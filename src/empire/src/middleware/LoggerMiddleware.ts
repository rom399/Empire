import { Middleware } from "../types";

export const LoggerMiddleware: Middleware = (req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
};
