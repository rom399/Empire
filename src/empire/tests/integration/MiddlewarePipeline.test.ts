import { describe, it, expect, afterEach } from "vitest";
import { Empire } from "../../src/Empire";
import { TestLogger } from "../fixtures/services/TestLogger";

/**
 * FINDING 3 — Empire.handleRequest() has no try/catch. Router.invokeHandler()
 * wraps route handlers, but a middleware that throws produces an unhandled
 * rejection and no response.
 *
 * FINDING 4 — `index` is shared across the next() closure, so calling next()
 * twice advances the pipeline twice instead of erroring.
 *
 * FINDING 5 — the shipped LoggerMiddleware and AuthMiddleware call next()
 * without awaiting it, so the pipeline resolves before downstream work runs.
 */
describe("Middleware pipeline", () => {

    let app: Empire | undefined;
    let port = 43200;

    afterEach(async () => {
        await app?.stop();
        app = undefined;
    });

    function makeApp(): Empire {
        port += 1;
        app = new Empire({ host: "127.0.0.1", port, logger: new TestLogger() });
        return app;
    }

    it("returns 500 when a middleware throws instead of crashing", async () => {
        const a = makeApp();

        a.use(async function explodes() {
            throw new Error("middleware blew up");
        });

        a.get("/", (ctx) => ctx.text("never reached"));

        await a.start();
        const res = await fetch(`http://127.0.0.1:${port}/`);

        expect(res.status).toBe(500);
    });

    it("returns the mapped status when a middleware throws an HttpError", async () => {
        const { HttpError } = await import("../../src/errors/HttpError");
        const a = makeApp();

        a.use(async function unauthorised() {
            throw new HttpError(401, "Nope");
        });

        a.get("/", (ctx) => ctx.text("never reached"));

        await a.start();
        const res = await fetch(`http://127.0.0.1:${port}/`);

        expect(res.status).toBe(401);
    });

    it("throws if a middleware calls next() more than once", async () => {
        const a = makeApp();
        let downstreamCalls = 0;

        a.use(async function callsTwice(_ctx, next) {
            await next();
            await next();
        });

        a.use(async function counts(_ctx, next) {
            downstreamCalls += 1;
            await next();
        });

        a.get("/", (ctx) => ctx.text("ok"));

        await a.start();
        await fetch(`http://127.0.0.1:${port}/`);

        // Today the second next() skips ahead and re-dispatches the router.
        expect(downstreamCalls).toBe(1);
    });

    it("runs middleware in registration order", async () => {
        const a = makeApp();
        const order: string[] = [];

        a.use(async function first(_ctx, next) {
            order.push("first-in");
            await next();
            order.push("first-out");
        });

        a.use(async function second(_ctx, next) {
            order.push("second-in");
            await next();
            order.push("second-out");
        });

        a.get("/", (ctx) => {
            order.push("handler");
            ctx.text("ok");
        });

        await a.start();
        await fetch(`http://127.0.0.1:${port}/`);

        expect(order).toEqual([
            "first-in", "second-in", "handler", "second-out", "first-out",
        ]);
    });

    it("waits for downstream work before unwinding the pipeline", async () => {
        const a = makeApp();
        let handlerFinished = false;
        let sawHandlerFinished = false;

        a.use(async function outer(_ctx, next) {
            await next();
            sawHandlerFinished = handlerFinished;
        });

        a.get("/", async (ctx) => {
            await new Promise((r) => setTimeout(r, 20));
            handlerFinished = true;
            ctx.text("ok");
        });

        await a.start();
        await fetch(`http://127.0.0.1:${port}/`);

        expect(sawHandlerFinished).toBe(true);
    });
});
