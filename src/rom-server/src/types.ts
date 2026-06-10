import http from "http";

export type Middleware = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  next: () => void
) => void;