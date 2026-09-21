import { StandardSchemaV1 } from "../../../src/validation/standard/StandardSchemaV1";
import { StandardSchemaIssue } from "../../../src/validation/standard/StandardSchemaIssue";

/**
 * Tiny hand-written validators for the tests. Empire's repository contains
 * no validation library, so these stand in for the Zod schemas the tests
 * once used. They are test code, not part of the package: each field rule
 * takes an optional custom message the way `z.string().min(1, "...")` did,
 * and an object schema reports every failing field, not just the first.
 */

export interface FieldIssue {
    path: string[];
    message: string;
}

export type FieldResult<T> = { value: T } | { issues: FieldIssue[] };

export interface FieldRule<T> {
    check(value: unknown): FieldResult<T>;
}

export interface StringFieldOptions {
    /** Message used when the string is empty (after trimming, when `trim` is set). */
    required?: string;
    min?: [number, string];
    email?: string;
    pattern?: [RegExp, string];
    optional?: boolean;
    default?: string;
    trim?: boolean;
}

export interface NumberFieldOptions {
    /** Accept text such as "2", as a query string or route param delivers it. */
    coerce?: boolean;
    int?: string;
    min?: [number, string];
    positive?: string;
    optional?: boolean;
    default?: number;
}

export interface BooleanFieldOptions {
    /** Accept the text "true" or "false", as a query string delivers it. */
    coerce?: boolean;
    optional?: boolean;
    default?: boolean;
}

type OptionalFlag = { optional?: boolean; default?: unknown };

/** `string | undefined` only when the field is marked optional and has no default. */
type FieldValue<O extends OptionalFlag, T> =
    O extends { default: T } ? T : O extends { optional: true } ? T | undefined : T;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function fail<T>(message: string): FieldResult<T> {
    return { issues: [{ path: [], message }] };
}

function typeName(value: unknown): string {
    if (value === null) {
        return "null";
    }

    return Array.isArray(value) ? "array" : typeof value;
}

export function stringField<const O extends StringFieldOptions = object>(
    options?: O
): FieldRule<FieldValue<O, string>> {
    const rules: StringFieldOptions = options ?? {};

    return {
        check(input: unknown): FieldResult<FieldValue<O, string>> {
            type Out = FieldValue<O, string>;

            if (input === undefined) {
                if (rules.default !== undefined) {
                    return { value: rules.default as Out };
                }

                return rules.optional ? { value: undefined as Out } : fail("Required");
            }

            if (typeof input !== "string") {
                return fail(`Expected string, received ${typeName(input)}`);
            }

            const value = rules.trim ? input.trim() : input;

            if (value === "" && rules.required !== undefined) {
                return fail(rules.required);
            }

            if (rules.min && value.length < rules.min[0]) {
                return fail(rules.min[1]);
            }

            if (rules.email !== undefined && !EMAIL_PATTERN.test(value)) {
                return fail(rules.email);
            }

            if (rules.pattern && !rules.pattern[0].test(value)) {
                return fail(rules.pattern[1]);
            }

            return { value: value as Out };
        },
    };
}

export function numberField<const O extends NumberFieldOptions = object>(
    options?: O
): FieldRule<FieldValue<O, number>> {
    const rules: NumberFieldOptions = options ?? {};

    return {
        check(input: unknown): FieldResult<FieldValue<O, number>> {
            type Out = FieldValue<O, number>;

            if (input === undefined) {
                if (rules.default !== undefined) {
                    return { value: rules.default as Out };
                }

                if (rules.optional) {
                    return { value: undefined as Out };
                }
            }

            const value = rules.coerce && typeof input === "string" ? Number(input) : input;

            if (typeof value !== "number" || Number.isNaN(value)) {
                return fail(input === undefined ? "Required" : `Expected number, received ${typeName(input)}`);
            }

            if (rules.int !== undefined && !Number.isInteger(value)) {
                return fail(rules.int);
            }

            if (rules.min && value < rules.min[0]) {
                return fail(rules.min[1]);
            }

            if (rules.positive !== undefined && value <= 0) {
                return fail(rules.positive);
            }

            return { value: value as Out };
        },
    };
}

export function booleanField<const O extends BooleanFieldOptions = object>(
    options?: O
): FieldRule<FieldValue<O, boolean>> {
    const rules: BooleanFieldOptions = options ?? {};

    return {
        check(input: unknown): FieldResult<FieldValue<O, boolean>> {
            type Out = FieldValue<O, boolean>;

            if (input === undefined) {
                if (rules.default !== undefined) {
                    return { value: rules.default as Out };
                }

                return rules.optional ? { value: undefined as Out } : fail("Required");
            }

            if (rules.coerce && (input === "true" || input === "false")) {
                return { value: (input === "true") as Out };
            }

            if (typeof input !== "boolean") {
                return fail(`Expected boolean, received ${typeName(input)}`);
            }

            return { value: input as Out };
        },
    };
}

/** A nested object: its fields' issues come back with the field name in front of their path. */
export function objectField<T extends object>(
    fields: { [K in keyof T]: FieldRule<T[K]> }
): FieldRule<T> {
    return {
        check(input: unknown): FieldResult<T> {
            if (typeof input !== "object" || input === null || Array.isArray(input)) {
                return fail(`Expected object, received ${typeName(input)}`);
            }

            const source = input as Record<string, unknown>;
            const output: Record<string, unknown> = {};
            const issues: FieldIssue[] = [];

            for (const key of Object.keys(fields) as Array<keyof T & string>) {
                const result = fields[key].check(source[key]);

                if ("issues" in result) {
                    for (const issue of result.issues) {
                        issues.push({ path: [key, ...issue.path], message: issue.message });
                    }
                } else {
                    output[key] = result.value;
                }
            }

            return issues.length > 0 ? { issues } : { value: output as T };
        },
    };
}

/** A Standard Schema validator over an object, reporting every failing field. */
export function objectSchema<T extends object>(
    fields: { [K in keyof T]: FieldRule<T[K]> }
): StandardSchemaV1<unknown, T> {
    const rule = objectField<T>(fields);

    return {
        "~standard": {
            version: 1,
            vendor: "empire-tests",
            validate(value: unknown) {
                const result = rule.check(value);

                if ("issues" in result) {
                    const issues: StandardSchemaIssue[] = result.issues.map((issue) => ({
                        message: issue.message,
                        path: issue.path,
                    }));

                    return { issues };
                }

                return { value: result.value };
            },
        },
    };
}
