import http from "http";
import { ILogger } from "../../logging/ILogger";
import { LoadBalancerMonitor } from "../monitoring/LoadBalancerMonitor";

/** Per-request settings for forwardRequest(), supplied by the load balancer middleware. */
export interface ForwardRequestOptions {
    /** Shared keep-alive agent, so connections to backends are reused across requests. */
    agent: http.Agent;

    /**
     * How long to wait for the backend's response *headers*. It bounds time
     * to first response, not total duration, so a long streamed response
     * is never cut off by it.
     */
    timeoutMs: number;

    /** Identifies this request in monitor events and, as X-Request-Id, in the backend's own logs. */
    requestId: string;

    monitor?: LoadBalancerMonitor;

    /**
     * Keep the query string in the paths reported to the monitor. Off by
     * default: query strings routinely carry tokens, emails and search
     * terms, and the dashboard is the kind of page that gets screen-shared.
     * It is always forwarded to the backend regardless.
     */
    includeQueryString?: boolean;

    logger?: ILogger;
}
