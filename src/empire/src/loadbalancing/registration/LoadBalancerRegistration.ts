import { ConsoleLogger } from "../../logging/ConsoleLogger";
import { ILogger } from "../../logging/ILogger";
import { BACKEND_ID_PATTERN, normalizeBackendUrl } from "../backends/backendIdentity";
import { LoadBalancerRegistrationError } from "./LoadBalancerRegistrationError";
import { LoadBalancerRegistrationOptions } from "./LoadBalancerRegistrationOptions";

const HTTP_UNAUTHORIZED = 401;
const HTTP_CONFLICT = 409;

/**
 * The backend side of auto-registration: announces this app to a load
 * balancer, then keeps its lease alive with heartbeats until stopped.
 *
 * It is a plain class the caller sequences - serve first, *then* start();
 * on shutdown, stop() first, *then* stop serving - rather than something
 * hooked into Empire's lifecycle, so the ordering that matters is visible
 * in the caller's own code. Deregistering before the server stops is what
 * lets the balancer drain this backend gracefully: it only stops sending
 * new requests, while ones already in flight finish.
 *
 * Registration and heartbeat are the same call (PUT), so a balancer that
 * restarts and forgets every backend is repopulated by the very next
 * heartbeat with no special handling here.
 */
export class LoadBalancerRegistration {

    private static readonly HEARTBEATS_PER_TTL = 3;
    private static readonly DEFAULT_REQUEST_TIMEOUT_MS = 5_000;

    /** Short, so shutdown never waits long on an unreachable balancer. */
    private static readonly DEREGISTER_TIMEOUT_MS = 2_000;

    private readonly endpoint: string;
    private readonly url: string;
    private readonly token?: string;
    private readonly logger: ILogger;
    private readonly requestTimeoutMs: number;

    private heartbeatIntervalMs = 0;
    private heartbeatTimer?: NodeJS.Timeout;
    private inFlight?: AbortController;
    private registered = false;
    private stopped = false;

    /** Throws if the id or url is not usable - a misconfigured backend should fail at construction, not on its first heartbeat. */
    public constructor(options: LoadBalancerRegistrationOptions) {
        if (!BACKEND_ID_PATTERN.test(options.id)) {
            throw new Error(`Invalid backend id "${options.id}": use 1-128 letters, digits, "-", "_" or ":"`);
        }

        const url = normalizeBackendUrl(options.url);

        if (url === undefined) {
            throw new Error(`Invalid backend url "${options.url}": expected an absolute http: origin such as http://127.0.0.1:5001`);
        }

        this.endpoint = `${options.registryUrl.replace(/\/+$/, "")}/${encodeURIComponent(options.id)}`;
        this.url = url;
        this.token = options.token;
        this.logger = options.logger ?? new ConsoleLogger();
        this.requestTimeoutMs = options.requestTimeoutMs ?? LoadBalancerRegistration.DEFAULT_REQUEST_TIMEOUT_MS;
    }

    /**
     * Registers with the balancer, then heartbeats in the background.
     * Rejects if that first registration fails: a backend with the wrong
     * URL or token should find out at startup, not run silently
     * unregistered and receive no traffic.
     */
    public async start(): Promise<void> {
        if (this.registered || this.stopped) {
            throw new Error("LoadBalancerRegistration can only be started once");
        }

        const leaseTtlMs = await this.register();

        this.registered = true;

        if (this.stopped) {
            // stop() ran while that first registration was in flight. It found
            // nothing registered yet, so it is this call's job to undo it.
            await this.deregister();
            return;
        }

        this.heartbeatIntervalMs = this.intervalFor(leaseTtlMs);
        this.scheduleHeartbeat();
    }

    /**
     * Cancels the heartbeat and deregisters, best effort. Always resolves,
     * even with the balancer unreachable: the lease expires on its own
     * anyway, so shutdown must never hang waiting on it.
     */
    public async stop(): Promise<void> {
        if (this.stopped) {
            return;
        }

        this.stopped = true;
        clearTimeout(this.heartbeatTimer);
        this.inFlight?.abort();

        if (!this.registered) {
            return;
        }

        await this.deregister();
    }

    private async deregister(): Promise<void> {
        try {
            await this.send("DELETE", LoadBalancerRegistration.DEREGISTER_TIMEOUT_MS);
        } catch (err) {
            this.logger.warn(`Could not deregister "${this.endpoint}" - its lease will expire on its own: ${messageOf(err)}`);
        }
    }

    /**
     * One PUT: register or renew, indistinguishable to the balancer.
     * Returns the lease TTL the balancer wants heartbeats measured against.
     */
    private async register(): Promise<number> {
        const response = await this.send("PUT", this.requestTimeoutMs, JSON.stringify({ url: this.url }));

        if (!response.ok) {
            throw new LoadBalancerRegistrationError(
                response.status,
                `Registration rejected with HTTP ${response.status}: ${await readErrorMessage(response)}`
            );
        }

        const body: unknown = await response.json();
        const leaseTtlMs = typeof body === "object" && body !== null && "leaseTtlMs" in body
            ? body.leaseTtlMs
            : undefined;

        if (typeof leaseTtlMs !== "number" || !(leaseTtlMs > 0)) {
            throw new Error("Registration response did not include a valid leaseTtlMs");
        }

        return leaseTtlMs;
    }

    private async send(method: "PUT" | "DELETE", timeoutMs: number, body?: string): Promise<Response> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        if (method === "PUT") {
            this.inFlight = controller;
        }

        const headers: Record<string, string> = {};

        if (body !== undefined) {
            headers["Content-Type"] = "application/json";
        }

        if (this.token) {
            headers.Authorization = `Bearer ${this.token}`;
        }

        try {
            return await fetch(this.endpoint, { method, headers, body, signal: controller.signal });
        } finally {
            clearTimeout(timeout);

            if (this.inFlight === controller) {
                this.inFlight = undefined;
            }
        }
    }

    /**
     * Heartbeats are chained setTimeouts, not a setInterval: the next one
     * is only scheduled after the current one settles, so a slow balancer
     * can never cause two heartbeats to overlap. Unref'd so a pending
     * heartbeat never keeps the process alive.
     */
    private scheduleHeartbeat(): void {
        this.heartbeatTimer = setTimeout(() => void this.heartbeat(), this.heartbeatIntervalMs);
        this.heartbeatTimer.unref();
    }

    private async heartbeat(): Promise<void> {
        try {
            const leaseTtlMs = await this.register();

            // The balancer owns the timing, so follow it if it changes.
            this.heartbeatIntervalMs = this.intervalFor(leaseTtlMs);
        } catch (err) {
            this.reportHeartbeatFailure(err);
        }

        if (!this.stopped) {
            this.scheduleHeartbeat();
        }
    }

    /**
     * A failed heartbeat is retried on the next tick with no backoff - the
     * interval is already seconds long, and a local balancer restarting is
     * the common cause. A 401 or 409 will never fix itself by retrying, so
     * those are logged as errors rather than warnings.
     */
    private reportHeartbeatFailure(err: unknown): void {
        if (this.stopped) {
            return;
        }

        const permanent = err instanceof LoadBalancerRegistrationError
            && (err.status === HTTP_UNAUTHORIZED || err.status === HTTP_CONFLICT);

        if (permanent) {
            this.logger.error(`Heartbeat to ${this.endpoint} was refused and retrying will not help`, err);
            return;
        }

        this.logger.warn(`Heartbeat to ${this.endpoint} failed, will retry: ${messageOf(err)}`);
    }

    private intervalFor(leaseTtlMs: number): number {
        return Math.max(1, Math.floor(leaseTtlMs / LoadBalancerRegistration.HEARTBEATS_PER_TTL));
    }
}

function messageOf(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

async function readErrorMessage(response: Response): Promise<string> {
    try {
        const body: unknown = await response.json();
        const message = typeof body === "object" && body !== null && "error" in body
            ? body.error
            : undefined;

        return typeof message === "string" ? message : response.statusText;
    } catch {
        return response.statusText;
    }
}
