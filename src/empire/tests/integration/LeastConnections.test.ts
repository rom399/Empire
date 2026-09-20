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
const SLOW_HOLD_MS = 300;

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

    async function serve(strategyFor: (monitor: LoadBalancerMonitor) => ILoadBalancingStrategy) {
        const monitor = new LoadBalancerMonitor({ logger: new TestLogger() });
        const registry = new BackendRegistry({ monitor });
        cleanups.push(() => registry.dispose());

        const fast = await startHttpServer((_req, res) => { res.end("fast"); });
        const slow = await startHttpServer((_req, res) => { setTimeout(() => res.end("slow"), SLOW_HOLD_MS); });
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

    it("splits a burst evenly, since every backend is equally loaded as the requests arrive together", async () => {
        const { server } = await serve((monitor) => new LeastConnectionsStrategy(monitor));

        const answers = await Promise.all(
            Array.from({ length: 20 }, () => fetch(server.url).then((response) => response.text()))
        );

        expect(answers.filter((name) => name === "slow")).toHaveLength(10);
    });
});
