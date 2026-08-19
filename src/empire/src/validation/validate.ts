import { ZodType } from "zod";
import { Context } from "../http/Context";
import { RouteHandler } from "../types";
import { ValidationError } from "../errors/ValidationError";
import { ValidationSchemas } from "./ValidationSchemas";
import { Validated } from "./Validated";

/**
 * Wraps a handler with schema-based validation for the request body,
 * query string, and/or route params. Returns a plain RouteHandler, so it
 * needs no changes to Router's registration methods or Context's frozen
 * API - same shape as createLoggerMiddleware(logger) wrapping a
 * middleware around a dependency.
 *
 * Any schema that fails throws ValidationError (a BadRequestError),
 * which Router already converts into a 400 through the existing error
 * pipeline - see sendErrorResponse.ts for the response shape.
 *
 * ctx.query and ctx.params both come off the raw URL, so every value in
 * them is a string - a schema expecting a number needs z.coerce.number()
 * rather than z.number(), or a well-formed "?page=2" will fail validation
 * as the string "2" rather than being treated as the number 2.
 */
export function validate<TBody = undefined, TQuery = undefined, TParams = undefined>(
    schemas: ValidationSchemas<TBody, TQuery, TParams>
) {
    return (
        handler: (ctx: Context, data: Validated<TBody, TQuery, TParams>) => void | Promise<void>
    ): RouteHandler =>
        async (ctx) => {
            const body = schemas.body
                ? parseOrThrow(schemas.body, await ctx.jsonBody(), "body")
                : (undefined as TBody);

            const query = schemas.query
                ? parseOrThrow(schemas.query, Object.fromEntries(ctx.query), "query")
                : (undefined as TQuery);

            const params = schemas.params
                ? parseOrThrow(schemas.params, ctx.params, "params")
                : (undefined as TParams);

            return handler(ctx, { body, query, params });
        };
}

function parseOrThrow<T>(schema: ZodType<T>, value: unknown, location: string): T {
    const result = schema.safeParse(value);

    if (!result.success) {
        throw new ValidationError(
            result.error.issues.map((issue) => ({
                field: `${location}.${issue.path.join(".")}`,
                message: issue.message,
            }))
        );
    }

    return result.data;
}
