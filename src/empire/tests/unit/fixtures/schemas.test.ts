import { describe, it, expect } from "vitest";
import { StandardSchemaV1 } from "../../../src/validation/standard/StandardSchemaV1";
import {
    booleanField, numberField, objectField, objectSchema, stringField,
} from "../../fixtures/validation/schemas";

interface Issues {
    issues: Array<{ message: string; path?: ReadonlyArray<unknown> }>;
}

/** Runs a schema the way validate() does; the fixtures are synchronous, so no await is needed. */
function run(schema: StandardSchemaV1<unknown, unknown>, value: unknown): unknown {
    return schema["~standard"].validate(value);
}

describe("validation test fixtures", () => {

    describe("stringField", () => {

        const schema = objectSchema({ name: stringField({ required: "name is required" }) });

        it("passes a non-empty string", () => {
            expect(run(schema, { name: "Alice" })).toEqual({ value: { name: "Alice" } });
        });

        it("fails an empty string with the required message", () => {
            expect(run(schema, { name: "" })).toEqual({
                issues: [{ message: "name is required", path: ["name"] }],
            });
        });

        it("fails a missing field with a base type message, not the required one", () => {
            expect((run(schema, {}) as Issues).issues[0].message).toBe("Required");
        });

        it("fails a value of the wrong type", () => {
            expect((run(schema, { name: 7 }) as Issues).issues[0].message).toBe("Expected string, received number");
        });

        it("applies min, email and pattern with their own messages", () => {
            const rules = objectSchema({
                short: stringField({ min: [3, "too short"] }),
                mail: stringField({ email: "not an email" }),
                code: stringField({ pattern: [/^\d+$/, "digits only"] }),
            });

            expect(run(rules, { short: "ab", mail: "nope", code: "x1" })).toEqual({
                issues: [
                    { message: "too short", path: ["short"] },
                    { message: "not an email", path: ["mail"] },
                    { message: "digits only", path: ["code"] },
                ],
            });
            expect(run(rules, { short: "abc", mail: "a@b.co", code: "42" })).toEqual({
                value: { short: "abc", mail: "a@b.co", code: "42" },
            });
        });

        it("resolves an omitted optional field to undefined", () => {
            const optional = objectSchema({ note: stringField({ optional: true }) });

            expect(run(optional, {})).toEqual({ value: { note: undefined } });
        });

        it("fills in a default for an omitted field", () => {
            const defaulted = objectSchema({ role: stringField({ default: "user" }) });

            expect(run(defaulted, {})).toEqual({ value: { role: "user" } });
        });

        it("trims before checking, and returns the trimmed text", () => {
            const trimmed = objectSchema({ name: stringField({ trim: true, required: "name is required" }) });

            expect(run(trimmed, { name: "  Al  " })).toEqual({ value: { name: "Al" } });
            expect(run(trimmed, { name: "   " })).toEqual({
                issues: [{ message: "name is required", path: ["name"] }],
            });
        });
    });

    describe("numberField", () => {

        it("passes a number and rejects text unless coercing", () => {
            const strict = objectSchema({ n: numberField() });

            expect(run(strict, { n: 3 })).toEqual({ value: { n: 3 } });
            expect((run(strict, { n: "3" }) as Issues).issues).toHaveLength(1);
        });

        it("coerces numeric text when asked, and rejects text that is not a number", () => {
            const coercing = objectSchema({ n: numberField({ coerce: true }) });

            expect(run(coercing, { n: "3" })).toEqual({ value: { n: 3 } });
            expect((run(coercing, { n: "abc" }) as Issues).issues).toHaveLength(1);
        });

        it("checks int, min and positive with their own messages", () => {
            const rules = objectSchema({
                whole: numberField({ int: "must be whole" }),
                big: numberField({ min: [10, "at least 10"] }),
                above: numberField({ positive: "must be positive" }),
            });

            expect(run(rules, { whole: 1.5, big: 3, above: 0 })).toEqual({
                issues: [
                    { message: "must be whole", path: ["whole"] },
                    { message: "at least 10", path: ["big"] },
                    { message: "must be positive", path: ["above"] },
                ],
            });
        });

        it("supports optional and default", () => {
            const rules = objectSchema({
                a: numberField({ optional: true }),
                b: numberField({ coerce: true, default: 1 }),
            });

            expect(run(rules, {})).toEqual({ value: { a: undefined, b: 1 } });
        });
    });

    describe("booleanField", () => {

        it("accepts a boolean, and coerces \"true\" and \"false\" when asked", () => {
            const rules = objectSchema({ flag: booleanField({ coerce: true }) });

            expect(run(rules, { flag: true })).toEqual({ value: { flag: true } });
            expect(run(rules, { flag: "false" })).toEqual({ value: { flag: false } });
            expect((run(rules, { flag: "yes" }) as Issues).issues).toHaveLength(1);
        });
    });

    describe("objectSchema", () => {

        it("reports every failing field, not just the first", () => {
            const schema = objectSchema({
                name: stringField({ required: "name is required" }),
                age: numberField(),
            });

            expect((run(schema, { name: "", age: "x" }) as Issues).issues).toHaveLength(2);
        });

        it("reports a nested field with its full path", () => {
            const schema = objectSchema({
                user: objectField({ name: stringField({ required: "name is required" }) }),
            });

            expect(run(schema, { user: { name: "" } })).toEqual({
                issues: [{ message: "name is required", path: ["user", "name"] }],
            });
        });

        it("reports a value that is not an object as a root issue with no path", () => {
            const schema = objectSchema({ a: stringField() });

            for (const value of [null, 5, "text", [1]]) {
                const result = run(schema, value) as Issues;

                expect(result.issues).toHaveLength(1);
                expect(result.issues[0].path).toEqual([]);
            }
        });
    });
});
