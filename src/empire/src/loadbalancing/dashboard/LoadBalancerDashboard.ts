import fs from "fs";
import path from "path";
import { Context } from "../../http/Context";
import { HttpError } from "../../errors/HttpError";
import { StaticFileHandler } from "../../static/StaticFileHandler";
import { DashboardSseClient } from "./DashboardSseClient";
import { renderDashboardPage } from "./page/dashboardPage";
import { ILoadBalancerDashboard } from "./ILoadBalancerDashboard";
import { isLoopbackAddress } from "../isLoopbackAddress";
import { LoadBalancerDashboardOptions } from "./LoadBalancerDashboardOptions";
import { LoadBalancerMonitor } from "../monitoring/LoadBalancerMonitor";

/**
 * three.js is the one third-party library in the feature, and it is
 * browser-side only: the empire-ts package never imports it. The page pulls
 * it from the CDN at this exact version unless told otherwise, so a
 * dashboard cannot silently change behaviour when three.js releases.
 */
export const THREE_VERSION = "0.170.0";
const DEFAULT_THREE_BASE_URL = `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/`;

const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;

/** How long a browser's EventSource waits before reconnecting after the stream drops. */
const SSE_RECONNECT_DELAY_MS = 2_000;
const VENDOR_SEGMENT = "vendor/three";

/**
 * Builds the dashboard's endpoints:
 *
 *   GET {path}                  the self-contained HTML page (three.js scene + overlay)
 *   GET {path}/events           a Server-Sent Events stream: a `snapshot`, then one message per monitor event
 *   GET {path}/backends/{id}    JSON call detail for one backend - route stats and recent calls
 *   GET {path}/vendor/three/*   three.js served locally, only when threeLocalPath is set
 *
 * Anything else passes through to next(), so it can sit anywhere before the
 * (terminal) load balancer middleware.
 *
 * Server-Sent Events rather than WebSockets: data only ever flows from
 * server to browser, SSE is just a long-lived text/event-stream response,
 * and EventSource reconnects by itself. WebSockets would mean writing the
 * Upgrade handshake and framing by hand, or taking the `ws` dependency.
 *
 * There is deliberately no separate per-backend stream. The one stream
 * already carries every request event with its backend id; a tab drilling
 * into a backend fetches its detail once for the history, then filters the
 * stream it already has. One subscription per tab, and nothing to set up
 * or tear down server-side as the user clicks around.
 *
 * The page exposes backend URLs and request paths, so like the
 * registration endpoint it serves loopback clients only unless allowRemote.
 */
export function createLoadBalancerDashboard(
    monitor: LoadBalancerMonitor,
    options: LoadBalancerDashboardOptions
): ILoadBalancerDashboard {

    const basePath = normalizeMountPath(options.path);
    const heartbeatMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    const vendor = createVendorHandler(basePath, options.threeLocalPath);
    const page = renderDashboardPage({ basePath, threeBaseUrl: resolveThreeBaseUrl(basePath, options) });
    const streams = new Set<() => void>();

    const middleware = async (ctx: Context, next: () => Promise<void>): Promise<void> => {
        const target = matchDashboardPath(ctx.path, basePath);

        if (target === undefined) {
            return next();
        }

        if (!options.allowRemote && !isLoopbackAddress(ctx.req.socket.remoteAddress)) {
            throw new HttpError(403, "Forbidden");
        }

        if (target.kind === "vendor") {
            return serveVendor(ctx, vendor);
        }

        assertReadMethod(ctx);

        switch (target.kind) {
            case "page":
                return servePage(ctx, page);
            case "events":
                return openEventStream(ctx, monitor, heartbeatMs, streams);
            case "backend":
                return serveBackendDetail(ctx, monitor, target.id);
        }
    };

    return Object.assign(middleware, {
        dispose(): void {
            for (const close of Array.from(streams)) {
                close();
            }
        },
    });
}

type DashboardTarget =
    | { kind: "page" }
    | { kind: "events" }
    | { kind: "backend"; id: string }
    | { kind: "vendor" };

function matchDashboardPath(requestPath: string, basePath: string): DashboardTarget | undefined {
    if (requestPath === basePath || requestPath === `${basePath}/`) {
        return { kind: "page" };
    }

    if (!requestPath.startsWith(`${basePath}/`)) {
        return undefined;
    }

    const rest = requestPath.slice(basePath.length + 1);

    if (rest === "events") {
        return { kind: "events" };
    }

    if (rest.startsWith("backends/") && rest.length > "backends/".length && !rest.slice("backends/".length).includes("/")) {
        return { kind: "backend", id: rest.slice("backends/".length) };
    }

    if (rest.startsWith(`${VENDOR_SEGMENT}/`)) {
        return { kind: "vendor" };
    }

    return undefined;
}

function normalizeMountPath(mountPath: string): string {
    const trimmed = mountPath.replace(/\/+$/, "");

    if (!trimmed.startsWith("/")) {
        throw new Error(`Dashboard path must start with "/" and not be the site root, received "${mountPath}"`);
    }

    return trimmed;
}

function resolveThreeBaseUrl(basePath: string, options: LoadBalancerDashboardOptions): string {
    const chosen = options.threeLocalPath
        ? `${basePath}/${VENDOR_SEGMENT}/`
        : options.three?.baseUrl ?? DEFAULT_THREE_BASE_URL;

    return chosen.endsWith("/") ? chosen : `${chosen}/`;
}

/**
 * Serving a local three.js is reusing the existing static file handler,
 * mounted under a prefix - including its path-traversal protection, which
 * matters here because the directory is the user's whole node_modules/three.
 */
function createVendorHandler(basePath: string, localPath: string | undefined): StaticFileHandler | undefined {
    if (!localPath) {
        return undefined;
    }

    const root = path.resolve(localPath);

    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
        throw new Error(`Dashboard threeLocalPath is not a directory: ${root}`);
    }

    return new StaticFileHandler({ root, prefix: `${basePath}/${VENDOR_SEGMENT}` });
}

async function serveVendor(ctx: Context, vendor: StaticFileHandler | undefined): Promise<void> {
    if (!vendor || !(await vendor.handle(ctx))) {
        throw new HttpError(404, "Not found");
    }
}

function assertReadMethod(ctx: Context): void {
    if (ctx.method !== "GET" && ctx.method !== "HEAD") {
        ctx.header("Allow", "GET, HEAD");
        throw new HttpError(405, "Method not allowed");
    }
}

function servePage(ctx: Context, page: string): void {
    ctx.header("Cache-Control", "no-store");
    ctx.header("X-Content-Type-Options", "nosniff");
    ctx.header("X-Frame-Options", "DENY");
    ctx.header("Referrer-Policy", "no-referrer");
    ctx.html(page);
}

function serveBackendDetail(ctx: Context, monitor: LoadBalancerMonitor, id: string): void {
    const detail = monitor.detail(id);

    if (!detail) {
        throw new HttpError(404, "Unknown backend");
    }

    ctx.header("Cache-Control", "no-store");
    ctx.json(detail);
}

/**
 * Opens the SSE stream for one tab: an immediate snapshot, then every
 * monitor event as it happens, until the tab goes away or the dashboard is
 * disposed. Each tab gets its own DashboardSseClient, which is what keeps
 * one slow tab from affecting the balancer or any other tab.
 */
function openEventStream(
    ctx: Context,
    monitor: LoadBalancerMonitor,
    heartbeatMs: number,
    streams: Set<() => void>
): Promise<void> {

    const res = ctx.res;

    if (ctx.method !== "GET") {
        ctx.header("Allow", "GET");
        throw new HttpError(405, "Method not allowed");
    }

    res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        "X-Content-Type-Options": "nosniff",
    });

    const client = new DashboardSseClient(res, () => monitor.snapshot());
    const unsubscribe = monitor.subscribe((event) => client.send(event));
    const heartbeat = setInterval(() => client.sendHeartbeat(), heartbeatMs);
    heartbeat.unref();

    return new Promise<void>((resolve) => {
        const close = (): void => {
            unsubscribe();
            clearInterval(heartbeat);
            streams.delete(close);
            resolve();

            if (!res.writableEnded) {
                res.end();
            }
        };

        streams.add(close);
        res.once("close", close);

        // Tell EventSource how long to wait before reconnecting, then hand it the current state.
        res.write(`retry: ${SSE_RECONNECT_DELAY_MS}\n\n`);
        client.sendSnapshot();
    });
}
