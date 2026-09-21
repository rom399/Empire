import { describe, it, expect, expectTypeOf } from "vitest";
import { StandardSchemaV1 } from "../../../../src/validation/standard/StandardSchemaV1";
import { ValidationSchemas } from "../../../../src/validation/ValidationSchemas";
import { numberField, objectSchema, stringField } from "../../../fixtures/validation/schemas";

describe("StandardSchemaV1", () => {

    it("accepts a hand-written validator", () => {
        const pageQuery: StandardSchemaV1<unknown, { page: number }> = {
            "~standard": {
                version: 1,
                vendor: "my-app",
                validate: () => ({ value: { page: 1 } }),
            },
        };

        expect(pageQuery["~standard"].validate({})).toEqual({ value: { page: 1 } });
    });

    it("infers a fixture schema's output type from its field rules", () => {
        const schema = objectSchema({
            name: stringField(),
            note: stringField({ optional: true }),
            age: numberField({ default: 18 }),
        });

        expectTypeOf(schema).toEqualTypeOf<
            StandardSchemaV1<unknown, { name: string; note: string | undefined; age: number }>
        >();
        expect(schema["~standard"].version).toBe(1);
    });

    it("rejects a schema whose output type does not match", () => {
        const strings: StandardSchemaV1<unknown, { a: string }> = {
            "~standard": { version: 1, vendor: "t", validate: () => ({ value: { a: "x" } }) },
        };

        // @ts-expect-error - { a: string } output is not assignable to { a: number }
        const numbers: StandardSchemaV1<unknown, { a: number }> = strings;

        expect(numbers).toBe(strings);
    });

    it("rejects an object with no ~standard property, or with version 2", () => {
        // @ts-expect-error - "~standard" is missing
        const missing: StandardSchemaV1 = {};

        // @ts-expect-error - only version 1 is supported
        const wrongVersion: StandardSchemaV1 = { "~standard": { version: 2, vendor: "t", validate: () => ({ value: 1 }) } };

        expect(missing).toBeDefined();
        expect(wrongVersion).toBeDefined();
    });

    it("accepts an object built like a real vendor's, including the optional types member", () => {
        // Written out to match what Zod 4 exposes, without importing Zod.
        const vendorLike = {
            "~standard": {
                version: 1 as const,
                vendor: "zod",
                validate: (value: unknown) =>
                    typeof value === "string"
                        ? { value }
                        : { issues: [{ message: "Invalid input: expected string", path: ["name"] }] },
                types: undefined as unknown as { input: string; output: string },
            },
        };

        const asStandard: StandardSchemaV1<unknown, string> = vendorLike;

        expect(asStandard["~standard"].validate("a")).toEqual({ value: "a" });
        expect(asStandard["~standard"].validate(1)).toEqual({
            issues: [{ message: "Invalid input: expected string", path: ["name"] }],
        });
    });

    it("is accepted by ValidationSchemas for the body", () => {
        const body: StandardSchemaV1<unknown, { a: string }> = {
            "~standard": { version: 1, vendor: "t", validate: () => ({ value: { a: "x" } }) },
        };

        const schemas: ValidationSchemas<{ a: string }, undefined, undefined> = { body };

        expect(schemas.body).toBe(body);
    });
});
