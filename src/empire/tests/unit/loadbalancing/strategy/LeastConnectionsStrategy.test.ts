import { describe, it, expect } from "vitest";
import { LeastConnectionsStrategy } from "../../../../src/loadbalancing/strategy/LeastConnectionsStrategy";
import { RoundRobinStrategy } from "../../../../src/loadbalancing/strategy/RoundRobinStrategy";
import { IInFlightSource } from "../../../../src/loadbalancing/strategy/IInFlightSource";
import { Backend } from "../../../../src/loadbalancing/Backend";
import { Context } from "../../../../src/http/Context";
import { createMockRequest, createMockResponse } from "../../../fixtures/http/MockHttp";

/** An in-flight source the test drives by hand. */
class FakeSource implements IInFlightSource {
    public readonly counts = new Map<string, number>();
    public reads = 0;

    public inFlight(backendId: string): number {
        this.reads += 1;

        return this.counts.get(backendId) ?? 0;
    }

    public set(counts: Record<string, number>): void {
        this.counts.clear();
        Object.entries(counts).forEach(([id, count]) => this.counts.set(id, count));
    }
}

function backends(...ids: string[]): Backend[] {
    return ids.map((id) => ({ id, url: "http://127.0.0.1:1", source: "static" as const }));
}

const ctx = new Context(createMockRequest(), createMockResponse() as unknown as never);

describe("LeastConnectionsStrategy", () => {

    it("is named for the dashboard's hub label", () => {
        expect(new LeastConnectionsStrategy(new FakeSource()).name).toBe("least-connections");
    });

    it("exposes the source it reads, so the middleware can check it is the balancer's own monitor", () => {
        const source = new FakeSource();

        expect(new LeastConnectionsStrategy(source).inFlightSource).toBe(source);
    });

    it("picks the backend with the fewest requests in flight", () => {
        const source = new FakeSource();
        source.set({ a: 5, b: 1, c: 3 });

        expect(new LeastConnectionsStrategy(source).select(backends("a", "b", "c"))?.id).toBe("b");
    });

    it("picks the fewest wherever it sits in the list", () => {
        const source = new FakeSource();
        const list = backends("a", "b", "c", "d");

        for (const idle of ["a", "b", "c", "d"]) {
            source.set({ a: 4, b: 4, c: 4, d: 4, [idle]: 1 });

            expect(new LeastConnectionsStrategy(source).select(list)?.id).toBe(idle);
        }
    });

    it("keeps choosing the same backend while it stays the least loaded", () => {
        const source = new FakeSource();
        source.set({ a: 4, b: 0, c: 4 });
        const strategy = new LeastConnectionsStrategy(source);

        const picked = [1, 2, 3, 4].map(() => strategy.select(backends("a", "b", "c"))?.id);

        expect(picked).toEqual(["b", "b", "b", "b"]);
    });

    it("moves off a backend as soon as it stops being the least loaded", () => {
        const source = new FakeSource();
        const strategy = new LeastConnectionsStrategy(source);
        const list = backends("a", "b");

        source.set({ a: 0, b: 1 });
        expect(strategy.select(list)?.id).toBe("a");

        source.set({ a: 2, b: 1 });
        expect(strategy.select(list)?.id).toBe("b");
    });

    it("rotates through ties instead of always taking the first backend", () => {
        const strategy = new LeastConnectionsStrategy(new FakeSource());
        const list = backends("a", "b", "c");

        const picked = [1, 2, 3, 4, 5, 6, 7].map(() => strategy.select(list)?.id);

        expect(picked).toEqual(["a", "b", "c", "a", "b", "c", "a"]);
    });

    it("behaves exactly like round robin while every backend is equally loaded", () => {
        const least = new LeastConnectionsStrategy(new FakeSource());
        const roundRobin = new RoundRobinStrategy();
        const list = backends("a", "b", "c", "d");

        for (let index = 0; index < 25; index++) {
            expect(least.select(list)?.id).toBe(roundRobin.select(list, ctx)?.id);
        }
    });

    it("rotates only among the tied backends when some are busier", () => {
        const source = new FakeSource();
        source.set({ a: 3, b: 0, c: 0, d: 3 });
        const strategy = new LeastConnectionsStrategy(source);

        const picked = [1, 2, 3, 4].map(() => strategy.select(backends("a", "b", "c", "d"))?.id);

        expect(picked).toEqual(["b", "c", "b", "c"]);
    });

    it("treats a backend the source has never heard of as idle", () => {
        const source = new FakeSource();
        source.set({ a: 2, b: 2 });

        expect(new LeastConnectionsStrategy(source).select(backends("a", "b", "brand-new"))?.id).toBe("brand-new");
    });

    it("returns undefined when nothing is eligible", () => {
        expect(new LeastConnectionsStrategy(new FakeSource()).select([])).toBeUndefined();
    });

    it("returns the only backend, however busy", () => {
        const source = new FakeSource();
        source.set({ solo: 99 });

        expect(new LeastConnectionsStrategy(source).select(backends("solo"))?.id).toBe("solo");
    });

    it("stays in bounds when the list shrinks between calls", () => {
        const strategy = new LeastConnectionsStrategy(new FakeSource());

        [1, 2, 3].forEach(() => strategy.select(backends("a", "b", "c", "d")));

        const picked = [1, 2, 3, 4].map(() => strategy.select(backends("a", "b"))?.id);

        expect(picked.every((id) => id === "a" || id === "b")).toBe(true);
    });

    it("stays in bounds when the list grows between calls", () => {
        const strategy = new LeastConnectionsStrategy(new FakeSource());

        [1, 2, 3].forEach(() => strategy.select(backends("a", "b")));

        const picked = [1, 2, 3, 4, 5, 6, 7, 8].map(() => strategy.select(backends("a", "b", "c", "d"))?.id);

        expect(picked.every((id) => id !== undefined && ["a", "b", "c", "d"].includes(id))).toBe(true);
    });

    it("reads the counts fresh on every call instead of caching them", () => {
        const source = new FakeSource();
        const strategy = new LeastConnectionsStrategy(source);
        const list = backends("a", "b");

        strategy.select(list);
        const readsAfterFirst = source.reads;
        strategy.select(list);

        expect(source.reads).toBe(readsAfterFirst * 2);
    });

    it("spreads work evenly when each request is counted as it is dispatched and never finishes", () => {
        const source = new FakeSource();
        const strategy = new LeastConnectionsStrategy(source);
        const list = backends("a", "b", "c");

        for (let index = 0; index < 30; index++) {
            const chosen = strategy.select(list);
            source.counts.set(chosen?.id ?? "", (source.counts.get(chosen?.id ?? "") ?? 0) + 1);
        }

        expect(Array.from(source.counts.values())).toEqual([10, 10, 10]);
    });

    it("steers work away from a backend that holds requests longer", () => {
        const source = new FakeSource();
        const strategy = new LeastConnectionsStrategy(source);
        const list = backends("fast", "slow");
        const served = { fast: 0, slow: 0 };

        // Each round one request arrives. "fast" finishes it instantly; "slow" holds it for the next 4 rounds.
        const slowFinishes: number[] = [];

        for (let round = 0; round < 40; round++) {
            while (slowFinishes.length > 0 && slowFinishes[0] <= round) {
                slowFinishes.shift();
                source.counts.set("slow", Math.max(0, (source.counts.get("slow") ?? 0) - 1));
            }

            const chosen = strategy.select(list)?.id as "fast" | "slow";
            served[chosen] += 1;

            if (chosen === "slow") {
                source.counts.set("slow", (source.counts.get("slow") ?? 0) + 1);
                slowFinishes.push(round + 4);
            }
        }

        expect(served.slow).toBeLessThan(served.fast / 2);
    });
});
