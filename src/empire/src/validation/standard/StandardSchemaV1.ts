import { StandardSchemaProps } from "./StandardSchemaProps";

/**
 * A copy of the Standard Schema v1 interface (https://standardschema.dev),
 * which Zod (3.24 and later), Valibot and ArkType all implement. The spec
 * is published as an interface to be copied rather than depended on, so
 * Empire can accept any of them without installing any of them.
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
    readonly "~standard": StandardSchemaProps<Input, Output>;
}
