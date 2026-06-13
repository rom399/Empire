import http from "http";
import { Context } from "./Context";

export type Middleware = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  next: () => void
) => void;

export type RouteHandler = (
    ctx: Context
) => void;

export interface Route {
    method: string;
    path: string;
    handler: RouteHandler;
}