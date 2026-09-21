/** Carries a validator's input and output types so they can be inferred; never read at runtime. */
export interface StandardSchemaTypes<Input, Output> {
    readonly input: Input;
    readonly output: Output;
}
