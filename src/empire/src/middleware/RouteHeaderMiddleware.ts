import { Middleware } from "../types";

/** Response header carrying the route template the backend matched. */
export const ROUTE_HEADER = "X-Empire-Route";

/**
 * Adds `X-Empire-Route: /users/:id` to every response whose request
 * matched a route, so a load balancer in front of this app can group
 * calls by endpoint instead of by raw path. Opt-in: the header exposes
 * your route structure to whoever can see responses, which is right for a
 * backend that only the balancer talks to, and not something to switch on
 * for an app that faces the internet directly. Pair it with the
 * balancer's dashboard - see doc/features/Loadbalancer-v1.md §2.7a.
 *
 * The route is only known once Router has run, which is after this
 * middleware has called next() - and by the time next() returns, headers
 * may already be on the wire. So it hooks the response's writeHead
 * instead, which Node calls (implicitly, from end(), if the handler never
 * does) immediately before the headers are sent. That is the same
 * pre-header hook the on-headers package provides.
 */
export function createRouteHeaderMiddleware(): Middleware {
    return (ctx, next) => {
        const res = ctx.res;
        const originalWriteHead = res.writeHead.bind(res);

        res.writeHead = ((...args: Parameters<typeof originalWriteHead>) => {
            if (ctx.route !== undefined && !res.headersSent) {
                try {
                    res.setHeader(ROUTE_HEADER, ctx.route);
                } catch {
                    // A route pattern Node refuses as a header value (a
                    // character outside Latin-1) must not break the response
                    // it merely describes - skip the header instead.
                }
            }

            return originalWriteHead(...args);
        }) as typeof res.writeHead;

        return next();
    };
}
