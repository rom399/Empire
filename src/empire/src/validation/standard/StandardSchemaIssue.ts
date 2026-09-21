import { StandardSchemaPathSegment } from "./StandardSchemaPathSegment";

/** One problem: a message, and where in the value it was found. */
export interface StandardSchemaIssue {
    readonly message: string;
    readonly path?: ReadonlyArray<PropertyKey | StandardSchemaPathSegment> | undefined;
}
