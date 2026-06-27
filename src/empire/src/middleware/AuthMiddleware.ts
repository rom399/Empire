import { Middleware } from "../types";

export const AuthMiddleware: Middleware = (
    req,
    res,
    next
) => {

    const authorized = true;

    if (!authorized) {

        res.statusCode = 401;
        res.end("Unauthorized");

        return;
    }

    next();
};