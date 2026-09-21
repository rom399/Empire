import { describe, it, expect, beforeEach } from "vitest";
import { LoadBalancerMonitor } from "../../../../src/loadbalancing/monitoring/LoadBalancerMonitor";
import { LoadBalancerEvent } from "../../../../src/loadbalancing/monitoring/LoadBalancerEvent";
import { BackendStatsTracker } from "../../../../src/loadbalancing/monitoring/BackendStatsTracker";
import { TestLogger } from "../../../fixtures/services/TestLogger";

const GRACE_MS = 1000;

describe("LoadBalancerMonitor", () => {

    let clock: number;
    let logger: TestLogger;
    let monitor: LoadBalancerMonitor;
    let nextRequest: number;

    beforeEach(() => {
        clock = 1_000_000;
        nextRequest = 0;
        logger = new TestLogger();
        monitor = new LoadBalancerMonitor({ logger, removedGraceMs: GRACE_MS, now: () => clock });
        monitor.publish({ type: "backendAdded", backend: { id: "alpha", url: "http://a:1", source: "registered" }, expiresAt: clock + 15_000, at: clock });
    });

    /** Sends dispatched then a terminal event, the way the proxy does. */
    function request(options: {
        backendId?: string;
        method?: string;
        path?: string;
        outcome?: "completed" | "failed" | "aborted";
        status?: number;
        durationMs?: number;
        route?: string;
        phase?: "connect" | "timeout" | "stream";
    } = {}): string {
        const requestId = `req-${++nextRequest}`;
        const backendId = options.backendId ?? "alpha";
        const outcome = options.outcome ?? "completed";

        monitor.publish({
            type: "dispatched", requestId, backendId,
            method: options.method ?? "GET", path: options.path ?? "/users/42", at: clock,
        });

        if (outcome === "completed") {
            monitor.publish({
                type: "completed", requestId, backendId, status: options.status ?? 200,
                durationMs: options.durationMs ?? 10, route: options.route, at: clock,
            });
        } else if (outcome === "failed") {
            monitor.publish({ type: "failed", requestId, backendId, phase: options.phase ?? "connect", at: clock });
        } else {
            monitor.publish({ type: "aborted", requestId, backendId, at: clock });
        }

        return requestId;
    }

    function backend(id = "alpha") {
        return monitor.snapshot().backends.find((entry) => entry.id === id);
    }

    describe("counters", () => {

        it("registers a backend on backendAdded with its source and lease expiry", () => {
            expect(backend()).toMatchObject({
                id: "alpha", url: "http://a:1", source: "registered", expiresAt: clock + 15_000,
                total: 0, inFlight: 0, completed: 0, failed: 0, aborted: 0,
            });
        });

        it("counts a dispatch as total and in-flight", () => {
            monitor.publish({ type: "dispatched", requestId: "r1", backendId: "alpha", method: "GET", path: "/", at: clock });

            expect(backend()).toMatchObject({ total: 1, inFlight: 1 });
        });

        it("counts completions by status class and records latency", () => {
            request({ status: 200, durationMs: 10 });
            request({ status: 302, durationMs: 20 });
            request({ status: 404, durationMs: 30 });
            request({ status: 500, durationMs: 40 });

            expect(backend()).toMatchObject({
                total: 4, completed: 4, inFlight: 0,
                statusClasses: { "1xx": 0, "2xx": 1, "3xx": 1, "4xx": 1, "5xx": 1 },
                avgLatencyMs: 25, lastLatencyMs: 40,
            });
        });

        it("counts a failure without counting it as completed", () => {
            request({ outcome: "failed", phase: "timeout" });

            expect(backend()).toMatchObject({ total: 1, failed: 1, completed: 0, inFlight: 0 });
        });

        it("counts an abort without counting it as completed or failed", () => {
            request({ outcome: "aborted" });

            expect(backend()).toMatchObject({ total: 1, aborted: 1, completed: 0, failed: 0, inFlight: 0 });
        });

        it("returns inFlight to zero after a mix of every terminal outcome", () => {
            request({ outcome: "completed" });
            request({ outcome: "failed" });
            request({ outcome: "aborted" });

            expect(backend()?.inFlight).toBe(0);
        });

        it("tracks several requests in flight at once", () => {
            ["r1", "r2", "r3"].forEach((requestId) =>
                monitor.publish({ type: "dispatched", requestId, backendId: "alpha", method: "GET", path: "/", at: clock }));

            expect(backend()?.inFlight).toBe(3);

            monitor.publish({ type: "completed", requestId: "r2", backendId: "alpha", status: 200, durationMs: 5, at: clock });

            expect(backend()?.inFlight).toBe(2);
        });

        it("counts a no-backend failure as unroutable, not against any backend", () => {
            monitor.publish({ type: "failed", requestId: "r1", phase: "select", at: clock });

            expect(monitor.snapshot().unroutable).toBe(1);
            expect(backend()?.failed).toBe(0);
        });

        it("updates the lease expiry on leaseRenewed", () => {
            monitor.publish({ type: "leaseRenewed", backendId: "alpha", expiresAt: clock + 99_000, at: clock });

            expect(backend()?.expiresAt).toBe(clock + 99_000);
        });

        it("ignores events for a backend it has never heard of", () => {
            expect(() => request({ backendId: "ghost" })).not.toThrow();
            expect(backend("ghost")).toBeUndefined();
        });

        it("reports the strategy name it was given", () => {
            monitor.setStrategyName("round-robin");

            expect(monitor.snapshot().strategy).toBe("round-robin");
        });
    });

    describe("removed backends", () => {

        function remove(reason: "deregistered" | "expired" = "expired"): void {
            monitor.publish({ type: "backendRemoved", backendId: "alpha", reason, at: clock });
        }

        it("keep their final counters, flagged as removed, during the grace window", () => {
            request({ status: 200 });
            remove("expired");

            clock += GRACE_MS - 1;

            expect(backend()).toMatchObject({ total: 1, completed: 1, removed: { reason: "expired" } });
        });

        it("are dropped once the grace window has passed", () => {
            remove();
            clock += GRACE_MS + 1;

            expect(backend()).toBeUndefined();
            expect(monitor.detail("alpha")).toBeUndefined();
        });

        it("still serve detail during the grace window", () => {
            request({ route: "/users/:id" });
            remove();

            expect(monitor.detail("alpha")?.routes).toHaveLength(1);
        });

        it("still settle in-flight requests that were dispatched before removal", () => {
            monitor.publish({ type: "dispatched", requestId: "r1", backendId: "alpha", method: "GET", path: "/", at: clock });
            remove();
            monitor.publish({ type: "completed", requestId: "r1", backendId: "alpha", status: 200, durationMs: 5, at: clock });

            expect(backend()).toMatchObject({ inFlight: 0, completed: 1 });
        });

        it("start with fresh counters when the same id registers again", () => {
            request();
            remove();
            monitor.publish({ type: "backendAdded", backend: { id: "alpha", url: "http://a:1", source: "registered" }, at: clock });

            expect(backend()).toMatchObject({ total: 0, completed: 0 });
            expect(backend()?.removed).toBeUndefined();
        });

        it("are purged on later topology events even if nobody ever asks for a snapshot", () => {
            remove();
            clock += GRACE_MS + 1;
            monitor.publish({ type: "backendAdded", backend: { id: "beta", url: "http://b:1", source: "static" }, at: clock });

            expect(monitor.snapshot().backends.map((entry) => entry.id)).toEqual(["beta"]);
        });
    });

    describe("subscribers", () => {

        it("receive every published event in order", () => {
            const received: LoadBalancerEvent[] = [];
            monitor.subscribe((event) => received.push(event));

            request();

            expect(received.map((event) => event.type)).toEqual(["dispatched", "completed"]);
        });

        it("stop receiving events after unsubscribing", () => {
            const received: LoadBalancerEvent[] = [];
            const unsubscribe = monitor.subscribe((event) => received.push(event));

            unsubscribe();
            request();

            expect(received).toEqual([]);
        });

        it("isolate a throwing listener from the publisher and from other listeners", () => {
            const received: LoadBalancerEvent[] = [];
            monitor.subscribe(() => { throw new Error("listener blew up"); });
            monitor.subscribe((event) => received.push(event));

            expect(() => request()).not.toThrow();

            expect(received).toHaveLength(2);
            expect(logger.errorMessages).toHaveLength(2);
            expect(backend()?.completed).toBe(1);
        });
    });

    describe("route stats", () => {

        it("group by method and the route the backend reported", () => {
            request({ method: "GET", path: "/users/1", route: "/users/:id" });
            request({ method: "GET", path: "/users/2", route: "/users/:id" });
            request({ method: "POST", path: "/users", route: "/users" });

            const routes = monitor.detail("alpha")!.routes;

            expect(routes.map((route) => [route.key, route.count])).toEqual([
                ["GET /users/:id", 2],
                ["POST /users", 1],
            ]);
        });

        it("keep the same route under different methods separate", () => {
            request({ method: "GET", route: "/things" });
            request({ method: "DELETE", route: "/things" });

            expect(monitor.detail("alpha")!.routes.map((route) => route.key).sort())
                .toEqual(["DELETE /things", "GET /things"]);
        });

        it("guess the route from the path when the backend reported none, and flag it", () => {
            request({ path: "/orders/1234/items/9" });

            const [route] = monitor.detail("alpha")!.routes;

            expect(route).toMatchObject({ route: "/orders/:id/items/:id", guessed: true });
        });

        it("are not flagged as guessed once the backend has reported the template", () => {
            request({ path: "/users/1" });
            request({ path: "/users/2", route: "/users/:id" });

            expect(monitor.detail("alpha")!.routes[0].guessed).toBe(false);
        });

        it("count server errors and failures as errors", () => {
            request({ route: "/x", status: 200 });
            request({ route: "/x", status: 500 });
            request({ path: "/x", outcome: "failed" });

            const [route] = monitor.detail("alpha")!.routes;

            expect(route).toMatchObject({ count: 3, errors: 2, failed: 1 });
        });

        it("do not count an aborted request against any route", () => {
            request({ route: "/x", outcome: "aborted", path: "/x" });

            expect(monitor.detail("alpha")!.routes).toEqual([]);
        });

        it("report latency percentiles read from the histogram", () => {
            for (let ms = 1; ms <= 100; ms++) {
                request({ route: "/slow", durationMs: ms });
            }

            const [route] = monitor.detail("alpha")!.routes;

            expect(route.avgMs).toBeCloseTo(50.5);
            expect(route.maxMs).toBe(100);
            expect(route.p50Ms).toBeLessThanOrEqual(route.p95Ms);
            expect(route.p95Ms).toBeLessThanOrEqual(route.p99Ms);
            expect(route.p99Ms).toBeLessThanOrEqual(100);
        });

        it("sort busiest first", () => {
            request({ route: "/quiet" });
            request({ route: "/busy" });
            request({ route: "/busy" });

            expect(monitor.detail("alpha")!.routes.map((route) => route.route)).toEqual(["/busy", "/quiet"]);
        });

        it("fold the 51st distinct route into (other) instead of growing without bound", () => {
            for (let index = 0; index < BackendStatsTracker.MAX_ROUTES; index++) {
                request({ route: `/r${index}` });
            }

            request({ route: "/overflow-a" });
            request({ route: "/overflow-b" });

            const routes = monitor.detail("alpha")!.routes;
            const other = routes.find((route) => route.key === "(other)");

            expect(routes).toHaveLength(BackendStatsTracker.MAX_ROUTES + 1);
            expect(other?.count).toBe(2);
            expect(routes.some((route) => route.route === "/overflow-a")).toBe(false);
        });

        it("keep counting an already-tracked route after the cap is reached", () => {
            for (let index = 0; index < BackendStatsTracker.MAX_ROUTES; index++) {
                request({ route: `/r${index}` });
            }

            request({ route: "/r0" });

            const tracked = monitor.detail("alpha")!.routes.find((route) => route.route === "/r0");

            expect(tracked?.count).toBe(2);
        });
    });

    describe("recent calls", () => {

        it("list the newest call first with its full record", () => {
            request({ path: "/a", route: "/a", status: 200, durationMs: 5 });
            const id = request({ path: "/b", route: "/b", status: 503, durationMs: 9 });

            const [newest] = monitor.detail("alpha")!.recentCalls;

            expect(newest).toMatchObject({
                requestId: id, method: "GET", path: "/b", route: "/b",
                outcome: "completed", status: 503, durationMs: 9,
            });
        });

        it("record the failure phase for a failed call", () => {
            request({ outcome: "failed", phase: "timeout" });

            expect(monitor.detail("alpha")!.recentCalls[0]).toMatchObject({ outcome: "failed", phase: "timeout" });
        });

        it("record an aborted call", () => {
            request({ outcome: "aborted" });

            expect(monitor.detail("alpha")!.recentCalls[0].outcome).toBe("aborted");
        });

        it("cap at 200 and keep only the newest", () => {
            const total = BackendStatsTracker.RECENT_CALLS_CAPACITY + 25;
            const ids: string[] = [];

            for (let index = 0; index < total; index++) {
                ids.push(request({ route: "/x" }));
            }

            const calls = monitor.detail("alpha")!.recentCalls;

            expect(calls).toHaveLength(BackendStatsTracker.RECENT_CALLS_CAPACITY);
            expect(calls[0].requestId).toBe(ids[total - 1]);
            expect(calls.at(-1)?.requestId).toBe(ids[total - BackendStatsTracker.RECENT_CALLS_CAPACITY]);
        });
    });

    describe("inFlight(id)", () => {

        it("is zero for a backend the monitor has never heard of", () => {
            expect(monitor.inFlight("ghost")).toBe(0);
        });

        it("is zero for a known backend that has been sent nothing", () => {
            expect(monitor.inFlight("alpha")).toBe(0);
        });

        it("rises with each dispatch", () => {
            monitor.publish({ type: "dispatched", requestId: "r1", backendId: "alpha", method: "GET", path: "/", at: clock });
            monitor.publish({ type: "dispatched", requestId: "r2", backendId: "alpha", method: "GET", path: "/", at: clock });

            expect(monitor.inFlight("alpha")).toBe(2);
        });

        it.each(["completed", "failed", "aborted"] as const)("falls when a request %s", (outcome) => {
            monitor.publish({ type: "dispatched", requestId: "r1", backendId: "alpha", method: "GET", path: "/", at: clock });
            monitor.publish({ type: "dispatched", requestId: "r2", backendId: "alpha", method: "GET", path: "/", at: clock });

            if (outcome === "completed") {
                monitor.publish({ type: "completed", requestId: "r1", backendId: "alpha", status: 200, durationMs: 5, at: clock });
            } else if (outcome === "failed") {
                monitor.publish({ type: "failed", requestId: "r1", backendId: "alpha", phase: "connect", at: clock });
            } else {
                monitor.publish({ type: "aborted", requestId: "r1", backendId: "alpha", at: clock });
            }

            expect(monitor.inFlight("alpha")).toBe(1);
        });

        it("counts each backend separately", () => {
            monitor.publish({ type: "backendAdded", backend: { id: "beta", url: "http://b:1", source: "static" }, at: clock });
            monitor.publish({ type: "dispatched", requestId: "r1", backendId: "alpha", method: "GET", path: "/", at: clock });

            expect(monitor.inFlight("alpha")).toBe(1);
            expect(monitor.inFlight("beta")).toBe(0);
        });

        it("never goes negative when a terminal event arrives with no dispatch", () => {
            monitor.publish({ type: "completed", requestId: "orphan", backendId: "alpha", status: 200, durationMs: 1, at: clock });

            expect(monitor.inFlight("alpha")).toBe(0);
        });

        it("still reports what a removed backend has in flight, inside the grace window", () => {
            monitor.publish({ type: "dispatched", requestId: "r1", backendId: "alpha", method: "GET", path: "/", at: clock });
            monitor.publish({ type: "backendRemoved", backendId: "alpha", reason: "deregistered", at: clock });

            expect(monitor.inFlight("alpha")).toBe(1);
        });

        it("is zero again once a removed backend has been dropped", () => {
            monitor.publish({ type: "dispatched", requestId: "r1", backendId: "alpha", method: "GET", path: "/", at: clock });
            monitor.publish({ type: "backendRemoved", backendId: "alpha", reason: "expired", at: clock });
            clock += GRACE_MS + 1;
            monitor.snapshot();

            expect(monitor.inFlight("alpha")).toBe(0);
        });

        it("matches the in-flight figure in the snapshot", () => {
            monitor.publish({ type: "dispatched", requestId: "r1", backendId: "alpha", method: "GET", path: "/", at: clock });

            expect(monitor.snapshot().backends[0].inFlight).toBe(monitor.inFlight("alpha"));
        });
    });

    describe("detail", () => {

        it("returns undefined for an unknown backend", () => {
            expect(monitor.detail("ghost")).toBeUndefined();
        });

        it("includes the backend's own snapshot", () => {
            request();

            expect(monitor.detail("alpha")!.backend).toMatchObject({ id: "alpha", total: 1 });
        });
    });
});
