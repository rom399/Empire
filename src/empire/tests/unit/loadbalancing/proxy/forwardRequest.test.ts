import { describe, it, expect, afterEach, beforeEach } from "vitest";
import http from "http";
import { randomBytes } from "crypto";
import { forwardRequest } from "../../../../src/loadbalancing/proxy/forwardRequest";
import { ForwardRequestOptions } from "../../../../src/loadbalancing/proxy/ForwardRequestOptions";
import { Backend } from "../../../../src/loadbalancing/Backend";
import { LoadBalancerEvent } from "../../../../src/loadbalancing/monitoring/LoadBalancerEvent";
import { LoadBalancerMonitor } from "../../../../src/loadbalancing/monitoring/LoadBalancerMonitor";
import { Context } from "../../../../src/http/Context";
import { sendErrorResponse } from "../../../../src/errors/sendErrorResponse";
import { getFreePort, startHttpServer } from "../../../fixtures/http/TestServers";
import { waitFor } from "../../../fixtures/http/waitFor";
import { TestLogger } from "../../../fixtures/services/TestLogger";

interface ClientResponse {
    status: number;
    headers: http.IncomingHttpHeaders;
    rawHeaders: string[];
    body: Buffer;
}

/** Real backends and a real proxy in front of them - forwardRequest is all about real sockets. */
describe("forwardRequest", () => {

    let logger: TestLogger;
    let monitor: LoadBalancerMonitor;
    let events: LoadBalancerEvent[];
    let agent: http.Agent;
    const stops: (() => Promise<void>)[] = [];

    beforeEach(() => {
        logger = new TestLogger();
        monitor = new LoadBalancerMonitor({ logger });
        events = [];
        monitor.subscribe((event) => events.push(event));
        agent = new http.Agent({ keepAlive: true });
    });

    afterEach(async () => {
        agent.destroy();

        while (stops.length > 0) {
            await stops.pop()?.();
        }
    });

    /** Starts a backend and registers it with the monitor the way BackendRegistry would. */
    async function startBackend(handler: http.RequestListener, id = "alpha") {
        const server = await startHttpServer(handler);
        stops.push(() => server.stop());
        const backend: Backend = { id, url: server.url, source: "static" };

        monitor.publish({ type: "backendAdded", backend: { id, url: server.url, source: "static" }, at: Date.now() });

        return { ...server, backend };
    }

    /** Starts a proxy that forwards everything it receives to `backend`. */
    async function startProxy(backend: Backend, overrides: Partial<ForwardRequestOptions> = {}, beforeForward?: (ctx: Context) => Promise<void>) {
        let counter = 0;
        const proxy = await startHttpServer((req, res) => {
            const ctx = new Context(req, res);

            void (async () => {
                try {
                    await beforeForward?.(ctx);
                    await forwardRequest(ctx, backend, {
                        agent, timeoutMs: 5000, monitor, logger, requestId: `req-${++counter}`, ...overrides,
                    });
                } catch (err) {
                    sendErrorResponse(res, err, logger, "proxy error");
                }
            })();
        });
        stops.push(() => proxy.stop());

        return proxy;
    }

    function request(
        port: number,
        options: { method?: string; path?: string; headers?: http.OutgoingHttpHeaders; body?: Uint8Array | string; agent?: http.Agent } = {}
    ): Promise<ClientResponse> {
        return new Promise((resolve, reject) => {
            const req = http.request({
                host: "127.0.0.1", port, method: options.method ?? "GET", path: options.path ?? "/",
                headers: options.headers, agent: options.agent ?? false,
            }, (res) => {
                const chunks: Buffer[] = [];
                res.on("data", (chunk: Buffer) => chunks.push(chunk));
                res.on("end", () => resolve({
                    status: res.statusCode ?? 0, headers: res.headers, rawHeaders: res.rawHeaders, body: Buffer.concat(chunks),
                }));
                res.on("error", reject);
            });

            req.on("error", reject);
            req.end(options.body);
        });
    }

    function terminalEvents(): LoadBalancerEvent[] {
        return events.filter((event) => ["completed", "failed", "aborted"].includes(event.type));
    }

    describe("proxying", () => {

        it("returns the backend's status, headers and body", async () => {
            const backend = await startBackend((_req, res) => {
                res.writeHead(201, { "Content-Type": "application/json", "X-Backend": "alpha" });
                res.end(JSON.stringify({ hello: "world" }));
            });
            const proxy = await startProxy(backend.backend);

            const response = await request(proxy.port);

            expect(response.status).toBe(201);
            expect(response.headers["x-backend"]).toBe("alpha");
            expect(response.headers["content-type"]).toBe("application/json");
            expect(JSON.parse(response.body.toString())).toEqual({ hello: "world" });
        });

        it.each([204, 302, 304, 400, 404, 500, 503])("passes a %i through untouched", async (status) => {
            const backend = await startBackend((_req, res) => {
                res.writeHead(status, status === 302 ? { Location: "/elsewhere" } : {});
                res.end();
            });
            const proxy = await startProxy(backend.backend);

            const response = await request(proxy.port);

            expect(response.status).toBe(status);

            if (status === 302) {
                expect(response.headers.location).toBe("/elsewhere");
            }
        });

        it("forwards the method, path, query string and request headers", async () => {
            let seen: { method?: string; url?: string; headers?: http.IncomingHttpHeaders } = {};
            const backend = await startBackend((req, res) => {
                seen = { method: req.method, url: req.url, headers: req.headers };
                res.end("ok");
            });
            const proxy = await startProxy(backend.backend);

            await request(proxy.port, {
                method: "PATCH", path: "/things/42?sort=asc&q=a%20b",
                headers: { "Content-Type": "text/plain", Authorization: "Bearer abc", "X-Custom": "1" }, body: "x",
            });

            expect(seen.method).toBe("PATCH");
            expect(seen.url).toBe("/things/42?sort=asc&q=a%20b");
            expect(seen.headers).toMatchObject({ "content-type": "text/plain", authorization: "Bearer abc", "x-custom": "1" });
        });

        it("streams a large request body through intact", async () => {
            const payload = randomBytes(3 * 1024 * 1024);
            const backend = await startBackend((req, res) => {
                const chunks: Buffer[] = [];
                req.on("data", (chunk: Buffer) => chunks.push(chunk));
                req.on("end", () => res.end(Buffer.concat(chunks)));
            });
            const proxy = await startProxy(backend.backend);

            const response = await request(proxy.port, { method: "POST", body: payload, headers: { "Content-Type": "application/octet-stream" } });

            expect(response.body.equals(payload)).toBe(true);
        });

        it("streams a chunked request body with no Content-Length", async () => {
            const backend = await startBackend((req, res) => {
                const chunks: Buffer[] = [];
                req.on("data", (chunk: Buffer) => chunks.push(chunk));
                req.on("end", () => res.end(`${req.headers["content-length"] ?? "chunked"}:${Buffer.concat(chunks).toString()}`));
            });
            const proxy = await startProxy(backend.backend);

            const response = await new Promise<string>((resolve, reject) => {
                const req = http.request({ host: "127.0.0.1", port: proxy.port, method: "POST", agent: false }, (res) => {
                    let text = "";
                    res.on("data", (chunk: Buffer) => { text += chunk.toString(); });
                    res.on("end", () => resolve(text));
                });
                req.on("error", reject);
                req.write("part-one,");
                setTimeout(() => req.end("part-two"), 20);
            });

            expect(response).toBe("chunked:part-one,part-two");
        });

        it("streams a large response body through intact", async () => {
            const payload = randomBytes(4 * 1024 * 1024);
            const backend = await startBackend((_req, res) => { res.end(payload); });
            const proxy = await startProxy(backend.backend);

            const response = await request(proxy.port);

            expect(response.body.equals(payload)).toBe(true);
        });

        it("does not buffer: the first chunk reaches the client before the backend has finished", async () => {
            let finishBackend: () => void = () => undefined;
            const backend = await startBackend((_req, res) => {
                res.write("first-chunk");
                finishBackend = () => res.end("-done");
            });
            const proxy = await startProxy(backend.backend);

            const firstChunk = await new Promise<string>((resolve, reject) => {
                http.get({ host: "127.0.0.1", port: proxy.port, agent: false }, (res) => {
                    res.once("data", (chunk: Buffer) => { resolve(chunk.toString()); res.destroy(); });
                    res.on("error", () => undefined);
                }).on("error", reject);
            });

            expect(firstChunk).toBe("first-chunk");
            finishBackend();
        });

        it("answers HEAD with the backend's headers and no body", async () => {
            const backend = await startBackend((req, res) => {
                res.writeHead(200, { "Content-Length": "5", "X-Method": req.method ?? "" });
                res.end(req.method === "HEAD" ? undefined : "hello");
            });
            const proxy = await startProxy(backend.backend);

            const response = await request(proxy.port, { method: "HEAD" });

            expect(response.status).toBe(200);
            expect(response.headers["content-length"]).toBe("5");
            expect(response.headers["x-method"]).toBe("HEAD");
            expect(response.body).toHaveLength(0);
        });

        it("preserves several Set-Cookie headers as separate values", async () => {
            const backend = await startBackend((_req, res) => {
                res.setHeader("Set-Cookie", ["a=1; Path=/", "b=2; HttpOnly"]);
                res.end();
            });
            const proxy = await startProxy(backend.backend);

            const response = await request(proxy.port);

            expect(response.headers["set-cookie"]).toEqual(["a=1; Path=/", "b=2; HttpOnly"]);
        });

        it("reuses one keep-alive connection to the backend across requests", async () => {
            const backend = await startBackend((_req, res) => { res.end("ok"); });
            let connections = 0;
            backend.server.on("connection", () => { connections += 1; });
            const proxy = await startProxy(backend.backend);

            await request(proxy.port);
            await request(proxy.port);
            await request(proxy.port);

            expect(connections).toBe(1);
        });

        it("accepts an absolute-form request target and forwards its origin-form path", async () => {
            let seenUrl: string | undefined;
            const backend = await startBackend((req, res) => { seenUrl = req.url; res.end(); });
            const proxy = await startProxy(backend.backend);

            await request(proxy.port, { path: "http://example.com/abs/path?x=1" });

            expect(seenUrl).toBe("/abs/path?x=1");
        });
    });

    describe("headers sent upstream", () => {

        async function upstreamHeaders(clientHeaders: http.OutgoingHttpHeaders): Promise<http.IncomingHttpHeaders> {
            let seen: http.IncomingHttpHeaders = {};
            const backend = await startBackend((req, res) => { seen = req.headers; res.end(); });
            const proxy = await startProxy(backend.backend);

            await request(proxy.port, { headers: clientHeaders });

            return Object.assign(seen, { __backendHost: `127.0.0.1:${backend.port}`, __proxyHost: `127.0.0.1:${proxy.port}` });
        }

        it("strips hop-by-hop headers, including ones the client named in Connection", async () => {
            const seen = await upstreamHeaders({
                Connection: "keep-alive, X-Hop-Only",
                "Keep-Alive": "timeout=5",
                TE: "trailers",
                Upgrade: "h2c",
                "X-Hop-Only": "secret",
                "X-End-To-End": "kept",
            });

            expect(seen["keep-alive"]).toBeUndefined();
            expect(seen.te).toBeUndefined();
            expect(seen.upgrade).toBeUndefined();
            expect(seen["x-hop-only"]).toBeUndefined();
            expect(seen["x-end-to-end"]).toBe("kept");
        });

        it("rewrites Host to the backend's and keeps the original in X-Forwarded-Host", async () => {
            const seen = await upstreamHeaders({});

            expect(seen.host).toBe(seen.__backendHost);
            expect(seen["x-forwarded-host"]).toBe(seen.__proxyHost);
        });

        it("sets X-Forwarded-For to the client's socket address and X-Forwarded-Proto to http", async () => {
            const seen = await upstreamHeaders({});

            expect(seen["x-forwarded-for"]).toBe("127.0.0.1");
            expect(seen["x-forwarded-proto"]).toBe("http");
        });

        it("appends to an existing X-Forwarded-For chain instead of replacing it", async () => {
            const seen = await upstreamHeaders({ "X-Forwarded-For": "203.0.113.7, 198.51.100.2" });

            expect(seen["x-forwarded-for"]).toBe("203.0.113.7, 198.51.100.2, 127.0.0.1");
        });

        it("preserves an outer proxy's X-Forwarded-Host and X-Forwarded-Proto", async () => {
            const seen = await upstreamHeaders({ "X-Forwarded-Host": "public.example.com", "X-Forwarded-Proto": "https" });

            expect(seen["x-forwarded-host"]).toBe("public.example.com");
            expect(seen["x-forwarded-proto"]).toBe("https");
        });

        it("forwards the request id as X-Request-Id, overriding one the client sent", async () => {
            const seen = await upstreamHeaders({ "X-Request-Id": "client-supplied" });

            expect(seen["x-request-id"]).toBe("req-1");
        });

        it("drops Expect, since the proxy has already answered 100 Continue itself", async () => {
            const seen = await upstreamHeaders({ Expect: "100-continue" });

            expect(seen.expect).toBeUndefined();
        });
    });

    describe("headers sent to the client", () => {

        it("strips hop-by-hop response headers, including ones the backend named in Connection", async () => {
            const backend = await startBackend((_req, res) => {
                res.setHeader("Connection", "X-Internal");
                res.setHeader("Keep-Alive", "timeout=9");
                res.setHeader("Proxy-Authenticate", "Basic");
                res.setHeader("X-Internal", "hop-only");
                res.setHeader("X-Public", "kept");
                res.end("body");
            });
            const proxy = await startProxy(backend.backend);

            const response = await request(proxy.port);

            expect(response.headers["x-internal"]).toBeUndefined();
            expect(response.headers["proxy-authenticate"]).toBeUndefined();
            expect(response.headers["keep-alive"]).not.toBe("timeout=9");
            expect(response.headers["x-public"]).toBe("kept");
        });

        it("reads X-Empire-Route onto the completed event and strips it from the client response", async () => {
            const backend = await startBackend((_req, res) => {
                res.setHeader("X-Empire-Route", "/users/:id");
                res.end("ok");
            });
            const proxy = await startProxy(backend.backend);

            const response = await request(proxy.port, { path: "/users/42" });

            expect(response.headers["x-empire-route"]).toBeUndefined();
            expect(events.find((event) => event.type === "completed")).toMatchObject({ route: "/users/:id" });
        });

        it("treats an empty X-Empire-Route as no route at all", async () => {
            const backend = await startBackend((_req, res) => { res.setHeader("X-Empire-Route", ""); res.end("ok"); });
            const proxy = await startProxy(backend.backend);

            await request(proxy.port);

            expect(events.find((event) => event.type === "completed")).not.toHaveProperty("route", expect.any(String));
        });

        it("caps an oversized X-Empire-Route so a careless backend cannot bloat the monitor", async () => {
            const backend = await startBackend((_req, res) => { res.setHeader("X-Empire-Route", `/${"x".repeat(5000)}`); res.end("ok"); });
            const proxy = await startProxy(backend.backend);

            await request(proxy.port);

            const completed = events.find((event) => event.type === "completed") as { route?: string };
            expect(completed.route).toHaveLength(256);
        });

        it("leaves route undefined on the event when the backend sends no X-Empire-Route", async () => {
            const backend = await startBackend((_req, res) => { res.end("ok"); });
            const proxy = await startProxy(backend.backend);

            await request(proxy.port);

            const completed = events.find((event) => event.type === "completed");
            expect(completed).toBeDefined();
            expect(completed).not.toHaveProperty("route", expect.any(String));
        });
    });

    describe("monitor events", () => {

        it("emits dispatched then completed with status and duration", async () => {
            const backend = await startBackend((_req, res) => { res.writeHead(202); res.end(); });
            const proxy = await startProxy(backend.backend);

            await request(proxy.port, { method: "POST", path: "/jobs" });

            const [, dispatched, completed] = events;
            expect(dispatched).toMatchObject({ type: "dispatched", requestId: "req-1", backendId: "alpha", method: "POST", path: "/jobs" });
            expect(completed).toMatchObject({ type: "completed", requestId: "req-1", backendId: "alpha", status: 202 });
            expect((completed as { durationMs: number }).durationMs).toBeGreaterThanOrEqual(0);
        });

        it("drops the query string from the reported path by default", async () => {
            const backend = await startBackend((_req, res) => { res.end(); });
            const proxy = await startProxy(backend.backend);

            await request(proxy.port, { path: "/search?token=secret&q=cats" });

            expect(events.find((event) => event.type === "dispatched")).toMatchObject({ path: "/search" });
        });

        it("keeps the query string in the reported path when includeQueryString is set", async () => {
            const backend = await startBackend((_req, res) => { res.end(); });
            const proxy = await startProxy(backend.backend, { includeQueryString: true });

            await request(proxy.port, { path: "/search?q=cats" });

            expect(events.find((event) => event.type === "dispatched")).toMatchObject({ path: "/search?q=cats" });
        });

        it("leaves a backend's in-flight count at zero once requests finish", async () => {
            const backend = await startBackend((_req, res) => { res.end("ok"); });
            const proxy = await startProxy(backend.backend);

            await Promise.all([request(proxy.port), request(proxy.port), request(proxy.port)]);
            await waitFor(() => terminalEvents().length === 3, "three terminal events");

            expect(monitor.snapshot().backends[0]).toMatchObject({ total: 3, completed: 3, inFlight: 0 });
        });

        it("works without a monitor at all", async () => {
            const backend = await startBackend((_req, res) => { res.end("fine"); });
            const proxy = await startProxy(backend.backend, { monitor: undefined });

            const response = await request(proxy.port);

            expect(response.body.toString()).toBe("fine");
        });
    });

    describe("failures", () => {

        it("answers 502 and emits failed(connect) when the backend refuses the connection", async () => {
            const deadPort = await getFreePort();
            const backend: Backend = { id: "alpha", url: `http://127.0.0.1:${deadPort}`, source: "static" };
            monitor.publish({ type: "backendAdded", backend, at: Date.now() });
            const proxy = await startProxy(backend);

            const response = await request(proxy.port);

            expect(response.status).toBe(502);
            expect(JSON.parse(response.body.toString())).toEqual({ error: "Bad Gateway" });
            expect(terminalEvents()).toEqual([expect.objectContaining({ type: "failed", phase: "connect", backendId: "alpha" })]);
        });

        it("answers 504, destroys the upstream request and emits failed(timeout) when the backend never answers", async () => {
            let backendConnectionClosed = false;
            const backend = await startBackend((req) => { req.on("close", () => { backendConnectionClosed = true; }); });
            const proxy = await startProxy(backend.backend, { timeoutMs: 100 });

            const response = await request(proxy.port);

            expect(response.status).toBe(504);
            expect(terminalEvents()).toEqual([expect.objectContaining({ type: "failed", phase: "timeout" })]);
            await waitFor(() => backendConnectionClosed, "the backend to see the upstream request destroyed");
        });

        it("bounds time to response headers only, so a long streamed body is not cut off", async () => {
            const backend = await startBackend((_req, res) => {
                res.writeHead(200);
                res.write("start-");
                setTimeout(() => res.end("end"), 300);
            });
            const proxy = await startProxy(backend.backend, { timeoutMs: 100 });

            const response = await request(proxy.port);

            expect(response.status).toBe(200);
            expect(response.body.toString()).toBe("start-end");
            expect(terminalEvents()).toEqual([expect.objectContaining({ type: "completed" })]);
        });

        it("destroys the client's connection and emits failed(stream) when the backend dies mid-body", async () => {
            const backend = await startBackend((_req, res) => {
                res.writeHead(200, { "Content-Length": "1000" });
                res.write("partial");
                setTimeout(() => res.destroy(), 20);
            });
            const proxy = await startProxy(backend.backend);

            const outcome = await new Promise<string>((resolve) => {
                http.get({ host: "127.0.0.1", port: proxy.port, agent: false }, (res) => {
                    res.on("data", () => undefined);
                    res.on("end", () => resolve(res.complete ? "clean-end" : "truncated"));
                    res.on("error", () => resolve("error"));
                    res.on("close", () => resolve(res.complete ? "clean-end" : "truncated"));
                }).on("error", () => resolve("error"));
            });

            expect(outcome).not.toBe("clean-end");
            await waitFor(() => terminalEvents().length === 1, "the terminal event");
            expect(terminalEvents()[0]).toMatchObject({ type: "failed", phase: "stream" });
        });

        it("destroys the upstream request and emits aborted when the client disconnects mid-response", async () => {
            let backendResponseClosedEarly = false;
            const backend = await startBackend((_req, res) => {
                res.write("streaming...");
                res.on("close", () => { backendResponseClosedEarly = !res.writableFinished; });
            });
            const proxy = await startProxy(backend.backend);

            await new Promise<void>((resolve) => {
                const req = http.get({ host: "127.0.0.1", port: proxy.port, agent: false }, (res) => {
                    res.once("data", () => { req.destroy(); resolve(); });
                    res.on("error", () => undefined);
                });
                req.on("error", () => undefined);
            });

            await waitFor(() => backendResponseClosedEarly, "the backend to see its connection destroyed");
            await waitFor(() => terminalEvents().length === 1, "the terminal event");
            expect(terminalEvents()[0]).toMatchObject({ type: "aborted", backendId: "alpha" });
        });

        it("emits aborted when the client disconnects before the backend has answered", async () => {
            let upstreamClosed = false;
            const backend = await startBackend((req) => { req.on("close", () => { upstreamClosed = true; }); });
            const proxy = await startProxy(backend.backend);

            const req = http.get({ host: "127.0.0.1", port: proxy.port, agent: false });
            req.on("error", () => undefined);
            await waitFor(() => events.some((event) => event.type === "dispatched"), "the request to be dispatched");
            req.destroy();

            await waitFor(() => upstreamClosed, "the upstream request to be destroyed");
            await waitFor(() => terminalEvents().length === 1, "the terminal event");
            expect(terminalEvents()[0]).toMatchObject({ type: "aborted" });
        });

        it("emits exactly one terminal event per request across every outcome", async () => {
            const deadPort = await getFreePort();
            const ok = await startBackend((_req, res) => { res.end("ok"); }, "ok");
            const dead: Backend = { id: "dead", url: `http://127.0.0.1:${deadPort}`, source: "static" };
            monitor.publish({ type: "backendAdded", backend: dead, at: Date.now() });
            const okProxy = await startProxy(ok.backend);
            const deadProxy = await startProxy(dead);

            await Promise.all([request(okProxy.port), request(deadProxy.port), request(okProxy.port), request(deadProxy.port)]);
            await waitFor(() => terminalEvents().length >= 4, "four terminal events");

            const dispatched = events.filter((event) => event.type === "dispatched").length;
            expect(dispatched).toBe(4);
            expect(terminalEvents()).toHaveLength(4);
        });

        it("logs a hint and answers 500 when an earlier middleware already consumed the request body", async () => {
            const backend = await startBackend((_req, res) => { res.end("should not be reached"); });
            const proxy = await startProxy(backend.backend, {}, async (ctx) => { await ctx.body(); });

            const response = await request(proxy.port, { method: "POST", body: "some body", headers: { "Content-Type": "text/plain" } });

            expect(response.status).toBe(500);
            expect(logger.debugMessages.some((message) => message.includes("already consumed"))).toBe(true);
            expect(events.some((event) => event.type === "dispatched")).toBe(false);
        });

        it("still forwards a bodiless request whose (empty) body an earlier middleware already read", async () => {
            const backend = await startBackend((_req, res) => { res.end("reached"); });
            const proxy = await startProxy(backend.backend, {}, async (ctx) => { await ctx.body(); });

            const response = await request(proxy.port);

            expect(response.status).toBe(200);
            expect(response.body.toString()).toBe("reached");
        });

        it("leaves a keep-alive client connection usable after a proxy failure mid-upload", async () => {
            const deadPort = await getFreePort();
            const dead: Backend = { id: "dead", url: `http://127.0.0.1:${deadPort}`, source: "static" };
            const proxy = await startProxy(dead);

            // One socket, reused: if the failed upload left the connection in a bad state, the second request breaks.
            const client = new http.Agent({ keepAlive: true, maxSockets: 1 });

            try {
                const first = await request(proxy.port, { method: "POST", body: randomBytes(256 * 1024), agent: client });
                const second = await request(proxy.port, { agent: client });

                expect(first.status).toBe(502);
                expect(second.status).toBe(502);
            } finally {
                client.destroy();
            }
        });
    });
});
