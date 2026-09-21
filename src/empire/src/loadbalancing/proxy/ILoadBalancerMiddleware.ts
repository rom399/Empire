import { Context } from "../../http/Context";

/**
 * What createLoadBalancerMiddleware() returns: a plain Middleware,
 * registrable with app.use(), that also owns resources needing release.
 */
export interface ILoadBalancerMiddleware {
    /**
     * Proxies the request to a backend. Terminal - it never calls next(),
     * so anything the balancer app answers itself must be registered before it.
     */
    (ctx: Context, next: () => Promise<void>): Promise<void>;

    /**
     * Closes the keep-alive connections held open to backends, and stops
     * the registry's sweep timer if this middleware created that registry
     * itself. Call it from your shutdown handler; a registry you passed in
     * is yours to dispose.
     */
    dispose(): void;
}
