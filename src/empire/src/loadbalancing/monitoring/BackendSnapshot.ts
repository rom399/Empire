import { BackendInfo } from "../BackendInfo";
import { StatusClassCounts } from "./StatusClassCounts";

/**
 * A point-in-time view of one backend's counters, as the dashboard's
 * overlay shows them.
 */
export interface BackendSnapshot extends BackendInfo {
    /** Epoch ms the lease lapses. Undefined for static backends. */
    expiresAt?: number;

    /** Present once the backend has left rotation, until the grace window ends. */
    removed?: { at: number; reason: "deregistered" | "expired" };

    addedAt: number;

    /** Requests dispatched to this backend. */
    total: number;
    inFlight: number;
    completed: number;
    failed: number;
    aborted: number;
    statusClasses: StatusClassCounts;
    avgLatencyMs: number;
    lastLatencyMs?: number;
}
