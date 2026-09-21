import { BackendInfo } from "../BackendInfo";
import { BackendDetail } from "./BackendDetail";
import { BackendSnapshot } from "./BackendSnapshot";
import { RecentCall } from "./RecentCall";
import { RouteSnapshot } from "./RouteSnapshot";
import { ObservedCall } from "./ObservedCall";
import { RouteStatsTracker } from "./RouteStatsTracker";
import { emptyStatusClassCounts, statusClassOf } from "./statusClass";

/**
 * Everything the monitor tracks for a single backend: headline counters,
 * per-route stats and a ring buffer of recent calls. All of it is bounded
 * - a route cap folds the long tail into "(other)", histograms are fixed
 * size, and the call buffer overwrites its oldest entry - so a backend
 * costs a constant amount of memory however long it lives.
 */
export class BackendStatsTracker {

    /** Distinct route keys tracked per backend before new ones fold into (other). */
    public static readonly MAX_ROUTES = 50;

    /** Route key the overflow bucket is reported under. */
    public static readonly OTHER_ROUTE = "(other)";

    /** How many recent calls each backend remembers. */
    public static readonly RECENT_CALLS_CAPACITY = 200;

    private readonly routes = new Map<string, RouteStatsTracker>();
    private readonly recent: (RecentCall | undefined)[] = Array.from(
        { length: BackendStatsTracker.RECENT_CALLS_CAPACITY },
        (): RecentCall | undefined => undefined
    );
    private recentNext = 0;
    private recentSize = 0;

    private readonly statusClasses = emptyStatusClassCounts();
    private total = 0;
    private inFlight = 0;
    private completed = 0;
    private failed = 0;
    private aborted = 0;
    private latencySumMs = 0;
    private lastLatencyMs?: number;
    private expiresAt?: number;
    private removed?: { at: number; reason: "deregistered" | "expired" };

    /** Starts tracking a backend that was added at `addedAt`; `expiresAt` is set only for a registered (leased) one. */
    public constructor(
        private readonly info: BackendInfo,
        private readonly addedAt: number,
        expiresAt?: number
    ) {
        this.expiresAt = expiresAt;
    }

    /** True once the backend has left rotation (it stays tracked for the monitor's grace window). */
    public get isRemoved(): boolean {
        return this.removed !== undefined;
    }

    /** When the backend left rotation, or undefined while it is still live. */
    public get removedAt(): number | undefined {
        return this.removed?.at;
    }

    /** Requests dispatched to this backend that have not yet finished, failed or been abandoned. */
    public get inFlightCount(): number {
        return this.inFlight;
    }

    /** Records a heartbeat: the lease now lapses at `expiresAt`. */
    public renew(expiresAt: number): void {
        this.expiresAt = expiresAt;
    }

    /** Flags the backend as gone, keeping its counters so a dashboard can animate it out with its final numbers. */
    public markRemoved(at: number, reason: "deregistered" | "expired"): void {
        this.removed = { at, reason };
    }

    /** A request was sent to this backend and is now in flight. */
    public recordDispatch(): void {
        this.total += 1;
        this.inFlight += 1;
    }

    /** An in-flight request came back with a response: settles it and tallies status, latency and route. */
    public recordCompleted(call: ObservedCall, status: number, durationMs: number): void {
        this.settle();
        this.completed += 1;
        this.latencySumMs += durationMs;
        this.lastLatencyMs = durationMs;

        const statusClass = statusClassOf(status);

        if (statusClass) {
            this.statusClasses[statusClass] += 1;
        }

        const route = this.routeFor(call);
        route.recordResponse(status, durationMs);

        this.remember({ ...this.callFields(call), outcome: "completed", status, durationMs });
    }

    /** An in-flight request never produced a response (connect, timeout or mid-stream failure): settles it and counts it against its route. */
    public recordFailed(call: ObservedCall, phase: string, durationMs?: number): void {
        this.settle();
        this.failed += 1;

        this.routeFor(call).recordFailure();

        this.remember({ ...this.callFields(call), outcome: "failed", phase, durationMs });
    }

    /** The client hung up on an in-flight request: settles it without counting it against any route. */
    public recordAborted(call: ObservedCall): void {
        this.settle();
        this.aborted += 1;

        this.remember({ ...this.callFields(call), outcome: "aborted" });
    }

    /** The headline counters as they stand now. */
    public snapshot(): BackendSnapshot {
        return {
            ...this.info,
            expiresAt: this.expiresAt,
            removed: this.removed ? { ...this.removed } : undefined,
            addedAt: this.addedAt,
            total: this.total,
            inFlight: this.inFlight,
            completed: this.completed,
            failed: this.failed,
            aborted: this.aborted,
            statusClasses: { ...this.statusClasses },
            avgLatencyMs: this.completed === 0 ? 0 : this.latencySumMs / this.completed,
            lastLatencyMs: this.lastLatencyMs,
        };
    }

    /** The counters plus every tracked route (busiest first) and the recent-call buffer. */
    public detail(): BackendDetail {
        const routes: RouteSnapshot[] = Array.from(this.routes.entries())
            .map(([key, tracker]) => tracker.snapshot(key))
            .sort((a, b) => b.count - a.count);

        return { backend: this.snapshot(), routes, recentCalls: this.recentCalls() };
    }

    /** Newest first. */
    public recentCalls(): RecentCall[] {
        const capacity = BackendStatsTracker.RECENT_CALLS_CAPACITY;
        const calls: RecentCall[] = [];

        for (let offset = 1; offset <= this.recentSize; offset++) {
            const call = this.recent[(this.recentNext - offset + capacity) % capacity];

            if (call) {
                calls.push(call);
            }
        }

        return calls;
    }

    private settle(): void {
        this.inFlight = Math.max(0, this.inFlight - 1);
    }

    /**
     * Finds or creates the tracker for a call's route. Once MAX_ROUTES
     * distinct keys exist, an unseen key is recorded under "(other)"
     * instead of growing the map - without that cap, a backend hit with
     * /files/<random> paths and no route template would grow it forever.
     */
    private routeFor(call: ObservedCall): RouteStatsTracker {
        const key = `${call.method} ${call.route}`;
        const existing = this.routes.get(key);

        if (existing) {
            existing.noteProvenance(call.guessedRoute);
            return existing;
        }

        if (this.routes.size >= BackendStatsTracker.MAX_ROUTES) {
            return this.otherBucket();
        }

        const created = new RouteStatsTracker(call.method, call.route);
        created.noteProvenance(call.guessedRoute);
        this.routes.set(key, created);

        return created;
    }

    private otherBucket(): RouteStatsTracker {
        const key = BackendStatsTracker.OTHER_ROUTE;
        const existing = this.routes.get(key);

        if (existing) {
            return existing;
        }

        // The overflow bucket is exempt from the cap it enforces, so the
        // map peaks at MAX_ROUTES + 1 entries.
        const created = new RouteStatsTracker("", key);
        created.noteProvenance(false);
        this.routes.set(key, created);

        return created;
    }

    private callFields(call: ObservedCall): Omit<RecentCall, "outcome"> {
        return {
            requestId: call.requestId,
            method: call.method,
            path: call.path,
            route: call.route,
            guessedRoute: call.guessedRoute,
            at: call.at,
        };
    }

    private remember(call: RecentCall): void {
        const capacity = BackendStatsTracker.RECENT_CALLS_CAPACITY;

        this.recent[this.recentNext] = call;
        this.recentNext = (this.recentNext + 1) % capacity;
        this.recentSize = Math.min(this.recentSize + 1, capacity);
    }
}
