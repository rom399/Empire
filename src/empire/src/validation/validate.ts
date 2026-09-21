import { Context } from "../http/Context";
import { RouteHandler } from "../types";
import { ValidationError } from "../errors/ValidationError";
import { ValidationIssue } from "../errors/ValidationIssue";
import { formatIssueField } from "./formatIssueField";
import { StandardSchemaV1 } from "./standard/StandardSchemaV1";
import { ValidationSchemas } from "./ValidationSchemas";
import { Validated } from "./Validated";

/**
 * Wraps a handler with schema-based validation for the request body,
 * query string, and/or route params. Returns a plain RouteHandler, so it
 * needs no changes to Router's registration methods or Context's frozen
 * API - same shape as createLoggerMiddleware(logger) wrapping a
 * middleware around a dependency.
 *
 * Each schema is any Standard Schema validator (https://standardschema.dev)
 * - Zod, Valibot, ArkType, or a hand-written one. Empire calls it through
 * the spec's single entry point and depends on none of them.
 *
 * Any schema that fails throws ValidationError (a BadRequestError),
 * which Router already converts into a 400 through the existing error
 * pipeline - see sendErrorResponse.ts for the response shape. Body, query
 * and params are all checked, in that order, and every problem found is
 * reported together in one ValidationError, so a client fixing a bad
 * request sees everything wrong with it at once. A validator that throws
 * instead of returning issues is a bug in the validator, so its error
 * propagates as a 500.
 *
 * ctx.query and ctx.params both come off the raw URL, so every value in
 * them is a string - a schema expecting a number must coerce it (with Zod,
 * z.coerce.number() rather than z.number()), or a well-formed "?page=2"
 * will fail validation as the string "2" rather than being treated as the
 * number 2.
 */
export function validate<TBody = undefined, TQuery = undefined, TParams = undefined>(
    schemas: ValidationSchemas<TBody, TQuery, TParams>
) {
    return (
        handler: (ctx: Context, data: Validated<TBody, TQuery, TParams>) => void | Promise<void>
    ): RouteHandler =>
        async (ctx) => {
            const problems: ValidationIssue[] = [];

            const body = schemas.body
                ? keepValueOrCollect(await check(schemas.body, await ctx.jsonBody(), "body"), problems)
                : (undefined as TBody);

            const query = schemas.query
                ? keepValueOrCollect(await check(schemas.query, Object.fromEntries(ctx.query), "query"), problems)
                : (undefined as TQuery);

            const params = schemas.params
                ? keepValueOrCollect(await check(schemas.params, ctx.params, "params"), problems)
                : (undefined as TParams);

            if (problems.length > 0) {
                throw new ValidationError(problems);
            }

            return handler(ctx, { body, query, params });
        };
}

type CheckResult<T> = { value: T } | { problems: ValidationIssue[] };

/** Adds a failed check's problems to the running list; a passed check's value is returned as is. */
function keepValueOrCollect<T>(result: CheckResult<T>, problems: ValidationIssue[]): T {
    if ("problems" in result) {
        problems.push(...result.problems);

        // never read: the caller throws once every location has been checked
        return undefined as T;
    }

    return result.value;
}

async function check<T>(
    schema: StandardSchemaV1<unknown, T>,
    value: unknown,
    location: "body" | "query" | "params"
): Promise<CheckResult<T>> {
    // await covers validators that return a value and ones that return a Promise.
    const result = await schema["~standard"].validate(value);

    if (result.issues === undefined) {
        return { value: result.value };
    }

    const problems: ValidationIssue[] = result.issues.map((issue) => ({
        field: formatIssueField(location, issue.path),
        message: issue.message,
    }));

    // A failure with no issues listed must not reach the client as a 400 with no reason.
    if (problems.length === 0) {
        problems.push({ field: location, message: "Invalid value" });
    }

    return { problems };
}
