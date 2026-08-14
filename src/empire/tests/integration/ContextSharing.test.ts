import { describe, it, expect, afterEach } from "vitest";
import { Empire } from "../../src/Empire";
import { TestLogger } from "../fixtures/services/TestLogger";

/**
 * FINDING 1 — Middleware and route handlers receive different Context objects.
 *
 * Empire.handleRequest() constructs a Context and passes it through the
 * middleware chain. Router.handle() then constructs a SECOND Context for the
 * route handler. Anything a middleware attaches to ctx is silently discarded.
 *
 * These tests fail against the current implementation. They pass once Empire
 * builds the Context once and passes it into Router.handle(ctx).
 */
describe("Context sharing between middleware and handlers", () => {

    const PORT = 43101;
    let app: Empire | undefined;

    afterEach(async () => {
        await app?.stop();
        app = undefined;
    });

    it("gives the route handler the same Context instance the middleware saw", async () => {
        app = new Empire({ host: "127.0.0.1", port: PORT, logger: new TestLogger() });

        let middlewareCtx: unknown;
        let handlerCtx: unknown;

        app.use(async function captureMiddleware(ctx, next) {
            middlewareCtx = ctx;
            await next();
        });

        app.get("/probe", (ctx) => {
            handlerCtx = ctx;
            ctx.json({ ok: true });
        });

        await app.start();
        await fetch(`http://127.0.0.1:${PORT}/probe`);

        expect(handlerCtx).toBe(middlewareCtx);
    });

    it("carries state set by middleware through to the route handler", async () => {
        app = new Empire({ host: "127.0.0.1", port: PORT, logger: new TestLogger() });

        app.use(async function attachUser(ctx, next) {
            (ctx as unknown as Record<string, unknown>).user = { id: "u-1" };
            await next();
        });

        app.get("/me", (ctx) => {
            const user = (ctx as unknown as Record<string, unknown>).user;
            ctx.json({ user });
        });

        await app.start();
        const body = await (await fetch(`http://127.0.0.1:${PORT}/me`)).json();

        // This is the shape a validation or auth middleware depends on.
        expect(body).toEqual({ user: { id: "u-1" } });
    });

    it("still populates route params on the shared Context", async () => {
        app = new Empire({ host: "127.0.0.1", port: PORT, logger: new TestLogger() });

        app.use(async function passthrough(_ctx, next) {
            await next();
        });

        app.get("/users/:id", (ctx) => ctx.json({ id: ctx.params.id }));

        await app.start();
        const body = await (await fetch(`http://127.0.0.1:${PORT}/users/42`)).json();

        // Guards against a fix that shares the Context but drops params.
        expect(body).toEqual({ id: "42" });
    });
});
