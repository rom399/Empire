import { Middleware } from "../types";
import { ILogger } from "../logging/ILogger";

export function createLoggerMiddleware(logger: ILogger): Middleware {
    return (ctx, next) => {
        logger.info(`${ctx.method} ${ctx.path}`);
        return next();
    };
}
