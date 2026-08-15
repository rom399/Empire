import { describe, it, expect, afterEach } from "vitest";
import { Empire } from "../../src/Empire";
import { ConsoleLogger } from "../../src/logging/ConsoleLogger";
import { TestLogger } from "../fixtures/services/TestLogger";

/**
 * Server lifecycle, logger injection (Phase 1), and routing method
 * delegation (Phase 3 — PUT/PATCH/DELETE registered via Empire reach the
 * server; GET/POST have no equivalent test here yet, and Router.test.ts
 * already covers the underlying dispatch logic these thinly wrap).
 * Middleware and static-file dispatch through Empire are covered
 * separately once those sections of Phase 9.2 are written.
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

    describe("routing", () => {

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
