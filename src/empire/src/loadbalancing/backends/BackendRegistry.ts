import { HttpError } from "../../errors/HttpError";
import { Backend } from "../Backend";
import { BACKEND_ID_PATTERN, normalizeBackendUrl } from "./backendIdentity";
import { BackendRegistryOptions } from "./BackendRegistryOptions";
import { LoadBalancerMonitor } from "../monitoring/LoadBalancerMonitor";

const CONFLICT_STATUS = 409;

/**
 * The set of backends currently eligible for traffic.
 *
 * A registered backend does not "join" - it holds a lease that lapses
 * unless it keeps renewing it (the Consul/Eureka pattern). That is what
 * makes the system self-healing without the balancer ever probing
 * anything: a backend that crashes, hangs or loses its network simply
 * stops renewing and falls out of rotation after one TTL.
 *
 * Static backends are pinned instead: no lease, never expire, and they
 * cannot be replaced or removed through register()/deregister().
 *
 * Removing a backend only affects *future* selection. Requests already
 * proxied to it run to completion, so deregistering before shutting down
 * drains a backend gracefully.
 */
export class BackendRegistry {

    private static readonly DEFAULT_LEASE_TTL_MS = 15_000;

    /** The sweep runs twice per TTL, so an expired lease is dropped promptly. */
    private static readonly SWEEPS_PER_TTL = 2;

    private readonly ttlMs: number;
    private readonly monitor?: LoadBalancerMonitor;
    private readonly now: () => number;
    private readonly backends = new Map<string, Backend>();
    private sweepTimer?: NodeJS.Timeout;

    /** Throws if leaseTtlMs is not a positive number - a bad TTL is a startup mistake, not something to discover under load. */
    public constructor(options: BackendRegistryOptions = {}) {
        const ttlMs = options.leaseTtlMs ?? BackendRegistry.DEFAULT_LEASE_TTL_MS;

        if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
            throw new Error(`BackendRegistry leaseTtlMs must be a positive number, received ${ttlMs}`);
        }

        this.ttlMs = ttlMs;
        this.monitor = options.monitor;
        this.now = options.now ?? Date.now;
    }

    /** The lease length clients are told to heartbeat against. */
    public get leaseTtlMs(): number {
        return this.ttlMs;
    }

    /**
     * Pins a backend that never expires and cannot be deregistered
     * remotely. Throws on an invalid id or URL, or a duplicate id - these
     * are startup configuration mistakes, best found immediately.
     */
    public addStatic(backend: { id: string; url: string }): void {
        const url = this.validated(backend.id, backend.url);

        if (this.backends.has(backend.id)) {
            throw new Error(`A backend with id "${backend.id}" is already registered`);
        }

        const entry: Backend = { id: backend.id, url, source: "static" };
        this.backends.set(backend.id, entry);
        this.monitor?.publish({ type: "backendAdded", backend: { id: entry.id, url, source: "static" }, at: this.now() });
    }

    /**
     * Registers a backend or renews its lease - the same call does both,
     * which is what makes a retried heartbeat harmless and lets a
     * restarted balancer rebuild its registry from the next heartbeats.
     *
     * Throws HttpError 409 if the id belongs to a static backend, or to a
     * live lease held for a *different* URL - two backends misconfigured
     * with the same id would otherwise silently steal each other's traffic.
     * Once a lease has lapsed its id is free again.
     */
    public register(id: string, url: string): { created: boolean } {
        const normalizedUrl = this.validated(id, url);

        this.sweep();

        const existing = this.backends.get(id);

        if (existing?.source === "static") {
            throw new HttpError(CONFLICT_STATUS, `Backend "${id}" is pinned and cannot be registered`);
        }

        if (existing && existing.url !== normalizedUrl) {
            throw new HttpError(CONFLICT_STATUS, `Backend id "${id}" is already registered for a different URL`);
        }

        const at = this.now();
        const expiresAt = at + this.ttlMs;

        this.ensureSweeping();

        if (existing) {
            existing.expiresAt = expiresAt;
            this.monitor?.publish({ type: "leaseRenewed", backendId: id, expiresAt, at });

            return { created: false };
        }

        const entry: Backend = { id, url: normalizedUrl, source: "registered", expiresAt };
        this.backends.set(id, entry);
        this.monitor?.publish({
            type: "backendAdded",
            backend: { id, url: normalizedUrl, source: "registered" },
            expiresAt,
            at,
        });

        return { created: true };
    }

    /**
     * Removes a registered backend from future selection. Idempotent:
     * returns false, without error, if it was already gone. Throws
     * HttpError 409 for a static backend, which only its owner can remove.
     */
    public deregister(id: string): boolean {
        const existing = this.backends.get(id);

        if (!existing) {
            return false;
        }

        if (existing.source === "static") {
            throw new HttpError(CONFLICT_STATUS, `Backend "${id}" is pinned and cannot be deregistered`);
        }

        this.backends.delete(id);
        this.monitor?.publish({ type: "backendRemoved", backendId: id, reason: "deregistered", at: this.now() });

        return true;
    }

    /**
     * A fresh snapshot of the backends that may receive traffic now.
     * Filters by expiry itself rather than trusting the sweep, so a lease
     * that lapsed between sweeps can never be selected.
     */
    public eligible(): Backend[] {
        const at = this.now();

        return Array.from(this.backends.values()).filter(
            (backend) => backend.expiresAt === undefined || backend.expiresAt > at
        );
    }

    /**
     * Drops every lapsed lease, emitting backendRemoved for each. Runs on
     * a timer rather than lazily at selection time so the dashboard shows
     * a dead backend disappearing even when no traffic is flowing.
     * Returns how many were removed.
     */
    public sweep(): number {
        const at = this.now();
        let removed = 0;

        for (const [id, backend] of this.backends) {
            if (backend.expiresAt !== undefined && backend.expiresAt <= at) {
                this.backends.delete(id);
                this.monitor?.publish({ type: "backendRemoved", backendId: id, reason: "expired", at });
                removed += 1;
            }
        }

        return removed;
    }

    /** Stops the sweep timer. */
    public dispose(): void {
        if (this.sweepTimer) {
            clearInterval(this.sweepTimer);
            this.sweepTimer = undefined;
        }
    }

    /**
     * Starts the expiry sweep on first use, so a registry holding only
     * static backends never schedules anything. Unref'd: a pending sweep
     * must never keep the process alive.
     */
    private ensureSweeping(): void {
        if (this.sweepTimer) {
            return;
        }

        const intervalMs = Math.max(1, Math.floor(this.ttlMs / BackendRegistry.SWEEPS_PER_TTL));

        this.sweepTimer = setInterval(() => this.sweep(), intervalMs);
        this.sweepTimer.unref();
    }

    private validated(id: string, url: string): string {
        if (!BACKEND_ID_PATTERN.test(id)) {
            throw new Error(`Invalid backend id "${id}": use 1-128 letters, digits, "-", "_" or ":"`);
        }

        const normalized = normalizeBackendUrl(url);

        if (normalized === undefined) {
            throw new Error(`Invalid backend url "${url}": expected an absolute http: origin such as http://127.0.0.1:5001`);
        }

        return normalized;
    }
}
