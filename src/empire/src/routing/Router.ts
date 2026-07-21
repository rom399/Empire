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
     * Registers a handler for GET requests to the given path.
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
     * invokes the first matching handler. Falls back to the registered
     * fallback handler (GET requests only), a 405 when the path matches
     * a route registered under a different method (RFC 9110 §9.2.2 —
     * a matched resource that doesn't support the request method must
     * respond 405 with an Allow header, not 404), or a 404 when nothing
     * matches the path at all.
     */
    public async handle(
        req: http.IncomingMessage,
        res: http.ServerResponse
    ): Promise<void> {

        const path = req.url?.split("?")[0] ?? "/";
        const allowedMethods = new Set<string>();

        for (const route of this.routes) {

            const match = this.matcher.match(route.path, path);

            if (!match.matched) {
                continue;
            }

            allowedMethods.add(route.method);

            if (route.method !== req.method) {
                continue;
            }

            const ctx = new Context(req, res, match.params);
            await this.invokeHandler(ctx, route.handler);

            return;
        }

        if (allowedMethods.size > 0) {
            res.statusCode = 405;
            res.setHeader("Allow", Array.from(allowedMethods).join(", "));
            res.end("Method not allowed");

            return;
        }

        if (this.fallback && req.method === "GET") {
            const ctx = new Context(req, res);
            await this.invokeHandler(ctx, this.fallback);

            return;
        }

        res.statusCode = 404;
        res.end("Route not found");
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
