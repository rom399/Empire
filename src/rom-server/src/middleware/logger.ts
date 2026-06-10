import { Middleware } from "../types";

export const logger: Middleware = (req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
};
