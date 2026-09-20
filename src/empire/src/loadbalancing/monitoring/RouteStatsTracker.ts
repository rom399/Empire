import { LatencyHistogram } from "./LatencyHistogram";
import { RouteSnapshot } from "./RouteSnapshot";
import { emptyStatusClassCounts, statusClassOf } from "./statusClass";

const SERVER_ERROR_STATUS = 500;

/**
 * Accumulates the stats for one route on one backend. Memory is constant
 * however much traffic the route sees: counters plus a fixed-size latency
 * histogram, never stored samples.
 */
export class RouteStatsTracker {

    private readonly histogram = new LatencyHistogram();
    private readonly statusClasses = emptyStatusClassCounts();
    private requests = 0;
    private serverErrors = 0;
    private failures = 0;
    private guessedOnly = true;

    /** Tracks one route, identified by the method and template it was reported under. */
    public constructor(
        public readonly method: string,
        public readonly route: string
    ) {}

    /**
     * A route counts as guessed only while every observation of it was
     * guessed - once the backend reports the template even once, it is known.
     */
    public noteProvenance(guessed: boolean): void {
        this.guessedOnly = this.guessedOnly && guessed;
    }

    /** Tallies a response that came back: its status class, whether it was a server error, and its latency. */
    public recordResponse(status: number, durationMs: number): void {
        this.requests += 1;
        this.histogram.record(durationMs);

        const statusClass = statusClassOf(status);

        if (statusClass) {
            this.statusClasses[statusClass] += 1;
        }

        if (status >= SERVER_ERROR_STATUS) {
            this.serverErrors += 1;
        }
    }

    /** A request that never produced a response counts as an error, with no latency to record. */
    public recordFailure(): void {
        this.requests += 1;
        this.failures += 1;
    }

    /** The stats as they stand now, labelled with the key the route is filed under. */
    public snapshot(key: string): RouteSnapshot {
        return {
            key,
            method: this.method,
            route: this.route,
            guessed: this.guessedOnly,
            count: this.requests,
            errors: this.serverErrors + this.failures,
            statusClasses: { ...this.statusClasses },
            failed: this.failures,
            avgMs: this.histogram.average,
            p50Ms: this.histogram.percentile(50),
            p95Ms: this.histogram.percentile(95),
            p99Ms: this.histogram.percentile(99),
            maxMs: this.histogram.max,
        };
    }
}
