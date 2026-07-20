import { describe, it, expect } from "vitest";
import { Router } from "../../../src/routing/Router";
import { HttpError } from "../../../src/errors/HttpError";
import { TestLogger } from "../../fixtures/services/TestLogger";
import { createMockRequest, createMockResponse } from "../../fixtures/http/MockHttp";

describe("Router", () => {

    describe("get / post / handle", () => {

        it("dispatches a GET request to a registered handler", async () => {
            const router = new Router(new TestLogger());
            router.get("/users", (ctx) => ctx.json({ ok: true }));

            const req = createMockRequest({ method: "GET", url: "/users" });
            const res = createMockResponse();

            await router.handle(req, res);

            expect(res.statusCode).toBe(200);
            expect(res.body).toBe(JSON.stringify({ ok: true }));
        });

        it("dispatches a POST request to a registered handler", async () => {
            const router = new Router(new TestLogger());
            router.post("/users", (ctx) => ctx.status(201).json({ created: true }));

            const req = createMockRequest({ method: "POST", url: "/users" });
            const res = createMockResponse();

            await router.handle(req, res);

            expect(res.statusCode).toBe(201);
            expect(res.body).toBe(JSON.stringify({ created: true }));
        });

        it("passes route parameters to the handler via ctx.params", async () => {
            const router = new Router(new TestLogger());
            let capturedParams: Record<string, string> = {};

            router.get("/users/:id", (ctx) => {
                capturedParams = ctx.params;
                ctx.json({});
            });

            const req = createMockRequest({ method: "GET", url: "/users/42" });
            const res = createMockResponse();

            await router.handle(req, res);

            expect(capturedParams).toEqual({ id: "42" });
        });

        it("matches the first registered route when patterns overlap", async () => {
            const router = new Router(new TestLogger());

            router.get("/users/new", (ctx) => ctx.text("static route"));
            router.get("/users/:id", (ctx) => ctx.text("param route"));

            const req = createMockRequest({ method: "GET", url: "/users/new" });
            const res = createMockResponse();

            await router.handle(req, res);

            expect(res.body).toBe("static route");
        });

        it('returns 404 with "Route not found" when no route matches', async () => {
            const router = new Router(new TestLogger());
            router.get("/users", (ctx) => ctx.json({}));

            const req = createMockRequest({ method: "GET", url: "/nope" });
            const res = createMockResponse();

            await router.handle(req, res);

            expect(res.statusCode).toBe(404);
            expect(res.body).toBe("Route not found");
        });

        it("returns 404 when the path matches but the method does not", async () => {
            const router = new Router(new TestLogger());
            router.get("/users", (ctx) => ctx.json({}));

            const req = createMockRequest({ method: "POST", url: "/users" });
            const res = createMockResponse();

            await router.handle(req, res);

            expect(res.statusCode).toBe(404);
        });

        it("returns the HttpError status code and JSON body when a handler throws HttpError", async () => {
            const router = new Router(new TestLogger());
            router.get("/users/:id", () => {
                throw new HttpError(404, "User not found");
            });

            const req = createMockRequest({ method: "GET", url: "/users/1" });
            const res = createMockResponse();

            await router.handle(req, res);

            expect(res.statusCode).toBe(404);
            expect(res.body).toBe(JSON.stringify({ error: "User not found" }));
        });

        it("returns 500 with a generic message when a handler throws a plain Error", async () => {
            const router = new Router(new TestLogger());
            router.get("/boom", () => {
                throw new Error("something broke");
            });

            const req = createMockRequest({ method: "GET", url: "/boom" });
            const res = createMockResponse();

            await router.handle(req, res);

            expect(res.statusCode).toBe(500);
            expect(res.body).toBe(JSON.stringify({ error: "Internal Server Error" }));
        });

        it("does not write a second response when headers were already sent", async () => {
            const router = new Router(new TestLogger());

            router.get("/partial", (ctx) => {
                ctx.res.end("already sent");
                throw new Error("boom after sending");
            });

            const req = createMockRequest({ method: "GET", url: "/partial" });
            const res = createMockResponse();

            await router.handle(req, res);

            expect(res.body).toBe("already sent");
            expect(res.statusCode).toBe(200);
        });
    });

    describe("setFallback", () => {

        it("invokes the fallback when no route matches a GET request", async () => {
            const router = new Router(new TestLogger());
            router.get("/api/users", (ctx) => ctx.json({ users: [] }));
            router.setFallback((ctx) => ctx.html("<html>shell</html>"));

            const req = createMockRequest({ method: "GET", url: "/about" });
            const res = createMockResponse();

            await router.handle(req, res);

            expect(res.statusCode).toBe(200);
            expect(res.body).toBe("<html>shell</html>");
        });

        it("prefers a matching route over the fallback", async () => {
            const router = new Router(new TestLogger());
            router.get("/api/users", (ctx) => ctx.json({ users: [] }));
            router.setFallback((ctx) => ctx.html("<html>shell</html>"));

            const req = createMockRequest({ method: "GET", url: "/api/users" });
            const res = createMockResponse();

            await router.handle(req, res);

            expect(res.body).toBe(JSON.stringify({ users: [] }));
        });

        it("does not invoke the fallback for non-GET requests", async () => {
            const router = new Router(new TestLogger());
            router.setFallback((ctx) => ctx.html("<html>shell</html>"));

            const req = createMockRequest({ method: "POST", url: "/about" });
            const res = createMockResponse();

            await router.handle(req, res);

            expect(res.statusCode).toBe(404);
            expect(res.body).toBe("Route not found");
        });

        it("replaces a previously registered fallback when called again", async () => {
            const router = new Router(new TestLogger());
            router.setFallback((ctx) => ctx.text("first"));
            router.setFallback((ctx) => ctx.text("second"));

            const req = createMockRequest({ method: "GET", url: "/anything" });
            const res = createMockResponse();

            await router.handle(req, res);

            expect(res.body).toBe("second");
        });
    });
});
