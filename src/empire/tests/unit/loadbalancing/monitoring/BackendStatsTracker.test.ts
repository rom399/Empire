import { describe, it, expect } from "vitest";
import { BackendStatsTracker } from "../../../../src/loadbalancing/monitoring/BackendStatsTracker";
import { ObservedCall } from "../../../../src/loadbalancing/monitoring/ObservedCall";

const INFO = { id: "alpha", url: "http://127.0.0.1:1", source: "registered" as const };

function call(overrides: Partial<ObservedCall> = {}): ObservedCall {
    return { requestId: "r", method: "GET", path: "/x", route: "/x", guessedRoute: false, at: 1, ...overrides };
}

describe("BackendStatsTracker", () => {

    it("reports its identity and lease in the snapshot", () => {
        const tracker = new BackendStatsTracker(INFO, 100, 5000);

        expect(tracker.snapshot()).toMatchObject({ ...INFO, addedAt: 100, expiresAt: 5000, total: 0, inFlight: 0 });
    });

    it("follows lease renewals", () => {
        const tracker = new BackendStatsTracker(INFO, 100, 5000);

        tracker.renew(9000);

        expect(tracker.snapshot().expiresAt).toBe(9000);
    });

    it("tracks removal without discarding the counters", () => {
        const tracker = new BackendStatsTracker(INFO, 100, 5000);
        tracker.recordDispatch();

        expect(tracker.isRemoved).toBe(false);
        tracker.markRemoved(700, "expired");

        expect(tracker.isRemoved).toBe(true);
        expect(tracker.removedAt).toBe(700);
        expect(tracker.snapshot()).toMatchObject({ total: 1, removed: { at: 700, reason: "expired" } });
    });

    it("never lets in-flight go negative if a terminal event arrives with no dispatch", () => {
        const tracker = new BackendStatsTracker(INFO, 100);

        tracker.recordCompleted(call(), 200, 5);
        tracker.recordFailed(call(), "connect");
        tracker.recordAborted(call());

        expect(tracker.snapshot().inFlight).toBe(0);
    });

    it("keeps the recent-call buffer newest-first and correct after it wraps around", () => {
        const tracker = new BackendStatsTracker(INFO, 100);
        const total = BackendStatsTracker.RECENT_CALLS_CAPACITY * 2 + 7;

        for (let index = 0; index < total; index++) {
            tracker.recordCompleted(call({ requestId: `r${index}` }), 200, 1);
        }

        const recent = tracker.recentCalls();

        expect(recent).toHaveLength(BackendStatsTracker.RECENT_CALLS_CAPACITY);
        expect(recent.map((entry) => entry.requestId)).toEqual(
            Array.from({ length: BackendStatsTracker.RECENT_CALLS_CAPACITY }, (_, offset) => `r${total - 1 - offset}`)
        );
    });

    it("returns fewer calls than the capacity until the buffer has filled", () => {
        const tracker = new BackendStatsTracker(INFO, 100);

        tracker.recordCompleted(call({ requestId: "a" }), 200, 1);
        tracker.recordCompleted(call({ requestId: "b" }), 200, 1);

        expect(tracker.recentCalls().map((entry) => entry.requestId)).toEqual(["b", "a"]);
    });

    it("never tracks more than MAX_ROUTES + 1 route keys however many distinct ones it sees", () => {
        const tracker = new BackendStatsTracker(INFO, 100);

        for (let index = 0; index < BackendStatsTracker.MAX_ROUTES * 10; index++) {
            tracker.recordCompleted(call({ route: `/files/${index}` }), 200, 1);
        }

        const routes = tracker.detail().routes;

        expect(routes).toHaveLength(BackendStatsTracker.MAX_ROUTES + 1);
        expect(routes.find((route) => route.key === BackendStatsTracker.OTHER_ROUTE)?.count).toBe(BackendStatsTracker.MAX_ROUTES * 9);
    });

    it("does not let a returning route key go missing once the cap is hit", () => {
        const tracker = new BackendStatsTracker(INFO, 100);

        for (let index = 0; index < BackendStatsTracker.MAX_ROUTES; index++) {
            tracker.recordCompleted(call({ route: `/r${index}` }), 200, 1);
        }
        tracker.recordCompleted(call({ route: "/brand-new" }), 200, 1);
        tracker.recordCompleted(call({ route: "/r3" }), 200, 1);

        const routes = tracker.detail().routes;

        expect(routes.find((route) => route.route === "/r3")?.count).toBe(2);
        expect(routes.some((route) => route.route === "/brand-new")).toBe(false);
    });

    it("computes the average latency over completions only", () => {
        const tracker = new BackendStatsTracker(INFO, 100);

        tracker.recordCompleted(call(), 200, 10);
        tracker.recordCompleted(call(), 200, 30);
        tracker.recordFailed(call(), "timeout", 5000);

        expect(tracker.snapshot()).toMatchObject({ completed: 2, failed: 1, avgLatencyMs: 20, lastLatencyMs: 30 });
    });
});
