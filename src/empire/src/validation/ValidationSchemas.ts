import { ZodType } from "zod";

/**
 * The schemas validate() checks a request against. Each is optional
 * independently - a route can validate just its body, just its query
 * string, all three, or any combination.
 */
export interface ValidationSchemas<TBody, TQuery, TParams> {
    body?: ZodType<TBody>;
    query?: ZodType<TQuery>;
    params?: ZodType<TParams>;
}
