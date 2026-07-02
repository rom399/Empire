import { Middleware } from "../types";

export const AuthMiddleware: Middleware = (ctx, next) => {

    const authorized = true;

    if (!authorized) {

        ctx.status(401).text("Unauthorized");

        return;
    }

    next();
};