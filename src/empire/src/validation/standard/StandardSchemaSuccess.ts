/** A passing result. `issues` is absent, which is how a caller tells it from a failure. */
export interface StandardSchemaSuccess<Output> {
    readonly value: Output;
    readonly issues?: undefined;
}
