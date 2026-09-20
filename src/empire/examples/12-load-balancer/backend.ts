/**
 * 12 - Load balancer: a backend
 *
 * A small Empire app that registers itself with the balancer in server.ts.
 * Run several, each with its own id and port.
 *
 * Run: npx tsx examples/12-load-balancer/backend.ts <id> <port> [baseLatencyMs]
 *   e.g. npx tsx examples/12-load-balancer/backend.ts alpha 8021
 *        npx tsx examples/12-load-balancer/backend.ts beta 8022 40
 *
 * Routes (each answers with the backend's id, so you can see who served it):
 *   GET  /health            instant
 *   GET  /users/:id         baseLatencyMs, plus a little jitter
 *   GET  /reports/:id       baseLatencyMs x 2
 *   GET  /slow              400 ms + baseLatencyMs x 4 - the tallest p95 stalk on the dashboard
 *   GET  /flaky             fails with a 500 about 3 times in 10
 *   POST /orders            201, baseLatencyMs
 *
 * Two lines here matter for the balancer. createRouteHeaderMiddleware() tells
 * it which route each request matched (/users/:id, not /users/42), so the
 * dashboard can group calls by endpoint; without it the balancer only
 * guesses from the path. And the order at the bottom: serve first, then
 * announce; on shutdown, deregister first, then stop serving - so requests
 * already in flight on this backend finish instead of being cut off.
 *
 * The balancer and every backend must agree on EMPIRE_LB_TOKEN (default:
 * a demo token).
 */

import process from "process";
import { Empire } from "../../src/Empire";
import { LoadBalancerRegistration } from "../../src/loadbalancing/registration/LoadBalancerRegistration";
import { createRouteHeaderMiddleware } from "../../src/middleware/RouteHeaderMiddleware";

const REGISTRY_URL = "http://127.0.0.1:8012/_lb/registry";
const TOKEN = process.env.EMPIRE_LB_TOKEN ?? "dev-token";
const FLAKY_FAILURE_RATE = 0.3;
const SLOW_BASE_MS = 400;
const JITTER_MS = 15;
const MAX_PORT = 65535;
const SHUTDOWN_TIMEOUT_MS = 3000;

const [idArg, portArg, latencyArg] = process.argv.slice(2);

if (!idArg || !portArg) {
    console.error("Usage: npx tsx examples/12-load-balancer/backend.ts <id> <port> [baseLatencyMs]");
    process.exit(1);
}

const id = idArg;
const backendPort = Number(portArg);
const baseLatencyMs = Number(latencyArg ?? 0);

if (!Number.isInteger(backendPort) || backendPort < 1 || backendPort > MAX_PORT || !Number.isFinite(baseLatencyMs) || baseLatencyMs < 0) {
    console.error("port must be 1-65535 and baseLatencyMs must be 0 or more");
    process.exit(1);
}

const app = new Empire({ host: "127.0.0.1", port: backendPort, shutdownTimeoutMs: SHUTDOWN_TIMEOUT_MS });

function pause(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(): number {
    return Math.random() * JITTER_MS;
}

app.use(createRouteHeaderMiddleware());

app.get("/health", (ctx) => {
    ctx.json({ backend: id, status: "ok" });
});

app.get("/users/:id", async (ctx) => {
    await pause(baseLatencyMs + jitter());
    ctx.json({ backend: id, user: ctx.params.id });
});

app.get("/reports/:id", async (ctx) => {
    await pause(baseLatencyMs * 2 + jitter());
    ctx.json({ backend: id, report: ctx.params.id });
});

app.get("/slow", async (ctx) => {
    await pause(SLOW_BASE_MS + baseLatencyMs * 4 + jitter());
    ctx.json({ backend: id, slow: true });
});

app.get("/flaky", (ctx) => {
    if (Math.random() < FLAKY_FAILURE_RATE) {
        ctx.status(500).json({ backend: id, error: "flaked" });
        return;
    }

    ctx.json({ backend: id, flaky: "this time it worked" });
});

app.post("/orders", async (ctx) => {
    await pause(baseLatencyMs + jitter());
    ctx.status(201).json({ backend: id, created: true });
});

const registration = new LoadBalancerRegistration({
    registryUrl: REGISTRY_URL,
    id,
    url: `http://127.0.0.1:${backendPort}`,
    token: TOKEN,
    logger: app.logger,
});

async function start(): Promise<void> {
    try {
        await app.start();
        // Serve first, then announce.
        await registration.start();
        app.logger.info(`Backend "${id}" registered with ${REGISTRY_URL}`);
    } catch (err) {
        app.logger.error(`Failed to start backend "${id}" - is the balancer (server.ts) running?`, err);
        await registration.stop();
        await app.stop().catch(() => undefined);
        process.exit(1);
    }
}

process.on("SIGINT", async () => {
    app.logger.info("Shutting down...");

    try {
        // Deregister first, then stop serving, so in-flight requests drain.
        await registration.stop();
        await app.stop();
        app.logger.info("Server stopped.");
        process.exit(0);
    } catch (err) {
        app.logger.error("Error during shutdown", err);
        process.exit(1);
    }
});

void start();
