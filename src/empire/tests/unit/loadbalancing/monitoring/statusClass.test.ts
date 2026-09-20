import { describe, it, expect } from "vitest";
import { emptyStatusClassCounts, statusClassOf } from "../../../../src/loadbalancing/monitoring/statusClass";

describe("statusClassOf", () => {

    it.each([[100, "1xx"], [200, "2xx"], [204, "2xx"], [301, "3xx"], [404, "4xx"], [499, "4xx"], [500, "5xx"], [599, "5xx"]])(
        "maps %i to %s",
        (status, expected) => {
            expect(statusClassOf(status)).toBe(expected);
        }
    );

    it.each([0, 99, 600, -1, 1000])("has no class for the out-of-range status %i", (status) => {
        expect(statusClassOf(status)).toBeUndefined();
    });
});

describe("emptyStatusClassCounts", () => {

    it("starts every class at zero", () => {
        expect(emptyStatusClassCounts()).toEqual({ "1xx": 0, "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0 });
    });

    it("returns a fresh object each call, so tallies never leak between backends", () => {
        const first = emptyStatusClassCounts();
        first["2xx"] += 5;

        expect(emptyStatusClassCounts()["2xx"]).toBe(0);
    });
});
