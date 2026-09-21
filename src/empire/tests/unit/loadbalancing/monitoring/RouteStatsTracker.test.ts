import { describe, it, expect } from "vitest";
import { RouteStatsTracker } from "../../../../src/loadbalancing/monitoring/RouteStatsTracker";

describe("RouteStatsTracker", () => {

    it("starts empty", () => {
        const snapshot = new RouteStatsTracker("GET", "/users/:id").snapshot("GET /users/:id");

        expect(snapshot).toMatchObject({
            key: "GET /users/:id", method: "GET", route: "/users/:id",
            count: 0, errors: 0, failed: 0, avgMs: 0, p95Ms: 0, maxMs: 0,
        });
    });

    it("counts responses by status class and remembers latency", () => {
        const tracker = new RouteStatsTracker("GET", "/x");

        tracker.recordResponse(200, 10);
        tracker.recordResponse(404, 20);
        tracker.recordResponse(503, 30);

        expect(tracker.snapshot("k")).toMatchObject({
            count: 3, errors: 1, avgMs: 20, maxMs: 30,
            statusClasses: { "2xx": 1, "4xx": 1, "5xx": 1, "1xx": 0, "3xx": 0 },
        });
    });

    it("does not count a 4xx as an error, only 5xx", () => {
        const tracker = new RouteStatsTracker("GET", "/x");

        tracker.recordResponse(400, 5);
        tracker.recordResponse(499, 5);

        expect(tracker.snapshot("k").errors).toBe(0);
    });

    it("counts a failure as a request and an error, without adding a latency sample", () => {
        const tracker = new RouteStatsTracker("GET", "/x");

        tracker.recordResponse(200, 40);
        tracker.recordFailure();

        expect(tracker.snapshot("k")).toMatchObject({ count: 2, errors: 1, failed: 1, avgMs: 40 });
    });

    it("stays guessed only while every observation was a guess", () => {
        const tracker = new RouteStatsTracker("GET", "/x");

        expect(tracker.snapshot("k").guessed).toBe(true);
        tracker.noteProvenance(true);
        expect(tracker.snapshot("k").guessed).toBe(true);
        tracker.noteProvenance(false);
        expect(tracker.snapshot("k").guessed).toBe(false);
        tracker.noteProvenance(true);
        expect(tracker.snapshot("k").guessed).toBe(false);
    });

    it("ignores a status outside 100-599 in the class tally but still counts the request", () => {
        const tracker = new RouteStatsTracker("GET", "/x");

        tracker.recordResponse(42, 5);

        expect(tracker.snapshot("k")).toMatchObject({ count: 1, statusClasses: { "1xx": 0, "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0 } });
    });
});
