import { Context } from "./http/Context";

export type Middleware = (
    ctx: Context,
    next: () => Promise<void>
) => void | Promise<void>;

export type RouteHandler = (
    ctx: Context
) => void | Promise<void>;

export interface Route {
    method: string;
    path: string;
    handler: RouteHandler;
}