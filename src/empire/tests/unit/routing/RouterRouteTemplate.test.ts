import { describe, it, expect } from "vitest";
import { Router } from "../../../src/routing/Router";
import { Context } from "../../../src/http/Context";
import { TestLogger } from "../../fixtures/services/TestLogger";
import { createMockRequest, createMockResponse } from "../../fixtures/http/MockHttp";

/**
 * Context.route - the matched route pattern, as opposed to the concrete
 * request path - is what lets the load balancer's dashboard group
 * /users/1 and /users/2 as one endpoint. Covers doc/features/Loadbalancer-v1.md §2.7a.
 */
describe("Router - Context.route", () => {

    async function dispatch(router: Router, method: string, url: string): Promise<string | undefined> {
        const req = createMockRequest({ method, url });
        const res = createMockResponse();
        const ctx = new Context(req, res as unknown as never);

        await router.handle(req, res, ctx);

        return ctx.route;
    }

    it("is undefined until routing has run", () => {
        const ctx = new Context(createMockRequest(), createMockResponse() as unknown as never);

        expect(ctx.route).toBeUndefined();
    });

    it("is the registered pattern, not the concrete path", async () => {
        const router = new Router(new TestLogger());
        router.get("/users/:id", (ctx) => ctx.json({}));

        expect(await dispatch(router, "GET", "/users/42")).toBe("/users/:id");
    });

    it("is the pattern for a static route too", async () => {
        const router = new Router(new TestLogger());
        router.get("/health", (ctx) => ctx.json({}));

        expect(await dispatch(router, "GET", "/health")).toBe("/health");
    });

    it("ignores the query string", async () => {
        const router = new Router(new TestLogger());
        router.get("/search", (ctx) => ctx.json({}));

        expect(await dispatch(router, "GET", "/search?q=cats")).toBe("/search");
    });

    it("reports the pattern of the route that matched the request's method", async () => {
        const router = new Router(new TestLogger());
        router.get("/things/:id", (ctx) => ctx.json({}));
        router.post("/things/:thingId/actions", (ctx) => ctx.json({}));

        expect(await dispatch(router, "POST", "/things/7/actions")).toBe("/things/:thingId/actions");
    });

    it("reports the GET template for a HEAD request served by a GET route", async () => {
        const router = new Router(new TestLogger());
        router.get("/users/:id", (ctx) => ctx.json({}));

        expect(await dispatch(router, "HEAD", "/users/9")).toBe("/users/:id");
    });

    it("stays undefined for a 404", async () => {
        const router = new Router(new TestLogger());
        router.get("/users/:id", (ctx) => ctx.json({}));

        expect(await dispatch(router, "GET", "/nothing/here")).toBeUndefined();
    });

    it("stays undefined for a 405, where the path matched but the method did not", async () => {
        const router = new Router(new TestLogger());
        router.get("/users/:id", (ctx) => ctx.json({}));

        expect(await dispatch(router, "DELETE", "/users/1")).toBeUndefined();
    });

    it("stays undefined for the automatic OPTIONS response", async () => {
        const router = new Router(new TestLogger());
        router.get("/users/:id", (ctx) => ctx.json({}));

        expect(await dispatch(router, "OPTIONS", "/users/1")).toBeUndefined();
    });

    it("stays undefined when the SPA fallback answers, since no route matched", async () => {
        const router = new Router(new TestLogger());
        router.setFallback((ctx) => ctx.html("<html></html>"));

        expect(await dispatch(router, "GET", "/client/side/route")).toBeUndefined();
    });

    it("is visible to the handler itself", async () => {
        const router = new Router(new TestLogger());
        let seen: string | undefined;
        router.get("/orders/:orderId", (ctx) => { seen = ctx.route; ctx.json({}); });

        await dispatch(router, "GET", "/orders/5");

        expect(seen).toBe("/orders/:orderId");
    });

    it("sets it on the Context Router creates itself when none is passed in", async () => {
        const router = new Router(new TestLogger());
        let seen: string | undefined;
        router.get("/a/:b", (ctx) => { seen = ctx.route; ctx.json({}); });

        await router.handle(createMockRequest({ url: "/a/1" }), createMockResponse());

        expect(seen).toBe("/a/:b");
    });
});
