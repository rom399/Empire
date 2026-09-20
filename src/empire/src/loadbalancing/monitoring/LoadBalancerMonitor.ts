import { ConsoleLogger } from "../../logging/ConsoleLogger";
import { ILogger } from "../../logging/ILogger";
import { BackendDetail } from "./BackendDetail";
import { BackendStatsTracker } from "./BackendStatsTracker";
import { LoadBalancerEvent } from "./LoadBalancerEvent";
import { LoadBalancerMonitorOptions } from "./LoadBalancerMonitorOptions";
import { LoadBalancerSnapshot } from "./LoadBalancerSnapshot";
import { normalizePath } from "./normalizePath";
import { ObservedCall } from "./ObservedCall";

/** What "dispatched" recorded about a request, kept until its terminal event. */
interface PendingRequest {
    method: string;
    path: string;
}

type Listener = (event: LoadBalancerEvent) => void;

/**
 * The event source between the balancer and whatever watches it. The
 * registry and the proxy report to it; it keeps running counters and fans
 * every event out to subscribers, without knowing the dashboard exists.
 *
 * The server-side state here is the source of truth and events are live
 * deltas on top of it - a subscriber that misses some can always resync
 * from snapshot().
 *
 * Deliberately not an EventEmitter: that would lose the typed event union,
 * and an unhandled "error" event would crash the process.
 */
export class LoadBalancerMonitor {

    private static readonly DEFAULT_REMOVED_GRACE_MS = 30_000;

    /**
     * Ceiling on requests remembered between "dispatched" and their
     * terminal event. The proxy always emits one, so this only matters if
     * a caller misuses publish() - it keeps that mistake from becoming a leak.
     */
    private static readonly MAX_PENDING_REQUESTS = 10_000;

    private readonly logger: ILogger;
    private readonly removedGraceMs: number;
    private readonly now: () => number;

    private readonly backends = new Map<string, BackendStatsTracker>();
    private readonly pending = new Map<string, PendingRequest>();
    private readonly listeners = new Set<Listener>();
    private strategyName = "unknown";
    private unroutable = 0;

    /** Creates an empty monitor. */
    public constructor(options: LoadBalancerMonitorOptions = {}) {
        this.logger = options.logger ?? new ConsoleLogger();
        this.removedGraceMs = options.removedGraceMs ?? LoadBalancerMonitor.DEFAULT_REMOVED_GRACE_MS;
        this.now = options.now ?? Date.now;
    }

    /** Called by the load balancer middleware so the hub can be labelled. */
    public setStrategyName(name: string): void {
        this.strategyName = name;
    }

    /**
     * Registers a listener for every future event. Returns the function
     * that unsubscribes it.
     */
    public subscribe(listener: Listener): () => void {
        this.listeners.add(listener);

        return () => {
            this.listeners.delete(listener);
        };
    }

    /**
     * Records an event in the running counters, then delivers it to every
     * subscriber. A subscriber that throws is caught and logged - it must
     * never break the request or registration that produced the event.
     */
    public publish(event: LoadBalancerEvent): void {
        this.apply(event);

        for (const listener of this.listeners) {
            try {
                listener(event);
            } catch (err) {
                this.logger.error("Load balancer monitor listener threw", err);
            }
        }
    }

    /** The full current state: strategy, every backend's counters (including recently removed ones), and the unroutable count. */
    public snapshot(): LoadBalancerSnapshot {
        this.dropExpiredRemovals();

        return {
            strategy: this.strategyName,
            at: this.now(),
            backends: Array.from(this.backends.values(), (tracker) => tracker.snapshot()),
            unroutable: this.unroutable,
        };
    }

    /**
     * Route stats and recent calls for one backend, or undefined if it is
     * unknown - including one removed longer ago than the grace window.
     */
    public detail(backendId: string): BackendDetail | undefined {
        this.dropExpiredRemovals();

        return this.backends.get(backendId)?.detail();
    }

    private apply(event: LoadBalancerEvent): void {
        switch (event.type) {
            case "backendAdded":
                this.dropExpiredRemovals();
                // A returning id starts fresh: its counters belong to the
                // new lease, not the one that lapsed.
                this.backends.set(
                    event.backend.id,
                    new BackendStatsTracker(event.backend, event.at, event.expiresAt)
                );
                break;

            case "backendRemoved":
                this.backends.get(event.backendId)?.markRemoved(event.at, event.reason);
                this.dropExpiredRemovals();
                break;

            case "leaseRenewed":
                this.backends.get(event.backendId)?.renew(event.expiresAt);
                break;

            case "dispatched":
                this.backends.get(event.backendId)?.recordDispatch();
                this.remember(event.requestId, { method: event.method, path: event.path });
                break;

            case "completed": {
                const call = this.settle(event.requestId, event.at, event.route);
                this.backends.get(event.backendId)?.recordCompleted(call, event.status, event.durationMs);
                break;
            }

            case "failed": {
                const call = this.settle(event.requestId, event.at);

                if (event.backendId === undefined) {
                    this.unroutable += 1;
                    break;
                }

                this.backends.get(event.backendId)?.recordFailed(call, event.phase, event.durationMs);
                break;
            }

            case "aborted": {
                const call = this.settle(event.requestId, event.at);
                this.backends.get(event.backendId)?.recordAborted(call);
                break;
            }
        }
    }

    private remember(requestId: string, request: PendingRequest): void {
        this.pending.set(requestId, request);

        if (this.pending.size > LoadBalancerMonitor.MAX_PENDING_REQUESTS) {
            const oldest = this.pending.keys().next();

            if (!oldest.done) {
                this.pending.delete(oldest.value);
            }
        }
    }

    /**
     * Pairs a terminal event with the "dispatched" that started it, to
     * recover the method and path only that event carried. When the
     * backend reported no route template, one is guessed from the path.
     */
    private settle(requestId: string, at: number, reportedRoute?: string): ObservedCall {
        const request = this.pending.get(requestId) ?? { method: "", path: "" };
        this.pending.delete(requestId);

        return {
            requestId,
            method: request.method,
            path: request.path,
            route: reportedRoute ?? normalizePath(request.path),
            guessedRoute: reportedRoute === undefined,
            at,
        };
    }

    private dropExpiredRemovals(): void {
        const cutoff = this.now() - this.removedGraceMs;

        for (const [id, tracker] of this.backends) {
            const removedAt = tracker.removedAt;

            if (removedAt !== undefined && removedAt <= cutoff) {
                this.backends.delete(id);
            }
        }
    }
}
