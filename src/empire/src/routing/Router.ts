import http from "http";
import { Route } from "./Route";
import { RouteMatcher } from "./RouteMatcher";
import { RouteHandler } from "../types";
import { Context } from "../http/Context";
import { HttpError } from "../errors/HttpError";
import { ILogger } from "../logging/ILogger";

/**
 * Owns route registration and request dispatching. Empire delegates
 * routing here so that server lifecycle, middleware, and configuration
 * remain the only responsibilities left in Empire.ts.
 */
export class Router {

    private readonly routes: Route[] = [];
    private readonly matcher: RouteMatcher;
    private readonly logger: ILogger;
    private fallback?: RouteHandler;

    constructor(logger: ILogger) {
        this.logger = logger;
        this.matcher = new RouteMatcher();
    }

    /**
     * Registers a handler for GET requests to the given path. Also answers
     * HEAD requests to the same path — RFC 9110 §9.3.2 requires HEAD to
     * behave identically to GET but with no response body, so `handle()`
     * dispatches HEAD to the matching GET handler and discards the body
     * that handler would have written, while leaving headers (including
     * Content-Length/Content-Type) exactly as GET would have set them.
     */
    public get(path: string, handler: RouteHandler): void {
        this.addRoute("GET", path, handler);
    }

    /**
     * Registers a handler for POST requests to the given path.
     */
    public post(path: string, handler: RouteHandler): void {
        this.addRoute("POST", path, handler);
    }

    /**
     * Registers a handler for PUT requests to the given path.
     */
    public put(path: string, handler: RouteHandler): void {
        this.addRoute("PUT", path, handler);
    }

    /**
     * Registers a handler for PATCH requests to the given path.
     */
    public patch(path: string, handler: RouteHandler): void {
        this.addRoute("PATCH", path, handler);
    }

    /**
     * Registers a handler for DELETE requests to the given path.
     */
    public delete(path: string, handler: RouteHandler): void {
        this.addRoute("DELETE", path, handler);
    }

    /**
     * Registers a handler for OPTIONS requests to the given path. Optional —
     * any path with at least one other registered method already answers
     * OPTIONS automatically with a 204 and an Allow header listing what's
     * available there (RFC 9110 §9.3.7); register a handler here only when
     * you need custom behavior (e.g. CORS preflight headers) instead of the
     * automatic response. An explicit handler always takes priority over
     * the automatic one.
     */
    public options(path: string, handler: RouteHandler): void {
        this.addRoute("OPTIONS", path, handler);
    }

    /**
     * Registers a handler invoked when no route matches a GET request,
     * in place of the default plain-text 404. Used for single-page-app
     * support, where an unmatched path (e.g. a React Router route) should
     * still serve the application shell rather than a genuine not-found
     * response. Runs after every registered route has had a chance to
     * match, so API routes always take priority over the fallback.
     *
     * Deliberately GET-only: a POST, PUT, or DELETE to an unmatched path
     * is almost always a real client error (a typo'd endpoint, a wrong
     * method) and should 404 loudly rather than silently returning the
     * HTML shell, which would mask the mistake during development.
     *
     * Only one fallback can be registered — a later call replaces
     * the previous one.
     */
    public setFallback(handler: RouteHandler): void {
        this.fallback = handler;
    }

    /**
     * Matches the incoming request against registered routes and
     * invokes the first matching handler. HEAD requests are matched
     * against GET routes and dispatched to the same handler, with the
     * response body discarded before it reaches the client (RFC 9110
     * §9.3.2). An OPTIONS request matches an explicitly registered
     * OPTIONS handler exactly like any other method; if none is
     * registered for the path but other methods are, it instead gets an
     * automatic 204 with an Allow header (RFC 9110 §9.3.7) rather than
     * falling into the 405 case below. Otherwise falls back to the
     * registered fallback handler (GET requests only), a 405 when the
     * path matches a route registered under a different method (RFC 9110
     * §9.2.2 — a matched resource that doesn't support the request
     * method must respond 405 with an Allow header, not 404), or a 404
     * when nothing matches the path at all.
     */
    public async handle(
        req: http.IncomingMessage,
        res: http.ServerResponse,
        ctx?: Context
    ): Promise<void> {

        const path = req.url?.split("?")[0] ?? "/";
        const isHead = req.method === "HEAD";
        const matchMethod = isHead ? "GET" : req.method;
        const allowedMethods = new Set<string>();

        for (const route of this.routes) {

            const match = this.matcher.match(route.path, path);

            if (!match.matched) {
                continue;
            }

            allowedMethods.add(route.method);

            if (route.method === "GET") {
                // HEAD is implicitly supported wherever GET is
                allowedMethods.add("HEAD");
            }

            if (route.method !== matchMethod) {
                continue;
            }

            if (isHead) {
                this.discardBody(res);
            }

            const requestCtx = ctx ?? new Context(req, res);
            requestCtx.params = match.params;
            await this.invokeHandler(requestCtx, route.handler);

            return;
        }

        if (allowedMethods.size > 0) {

            // OPTIONS is implicitly supported wherever any other method is
            // registered, even without an explicit handler — RFC 9110
            // §9.3.7 — so it belongs in Allow the same way HEAD does above.
            allowedMethods.add("OPTIONS");

            if (req.method === "OPTIONS") {
                res.statusCode = 204;
                res.setHeader("Allow", Array.from(allowedMethods).join(", "));
                res.end();

                return;
            }

            res.statusCode = 405;
            res.setHeader("Allow", Array.from(allowedMethods).join(", "));
            res.end("Method not allowed");

            return;
        }

        if (this.fallback && req.method === "GET") {
            const requestCtx = ctx ?? new Context(req, res);
            await this.invokeHandler(requestCtx, this.fallback);

            return;
        }

        res.statusCode = 404;
        res.end("Route not found");
    }

    /**
     * Makes a response silently drop any body written to it while still
     * setting status and headers normally. Used for HEAD requests: the
     * matched GET handler runs unmodified (so Content-Type and
     * Content-Length reflect exactly what a GET would have sent), but the
     * actual bytes never reach the client, per RFC 9110 §9.3.2.
     */
    private discardBody(res: http.ServerResponse): void {
        const originalEnd = res.end.bind(res);

        res.write = (() => true) as typeof res.write;
        res.end = ((..._args: unknown[]) => originalEnd()) as typeof res.end;
    }

    /**
     * Invokes a route or fallback handler, converting thrown errors into
     * the correct status code and JSON body. Shared by matched routes
     * and the fallback handler so both get identical error handling.
     */
    private async invokeHandler(ctx: Context, handler: RouteHandler): Promise<void> {

        try {

            await handler(ctx);

        } catch (err) {

            this.logger.error("Unhandled route error", err);

            if (!ctx.res.headersSent) {

                if (err instanceof HttpError) {

                    ctx.res.statusCode = err.statusCode;
                    ctx.res.setHeader("Content-Type", "application/json");
                    ctx.res.end(JSON.stringify({ error: err.message }));

                    return;
                }

                ctx.res.statusCode = 500;
                ctx.res.setHeader("Content-Type", "application/json");
                ctx.res.end(JSON.stringify({ error: "Internal Server Error" }));
            }
        }
    }

    private addRoute(method: string, path: string, handler: RouteHandler): void {
        this.routes.push({
            method,
            path,
            handler,
        });
    }
}
