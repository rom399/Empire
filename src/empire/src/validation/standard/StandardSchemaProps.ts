import { StandardSchemaResult } from "./StandardSchemaResult";
import { StandardSchemaTypes } from "./StandardSchemaTypes";

/** The members a validator exposes under its "~standard" key. */
export interface StandardSchemaProps<Input = unknown, Output = Input> {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => StandardSchemaResult<Output> | Promise<StandardSchemaResult<Output>>;
    readonly types?: StandardSchemaTypes<Input, Output> | undefined;
}
