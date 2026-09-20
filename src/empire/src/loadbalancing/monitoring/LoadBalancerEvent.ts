import { BackendInfo } from "../BackendInfo";

/** Where in the proxy path a request failed. */
export type LoadBalancerFailurePhase = "select" | "connect" | "timeout" | "stream";

/**
 * Everything the registry and the proxy report to a LoadBalancerMonitor.
 * Each request emits "dispatched" followed by exactly one of "completed",
 * "failed" or "aborted" - the monitor's in-flight counts depend on that.
 * A request that finds no backend emits only "failed" (phase "select").
 */
export type LoadBalancerEvent =
    | { type: "backendAdded"; backend: BackendInfo; expiresAt?: number; at: number }
    | { type: "backendRemoved"; backendId: string; reason: "deregistered" | "expired"; at: number }
    | { type: "leaseRenewed"; backendId: string; expiresAt: number; at: number }
    | { type: "dispatched"; requestId: string; backendId: string; method: string; path: string; at: number }
    | {
        type: "completed";
        requestId: string;
        backendId: string;
        status: number;
        durationMs: number;
        /** Route template the backend reported via X-Empire-Route, when it did. */
        route?: string;
        at: number;
    }
    | {
        type: "failed";
        requestId: string;
        backendId?: string;
        phase: LoadBalancerFailurePhase;
        durationMs?: number;
        at: number;
    }
    | { type: "aborted"; requestId: string; backendId: string; at: number };
