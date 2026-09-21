import { StandardSchemaV1 } from "./standard/StandardSchemaV1";

/**
 * The validators validate() checks a request against. Each is optional
 * independently - a route can validate just its body, just its query
 * string, all three, or any combination. Any Standard Schema validator
 * works (Zod, Valibot, ArkType, or a hand-written one).
 */
export interface ValidationSchemas<TBody, TQuery, TParams> {
    body?: StandardSchemaV1<unknown, TBody>;
    query?: StandardSchemaV1<unknown, TQuery>;
    params?: StandardSchemaV1<unknown, TParams>;
}
