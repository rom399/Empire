import { describe, it, expect } from "vitest";
import { Router } from "../../../src/routing/Router";
import { HttpError } from "../../../src/errors/HttpError";
import { TestLogger } from "../../fixtures/services/TestLogger";
import { createMockRequest, createMockResponse } from "../../fixtures/http/MockHttp";

describe("Router", () => {

    describe("get / post / put / patch / delete / handle", () => {

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

        it("dispatches a PUT request to a registered handler", async () => {
            const router = new Router(new TestLogger());
            router.put("/users/1", (ctx) => ctx.json({ updated: true }));

            const req = createMockRequest({ method: "PUT", url: "/users/1" });
            const res = createMockResponse();

            await router.handle(req, res);

            expect(res.statusCode).toBe(200);
            expect(res.body).toBe(JSON.stringify({ updated: true }));
        });

        it("dispatches a PATCH request to a registered handler", async () => {
            const router = new Router(new TestLogger());
            router.patch("/users/1", (ctx) => ctx.json({ patched: true }));

            const req = createMockRequest({ method: "PATCH", url: "/users/1" });
            const res = createMockResponse();

            await router.handle(req, res);

            expect(res.statusCode).toBe(200);
            expect(res.body).toBe(JSON.stringify({ patched: true }));
        });

        it("dispatches a DELETE request to a registered handler", async () => {
            const router = new Router(new TestLogger());
            router.delete("/users/1", (ctx) => ctx.status(204).text(""));

            const req = createMockRequest({ method: "DELETE", url: "/users/1" });
            const res = createMockResponse();

            await router.handle(req, res);

            expect(res.statusCode).toBe(204);
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

        it("returns 405 with an Allow header when the path matches but the method does not", async () => {
            const router = new Router(new TestLogger());
            router.get("/users", (ctx) => ctx.json({}));

            const req = createMockRequest({ method: "POST", url: "/users" });
            const res = createMockResponse();

            await router.handle(req, res);

            expect(res.statusCode).toBe(405);
            expect(res.getHeader("Allow")).toBe("GET, HEAD, OPTIONS");
        });

        it("lists every registered method in Allow when a path has more than one", async () => {
            const router = new Router(new TestLogger());
            router.get("/users", (ctx) => ctx.json({}));
            router.post("/users", (ctx) => ctx.json({}));
            router.put("/users", (ctx) => ctx.json({}));

            const req = createMockRequest({ method: "PATCH", url: "/users" });
            const res = createMockResponse();

            await router.handle(req, res);

            expect(res.statusCode).toBe(405);
            expect(res.getHeader("Allow")).toBe("GET, HEAD, POST, PUT, OPTIONS");
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

    describe("HEAD", () => {

        it("dispatches a HEAD request to the matching GET handler", async () => {
            const router = new Router(new TestLogger());
            let handlerRan = false;
            router.get("/users", (ctx) => {
                handlerRan = true;
                ctx.json({ ok: true });
            });

            const req = createMockRequest({ method: "HEAD", url: "/users" });
            const res = createMockResponse();

            await router.handle(req, res);

            expect(handlerRan).toBe(true);
        });

        it("sets the same headers a GET request would set", async () => {
            const router = new Router(new TestLogger());
            router.get("/users", (ctx) => ctx.json({ ok: true }));

            const req = createMockRequest({ method: "HEAD", url: "/users" });
            const res = createMockResponse();

            await router.handle(req, res);

            expect(res.statusCode).toBe(200);
            expect(res.getHeader("Content-Type")).toBe("application/json");
        });

        it("discards the response body", async () => {
            const router = new Router(new TestLogger());
            router.get("/users", (ctx) => ctx.json({ ok: true }));

            const req = createMockRequest({ method: "HEAD", url: "/users" });
            const res = createMockResponse();

            await router.handle(req, res);

            expect(res.body).toBe("");
        });

        it("returns 405 with an Allow header when no GET route matches the path", async () => {
            const router = new Router(new TestLogger());
            router.post("/users", (ctx) => ctx.json({}));

            const req = createMockRequest({ method: "HEAD", url: "/users" });
            const res = createMockResponse();

            await router.handle(req, res);

            expect(res.statusCode).toBe(405);
            expect(res.getHeader("Allow")).toBe("POST, OPTIONS");
        });

        it("includes HEAD in the Allow header alongside GET on a 405 for a different path's method", async () => {
            const router = new Router(new TestLogger());
            router.get("/users", (ctx) => ctx.json({}));

            const req = createMockRequest({ method: "DELETE", url: "/users" });
            const res = createMockResponse();

            await router.handle(req, res);

            expect(res.statusCode).toBe(405);
            expect(res.getHeader("Allow")).toBe("GET, HEAD, OPTIONS");
        });

        it("returns 404 when no route matches the path at all", async () => {
            const router = new Router(new TestLogger());
            router.get("/users", (ctx) => ctx.json({}));

            const req = createMockRequest({ method: "HEAD", url: "/nope" });
            const res = createMockResponse();

            await router.handle(req, res);

            expect(res.statusCode).toBe(404);
        });
    });

    describe("OPTIONS", () => {

        it("responds 204 with an Allow header listing every method registered for the path", async () => {
            const router = new Router(new TestLogger());
            router.get("/users", (ctx) => ctx.json({}));
            router.post("/users", (ctx) => ctx.json({}));

            const req = createMockRequest({ method: "OPTIONS", url: "/users" });
            const res = createMockResponse();

            await router.handle(req, res);

            expect(res.statusCode).toBe(204);
            expect(res.getHeader("Allow")).toBe("GET, HEAD, POST, OPTIONS");
        });

        it("lists HEAD alongside GET in the OPTIONS Allow header, same as the 405 case", async () => {
            const router = new Router(new TestLogger());
            router.get("/users", (ctx) => ctx.json({}));

            const req = createMockRequest({ method: "OPTIONS", url: "/users" });
            const res = createMockResponse();

            await router.handle(req, res);

            expect(res.getHeader("Allow")).toBe("GET, HEAD, OPTIONS");
        });

        it("dispatches to an explicitly registered OPTIONS handler instead of the automatic response, when one exists", async () => {
            const router = new Router(new TestLogger());
            router.get("/users", (ctx) => ctx.json({}));
            router.options("/users", (ctx) => ctx.status(200).json({ custom: true }));

            const req = createMockRequest({ method: "OPTIONS", url: "/users" });
            const res = createMockResponse();

            await router.handle(req, res);

            expect(res.statusCode).toBe(200);
            expect(res.body).toBe(JSON.stringify({ custom: true }));
        });

        it("returns 404 for OPTIONS on a path with no registered routes at all", async () => {
            const router = new Router(new TestLogger());
            router.get("/users", (ctx) => ctx.json({}));

            const req = createMockRequest({ method: "OPTIONS", url: "/nope" });
            const res = createMockResponse();

            await router.handle(req, res);

            expect(res.statusCode).toBe(404);
        });

        it("has no body by default", async () => {
            const router = new Router(new TestLogger());
            router.get("/users", (ctx) => ctx.json({}));

            const req = createMockRequest({ method: "OPTIONS", url: "/users" });
            const res = createMockResponse();

            await router.handle(req, res);

            expect(res.body).toBe("");
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
