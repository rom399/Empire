import { describe, it, expect, vi, afterEach } from "vitest";
import { createCorsMiddleware } from "../../../src/middleware/CorsMiddleware";
import { Context } from "../../../src/http/Context";
import { createMockRequest, createMockResponse, MockResponse } from "../../fixtures/http/MockHttp";

/**
 * Covers doc/features/CORS.md §5's test list. Two entries there conflict
 * ("credentials: true always echoes the specific request's Origin ... even
 * when origin is configured as '*'" vs. the very next entry, "throws
 * synchronously at creation time" for that exact combination) - the crash
 * guard (§2.4) is the one actually implemented, so the credentials test
 * below uses an array config instead of the literal wildcard.
 */
describe("createCorsMiddleware", () => {

    function ctxFor(request: {
        method?: string;
        headers?: Record<string, string>;
    }): { ctx: Context; res: MockResponse } {
        const req = createMockRequest({ method: request.method ?? "GET", url: "/", headers: request.headers });
        const res = createMockResponse();
        return { ctx: new Context(req, res as unknown as never), res };
    }

    function next(): { fn: () => Promise<void>; called: () => boolean } {
        let called = false;
        return { fn: async () => { called = true; }, called: () => called };
    }

    describe("origin matching (non-preflight)", () => {

        it("sets Access-Control-Allow-Origin for an allowed string origin", async () => {
            const middleware = createCorsMiddleware({ origin: "http://allowed.example" });
            const { ctx, res } = ctxFor({ headers: { origin: "http://allowed.example" } });

            await middleware(ctx, next().fn);

            expect(res.getHeader("access-control-allow-origin")).toBe("http://allowed.example");
        });

        it("does not set Access-Control-Allow-Origin for a disallowed origin", async () => {
            const middleware = createCorsMiddleware({ origin: "http://allowed.example" });
            const { ctx, res } = ctxFor({ headers: { origin: "http://evil.example" } });

            await middleware(ctx, next().fn);

            expect(res.getHeader("access-control-allow-origin")).toBeUndefined();
        });

        it("matches an array of origins", async () => {
            const middleware = createCorsMiddleware({ origin: ["http://a.example", "http://b.example"] });
            const { ctx, res } = ctxFor({ headers: { origin: "http://b.example" } });

            await middleware(ctx, next().fn);

            expect(res.getHeader("access-control-allow-origin")).toBe("http://b.example");
        });

        it("matches via a function, passed the request's actual Origin", async () => {
            const originFn = vi.fn((origin: string) => origin.endsWith(".example"));
            const middleware = createCorsMiddleware({ origin: originFn });
            const { ctx, res } = ctxFor({ headers: { origin: "http://sub.example" } });

            await middleware(ctx, next().fn);

            expect(originFn).toHaveBeenCalledWith("http://sub.example");
            expect(res.getHeader("access-control-allow-origin")).toBe("http://sub.example");
        });

        it("a function returning false leaves the header unset", async () => {
            const middleware = createCorsMiddleware({ origin: () => false });
            const { ctx, res } = ctxFor({ headers: { origin: "http://anything.example" } });

            await middleware(ctx, next().fn);

            expect(res.getHeader("access-control-allow-origin")).toBeUndefined();
        });

        it("calls next() for a normal request", async () => {
            const middleware = createCorsMiddleware({ origin: "*" });
            const { ctx } = ctxFor({ headers: { origin: "http://allowed.example" } });
            const n = next();

            await middleware(ctx, n.fn);

            expect(n.called()).toBe(true);
        });
    });

    describe("no Origin header at all", () => {

        it("calls next() with no CORS headers added, for a normal request", async () => {
            const middleware = createCorsMiddleware({ origin: "http://allowed.example" });
            const { ctx, res } = ctxFor({});
            const n = next();

            await middleware(ctx, n.fn);

            expect(n.called()).toBe(true);
            expect(res.getHeader("access-control-allow-origin")).toBeUndefined();
        });

        it("calls next() rather than short-circuiting, even for an OPTIONS request carrying Access-Control-Request-Method", async () => {
            const middleware = createCorsMiddleware({ origin: "http://allowed.example" });
            const { ctx, res } = ctxFor({
                method: "OPTIONS",
                headers: { "access-control-request-method": "GET" },
            });
            const n = next();

            await middleware(ctx, n.fn);

            expect(n.called()).toBe(true);
            expect(res.statusCode).toBe(200);
        });
    });

    describe("preflight detection & short-circuit", () => {

        it("intercepts a genuine preflight (Origin + Access-Control-Request-Method) and never calls next()", async () => {
            const middleware = createCorsMiddleware({ origin: "http://allowed.example" });
            const { ctx, res } = ctxFor({
                method: "OPTIONS",
                headers: { origin: "http://allowed.example", "access-control-request-method": "POST" },
            });
            const n = next();

            await middleware(ctx, n.fn);

            expect(n.called()).toBe(false);
            expect(res.statusCode).toBe(204);
        });

        it("still calls next() for a non-preflight OPTIONS request (no Access-Control-Request-Method)", async () => {
            const middleware = createCorsMiddleware({ origin: "http://allowed.example" });
            const { ctx, res } = ctxFor({
                method: "OPTIONS",
                headers: { origin: "http://allowed.example" },
            });
            const n = next();

            await middleware(ctx, n.fn);

            expect(n.called()).toBe(true);
            expect(res.getHeader("access-control-allow-methods")).toBeUndefined();
        });

        it("still answers 204 for a preflight from a disallowed origin, but omits the CORS headers", async () => {
            const middleware = createCorsMiddleware({ origin: "http://allowed.example" });
            const { ctx, res } = ctxFor({
                method: "OPTIONS",
                headers: { origin: "http://evil.example", "access-control-request-method": "POST" },
            });
            const n = next();

            await middleware(ctx, n.fn);

            expect(n.called()).toBe(false);
            expect(res.statusCode).toBe(204);
            expect(res.getHeader("access-control-allow-origin")).toBeUndefined();
            expect(res.getHeader("access-control-allow-methods")).toBeUndefined();
        });

        it("a preflight requesting a method outside CorsOptions.methods still gets 204, that method simply absent", async () => {
            const middleware = createCorsMiddleware({ origin: "*", methods: ["GET", "POST"] });
            const { ctx, res } = ctxFor({
                method: "OPTIONS",
                headers: { origin: "http://any.example", "access-control-request-method": "DELETE" },
            });

            await middleware(ctx, next().fn);

            expect(res.statusCode).toBe(204);
            expect(res.getHeader("access-control-allow-methods")).toBe("GET, POST");
        });
    });

    describe("Allow header on preflight (C-3)", () => {

        it("includes a plain Allow header matching Access-Control-Allow-Methods, sourced from CorsOptions.methods", async () => {
            const middleware = createCorsMiddleware({ origin: "*", methods: ["GET", "POST"] });
            const { ctx, res } = ctxFor({
                method: "OPTIONS",
                headers: { origin: "http://any.example", "access-control-request-method": "GET" },
            });

            await middleware(ctx, next().fn);

            expect(res.getHeader("allow")).toBe("GET, POST");
            expect(res.getHeader("access-control-allow-methods")).toBe("GET, POST");
        });

        it("defaults methods to GET, POST, PUT, PATCH, DELETE, OPTIONS when unconfigured", async () => {
            const middleware = createCorsMiddleware({ origin: "*" });
            const { ctx, res } = ctxFor({
                method: "OPTIONS",
                headers: { origin: "http://any.example", "access-control-request-method": "GET" },
            });

            await middleware(ctx, next().fn);

            expect(res.getHeader("allow")).toBe("GET, POST, PUT, PATCH, DELETE, OPTIONS");
        });
    });

    describe("credentials", () => {

        it("echoes the specific request Origin, never *, when origin is an array (§2.4)", async () => {
            const middleware = createCorsMiddleware({
                origin: ["http://a.example", "http://b.example"],
                credentials: true,
            });
            const { ctx, res } = ctxFor({ headers: { origin: "http://b.example" } });

            await middleware(ctx, next().fn);

            expect(res.getHeader("access-control-allow-origin")).toBe("http://b.example");
            expect(res.getHeader("access-control-allow-credentials")).toBe("true");
        });

        it("sets Access-Control-Allow-Credentials on a preflight too", async () => {
            const middleware = createCorsMiddleware({ origin: "http://allowed.example", credentials: true });
            const { ctx, res } = ctxFor({
                method: "OPTIONS",
                headers: { origin: "http://allowed.example", "access-control-request-method": "GET" },
            });

            await middleware(ctx, next().fn);

            expect(res.getHeader("access-control-allow-credentials")).toBe("true");
        });

        it("does not set Access-Control-Allow-Credentials when unconfigured", async () => {
            const middleware = createCorsMiddleware({ origin: "http://allowed.example" });
            const { ctx, res } = ctxFor({ headers: { origin: "http://allowed.example" } });

            await middleware(ctx, next().fn);

            expect(res.getHeader("access-control-allow-credentials")).toBeUndefined();
        });
    });

    describe("allowedHeaders (C-5)", () => {

        it("sets Access-Control-Allow-Headers from the configured list, regardless of what was requested", async () => {
            const middleware = createCorsMiddleware({
                origin: "http://allowed.example",
                allowedHeaders: ["Content-Type", "Authorization"],
            });
            const { ctx, res } = ctxFor({
                method: "OPTIONS",
                headers: {
                    origin: "http://allowed.example",
                    "access-control-request-method": "POST",
                    "access-control-request-headers": "content-type, x-client-version",
                },
            });

            await middleware(ctx, next().fn);

            expect(res.getHeader("access-control-allow-headers")).toBe("Content-Type, Authorization");
        });

        it("never sets Access-Control-Allow-Headers when unconfigured, even if the preflight asked for headers", async () => {
            const middleware = createCorsMiddleware({ origin: "http://allowed.example" });
            const { ctx, res } = ctxFor({
                method: "OPTIONS",
                headers: {
                    origin: "http://allowed.example",
                    "access-control-request-method": "POST",
                    "access-control-request-headers": "authorization",
                },
            });

            await middleware(ctx, next().fn);

            expect(res.getHeader("access-control-allow-headers")).toBeUndefined();
        });
    });

    describe("exposedHeaders (C-6)", () => {

        it("sets Access-Control-Expose-Headers on the actual response", async () => {
            const middleware = createCorsMiddleware({
                origin: "http://allowed.example",
                exposedHeaders: ["X-Request-Id"],
            });
            const { ctx, res } = ctxFor({ headers: { origin: "http://allowed.example" } });

            await middleware(ctx, next().fn);

            expect(res.getHeader("access-control-expose-headers")).toBe("X-Request-Id");
        });

        it("does not set Access-Control-Expose-Headers on the preflight response", async () => {
            const middleware = createCorsMiddleware({
                origin: "http://allowed.example",
                exposedHeaders: ["X-Request-Id"],
            });
            const { ctx, res } = ctxFor({
                method: "OPTIONS",
                headers: { origin: "http://allowed.example", "access-control-request-method": "GET" },
            });

            await middleware(ctx, next().fn);

            expect(res.getHeader("access-control-expose-headers")).toBeUndefined();
        });

        it("never sets Access-Control-Expose-Headers when unconfigured", async () => {
            const middleware = createCorsMiddleware({ origin: "http://allowed.example" });
            const { ctx, res } = ctxFor({ headers: { origin: "http://allowed.example" } });

            await middleware(ctx, next().fn);

            expect(res.getHeader("access-control-expose-headers")).toBeUndefined();
        });
    });

    describe("maxAge", () => {

        it("sets Access-Control-Max-Age on a preflight response", async () => {
            const middleware = createCorsMiddleware({ origin: "http://allowed.example", maxAge: 600 });
            const { ctx, res } = ctxFor({
                method: "OPTIONS",
                headers: { origin: "http://allowed.example", "access-control-request-method": "GET" },
            });

            await middleware(ctx, next().fn);

            expect(res.getHeader("access-control-max-age")).toBe("600");
        });

        it("never sets Access-Control-Max-Age on an actual (non-preflight) response", async () => {
            const middleware = createCorsMiddleware({ origin: "http://allowed.example", maxAge: 600 });
            const { ctx, res } = ctxFor({ headers: { origin: "http://allowed.example" } });

            await middleware(ctx, next().fn);

            expect(res.getHeader("access-control-max-age")).toBeUndefined();
        });

        it("never sets Access-Control-Max-Age when unconfigured", async () => {
            const middleware = createCorsMiddleware({ origin: "http://allowed.example" });
            const { ctx, res } = ctxFor({
                method: "OPTIONS",
                headers: { origin: "http://allowed.example", "access-control-request-method": "GET" },
            });

            await middleware(ctx, next().fn);

            expect(res.getHeader("access-control-max-age")).toBeUndefined();
        });
    });

    describe("Vary: Origin (C-7)", () => {

        it("is set on an actual response when origin is a string", async () => {
            const middleware = createCorsMiddleware({ origin: "http://allowed.example" });
            const { ctx, res } = ctxFor({ headers: { origin: "http://allowed.example" } });

            await middleware(ctx, next().fn);

            expect(res.getHeader("vary")).toBe("Origin");
        });

        it("is set on a preflight response too", async () => {
            const middleware = createCorsMiddleware({ origin: "http://allowed.example" });
            const { ctx, res } = ctxFor({
                method: "OPTIONS",
                headers: { origin: "http://allowed.example", "access-control-request-method": "GET" },
            });

            await middleware(ctx, next().fn);

            expect(res.getHeader("vary")).toBe("Origin");
        });

        it("is not set when origin is configured as the literal *", async () => {
            const middleware = createCorsMiddleware({ origin: "*" });
            const { ctx, res } = ctxFor({ headers: { origin: "http://allowed.example" } });

            await middleware(ctx, next().fn);

            expect(res.getHeader("vary")).toBeUndefined();
        });

        it("is appended to an existing Vary header rather than overwritten", async () => {
            const middleware = createCorsMiddleware({ origin: "http://allowed.example" });
            const { ctx, res } = ctxFor({ headers: { origin: "http://allowed.example" } });

            res.setHeader("Vary", "Accept-Encoding");

            await middleware(ctx, next().fn);

            expect(res.getHeader("vary")).toBe("Accept-Encoding, Origin");
        });
    });

    describe("multi-policy support (C-8)", () => {

        it("first match wins when more than one policy's match() would match", async () => {
            const middleware = createCorsMiddleware({
                policies: [
                    { match: () => true, options: { origin: "http://first.example" } },
                    { match: () => true, options: { origin: "http://second.example" } },
                ],
            });
            const { ctx, res } = ctxFor({ headers: { origin: "http://first.example" } });

            await middleware(ctx, next().fn);

            expect(res.getHeader("access-control-allow-origin")).toBe("http://first.example");
        });

        it("passes through untouched when no policy matches and there is no fallback", async () => {
            const middleware = createCorsMiddleware({
                policies: [{ match: () => false, options: { origin: "*" } }],
            });
            const { ctx, res } = ctxFor({ headers: { origin: "http://any.example" } });
            const n = next();

            await middleware(ctx, n.fn);

            expect(n.called()).toBe(true);
            expect(res.getHeader("access-control-allow-origin")).toBeUndefined();
            expect(res.getHeader("vary")).toBeUndefined();
        });

        it("uses the fallback options when no policy matches", async () => {
            const middleware = createCorsMiddleware({
                policies: [{ match: () => false, options: { origin: "http://never.example" } }],
                fallback: { origin: "http://fallback.example" },
            });
            const { ctx, res } = ctxFor({ headers: { origin: "http://fallback.example" } });

            await middleware(ctx, next().fn);

            expect(res.getHeader("access-control-allow-origin")).toBe("http://fallback.example");
        });
    });

    describe("crash paths (§2.4)", () => {

        let exitCode: number | undefined;
        let loggedMessage = "";

        const originalExit = process.exit;
        const originalError = console.error;

        function stubCrash(): void {
            exitCode = undefined;
            loggedMessage = "";

            process.exit = ((code?: number) => {
                exitCode = code;
                throw new Error("__process_exit_stub__");
            }) as typeof process.exit;

            console.error = (message: string) => {
                loggedMessage = message;
            };
        }

        afterEach(() => {
            process.exit = originalExit;
            console.error = originalError;
        });

        it("throws synchronously at creation time for credentials: true + origin: \"*\"", () => {
            stubCrash();

            expect(() => createCorsMiddleware({ origin: "*", credentials: true }))
                .toThrow("__process_exit_stub__");
            expect(exitCode).toBe(1);
            expect(loggedMessage).toMatch(/credentials.*origin.*"\*"/i);
        });

        it("does not crash for credentials: true with a non-wildcard origin", () => {
            expect(() => createCorsMiddleware({ origin: "http://allowed.example", credentials: true }))
                .not.toThrow();
        });

        it("crashes for a misconfigured policy other than the first one in the list", () => {
            stubCrash();

            expect(() =>
                createCorsMiddleware({
                    policies: [
                        { match: () => false, options: { origin: "http://fine.example" } },
                        { match: () => false, options: { origin: "*", credentials: true } },
                    ],
                })
            ).toThrow("__process_exit_stub__");
            expect(exitCode).toBe(1);
        });

        it("crashes for a misconfigured fallback policy", () => {
            stubCrash();

            expect(() =>
                createCorsMiddleware({
                    policies: [{ match: () => false, options: { origin: "http://fine.example" } }],
                    fallback: { origin: "*", credentials: true },
                })
            ).toThrow("__process_exit_stub__");
            expect(exitCode).toBe(1);
        });
    });
});
