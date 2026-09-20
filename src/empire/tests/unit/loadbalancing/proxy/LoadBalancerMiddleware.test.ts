import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { createLoadBalancerMiddleware } from "../../../../src/loadbalancing/proxy/LoadBalancerMiddleware";
import { ILoadBalancerMiddleware } from "../../../../src/loadbalancing/proxy/ILoadBalancerMiddleware";
import { ILoadBalancingStrategy } from "../../../../src/loadbalancing/strategy/ILoadBalancingStrategy";
import { BackendRegistry } from "../../../../src/loadbalancing/backends/BackendRegistry";
import { LoadBalancerMonitor } from "../../../../src/loadbalancing/monitoring/LoadBalancerMonitor";
import { LoadBalancerEvent } from "../../../../src/loadbalancing/monitoring/LoadBalancerEvent";
import { Context } from "../../../../src/http/Context";
import { createMockRequest, createMockResponse } from "../../../fixtures/http/MockHttp";
import { startEmpire, startHttpServer, RunningServer } from "../../../fixtures/http/TestServers";
import { waitFor } from "../../../fixtures/http/waitFor";
import { TestLogger } from "../../../fixtures/services/TestLogger";

describe("createLoadBalancerMiddleware", () => {

    let monitor: LoadBalancerMonitor;
    let events: LoadBalancerEvent[];
    const cleanups: (() => Promise<void> | void)[] = [];

    beforeEach(() => {
        monitor = new LoadBalancerMonitor({ logger: new TestLogger() });
        events = [];
        monitor.subscribe((event) => events.push(event));
    });

    afterEach(async () => {
        while (cleanups.length > 0) {
            await cleanups.pop()?.();
        }
    });

    /** A backend that answers with its own name, so a test can see who served it. */
    async function namedBackend(name: string, delayMs = 0): Promise<RunningServer> {
        const server = await startHttpServer((_req, res) => {
            setTimeout(() => res.end(name), delayMs);
        });
        cleanups.push(() => server.stop());

        return server;
    }

    async function balancer(create: () => ILoadBalancerMiddleware) {
        const lb = create();
        cleanups.push(() => lb.dispose());
        const server = await startEmpire((app) => { app.use(lb); });
        cleanups.push(() => server.stop());

        return { lb, server };
    }

    async function get(server: RunningServer, path = "/"): Promise<{ status: number; text: string }> {
        const response = await fetch(`${server.url}${path}`);

        return { status: response.status, text: await response.text() };
    }

    describe("construction", () => {

        it("throws when given neither a registry nor backends", () => {
            expect(() => createLoadBalancerMiddleware({})).toThrow(/needs a registry, or at least one entry in backends/);
        });

        it("throws when given an empty backends list", () => {
            expect(() => createLoadBalancerMiddleware({ backends: [] })).toThrow(/at least one/);
        });

        it("throws when given both a registry and backends", () => {
            const registry = new BackendRegistry();

            expect(() => createLoadBalancerMiddleware({ registry, backends: [{ id: "a", url: "http://127.0.0.1:1" }] }))
                .toThrow(/not both/);
        });

        it("throws on an invalid backend in the shorthand list", () => {
            expect(() => createLoadBalancerMiddleware({ backends: [{ id: "a", url: "nope" }] })).toThrow(/Invalid backend url/);
        });

        it.each([0, -5, Number.NaN])("throws on a timeoutMs of %s", (timeoutMs) => {
            expect(() => createLoadBalancerMiddleware({ backends: [{ id: "a", url: "http://127.0.0.1:1" }], timeoutMs }))
                .toThrow(/timeoutMs/);
        });

        it("tells the monitor which strategy is in use", () => {
            const strategy: ILoadBalancingStrategy = { name: "custom", select: () => undefined };

            createLoadBalancerMiddleware({ backends: [{ id: "a", url: "http://127.0.0.1:1" }], strategy, monitor }).dispose();

            expect(monitor.snapshot().strategy).toBe("custom");
        });

        it("defaults to round robin", () => {
            createLoadBalancerMiddleware({ backends: [{ id: "a", url: "http://127.0.0.1:1" }], monitor }).dispose();

            expect(monitor.snapshot().strategy).toBe("round-robin");
        });
    });

    describe("terminal behaviour", () => {

        it("never calls next()", async () => {
            const backend = await namedBackend("only");
            const lb = createLoadBalancerMiddleware({ backends: [{ id: "only", url: backend.url }] });
            cleanups.push(() => lb.dispose());
            const server = await startEmpire((app) => {
                app.use(lb);
                app.get("/", (ctx) => ctx.text("router-answered"));
            });
            cleanups.push(() => server.stop());

            const { text } = await get(server);

            expect(text).toBe("only");
        });

        it("does not call next() even when it answers 503", async () => {
            const registry = new BackendRegistry();
            const lb = createLoadBalancerMiddleware({ registry });
            let nextCalled = false;
            const ctx = new Context(createMockRequest(), createMockResponse() as unknown as never);

            await expect(lb(ctx, async () => { nextCalled = true; })).rejects.toMatchObject({ statusCode: 503 });

            expect(nextCalled).toBe(false);
            lb.dispose();
        });
    });

    describe("selection", () => {

        it("answers 503 while no backend has registered, and records it as unroutable", async () => {
            const registry = new BackendRegistry({ monitor });
            cleanups.push(() => registry.dispose());
            const { server } = await balancer(() => createLoadBalancerMiddleware({ registry, monitor }));

            const { status } = await get(server);

            expect(status).toBe(503);
            expect(events).toContainEqual(expect.objectContaining({ type: "failed", phase: "select" }));
            expect(monitor.snapshot().unroutable).toBe(1);
        });

        it("spreads requests across static backends in round-robin order", async () => {
            const alpha = await namedBackend("alpha");
            const beta = await namedBackend("beta");
            const { server } = await balancer(() => createLoadBalancerMiddleware({
                backends: [{ id: "alpha", url: alpha.url }, { id: "beta", url: beta.url }], monitor,
            }));

            const served = [];
            for (let index = 0; index < 6; index++) {
                served.push((await get(server)).text);
            }

            expect(served).toEqual(["alpha", "beta", "alpha", "beta", "alpha", "beta"]);
        });

        it("starts sending traffic to a backend that registers mid-run", async () => {
            const alpha = await namedBackend("alpha");
            const beta = await namedBackend("beta");
            const registry = new BackendRegistry({ monitor });
            cleanups.push(() => registry.dispose());
            registry.register("alpha", alpha.url);
            const { server } = await balancer(() => createLoadBalancerMiddleware({ registry, monitor }));

            expect((await get(server)).text).toBe("alpha");
            expect((await get(server)).text).toBe("alpha");

            registry.register("beta", beta.url);
            const served = [(await get(server)).text, (await get(server)).text, (await get(server)).text, (await get(server)).text];

            expect(served.filter((name) => name === "beta")).toHaveLength(2);
            expect(served.filter((name) => name === "alpha")).toHaveLength(2);
        });

        it("stops sending traffic to a backend once it deregisters", async () => {
            const alpha = await namedBackend("alpha");
            const beta = await namedBackend("beta");
            const registry = new BackendRegistry({ monitor });
            cleanups.push(() => registry.dispose());
            registry.register("alpha", alpha.url);
            registry.register("beta", beta.url);
            const { server } = await balancer(() => createLoadBalancerMiddleware({ registry, monitor }));

            registry.deregister("beta");

            const served = [(await get(server)).text, (await get(server)).text, (await get(server)).text];
            expect(served).toEqual(["alpha", "alpha", "alpha"]);
        });

        it("lets an in-flight request finish on a backend that deregisters while serving it", async () => {
            const slow = await namedBackend("slow", 300);
            const fast = await namedBackend("fast");
            const registry = new BackendRegistry({ monitor });
            cleanups.push(() => registry.dispose());
            registry.register("slow", slow.url);
            const { server } = await balancer(() => createLoadBalancerMiddleware({ registry, monitor }));

            const inFlight = get(server);
            await waitFor(() => events.some((event) => event.type === "dispatched"), "the request to be dispatched");

            registry.deregister("slow");
            registry.register("fast", fast.url);

            expect((await get(server)).text).toBe("fast"); // new traffic already goes elsewhere
            expect(await inFlight).toEqual({ status: 200, text: "slow" }); // the draining one still completes
        });

        it("does not select a backend whose lease has lapsed", async () => {
            const alpha = await namedBackend("alpha");
            const registry = new BackendRegistry({ leaseTtlMs: 50, monitor });
            cleanups.push(() => registry.dispose());
            registry.register("alpha", alpha.url);
            const { server } = await balancer(() => createLoadBalancerMiddleware({ registry, monitor }));

            await new Promise((resolve) => setTimeout(resolve, 80));

            expect((await get(server)).status).toBe(503);
        });

        it("asks a custom strategy, giving it the eligible list and the request context", async () => {
            const alpha = await namedBackend("alpha");
            const beta = await namedBackend("beta");
            const seen: { ids: string[]; path: string }[] = [];
            const strategy: ILoadBalancingStrategy = {
                name: "always-last",
                select: (backends, ctx) => {
                    seen.push({ ids: backends.map((backend) => backend.id), path: ctx.path });
                    return backends.at(-1);
                },
            };
            const { server } = await balancer(() => createLoadBalancerMiddleware({
                backends: [{ id: "alpha", url: alpha.url }, { id: "beta", url: beta.url }], strategy,
            }));

            expect((await get(server, "/x")).text).toBe("beta");
            expect(seen).toEqual([{ ids: ["alpha", "beta"], path: "/x" }]);
        });

        it("answers 503 when a strategy declines to choose", async () => {
            const alpha = await namedBackend("alpha");
            const strategy: ILoadBalancingStrategy = { name: "never", select: () => undefined };
            const { server } = await balancer(() => createLoadBalancerMiddleware({
                backends: [{ id: "alpha", url: alpha.url }], strategy,
            }));

            expect((await get(server)).status).toBe(503);
        });
    });

    describe("request ids", () => {

        async function upstreamRequestId(prepare?: (ctx: Context) => void): Promise<string | string[] | undefined> {
            let seen: string | string[] | undefined;
            const backend = await startHttpServer((req, res) => { seen = req.headers["x-request-id"]; res.end(); });
            cleanups.push(() => backend.stop());
            const lb = createLoadBalancerMiddleware({ backends: [{ id: "only", url: backend.url }], monitor });
            cleanups.push(() => lb.dispose());
            const server = await startEmpire((app) => {
                app.use(async (ctx, next) => { prepare?.(ctx); await next(); });
                app.use(lb);
            });
            cleanups.push(() => server.stop());

            await get(server);

            return seen;
        }

        it("generates an lb- id when no earlier middleware supplied one", async () => {
            expect(await upstreamRequestId()).toBe("lb-1");
        });

        it("reuses an id an earlier middleware stored in ctx.state.requestId", async () => {
            const seen = await upstreamRequestId((ctx) => { ctx.state.requestId = "trace-abc-123"; });

            expect(seen).toBe("trace-abc-123");
            expect(events).toContainEqual(expect.objectContaining({ type: "dispatched", requestId: "trace-abc-123" }));
        });

        it("ignores a stored id that is not a safe token", async () => {
            const seen = await upstreamRequestId((ctx) => { ctx.state.requestId = "evil\r\nX-Injected: 1"; });

            expect(seen).toBe("lb-1");
        });

        it("ignores a stored id that is not a string", async () => {
            const seen = await upstreamRequestId((ctx) => { ctx.state.requestId = 42; });

            expect(seen).toBe("lb-1");
        });
    });

    describe("dispose", () => {

        it("closes the keep-alive connections held open to backends", async () => {
            let backendSocketClosed = false;
            const backend = await startHttpServer((_req, res) => { res.end("ok"); });
            cleanups.push(() => backend.stop());
            backend.server.on("connection", (socket) => socket.on("close", () => { backendSocketClosed = true; }));
            const lb = createLoadBalancerMiddleware({ backends: [{ id: "only", url: backend.url }] });
            const server = await startEmpire((app) => { app.use(lb); });
            cleanups.push(() => server.stop());
            await get(server);

            lb.dispose();

            await waitFor(() => backendSocketClosed, "the pooled backend connection to close");
        });

        it("leaves a registry it was handed for its owner to dispose", () => {
            const registry = new BackendRegistry();
            registry.register("alpha", "http://127.0.0.1:1");
            const lb = createLoadBalancerMiddleware({ registry });

            lb.dispose();

            // The registry still works - it was not disposed out from under its owner.
            expect(registry.eligible()).toHaveLength(1);
            registry.dispose();
        });

        it("is safe to call twice", () => {
            const lb = createLoadBalancerMiddleware({ backends: [{ id: "a", url: "http://127.0.0.1:1" }] });

            expect(() => { lb.dispose(); lb.dispose(); }).not.toThrow();
        });
    });

    describe("failures", () => {

        it("answers 502 when the chosen backend is down, without taking the balancer down", async () => {
            const { server } = await balancer(() => createLoadBalancerMiddleware({
                backends: [{ id: "down", url: "http://127.0.0.1:1" }], monitor,
            }));

            const { status } = await get(server);

            expect(status).toBe(502);
            expect((await get(server)).status).toBe(502);
        });
    });
});
