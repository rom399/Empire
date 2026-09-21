import { StandardSchemaIssue } from "./StandardSchemaIssue";

/** A failing result: every problem the validator found. */
export interface StandardSchemaFailure {
    readonly issues: ReadonlyArray<StandardSchemaIssue>;
}
