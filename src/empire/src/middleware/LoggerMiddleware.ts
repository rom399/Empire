import { Middleware } from "../types";

export const LoggerMiddleware: Middleware = (ctx, next) => {
    console.log(`${ctx.method} ${ctx.path}`);
    next();
};
