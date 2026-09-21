import { describe, it, expect } from "vitest";
import { RoundRobinStrategy } from "../../../../src/loadbalancing/strategy/RoundRobinStrategy";
import { Backend } from "../../../../src/loadbalancing/Backend";
import { Context } from "../../../../src/http/Context";
import { createMockRequest, createMockResponse } from "../../../fixtures/http/MockHttp";

function backends(...ids: string[]): Backend[] {
    return ids.map((id) => ({ id, url: `http://127.0.0.1:${id.length}`, source: "static" as const }));
}

const ctx = new Context(createMockRequest(), createMockResponse() as unknown as never);

function pick(strategy: RoundRobinStrategy, list: Backend[], times: number): string[] {
    return Array.from({ length: times }, () => strategy.select(list, ctx)?.id ?? "none");
}

describe("RoundRobinStrategy", () => {

    it("is named for the dashboard's hub label", () => {
        expect(new RoundRobinStrategy().name).toBe("round-robin");
    });

    it("cycles through backends in list order", () => {
        const strategy = new RoundRobinStrategy();

        expect(pick(strategy, backends("a", "b", "c"), 3)).toEqual(["a", "b", "c"]);
    });

    it("wraps back to the first backend after the last", () => {
        const strategy = new RoundRobinStrategy();

        expect(pick(strategy, backends("a", "b", "c"), 7)).toEqual(["a", "b", "c", "a", "b", "c", "a"]);
    });

    it("keeps returning the only backend when there is one", () => {
        const strategy = new RoundRobinStrategy();

        expect(pick(strategy, backends("solo"), 4)).toEqual(["solo", "solo", "solo", "solo"]);
    });

    it("returns undefined when nothing is eligible", () => {
        expect(new RoundRobinStrategy().select([], ctx)).toBeUndefined();
    });

    it("stays in bounds when the list shrinks between calls", () => {
        const strategy = new RoundRobinStrategy();
        const list = backends("a", "b", "c", "d");

        pick(strategy, list, 3); // position now points past the end of a 2-item list

        const picked = pick(strategy, list.slice(0, 2), 4);

        expect(picked.every((id) => id === "a" || id === "b")).toBe(true);
    });

    it("stays in bounds when the list grows between calls", () => {
        const strategy = new RoundRobinStrategy();

        pick(strategy, backends("a", "b"), 3);

        const picked = pick(strategy, backends("a", "b", "c", "d"), 8);

        expect(picked.every((id) => ["a", "b", "c", "d"].includes(id))).toBe(true);
    });

    it("stays within one request of perfectly fair over any window against a stable list", () => {
        const strategy = new RoundRobinStrategy();
        const list = backends("a", "b", "c");

        pick(strategy, list, 2); // start the window mid-rotation

        const window = pick(strategy, list, 100);
        const counts = list.map((backend) => window.filter((id) => id === backend.id).length);

        expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    });

    it("gives a backend added mid-rotation its share going forward", () => {
        const strategy = new RoundRobinStrategy();

        pick(strategy, backends("a", "b"), 5);

        const grown = backends("a", "b", "c");
        const window = pick(strategy, grown, 30);

        expect(window.filter((id) => id === "c")).toHaveLength(10);
    });
});
