/**
 * Anything that can say how many requests a backend is serving right now.
 * LoadBalancerMonitor satisfies it structurally, without importing it, so
 * strategies stay independent of the monitoring folder.
 */
export interface IInFlightSource {
    /**
     * Requests dispatched to the backend that have not yet finished, failed
     * or been abandoned. Zero for a backend the source has never heard of,
     * since a strategy is handed a list the source may not have seen yet.
     */
    inFlight(backendId: string): number;
}
