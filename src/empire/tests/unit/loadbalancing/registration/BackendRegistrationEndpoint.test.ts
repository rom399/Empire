import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { createBackendRegistrationEndpoint } from "../../../../src/loadbalancing/registration/BackendRegistrationEndpoint";
import { BackendRegistry } from "../../../../src/loadbalancing/backends/BackendRegistry";
import { BackendRegistrationEndpointOptions } from "../../../../src/loadbalancing/registration/BackendRegistrationEndpointOptions";
import { Context } from "../../../../src/http/Context";
import { HttpError } from "../../../../src/errors/HttpError";
import { ValidationError } from "../../../../src/errors/ValidationError";
import { createMockRequest, createMockResponse, MockResponse } from "../../../fixtures/http/MockHttp";

const TOKEN = "s3cret-token";
const MOUNT = "/_lb/registry";
const BACKEND_URL = "http://127.0.0.1:5001";

interface CallOptions {
    headers?: Record<string, string>;
    body?: unknown;
    remoteAddress?: string;
    authorize?: boolean;
}

interface CallResult {
    res: MockResponse;
    nextCalled: boolean;
    error?: unknown;
    status: number;
    json: () => unknown;
}

describe("createBackendRegistrationEndpoint", () => {

    let registry: BackendRegistry;

    beforeEach(() => {
        registry = new BackendRegistry({ leaseTtlMs: 9000 });
    });

    afterEach(() => {
        registry.dispose();
        vi.restoreAllMocks();
    });

    function endpoint(options: Partial<BackendRegistrationEndpointOptions> = {}) {
        return createBackendRegistrationEndpoint(registry, { path: MOUNT, token: TOKEN, ...options });
    }

    async function call(
        middleware: ReturnType<typeof endpoint>,
        method: string,
        path: string,
        options: CallOptions = {}
    ): Promise<CallResult> {
        const headers: Record<string, string> = { host: "localhost", ...options.headers };

        if (options.authorize !== false && headers.authorization === undefined) {
            headers.authorization = `Bearer ${TOKEN}`;
        }

        const req = createMockRequest({
            method, url: path, headers,
            body: options.body === undefined ? undefined : JSON.stringify(options.body),
            socket: { remoteAddress: "remoteAddress" in options ? options.remoteAddress : "127.0.0.1" },
        });
        const res = createMockResponse();
        const ctx = new Context(req, res as unknown as never);

        let nextCalled = false;
        let error: unknown;

        try {
            await middleware(ctx, async () => { nextCalled = true; });
        } catch (err) {
            error = err;
        }

        return {
            res, nextCalled, error,
            status: error instanceof HttpError ? error.statusCode : res.statusCode,
            json: () => JSON.parse(res.body) as unknown,
        };
    }

    describe("registration", () => {

        it("answers 201 with the lease TTL for a new backend", async () => {
            const result = await call(endpoint(), "PUT", `${MOUNT}/alpha`, { body: { url: BACKEND_URL } });

            expect(result.status).toBe(201);
            expect(result.json()).toEqual({ leaseTtlMs: 9000 });
            expect(registry.eligible().map((backend) => backend.id)).toEqual(["alpha"]);
        });

        it("answers 200 when the same backend renews", async () => {
            const middleware = endpoint();

            await call(middleware, "PUT", `${MOUNT}/alpha`, { body: { url: BACKEND_URL } });
            const renewal = await call(middleware, "PUT", `${MOUNT}/alpha`, { body: { url: BACKEND_URL } });

            expect(renewal.status).toBe(200);
            expect(registry.eligible()).toHaveLength(1);
        });

        it("answers 409 when a live id is claimed for a different URL", async () => {
            const middleware = endpoint();

            await call(middleware, "PUT", `${MOUNT}/alpha`, { body: { url: BACKEND_URL } });
            const clash = await call(middleware, "PUT", `${MOUNT}/alpha`, { body: { url: "http://127.0.0.1:6000" } });

            expect(clash.status).toBe(409);
        });

        it("answers 409 for a static backend's id", async () => {
            registry.addStatic({ id: "legacy", url: BACKEND_URL });

            const result = await call(endpoint(), "PUT", `${MOUNT}/legacy`, { body: { url: BACKEND_URL } });

            expect(result.status).toBe(409);
        });

        it("rejects an invalid id with a 400 validation error", async () => {
            const result = await call(endpoint(), "PUT", `${MOUNT}/bad%20id`, { body: { url: BACKEND_URL } });

            expect(result.error).toBeInstanceOf(ValidationError);
            expect(result.status).toBe(400);
            expect(registry.eligible()).toEqual([]);
        });

        it.each([
            ["a non-http URL", { url: "ftp://example.com" }],
            ["a URL with a path", { url: "http://127.0.0.1:5001/api" }],
            ["a missing url", {}],
            ["a non-string url", { url: 42 }],
        ])("rejects %s with a 400 validation error", async (_label, body) => {
            const result = await call(endpoint(), "PUT", `${MOUNT}/alpha`, { body });

            expect(result.error).toBeInstanceOf(ValidationError);
            expect(registry.eligible()).toEqual([]);
        });

        it("rejects a body that is not JSON with 400", async () => {
            const req = createMockRequest({
                method: "PUT", url: `${MOUNT}/alpha`, body: "not json",
                headers: { host: "localhost", authorization: `Bearer ${TOKEN}` },
            });
            const ctx = new Context(req, createMockResponse() as unknown as never);

            await expect(endpoint()(ctx, async () => undefined)).rejects.toMatchObject({ statusCode: 400 });
        });
    });

    describe("deregistration", () => {

        it("answers 204 and removes the backend", async () => {
            const middleware = endpoint();
            await call(middleware, "PUT", `${MOUNT}/alpha`, { body: { url: BACKEND_URL } });

            const result = await call(middleware, "DELETE", `${MOUNT}/alpha`);

            expect(result.status).toBe(204);
            expect(registry.eligible()).toEqual([]);
        });

        it("answers 204 again when the backend is already gone", async () => {
            const result = await call(endpoint(), "DELETE", `${MOUNT}/ghost`);

            expect(result.status).toBe(204);
        });

        it("answers 409 for a static backend", async () => {
            registry.addStatic({ id: "legacy", url: BACKEND_URL });

            const result = await call(endpoint(), "DELETE", `${MOUNT}/legacy`);

            expect(result.status).toBe(409);
            expect(registry.eligible()).toHaveLength(1);
        });
    });

    describe("listing", () => {

        it("answers GET on the mount path with the registered backends", async () => {
            const middleware = endpoint();
            await call(middleware, "PUT", `${MOUNT}/alpha`, { body: { url: BACKEND_URL } });

            const result = await call(middleware, "GET", MOUNT);

            expect(result.status).toBe(200);
            expect((result.json() as { backends: { id: string }[] }).backends.map((backend) => backend.id)).toEqual(["alpha"]);
        });

        it("also answers on the mount path with a trailing slash", async () => {
            const result = await call(endpoint(), "GET", `${MOUNT}/`);

            expect(result.status).toBe(200);
        });

        it("rejects a non-GET method on the list path with 405 and an Allow header", async () => {
            const result = await call(endpoint(), "POST", MOUNT);

            expect(result.status).toBe(405);
            expect(result.res.getHeader("allow")).toBe("GET");
        });
    });

    describe("routing", () => {

        it("rejects an unsupported method on an id path with 405 and an Allow header", async () => {
            const result = await call(endpoint(), "PATCH", `${MOUNT}/alpha`);

            expect(result.status).toBe(405);
            expect(result.res.getHeader("allow")).toBe("PUT, DELETE");
        });

        it.each(["/", "/users", "/_lb", "/_lb/registryx", "/_lb/registry/a/b"])(
            "passes %s through to next()",
            async (path) => {
                const result = await call(endpoint(), "GET", path, { authorize: false });

                expect(result.nextCalled).toBe(true);
                expect(result.error).toBeUndefined();
            }
        );

        it("tolerates a trailing slash on the configured path", async () => {
            const result = await call(endpoint({ path: `${MOUNT}/` }), "GET", MOUNT);

            expect(result.status).toBe(200);
        });

        it("does not treat an unrelated request as needing a token", async () => {
            const result = await call(endpoint(), "GET", "/users", { authorize: false });

            expect(result.nextCalled).toBe(true);
        });
    });

    describe("authentication", () => {

        it("answers 401 without an Authorization header", async () => {
            const result = await call(endpoint(), "GET", MOUNT, { authorize: false });

            expect(result.status).toBe(401);
            expect(result.res.getHeader("www-authenticate")).toBe("Bearer");
        });

        it("answers 401 for a wrong token", async () => {
            const result = await call(endpoint(), "GET", MOUNT, { headers: { authorization: "Bearer nope" } });

            expect(result.status).toBe(401);
        });

        it("answers 401 for a token that only shares a prefix with the real one", async () => {
            const result = await call(endpoint(), "GET", MOUNT, { headers: { authorization: `Bearer ${TOKEN}x` } });

            expect(result.status).toBe(401);
        });

        it("answers 401 for a non-Bearer scheme", async () => {
            const result = await call(endpoint(), "GET", MOUNT, { headers: { authorization: `Basic ${TOKEN}` } });

            expect(result.status).toBe(401);
        });

        it("does not reveal why a request was rejected", async () => {
            const missing = await call(endpoint(), "GET", MOUNT, { authorize: false });
            const wrong = await call(endpoint(), "GET", MOUNT, { headers: { authorization: "Bearer nope" } });

            expect((missing.error as HttpError).message).toBe((wrong.error as HttpError).message);
        });

        it("accepts a lower-case bearer scheme", async () => {
            const result = await call(endpoint(), "GET", MOUNT, { headers: { authorization: `bearer ${TOKEN}` } });

            expect(result.status).toBe(200);
        });

        it("does not touch the registry for an unauthorized write", async () => {
            const result = await call(endpoint(), "PUT", `${MOUNT}/alpha`, {
                authorize: false, body: { url: BACKEND_URL },
            });

            expect(result.status).toBe(401);
            expect(registry.eligible()).toEqual([]);
        });
    });

    describe("startup validation", () => {

        it("throws at creation when no token is given", () => {
            expect(() => createBackendRegistrationEndpoint(registry, { path: MOUNT })).toThrow(/requires a token/);
        });

        it("throws at creation for an empty token", () => {
            expect(() => endpoint({ token: "" })).toThrow(/requires a token/);
        });

        it("allows running without a token only when allowUnauthenticated is explicit", async () => {
            const open = createBackendRegistrationEndpoint(registry, { path: MOUNT, allowUnauthenticated: true });

            const result = await call(open, "PUT", `${MOUNT}/alpha`, { authorize: false, body: { url: BACKEND_URL } });

            expect(result.status).toBe(201);
        });

        it("throws for a path that does not start with a slash", () => {
            expect(() => endpoint({ path: "registry" })).toThrow(/must start with/);
        });
    });

    describe("loopback guard", () => {

        it.each(["203.0.113.9", "10.0.0.5", "::ffff:192.168.1.10", "2001:db8::1", undefined])(
            "answers 403 to a remote client at %s",
            async (remoteAddress) => {
                const result = await call(endpoint(), "GET", MOUNT, { remoteAddress: remoteAddress as string });

                expect(result.status).toBe(403);
            }
        );

        it.each(["127.0.0.1", "127.5.5.5", "::1", "::ffff:127.0.0.1"])(
            "serves loopback client %s",
            async (remoteAddress) => {
                const result = await call(endpoint(), "GET", MOUNT, { remoteAddress });

                expect(result.status).toBe(200);
            }
        );

        it("serves a remote client when allowRemote is set", async () => {
            const result = await call(endpoint({ allowRemote: true }), "GET", MOUNT, { remoteAddress: "203.0.113.9" });

            expect(result.status).toBe(200);
        });

        it("cannot be bypassed by a spoofed X-Forwarded-For header", async () => {
            const result = await call(endpoint(), "GET", MOUNT, {
                remoteAddress: "203.0.113.9",
                headers: { "x-forwarded-for": "127.0.0.1" },
            });

            expect(result.status).toBe(403);
        });

        it("checks the guard before the token, so a remote caller learns nothing about auth", async () => {
            const result = await call(endpoint(), "GET", MOUNT, { remoteAddress: "203.0.113.9", authorize: false });

            expect(result.status).toBe(403);
        });
    });
});
