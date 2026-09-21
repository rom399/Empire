import { Context } from "../../http/Context";
import { Backend } from "../Backend";
import { IInFlightSource } from "./IInFlightSource";

/**
 * Chooses which backend serves a request. Strategies are handed the
 * eligible list on every call rather than owning it - the list changes at
 * runtime as backends register and expire, and the registry, not the
 * strategy, decides who is eligible.
 */
export interface ILoadBalancingStrategy {
    /** Shown on the dashboard's hub node, e.g. "round-robin". */
    readonly name: string;

    /**
     * Set by a strategy that reads live load. The load balancer middleware
     * requires it to be the very monitor the balancer reports to - a
     * strategy reading a different one would see counts that never move and
     * quietly degrade to round robin, which is worse than failing at startup.
     * Leave it undefined for a strategy that needs no live numbers.
     */
    readonly inFlightSource?: IInFlightSource;

    /**
     * Picks a backend for this request. Synchronous by design - a strategy
     * that awaited between reading its state and updating it would reopen
     * exactly the race a single-threaded select() rules out. Receives ctx
     * so a future header-based strategy can inspect the request without a
     * signature change. Returns undefined only when nothing is eligible.
     */
    select(backends: readonly Backend[], ctx: Context): Backend | undefined;
}
