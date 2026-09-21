import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { BackendRegistry } from "../../../../src/loadbalancing/backends/BackendRegistry";
import { LoadBalancerMonitor } from "../../../../src/loadbalancing/monitoring/LoadBalancerMonitor";
import { LoadBalancerEvent } from "../../../../src/loadbalancing/monitoring/LoadBalancerEvent";
import { HttpError } from "../../../../src/errors/HttpError";
import { TestLogger } from "../../../fixtures/services/TestLogger";

const URL_A = "http://127.0.0.1:5001";
const URL_B = "http://127.0.0.1:5002";
const TTL_MS = 1000;

describe("BackendRegistry", () => {

    let registry: BackendRegistry;
    let monitor: LoadBalancerMonitor;
    let events: LoadBalancerEvent[];

    beforeEach(() => {
        vi.useFakeTimers();
        monitor = new LoadBalancerMonitor({ logger: new TestLogger() });
        events = [];
        monitor.subscribe((event) => events.push(event));
        registry = new BackendRegistry({ leaseTtlMs: TTL_MS, monitor });
    });

    afterEach(() => {
        registry.dispose();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    describe("construction", () => {

        it("defaults the lease TTL to 15 seconds", () => {
            expect(new BackendRegistry().leaseTtlMs).toBe(15_000);
        });

        it.each([0, -1, Number.NaN, Infinity])("rejects a leaseTtlMs of %s", (ttl) => {
            expect(() => new BackendRegistry({ leaseTtlMs: ttl })).toThrow(/leaseTtlMs/);
        });
    });

    describe("register", () => {

        it("creates a new registration and reports it as created", () => {
            expect(registry.register("alpha", URL_A)).toEqual({ created: true });
            expect(registry.eligible().map((backend) => backend.id)).toEqual(["alpha"]);
        });

        it("marks the entry as registered with a lease expiry one TTL away", () => {
            vi.setSystemTime(10_000);
            registry.register("alpha", URL_A);

            expect(registry.eligible()[0]).toMatchObject({
                id: "alpha",
                url: URL_A,
                source: "registered",
                expiresAt: 10_000 + TTL_MS,
            });
        });

        it("treats the same id and URL as a renewal that extends the lease", () => {
            vi.setSystemTime(10_000);
            registry.register("alpha", URL_A);

            vi.setSystemTime(10_600);

            expect(registry.register("alpha", URL_A)).toEqual({ created: false });
            expect(registry.eligible()[0].expiresAt).toBe(10_600 + TTL_MS);
            expect(registry.eligible()).toHaveLength(1);
        });

        it("treats a trailing-slash variant of the same URL as a renewal", () => {
            registry.register("alpha", URL_A);

            expect(registry.register("alpha", `${URL_A}/`)).toEqual({ created: false });
        });

        it("rejects a live id re-registered for a different URL with 409", () => {
            registry.register("alpha", URL_A);

            expect(() => registry.register("alpha", URL_B)).toThrow(HttpError);

            try {
                registry.register("alpha", URL_B);
            } catch (err) {
                expect((err as HttpError).statusCode).toBe(409);
            }

            expect(registry.eligible()[0].url).toBe(URL_A);
        });

        it("frees an id for a different URL once its lease has lapsed", () => {
            registry.register("alpha", URL_A);
            vi.advanceTimersByTime(TTL_MS + 1);

            expect(registry.register("alpha", URL_B)).toEqual({ created: true });
            expect(registry.eligible()[0].url).toBe(URL_B);
        });

        it("rejects an invalid id", () => {
            expect(() => registry.register("bad id", URL_A)).toThrow(/Invalid backend id/);
        });

        it("rejects an invalid URL", () => {
            expect(() => registry.register("alpha", "ftp://nope")).toThrow(/Invalid backend url/);
        });

        it("emits backendAdded with its expiry on creation and leaseRenewed on renewal", () => {
            vi.setSystemTime(5_000);
            registry.register("alpha", URL_A);
            registry.register("alpha", URL_A);

            expect(events).toEqual([
                {
                    type: "backendAdded",
                    backend: { id: "alpha", url: URL_A, source: "registered" },
                    expiresAt: 5_000 + TTL_MS,
                    at: 5_000,
                },
                { type: "leaseRenewed", backendId: "alpha", expiresAt: 5_000 + TTL_MS, at: 5_000 },
            ]);
        });
    });

    describe("static backends", () => {

        it("are always eligible and never expire", () => {
            registry.addStatic({ id: "legacy", url: URL_A });
            vi.advanceTimersByTime(TTL_MS * 100);

            expect(registry.eligible().map((backend) => backend.id)).toEqual(["legacy"]);
            expect(registry.eligible()[0].expiresAt).toBeUndefined();
            expect(registry.eligible()[0].source).toBe("static");
        });

        it("refuse a remote registration of the same id with 409", () => {
            registry.addStatic({ id: "legacy", url: URL_A });

            expect(() => registry.register("legacy", URL_A)).toThrow(HttpError);
        });

        it("refuse a remote deregistration with 409", () => {
            registry.addStatic({ id: "legacy", url: URL_A });

            expect(() => registry.deregister("legacy")).toThrow(HttpError);
            expect(registry.eligible()).toHaveLength(1);
        });

        it("throw on a duplicate id", () => {
            registry.addStatic({ id: "legacy", url: URL_A });

            expect(() => registry.addStatic({ id: "legacy", url: URL_B })).toThrow(/already registered/);
        });

        it("throw on an invalid URL at startup", () => {
            expect(() => registry.addStatic({ id: "legacy", url: "nope" })).toThrow(/Invalid backend url/);
        });

        it("do not start the sweep timer", () => {
            const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
            const fresh = new BackendRegistry({ leaseTtlMs: TTL_MS });

            fresh.addStatic({ id: "legacy", url: URL_A });

            expect(setIntervalSpy).not.toHaveBeenCalled();
        });
    });

    describe("deregister", () => {

        it("removes the backend from selection and returns true", () => {
            registry.register("alpha", URL_A);

            expect(registry.deregister("alpha")).toBe(true);
            expect(registry.eligible()).toEqual([]);
        });

        it("is idempotent for an id that is already gone", () => {
            expect(registry.deregister("ghost")).toBe(false);
        });

        it("emits backendRemoved with reason deregistered", () => {
            registry.register("alpha", URL_A);
            registry.deregister("alpha");

            expect(events.at(-1)).toMatchObject({ type: "backendRemoved", backendId: "alpha", reason: "deregistered" });
        });
    });

    describe("expiry", () => {

        it("drops a backend once its lease lapses, via the sweep timer", () => {
            registry.register("alpha", URL_A);

            vi.advanceTimersByTime(TTL_MS + TTL_MS / 2);

            expect(registry.eligible()).toEqual([]);
            expect(events.at(-1)).toMatchObject({ type: "backendRemoved", backendId: "alpha", reason: "expired" });
        });

        it("keeps a backend that keeps renewing", () => {
            registry.register("alpha", URL_A);

            for (let beat = 0; beat < 10; beat++) {
                vi.advanceTimersByTime(TTL_MS / 3);
                registry.register("alpha", URL_A);
            }

            expect(registry.eligible().map((backend) => backend.id)).toEqual(["alpha"]);
            expect(events.some((event) => event.type === "backendRemoved")).toBe(false);
        });

        it("excludes an expired-but-not-yet-swept backend from eligible()", () => {
            registry.register("alpha", URL_A);

            // Lapse the lease without letting the sweep timer fire.
            vi.setSystemTime(Date.now() + TTL_MS + 1);

            expect(registry.eligible()).toEqual([]);
        });

        it("sweep() emits backendRemoved reason expired exactly once per lapsed lease", () => {
            registry.register("alpha", URL_A);
            registry.register("beta", URL_B);
            vi.setSystemTime(Date.now() + TTL_MS + 1);

            expect(registry.sweep()).toBe(2);
            expect(registry.sweep()).toBe(0);

            const removals = events.filter((event) => event.type === "backendRemoved");
            expect(removals).toHaveLength(2);
        });

        it("leaves unexpired backends in place when sweeping", () => {
            registry.register("alpha", URL_A);
            registry.addStatic({ id: "legacy", url: URL_B });

            expect(registry.sweep()).toBe(0);
            expect(registry.eligible()).toHaveLength(2);
        });
    });

    describe("sweep timer", () => {

        it("is unref'd so it never keeps the process alive", () => {
            vi.useRealTimers();
            const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
            const real = new BackendRegistry({ leaseTtlMs: TTL_MS });

            real.register("alpha", URL_A);

            const timer = setIntervalSpy.mock.results[0].value as NodeJS.Timeout;
            expect(timer.hasRef()).toBe(false);

            real.dispose();
        });

        it("runs twice per TTL", () => {
            const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
            const fresh = new BackendRegistry({ leaseTtlMs: TTL_MS });

            fresh.register("alpha", URL_A);

            expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), TTL_MS / 2);
            fresh.dispose();
        });

        it("is started once however many registrations happen", () => {
            const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
            const fresh = new BackendRegistry({ leaseTtlMs: TTL_MS });

            fresh.register("alpha", URL_A);
            fresh.register("beta", URL_B);
            fresh.register("alpha", URL_A);

            expect(setIntervalSpy).toHaveBeenCalledTimes(1);
            fresh.dispose();
        });

        it("is cleared on dispose", () => {
            const clearSpy = vi.spyOn(globalThis, "clearInterval");

            registry.register("alpha", URL_A);
            registry.dispose();

            expect(clearSpy).toHaveBeenCalledTimes(1);
            expect(vi.getTimerCount()).toBe(0);
        });

        it("makes dispose safe to call twice and when never started", () => {
            const fresh = new BackendRegistry();

            expect(() => {
                fresh.dispose();
                fresh.dispose();
            }).not.toThrow();
        });
    });

    describe("eligible", () => {

        it("returns a fresh array each call so a strategy cannot corrupt registry state", () => {
            registry.register("alpha", URL_A);

            const first = registry.eligible();
            first.pop();

            expect(registry.eligible()).toHaveLength(1);
        });

        it("keeps registration order", () => {
            registry.register("alpha", URL_A);
            registry.register("beta", URL_B);

            expect(registry.eligible().map((backend) => backend.id)).toEqual(["alpha", "beta"]);
        });
    });
});
