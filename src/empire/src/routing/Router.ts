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
     * Matches the incoming request against registered routes and
     * invokes the first matching handler. Writes a 404 response when
     * no route matches, and converts thrown errors into the correct
     * status code and JSON body.
     */
    public async handle(
        req: http.IncomingMessage,
        res: http.ServerResponse
    ): Promise<void> {

        const path = req.url?.split("?")[0] ?? "/";

        for (const route of this.routes) {

            if (route.method !== req.method) {
                continue;
            }

            const match = this.matcher.match(route.path, path);

            if (!match.matched) {
                continue;
            }

            const ctx = new Context(req, res, match.params);

            try {

                await route.handler(ctx);

            } catch (err) {

                this.logger.error("Unhandled route error", err);

                if (!res.headersSent) {

                    if (err instanceof HttpError) {

                        res.statusCode = err.statusCode;
                        res.setHeader("Content-Type", "application/json");
                        res.end(JSON.stringify({ error: err.message }));

                        return;
                    }

                    res.statusCode = 500;
                    res.setHeader("Content-Type", "application/json");
                    res.end(JSON.stringify({ error: "Internal Server Error" }));
                }
            }

            return;
        }

        res.statusCode = 404;
        res.end("Route not found");
    }

    private addRoute(method: string, path: string, handler: RouteHandler): void {
        this.routes.push({
            method,
            path,
            handler,
        });
    }
}
