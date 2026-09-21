import { describe, it, expect, afterEach } from "vitest";
import { createBackendRegistrationEndpoint } from "../../src/loadbalancing/registration/BackendRegistrationEndpoint";
import { BackendRegistry } from "../../src/loadbalancing/backends/BackendRegistry";
import { LoadBalancerMonitor } from "../../src/loadbalancing/monitoring/LoadBalancerMonitor";
import { LoadBalancerRegistration } from "../../src/loadbalancing/registration/LoadBalancerRegistration";
import { getFreePort, startEmpire } from "../fixtures/http/TestServers";
import { waitFor } from "../fixtures/http/waitFor";
import { TestLogger } from "../fixtures/services/TestLogger";

const TOKEN = "integration-token";
const LEASE_TTL_MS = 300;

/**
 * Real registration client against a real Empire balancer: the heartbeat
 * timing, restart recovery and shutdown behaviour that only mean something
 * across an actual HTTP boundary.
 */
describe("LoadBalancerRegistration against a real registry endpoint", () => {

    const cleanups: (() => Promise<void> | void)[] = [];

    afterEach(async () => {
        while (cleanups.length > 0) {
            await cleanups.pop()?.();
        }
    });

    async function startBalancer(port?: number) {
        const monitor = new LoadBalancerMonitor({ logger: new TestLogger() });
        const registry = new BackendRegistry({ leaseTtlMs: LEASE_TTL_MS, monitor });
        const server = await startEmpire((app) => {
            app.use(createBackendRegistrationEndpoint(registry, { path: "/_lb/registry", token: TOKEN }));
        }, port);

        cleanups.push(() => registry.dispose());

        return { registry, monitor, server };
    }

    function backendRegistration(registryPort: number, overrides: { token?: string } = {}) {
        return new LoadBalancerRegistration({
            registryUrl: `http://127.0.0.1:${registryPort}/_lb/registry`,
            id: "alpha",
            url: "http://127.0.0.1:59999",
            token: overrides.token ?? TOKEN,
            logger: new TestLogger(),
            requestTimeoutMs: 1000,
        });
    }

    it("registers the backend on start()", async () => {
        const { registry, server } = await startBalancer();
        cleanups.push(() => server.stop());
        const registration = backendRegistration(server.port);
        cleanups.push(() => registration.stop());

        await registration.start();

        expect(registry.eligible().map((backend) => backend.id)).toEqual(["alpha"]);
    });

    it("rejects start() when the token is wrong", async () => {
        const { registry, server } = await startBalancer();
        cleanups.push(() => server.stop());

        await expect(backendRegistration(server.port, { token: "wrong" }).start()).rejects.toThrow(/HTTP 401/);

        expect(registry.eligible()).toEqual([]);
    });

    it("rejects start() when the balancer is not running", async () => {
        const deadPort = await getFreePort();

        await expect(backendRegistration(deadPort).start()).rejects.toThrow();
    });

    it("keeps the lease alive well past one TTL by heartbeating", async () => {
        const { registry, monitor, server } = await startBalancer();
        cleanups.push(() => server.stop());
        const registration = backendRegistration(server.port);
        cleanups.push(() => registration.stop());
        let renewals = 0;
        monitor.subscribe((event) => { if (event.type === "leaseRenewed") { renewals += 1; } });

        await registration.start();
        await waitFor(() => renewals >= 4, "four heartbeats to land");

        // Three-plus TTLs of wall time have elapsed - without renewal it would be long gone.
        expect(registry.eligible().map((backend) => backend.id)).toEqual(["alpha"]);
    });

    it("drops out of rotation on its own when a backend registers once and then goes silent", async () => {
        const { registry, server } = await startBalancer();
        cleanups.push(() => server.stop());

        // A backend that crashes right after registering: one PUT, no heartbeats, no DELETE.
        const response = await fetch(`${server.url}/_lb/registry/crashy`, {
            method: "PUT",
            headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
            body: JSON.stringify({ url: "http://127.0.0.1:59998" }),
        });
        expect(response.status).toBe(201);
        expect(registry.eligible()).toHaveLength(1);

        await waitFor(() => registry.eligible().length === 0, "the lease to expire");
    });

    it("re-registers by itself after the balancer restarts and forgets everything", async () => {
        const first = await startBalancer();
        const port = first.server.port;
        const registration = backendRegistration(port);
        cleanups.push(() => registration.stop());

        await registration.start();
        expect(first.registry.eligible()).toHaveLength(1);

        // Balancer dies - and comes back on the same port with an empty registry.
        await first.server.stop();
        const second = await startBalancer(port);
        cleanups.push(() => second.server.stop());
        expect(second.registry.eligible()).toEqual([]);

        await waitFor(() => second.registry.eligible().length === 1, "the next heartbeat to re-register");

        expect(second.registry.eligible()[0].id).toBe("alpha");
    });

    it("deregisters on stop() so the balancer stops routing to it immediately", async () => {
        const { registry, server } = await startBalancer();
        cleanups.push(() => server.stop());
        const registration = backendRegistration(server.port);
        await registration.start();

        await registration.stop();

        expect(registry.eligible()).toEqual([]);
    });

    it("resolves stop() even though the balancer is already down", async () => {
        const { server } = await startBalancer();
        const registration = backendRegistration(server.port);
        await registration.start();

        await server.stop();

        await expect(registration.stop()).resolves.toBeUndefined();
    });
});
