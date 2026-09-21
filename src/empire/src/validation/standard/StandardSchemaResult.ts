import { StandardSchemaFailure } from "./StandardSchemaFailure";
import { StandardSchemaSuccess } from "./StandardSchemaSuccess";

/** What a Standard Schema validator returns: the value, or the issues. */
export type StandardSchemaResult<Output> = StandardSchemaSuccess<Output> | StandardSchemaFailure;
