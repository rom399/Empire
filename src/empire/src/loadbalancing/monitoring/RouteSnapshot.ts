import { StatusClassCounts } from "./StatusClassCounts";

/**
 * Aggregate stats for one route on one backend - what a row in the
 * drill-down route table shows.
 */
export interface RouteSnapshot {
    /** "METHOD route", e.g. "GET /users/:id", or "(other)" for the overflow bucket. */
    key: string;
    method: string;
    route: string;

    /**
     * True when the route template was inferred from the raw path rather
     * than reported by the backend, so the dashboard can flag it as a guess.
     */
    guessed: boolean;

    count: number;

    /** Responses with a 5xx status, plus requests that failed before one arrived. */
    errors: number;
    statusClasses: StatusClassCounts;
    failed: number;
    avgMs: number;
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
    maxMs: number;
}
