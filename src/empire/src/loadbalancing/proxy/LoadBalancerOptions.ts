import { ILogger } from "../../logging/ILogger";
import { BackendRegistry } from "../backends/BackendRegistry";
import { ILoadBalancingStrategy } from "../strategy/ILoadBalancingStrategy";
import { LoadBalancerMonitor } from "../monitoring/LoadBalancerMonitor";

/** Configuration for createLoadBalancerMiddleware(). */
export interface LoadBalancerOptions {
    /**
     * Where backends come from: a registry that backends register with
     * (see createBackendRegistrationEndpoint). Provide this or `backends`.
     */
    registry?: BackendRegistry;

    /**
     * Shorthand for a fixed set of pinned backends, when nothing needs to
     * register itself. Equivalent to a registry holding only static
     * backends. Provide this or `registry`.
     */
    backends?: readonly { id: string; url: string }[];

    /** Picks the backend for each request. Defaults to round robin. */
    strategy?: ILoadBalancingStrategy;

    /** Receives events for the dashboard. Share it with the registry and the dashboard. */
    monitor?: LoadBalancerMonitor;

    /**
     * How long to wait for a backend's response headers before answering
     * 504. Bounds time to first response, not total duration. Defaults to 30 seconds.
     */
    timeoutMs?: number;

    /** Keep query strings in the paths reported to the monitor. Off by default - they often hold secrets. */
    includeQueryString?: boolean;

    /** Receives debug hints, e.g. that a request body was consumed too early. */
    logger?: ILogger;
}
