import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LoadBalancerRegistration } from "../../../../src/loadbalancing/registration/LoadBalancerRegistration";
import { LoadBalancerRegistrationOptions } from "../../../../src/loadbalancing/registration/LoadBalancerRegistrationOptions";
import { TestLogger } from "../../../fixtures/services/TestLogger";

const REGISTRY_URL = "http://127.0.0.1:5000/_lb/registry";
const LEASE_TTL_MS = 3000;
const HEARTBEAT_MS = LEASE_TTL_MS / 3;

function leaseResponse(ttl = LEASE_TTL_MS): Response {
    return new Response(JSON.stringify({ leaseTtlMs: ttl }), { status: 201, headers: { "Content-Type": "application/json" } });
}

function errorResponse(status: number, message: string): Response {
    return new Response(JSON.stringify({ error: message }), { status, headers: { "Content-Type": "application/json" } });
}

describe("LoadBalancerRegistration (unit, fetch stubbed)", () => {

    let logger: TestLogger;
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.useFakeTimers();
        logger = new TestLogger();
        fetchMock = vi.fn(() => Promise.resolve(leaseResponse()));
        vi.stubGlobal("fetch", fetchMock);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    function registration(overrides: Partial<LoadBalancerRegistrationOptions> = {}): LoadBalancerRegistration {
        return new LoadBalancerRegistration({
            registryUrl: REGISTRY_URL, id: "alpha", url: "http://127.0.0.1:5001", token: "tok", logger, ...overrides,
        });
    }

    function calls(method: string): unknown[][] {
        return fetchMock.mock.calls.filter((call: unknown[]) => (call[1] as RequestInit).method === method);
    }

    describe("construction", () => {

        it("rejects an invalid id immediately", () => {
            expect(() => registration({ id: "bad id" })).toThrow(/Invalid backend id/);
        });

        it("rejects an invalid backend url immediately", () => {
            expect(() => registration({ url: "ftp://nope" })).toThrow(/Invalid backend url/);
        });
    });

    describe("start", () => {

        it("PUTs the backend's url to {registryUrl}/{id} with the bearer token", async () => {
            await registration().start();

            const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

            expect(url).toBe(`${REGISTRY_URL}/alpha`);
            expect(init.method).toBe("PUT");
            expect(init.body).toBe(JSON.stringify({ url: "http://127.0.0.1:5001" }));
            expect(init.headers).toMatchObject({ Authorization: "Bearer tok", "Content-Type": "application/json" });
        });

        it("omits the Authorization header when no token is configured", async () => {
            await registration({ token: undefined }).start();

            const init = fetchMock.mock.calls[0][1] as RequestInit;

            expect(init.headers).not.toHaveProperty("Authorization");
        });

        it("tolerates a trailing slash on the registry url", async () => {
            await registration({ registryUrl: `${REGISTRY_URL}/` }).start();

            expect(fetchMock.mock.calls[0][0]).toBe(`${REGISTRY_URL}/alpha`);
        });

        it("percent-encodes an id containing a colon", async () => {
            await registration({ id: "host:5001" }).start();

            expect(fetchMock.mock.calls[0][0]).toBe(`${REGISTRY_URL}/host%3A5001`);
        });

        it("rejects when the first registration is refused, naming the status and reason", async () => {
            fetchMock.mockResolvedValueOnce(errorResponse(401, "Unauthorized"));

            await expect(registration().start()).rejects.toThrow(/HTTP 401: Unauthorized/);
        });

        it("rejects when the balancer is unreachable", async () => {
            fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));

            await expect(registration().start()).rejects.toThrow(/fetch failed/);
        });

        it("rejects when the response has no usable leaseTtlMs", async () => {
            fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ nope: true }), { status: 201 }));

            await expect(registration().start()).rejects.toThrow(/leaseTtlMs/);
        });

        it("does not start heartbeating after a failed first registration", async () => {
            fetchMock.mockRejectedValueOnce(new Error("down"));

            await registration().start().catch(() => undefined);
            await vi.advanceTimersByTimeAsync(LEASE_TTL_MS * 3);

            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it("undoes its own registration if stop() was called while the first PUT was still in flight", async () => {
            let answerFirstPut: (response: Response) => void = () => undefined;
            fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { answerFirstPut = resolve; }));
            const instance = registration();

            const starting = instance.start();
            await instance.stop(); // nothing is registered yet, so this has nothing to undo
            answerFirstPut(leaseResponse());
            await starting;

            expect(calls("DELETE")).toHaveLength(1);
            await vi.advanceTimersByTimeAsync(LEASE_TTL_MS * 3);
            expect(calls("PUT")).toHaveLength(1); // and it never starts heartbeating
        });

        it("cannot be started twice", async () => {
            const instance = registration();
            await instance.start();

            await expect(instance.start()).rejects.toThrow(/only be started once/);
            await instance.stop();
        });
    });

    describe("heartbeat", () => {

        it("renews every third of the lease TTL the balancer reports", async () => {
            const instance = registration();
            await instance.start();

            await vi.advanceTimersByTimeAsync(HEARTBEAT_MS - 1);
            expect(calls("PUT")).toHaveLength(1);

            await vi.advanceTimersByTimeAsync(1);
            expect(calls("PUT")).toHaveLength(2);

            await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
            expect(calls("PUT")).toHaveLength(3);

            await instance.stop();
        });

        it("follows the balancer if it changes the lease TTL", async () => {
            fetchMock.mockImplementation(() => Promise.resolve(leaseResponse(LEASE_TTL_MS)));
            const instance = registration();
            await instance.start();

            fetchMock.mockImplementation(() => Promise.resolve(leaseResponse(LEASE_TTL_MS * 3)));
            await vi.advanceTimersByTimeAsync(HEARTBEAT_MS); // this beat learns the new TTL
            const beatsBefore = calls("PUT").length;

            await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 2);
            expect(calls("PUT")).toHaveLength(beatsBefore); // next beat is now 3000ms away, not 1000ms

            await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
            expect(calls("PUT")).toHaveLength(beatsBefore + 1);

            await instance.stop();
        });

        it("never overlaps a slow heartbeat with the next one", async () => {
            let release: () => void = () => undefined;
            const instance = registration();
            await instance.start();

            fetchMock.mockImplementation(() => new Promise<Response>((resolve) => {
                release = () => resolve(leaseResponse());
            }));

            await vi.advanceTimersByTimeAsync(HEARTBEAT_MS); // slow beat begins
            await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 5); // would have fired 5 more if it were an interval

            expect(calls("PUT")).toHaveLength(2);

            release();
            fetchMock.mockImplementation(() => Promise.resolve(leaseResponse())); // let the DELETE answer
            await instance.stop();
        });

        it("logs a failure as a warning and keeps retrying on the next tick", async () => {
            const instance = registration();
            await instance.start();

            fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
            await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);

            expect(logger.warnMessages).toHaveLength(1);
            expect(logger.warnMessages[0]).toMatch(/will retry.*fetch failed/);

            await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
            expect(calls("PUT")).toHaveLength(3);
            expect(logger.warnMessages).toHaveLength(1);

            await instance.stop();
        });

        it.each([401, 409])("logs a %i as an error, since retrying cannot fix it", async (status) => {
            const instance = registration();
            await instance.start();

            fetchMock.mockResolvedValueOnce(errorResponse(status, "refused"));
            await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);

            expect(logger.errorMessages).toHaveLength(1);
            expect(logger.warnMessages).toHaveLength(0);

            await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
            expect(calls("PUT")).toHaveLength(3); // still trying

            await instance.stop();
        });

        it("logs a 5xx as a retryable warning", async () => {
            const instance = registration();
            await instance.start();

            fetchMock.mockResolvedValueOnce(errorResponse(503, "restarting"));
            await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);

            expect(logger.warnMessages).toHaveLength(1);
            expect(logger.errorMessages).toHaveLength(0);

            await instance.stop();
        });

        it("uses unref'd timers so it never keeps the process alive", async () => {
            vi.useRealTimers();
            const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
            const instance = registration();
            await instance.start();

            const heartbeatTimer = setTimeoutSpy.mock.results
                .map((result) => result.value as NodeJS.Timeout)
                .find((timer) => !timer.hasRef());

            expect(heartbeatTimer).toBeDefined();

            await instance.stop();
            setTimeoutSpy.mockRestore();
        });
    });

    describe("stop", () => {

        it("cancels the heartbeat", async () => {
            const instance = registration();
            await instance.start();
            await instance.stop();

            const putsBefore = calls("PUT").length;
            await vi.advanceTimersByTimeAsync(LEASE_TTL_MS * 5);

            expect(calls("PUT")).toHaveLength(putsBefore);
        });

        it("sends a DELETE for its id with the bearer token", async () => {
            const instance = registration();
            await instance.start();
            await instance.stop();

            const [url, init] = calls("DELETE")[0] as [string, RequestInit];

            expect(url).toBe(`${REGISTRY_URL}/alpha`);
            expect(init.headers).toMatchObject({ Authorization: "Bearer tok" });
        });

        it("resolves even when the DELETE fails, logging a warning", async () => {
            const instance = registration();
            await instance.start();

            fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));

            await expect(instance.stop()).resolves.toBeUndefined();
            expect(logger.warnMessages.some((message) => message.includes("lease will expire"))).toBe(true);
        });

        it("resolves when the balancer hangs, bounded by a short timeout", async () => {
            const instance = registration();
            await instance.start();

            fetchMock.mockImplementation((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
                init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
            }));

            const stopped = instance.stop();
            await vi.advanceTimersByTimeAsync(2500);

            await expect(stopped).resolves.toBeUndefined();
        });

        it("aborts a heartbeat that is in flight", async () => {
            const instance = registration();
            await instance.start();

            let heartbeatSignal: AbortSignal | undefined;
            fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
                heartbeatSignal = init.signal ?? undefined;
                init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
            }));

            await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
            await instance.stop();

            expect(heartbeatSignal?.aborted).toBe(true);
            expect(logger.warnMessages.filter((message) => message.includes("Heartbeat"))).toHaveLength(0);
        });

        it("does not try to deregister if it never registered", async () => {
            fetchMock.mockRejectedValueOnce(new Error("down"));
            const instance = registration();
            await instance.start().catch(() => undefined);

            await instance.stop();

            expect(calls("DELETE")).toHaveLength(0);
        });

        it("is safe to call twice", async () => {
            const instance = registration();
            await instance.start();

            await instance.stop();
            await instance.stop();

            expect(calls("DELETE")).toHaveLength(1);
        });
    });
});
