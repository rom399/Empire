import { describe, it, expect, afterEach, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Empire } from "../../src/Empire";
import { ConsoleLogger } from "../../src/logging/ConsoleLogger";
import { TestLogger } from "../fixtures/services/TestLogger";
import { ServiceCollection } from "../../src/di/ServiceCollection";
import { createToken } from "../../src/di/ServiceToken";

/**
 * Server lifecycle, logger injection (Phase 1), routing method delegation
 * (Phase 3 — GET/POST/PUT/PATCH/DELETE registered via Empire all reach the
 * server; Router.test.ts already covers the underlying dispatch logic these
 * thinly wrap), middleware
 * pipeline behavior through Empire's real API — specifically the two
 * cases tests/integration/MiddlewarePipeline.test.ts doesn't already
 * cover (registration order, the double-next() guard, and error mapping
 * are covered there; a middleware that never calls next(), and the plain
 * success path, are covered here instead) — and useStaticFiles() through
 * Empire's real API, previously exercised only by
 * StaticFileStreamingAbort.test.ts, which is manual-only and gated out of
 * the normal suite (see that file for why).
 */
describe("Empire", () => {

    const instances: Empire[] = [];

    afterEach(async () => {
        while (instances.length > 0) {
            const app = instances.pop();
            try {
                await app?.stop();
            } catch {
                // already stopped or never started — fine to ignore in cleanup
            }
        }
    });

    function createApp(port: number, logger?: TestLogger): Empire {
        const app = new Empire({ host: "127.0.0.1", port, logger });
        instances.push(app);
        return app;
    }

    describe("start / stop", () => {

        it("starts the server so it accepts requests", async () => {
            const app = createApp(47001);

            await app.start();

            const response = await fetch("http://127.0.0.1:47001/");
            expect(response.status).toBe(404);
        });

        it("stops the server so it no longer accepts requests", async () => {
            const app = createApp(47002);

            await app.start();
            await app.stop();

            await expect(fetch("http://127.0.0.1:47002/")).rejects.toThrow();
        });

        it("rejects start() when the port is already in use", async () => {
            const first = createApp(47003);
            const second = createApp(47003);

            await first.start();

            await expect(second.start()).rejects.toThrow();
        });
    });

    describe("graceful shutdown", () => {

        it("disposes services registered via EmpireOptions.services when the server stops", async () => {
            const services = new ServiceCollection();
            const token = createToken<{ dispose(): void }>("Connection");
            let disposed = false;
            services.addSingleton(token, () => ({ dispose: () => { disposed = true; } }));
            const provider = services.build();

            const app = new Empire({ host: "127.0.0.1", port: 47017, services: provider });
            instances.push(app);

            await app.start();
            await app.services?.resolve(token);
            await app.stop();

            expect(disposed).toBe(true);
        });

        it("force-closes remaining connections once shutdownTimeoutMs elapses, instead of hanging forever", async () => {
            const logger = new TestLogger();
            const app = new Empire({ host: "127.0.0.1", port: 47018, shutdownTimeoutMs: 50, logger });
            instances.push(app);

            // Never resolves - simulates a request stuck mid-flight when
            // shutdown begins, forcing the timeout path to actually run.
            app.get("/hang", () => new Promise<void>(() => {}));

            await app.start();
            const hanging = fetch("http://127.0.0.1:47018/hang").catch(() => undefined);

            // Give the request time to actually be in flight before stopping.
            await new Promise((resolve) => setTimeout(resolve, 20));

            const startedAt = Date.now();
            await app.stop();
            const elapsedMs = Date.now() - startedAt;

            // Bounded well below the 10s default - proves the 50ms override
            // was honored rather than falling back to the default, and that
            // stop() doesn't simply wait for the hanging request forever.
            expect(elapsedMs).toBeLessThan(2000);
            expect(logger.errorMessages.some((m) => m.includes("Shutdown timed out"))).toBe(true);

            await hanging;
        });
    });

    describe("routing", () => {

        it("get() registers a route reachable via the server", async () => {
            const app = createApp(47015);
            app.get("/users/1", (ctx) => ctx.json({ id: "1" }));

            await app.start();
            const response = await fetch("http://127.0.0.1:47015/users/1");

            expect(response.status).toBe(200);
            expect(await response.json()).toEqual({ id: "1" });
        });

        it("post() registers a route reachable via the server", async () => {
            const app = createApp(47016);
            app.post("/users", (ctx) => ctx.status(201).json({ created: true }));

            await app.start();
            const response = await fetch("http://127.0.0.1:47016/users", { method: "POST" });

            expect(response.status).toBe(201);
            expect(await response.json()).toEqual({ created: true });
        });

        it("put() registers a route reachable via the server", async () => {
            const app = createApp(47007);
            app.put("/users/1", (ctx) => ctx.json({ updated: true }));

            await app.start();
            const response = await fetch("http://127.0.0.1:47007/users/1", { method: "PUT" });

            expect(response.status).toBe(200);
            expect(await response.json()).toEqual({ updated: true });
        });

        it("patch() registers a route reachable via the server", async () => {
            const app = createApp(47008);
            app.patch("/users/1", (ctx) => ctx.json({ patched: true }));

            await app.start();
            const response = await fetch("http://127.0.0.1:47008/users/1", { method: "PATCH" });

            expect(response.status).toBe(200);
            expect(await response.json()).toEqual({ patched: true });
        });

        it("delete() registers a route reachable via the server", async () => {
            const app = createApp(47009);
            app.delete("/users/1", (ctx) => ctx.status(204).text(""));

            await app.start();
            const response = await fetch("http://127.0.0.1:47009/users/1", { method: "DELETE" });

            expect(response.status).toBe(204);
        });
    });

    describe("middleware", () => {

        it("does not proceed to the next middleware when one does not call next()", async () => {
            const app = createApp(47010);
            let secondMiddlewareRan = false;
            let handlerRan = false;

            app.use(async () => {
                // Deliberately never calls next() — the chain should halt here.
            });

            app.use(async (_ctx, next) => {
                secondMiddlewareRan = true;
                await next();
            });

            app.get("/", (ctx) => {
                handlerRan = true;
                ctx.text("ok");
            });

            await app.start();

            const controller = new AbortController();
            const request = fetch("http://127.0.0.1:47010/", { signal: controller.signal }).catch(() => undefined);

            // The first middleware never calls next(), so the pipeline halts
            // with no response ever sent. Give it a moment to (not) progress,
            // then abort the still-pending request so the connection actually
            // closes — otherwise app.stop() in afterEach would hang waiting
            // for a request that will never complete.
            await new Promise((r) => setTimeout(r, 100));
            controller.abort();
            await request;

            expect(secondMiddlewareRan).toBe(false);
            expect(handlerRan).toBe(false);
        });

        it("dispatches to a registered route when the middleware chain completes", async () => {
            const app = createApp(47011);
            let middlewareRan = false;

            app.use(async (_ctx, next) => {
                middlewareRan = true;
                await next();
            });

            app.get("/", (ctx) => ctx.json({ ok: true }));

            await app.start();
            const response = await fetch("http://127.0.0.1:47011/");

            expect(middlewareRan).toBe(true);
            expect(response.status).toBe(200);
            expect(await response.json()).toEqual({ ok: true });
        });
    });

    describe("useStaticFiles", () => {

        let dir: string;

        beforeAll(() => {
            dir = fs.mkdtempSync(path.join(os.tmpdir(), "empire-test-static-"));
            fs.writeFileSync(path.join(dir, "hello.txt"), "hello from disk");
            fs.writeFileSync(path.join(dir, "index.html"), "<h1>SPA shell</h1>");
        });

        afterAll(() => {
            fs.rmSync(dir, { recursive: true, force: true });
        });

        it("useStaticFiles() serves a file from the given root", async () => {
            const app = createApp(47012);
            app.useStaticFiles(dir);

            await app.start();
            // Connection: close — otherwise fetch()'s keep-alive socket stays
            // open and app.stop() (afterEach) waits ~3s for the server's own
            // keepAliveTimeout to close it instead of returning immediately.
            const response = await fetch("http://127.0.0.1:47012/hello.txt", {
                headers: { connection: "close" },
            });

            expect(response.status).toBe(200);
            expect(await response.text()).toBe("hello from disk");
        });

        it("useStaticFiles() falls through to routing when no file matches", async () => {
            const app = createApp(47013);
            app.useStaticFiles(dir);
            app.get("/api/status", (ctx) => ctx.json({ ok: true }));

            await app.start();
            const response = await fetch("http://127.0.0.1:47013/api/status");

            expect(response.status).toBe(200);
            expect(await response.json()).toEqual({ ok: true });
        });

        it("useStaticFiles() with spaFallback serves index.html for an unmatched GET path", async () => {
            const app = createApp(47014);
            app.useStaticFiles(dir, { spaFallback: true });
            app.get("/api/status", (ctx) => ctx.json({ ok: true }));

            await app.start();
            const response = await fetch("http://127.0.0.1:47014/about", {
                headers: { connection: "close" },
            });

            expect(response.status).toBe(200);
            expect(await response.text()).toBe("<h1>SPA shell</h1>");
        });
    });

    describe("logger", () => {

        it("defaults to ConsoleLogger when none is provided", () => {
            const app = createApp(47004);

            expect(app.logger).toBeInstanceOf(ConsoleLogger);
        });

        it("uses the provided logger when one is passed in EmpireOptions", () => {
            const logger = new TestLogger();
            const app = createApp(47005, logger);

            expect(app.logger).toBe(logger);
        });

        it("logs a startup message through the injected logger on start()", async () => {
            const logger = new TestLogger();
            const app = createApp(47006, logger);

            await app.start();

            expect(logger.infoMessages.some((m) => m.includes("47006"))).toBe(true);
        });
    });
});
