import { BackendSnapshot } from "./BackendSnapshot";

/** The monitor's full state, sent to a dashboard on connect and on resync. */
export interface LoadBalancerSnapshot {
    /** Name of the active strategy, shown on the hub. */
    strategy: string;
    at: number;
    backends: BackendSnapshot[];

    /** Requests answered 503 because no backend was eligible. */
    unroutable: number;
}
