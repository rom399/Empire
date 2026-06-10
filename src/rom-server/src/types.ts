import http from "http";

export type Middleware = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  next: () => void
) => void;

export type RouteHandler = (
    req: http.IncomingMessage,
    res: http.ServerResponse
) => void;

export interface Route {
    method: string;
    path: string;
    handler: RouteHandler;
}