/**
 * 12 - Load balancer (the balancer itself; backend.ts and traffic.ts are its companions)
 *
 * Empire acting as a small layer-7 reverse proxy - see
 * doc/features/Loadbalancer-v1.md for the full design. A learning and
 * local-development tool, not a production edge: no TLS, no HTTP/2, no
 * WebSocket upgrades, no retries.
 *
 * Three pieces, all plain middleware registered with app.use(), in this
 * order - the load balancer is terminal (it never calls next()), so
 * everything the balancer app answers itself must come before it:
 *
 *   1. createLoadBalancerDashboard    - the live 3D view, at /_lb
 *   2. createBackendRegistrationEndpoint - where backends announce themselves, at /_lb/registry
 *   3. createLoadBalancerMiddleware   - the proxy itself, round robin by default
 *
 * Backends register themselves and keep a lease alive with heartbeats; nothing
 * here lists them. The lease is 5 seconds so a killed backend leaves the
 * ring quickly enough to watch (the library default is 15).
 *
 * Run (each in its own terminal):
 *   npx tsx examples/12-load-balancer/server.ts                       # this balancer, port 8012
 *   npx tsx examples/12-load-balancer/backend.ts alpha 8021           # a backend
 *   npx tsx examples/12-load-balancer/backend.ts beta 8022 40         # a slower one (40 ms base latency)
 *   npx tsx examples/12-load-balancer/traffic.ts                      # steady traffic through the balancer
 *
 * Open: http://localhost:8012/_lb
 *
 * Scripted walkthrough:
 *   1. Start only this balancer. The ring is empty, and any request answers 503:
 *        curl -i http://localhost:8012/health
 *   2. Start alpha, then beta, then gamma (a third terminal, backend.ts gamma 8023 120).
 *      Each spawns into the ring the moment it registers, and round robin starts
 *      sweeping the widened ring - no balancer restart, no config edit.
 *   3. Start traffic.ts. Click a backend node (or its row): the camera flies to
 *      it and it unfolds into one satellite per route - GET /users/:id, GET /slow,
 *      GET /flaky - sized by request count, coloured by error rate, with a
 *      "stalk" as long as the route's p95 latency. The table and call tail
 *      show the same data as numbers.
 *   4. Watch GET /slow: its p95 stalk is the tallest. Hammer it and it grows:
 *        for i in $(seq 1 40); do curl -s http://localhost:8012/slow > /dev/null; done
 *   5. Ctrl-C one backend: it deregisters first, so its node fades gracefully
 *      while any request it was serving finishes.
 *   6. Kill one hard (kill -9 its process id): nothing tells the balancer. Its lease
 *      arc drains over 5 seconds, then the node collapses - "crashed" looks
 *      different from "shut down cleanly".
 *   7. Ctrl-C this balancer and start it again. The backends re-register by
 *      themselves within one heartbeat, since a heartbeat is just a registration.
 *
 * Set EMPIRE_LB_TOKEN on the balancer and every backend to change the shared
 * secret; the default below is for local demos only. Registration is open to
 * loopback clients only, and the dashboard likewise - see the design doc's
 * security section before changing either.
 */

import process from "process";
import { Empire } from "../../src/Empire";
import { BackendRegistry } from "../../src/loadbalancing/backends/BackendRegistry";
import { createBackendRegistrationEndpoint } from "../../src/loadbalancing/registration/BackendRegistrationEndpoint";
import { createLoadBalancerDashboard } from "../../src/loadbalancing/dashboard/LoadBalancerDashboard";
import { createLoadBalancerMiddleware } from "../../src/loadbalancing/proxy/LoadBalancerMiddleware";
import { LoadBalancerMonitor } from "../../src/loadbalancing/monitoring/LoadBalancerMonitor";
import { RoundRobinStrategy } from "../../src/loadbalancing/strategy/RoundRobinStrategy";

const PORT = 8012;
const LEASE_TTL_MS = 5000;
const PROXY_TIMEOUT_MS = 10_000;
const SHUTDOWN_TIMEOUT_MS = 2000;
const TOKEN = process.env.EMPIRE_LB_TOKEN ?? "dev-token";

const app = new Empire({
    host: "127.0.0.1",
    port: PORT,
    // An open dashboard tab is a stream that never finishes by itself;
    // dispose() below ends those, and this bounds anything else.
    shutdownTimeoutMs: SHUTDOWN_TIMEOUT_MS,
});

const monitor = new LoadBalancerMonitor({ logger: app.logger });
const registry = new BackendRegistry({ leaseTtlMs: LEASE_TTL_MS, monitor });

const dashboard = createLoadBalancerDashboard(monitor, { path: "/_lb" });
const loadBalancer = createLoadBalancerMiddleware({
    registry,
    monitor,
    strategy: new RoundRobinStrategy(),
    timeoutMs: PROXY_TIMEOUT_MS,
    logger: app.logger,
});

app.use(dashboard);
app.use(createBackendRegistrationEndpoint(registry, { path: "/_lb/registry", token: TOKEN }));
app.use(loadBalancer);

async function start(): Promise<void> {
    try {
        await app.start();
        app.logger.info(`Dashboard: http://localhost:${PORT}/_lb   Registry: http://127.0.0.1:${PORT}/_lb/registry`);
    } catch (err) {
        app.logger.error("Failed to start server", err);
        process.exit(1);
    }
}

process.on("SIGINT", async () => {
    app.logger.info("Shutting down...");

    try {
        dashboard.dispose();
        loadBalancer.dispose();
        registry.dispose();
        await app.stop();
        app.logger.info("Server stopped.");
        process.exit(0);
    } catch (err) {
        app.logger.error("Error during shutdown", err);
        process.exit(1);
    }
});

void start();
