import { RouteHandler } from "../types";

/**
 * A single registered route — an HTTP method and path pattern
 * mapped to the handler that serves matching requests.
 */
export interface Route {
    method: string;
    path: string;
    handler: RouteHandler;
}
