import http from "http";
import { HttpError } from "./HttpError";
import { ILogger } from "../logging/ILogger";

/**
 * Logs an error and, if the response hasn't already started, converts it
 * into the response a client should see: an HttpError's own status code
 * and message as JSON, or a generic 500 for anything else. Shared by
 * Empire's middleware-pipeline catch and Router's route-handler catch so
 * both produce an identical response shape.
 */
export function sendErrorResponse(
    res: http.ServerResponse,
    err: unknown,
    logger: ILogger,
    logMessage: string
): void {
    logger.error(logMessage, err);

    if (res.headersSent) {
        return;
    }

    if (err instanceof HttpError) {
        res.statusCode = err.statusCode;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: err.message }));
        return;
    }

    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Internal Server Error" }));
}
