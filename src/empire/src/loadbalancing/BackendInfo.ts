/**
 * The identity of a backend as the balancer and the dashboard see it -
 * the part that never changes for the lifetime of the entry.
 */
export interface BackendInfo {
    /** Unique identifier, chosen by whoever registers the backend. */
    id: string;

    /** Origin the balancer forwards to, e.g. "http://127.0.0.1:5001". */
    url: string;

    /**
     * "static" backends are pinned: no lease, never expire, and cannot be
     * deregistered remotely. "registered" backends hold a lease that
     * expires unless the backend keeps renewing it.
     */
    source: "static" | "registered";
}
