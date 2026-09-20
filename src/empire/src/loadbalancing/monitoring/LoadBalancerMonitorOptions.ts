import { ILogger } from "../../logging/ILogger";

/** Configuration for a LoadBalancerMonitor. */
export interface LoadBalancerMonitorOptions {
    /**
     * Where a throwing listener is reported. A listener must never break a
     * request or a registration, so its error is caught and logged here.
     * Defaults to a ConsoleLogger.
     */
    logger?: ILogger;

    /**
     * How long a removed backend keeps its counters and call history
     * visible, so the dashboard can animate it out with its final numbers
     * and still drill into it. Defaults to 30 seconds.
     */
    removedGraceMs?: number;

    /** Clock, injectable for tests. Defaults to Date.now. */
    now?: () => number;
}
