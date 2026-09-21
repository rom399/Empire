import { describe, it, expect, afterEach } from "vitest";
import { BackendRegistry } from "../../src/loadbalancing/backends/BackendRegistry";
import { createLoadBalancerMiddleware } from "../../src/loadbalancing/proxy/LoadBalancerMiddleware";
import { LoadBalancerMonitor } from "../../src/loadbalancing/monitoring/LoadBalancerMonitor";
import { ILoadBalancingStrategy } from "../../src/loadbalancing/strategy/ILoadBalancingStrategy";
import { LeastConnectionsStrategy } from "../../src/loadbalancing/strategy/LeastConnectionsStrategy";
import { RoundRobinStrategy } from "../../src/loadbalancing/strategy/RoundRobinStrategy";
import { startEmpire, startHttpServer } from "../fixtures/http/TestServers";
import { waitFor } from "../fixtures/http/waitFor";
import { TestLogger } from "../fixtures/services/TestLogger";

const REQUESTS = 30;
const ARRIVAL_GAP_MS = 20;

/**
 * How long the slow backend holds a request. Deliberately much longer than the
 * whole stream takes to arrive (REQUESTS x ARRIVAL_GAP_MS = 600 ms), so the
 * outcome does not hinge on timer precision: even if a loaded CI machine
 * stretches every gap several times over, the slow backend is still busy with
 * its first request for most of the stream.
 */
const SLOW_HOLD_MS = 1500;

/**
 * The reason least connections exists, measured through a real balancer and
 * real backends: a steady stream of requests, one backend that answers at once
 * and one that holds each request for a while.
 */
describe("least connections through a real balancer", () => {

    const cleanups: (() => Promise<void> | void)[] = [];

    afterEach(async () => {
        while (cleanups.length > 0) {
            await cleanups.pop()?.();
        }
    });

    /**
     * Starts two backends behind a balancer. "fast" answers after `fastHoldMs`
     * (instantly by default) and "slow" holds every request for `slowHoldMs`.
     */
    async function serve(
        strategyFor: (monitor: LoadBalancerMonitor) => ILoadBalancingStrategy,
        { fastHoldMs = 0, slowHoldMs = SLOW_HOLD_MS }: { fastHoldMs?: number; slowHoldMs?: number } = {}
    ) {
        const monitor = new LoadBalancerMonitor({ logger: new TestLogger() });
        const registry = new BackendRegistry({ monitor });
        cleanups.push(() => registry.dispose());

        const fast = await startHttpServer((_req, res) => { setTimeout(() => res.end("fast"), fastHoldMs); });
        const slow = await startHttpServer((_req, res) => { setTimeout(() => res.end("slow"), slowHoldMs); });
        cleanups.push(() => fast.stop());
        cleanups.push(() => slow.stop());

        registry.register("fast", fast.url);
        registry.register("slow", slow.url);

        const balancer = createLoadBalancerMiddleware({ registry, monitor, strategy: strategyFor(monitor) });
        cleanups.push(() => balancer.dispose());
        const server = await startEmpire((app) => { app.use(balancer); });
        cleanups.push(() => server.stop());

        return { monitor, server };
    }

    /** Sends REQUESTS requests one arrival gap apart, without waiting for earlier ones to finish. */
    async function sendSteadyStream(url: string): Promise<{ fast: number; slow: number }> {
        const answers: Promise<string>[] = [];

        for (let index = 0; index < REQUESTS; index++) {
            answers.push(fetch(url).then((response) => response.text()));
            await new Promise((resolve) => setTimeout(resolve, ARRIVAL_GAP_MS));
        }

        const served = await Promise.all(answers);

        return {
            fast: served.filter((name) => name === "fast").length,
            slow: served.filter((name) => name === "slow").length,
        };
    }

    it("sends far less than half the traffic to the backend that holds requests longest", async () => {
        const { server } = await serve((monitor) => new LeastConnectionsStrategy(monitor));

        const served = await sendSteadyStream(server.url);

        expect(served.fast + served.slow).toBe(REQUESTS);
        expect(served.slow).toBeLessThan(served.fast / 2);
    });

    it("does the opposite of round robin, which splits the same stream exactly in half", async () => {
        const { server } = await serve(() => new RoundRobinStrategy());

        const served = await sendSteadyStream(server.url);

        expect(served).toEqual({ fast: REQUESTS / 2, slow: REQUESTS / 2 });
    });

    it("leaves nothing counted as in flight once the stream has finished", async () => {
        const { server, monitor } = await serve((m) => new LeastConnectionsStrategy(m));

        await sendSteadyStream(server.url);
        await waitFor(() => monitor.inFlight("fast") === 0 && monitor.inFlight("slow") === 0, "in-flight counts to drain");

        expect(monitor.inFlight("fast")).toBe(0);
        expect(monitor.inFlight("slow")).toBe(0);
    });

    it("splits a burst evenly between backends that are equally slow", async () => {
        const { server } = await serve(
            (monitor) => new LeastConnectionsStrategy(monitor),
            { fastHoldMs: SLOW_HOLD_MS, slowHoldMs: SLOW_HOLD_MS }
        );

        // All 20 arrive while every earlier one is still being held, so each backend's count climbs together.
        const answers = await Promise.all(
            Array.from({ length: 20 }, () => fetch(server.url).then((response) => response.text()))
        );
        const first = answers.filter((name) => name === "fast").length;
        const second = answers.filter((name) => name === "slow").length;

        expect(first + second).toBe(20);
        expect(Math.abs(first - second)).toBeLessThanOrEqual(2);
    });
});
