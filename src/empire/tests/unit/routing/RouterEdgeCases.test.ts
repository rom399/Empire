import { describe, it, expect } from "vitest";
import { Router } from "../../../src/routing/Router";
import { RouteMatcher } from "../../../src/routing/RouteMatcher";
import { TestLogger } from "../../fixtures/services/TestLogger";
import { createMockRequest, createMockResponse } from "../../fixtures/http/MockHttp";

/**
 * FINDING 10 — route params are never URL-decoded. Router splits req.url raw
 * while Context.path uses URL.pathname, so the two disagree about what the
 * request path is.
 *
 * FINDING 11 — matching is first-registered-wins, which is reasonable but
 * undocumented and easy to get wrong.
 *
 * FINDING 12 — RouteMatcher filters empty segments, so "//users//1" matches
 * "/users/:id". Multiple URLs map to one route with no canonical form.
 */
describe("Router edge cases", () => {

    async function dispatch(router: Router, url: string, method = "GET") {
        const req = createMockRequest({ method, url });
        const res = createMockResponse();
        await router.handle(req, res);
        return res;
    }

    describe("parameter decoding", () => {

        it("decodes percent-encoded route parameters", async () => {
            const router = new Router(new TestLogger());
            router.get("/users/:name", (ctx) => ctx.json({ name: ctx.params.name }));

            const res = await dispatch(router, "/users/john%20smith");

            expect(JSON.parse(res.body)).toEqual({ name: "john smith" });
        });

        it("decodes non-ASCII route parameters", async () => {
            const router = new Router(new TestLogger());
            router.get("/tags/:tag", (ctx) => ctx.json({ tag: ctx.params.tag }));

            const res = await dispatch(router, "/tags/%E6%97%A5%E6%9C%AC");

            expect(JSON.parse(res.body)).toEqual({ tag: "日本" });
        });

        it("agrees with Context.path about the request path", async () => {
            const router = new Router(new TestLogger());
            let seenPath = "";

            router.get("/files/:name", (ctx) => {
                seenPath = ctx.path;
                ctx.json({});
            });

            await dispatch(router, "/files/a%20b");

            // Router matched on the raw string; Context.path reports the decoded one.
            expect(seenPath).toBe("/files/a b");
        });

        it("rejects rather than matching when a route parameter has malformed percent-encoding", async () => {
            const router = new Router(new TestLogger());
            router.get("/users/:name", (ctx) => ctx.json({ name: ctx.params.name }));

            // "%zz" isn't a valid percent-encoded triplet — decodeURIComponent()
            // throws a URIError. Router.handle() has no try/catch of its own
            // around matching, so this propagates as a rejection here; it's
            // Empire's pipeline-level error handling that turns this into a
            // safe response in a real app — see MalformedRequestPath.test.ts.
            await expect(dispatch(router, "/users/%zz")).rejects.toThrow();
        });
    });

    describe("path normalisation", () => {

        it("does not match a path containing empty segments", () => {
            const matcher = new RouteMatcher();

            // "//users//1" currently matches because filter(Boolean) drops the gaps.
            expect(matcher.match("/users/:id", "//users//1").matched).toBe(false);
        });

        it("matches a trailing slash as the same route", () => {
            const matcher = new RouteMatcher();

            expect(matcher.match("/users", "/users/").matched).toBe(true);
        });
    });

    describe("registration order", () => {

        it("prefers a literal segment over a parameter regardless of order", async () => {
            const router = new Router(new TestLogger());

            // Registered param-first on purpose.
            router.get("/users/:id", (ctx) => ctx.text("param"));
            router.get("/users/new", (ctx) => ctx.text("literal"));

            const res = await dispatch(router, "/users/new");

            expect(res.body).toBe("literal");
        });
    });

    describe("405 handling", () => {

        it("returns 405 with an Allow header for a wrong method", async () => {
            const router = new Router(new TestLogger());
            router.get("/users", (ctx) => ctx.text("ok"));

            const res = await dispatch(router, "/users", "POST");

            expect(res.statusCode).toBe(405);
            expect(String(res.getHeader("allow"))).toContain("GET");
        });
    });
});
