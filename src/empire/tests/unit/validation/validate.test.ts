import { describe, it, expect } from "vitest";
import { Context } from "../../../src/http/Context";
import { ValidationError } from "../../../src/errors/ValidationError";
import { validate } from "../../../src/validation/validate";
import { StandardSchemaV1 } from "../../../src/validation/standard/StandardSchemaV1";
import { createMockRequest, createMockResponse } from "../../fixtures/http/MockHttp";
import { booleanField, numberField, objectSchema, stringField } from "../../fixtures/validation/schemas";

function contextWith(options: { body?: unknown; url?: string; params?: Record<string, string> } = {}): Context {
    const req = createMockRequest({
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        url: options.url ?? "/",
    });

    return new Context(req, createMockResponse(), options.params ?? {});
}

/** A hand-written Standard Schema validator around a plain function. */
function schemaFrom<T>(
    check: StandardSchemaV1<unknown, T>["~standard"]["validate"],
    vendor = "test"
): StandardSchemaV1<unknown, T> {
    return { "~standard": { version: 1, vendor, validate: check } };
}

async function failureOf(run: () => unknown): Promise<ValidationError> {
    try {
        await run();
    } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);

        return err as ValidationError;
    }

    return expect.unreachable("expected validate to throw");
}

describe("validate", () => {

    describe("body", () => {

        const schema = objectSchema({
            name: stringField({ required: "name is required" }),
            age: numberField({ optional: true }),
        });

        it("passes the parsed, typed body through to the handler on success", async () => {
            const ctx = contextWith({ body: { name: "Alice", age: 30 } });
            let received: unknown;

            await validate({ body: schema })(async (_ctx, data) => {
                received = data.body;
            })(ctx);

            expect(received).toEqual({ name: "Alice", age: 30 });
        });

        it("resolves an omitted optional field to undefined, not an error", async () => {
            const ctx = contextWith({ body: { name: "Alice" } });
            let received: unknown;

            await validate({ body: schema })(async (_ctx, data) => {
                received = data.body;
            })(ctx);

            expect(received).toEqual({ name: "Alice", age: undefined });
        });

        it("throws ValidationError naming the field when a required field is missing", async () => {
            const ctx = contextWith({ body: {} });

            await expect(
                validate({ body: schema })(async () => {})(ctx)
            ).rejects.toThrow(ValidationError);
        });

        it("includes the field path and reason in the thrown error's details", async () => {
            const ctx = contextWith({ body: { name: "" } });

            try {
                await validate({ body: schema })(async () => {})(ctx);
                expect.unreachable("expected validate to throw");
            } catch (err) {
                expect(err).toBeInstanceOf(ValidationError);
                const validationError = err as ValidationError;
                expect(validationError.details).toEqual([
                    { field: "body.name", message: "name is required" },
                ]);
            }
        });
    });

    describe("query", () => {

        it("passes the parsed, coerced query through to the handler on success", async () => {
            const schema = objectSchema({
                q: stringField(),
                page: numberField({ coerce: true, int: "must be a whole number" }),
            });
            const ctx = contextWith({ url: "/search?q=empire&page=2" });
            let received: unknown;

            await validate({ query: schema })(async (_ctx, data) => {
                received = data.query;
            })(ctx);

            // page arrived as the string "2" - a coercing number rule makes it a
            // real number, not the string that URLSearchParams always gives.
            expect(received).toEqual({ q: "empire", page: 2 });
        });

        it("throws ValidationError when a required query param is missing", async () => {
            const schema = objectSchema({ q: stringField({ required: "q is required" }) });
            const ctx = contextWith({ url: "/search" });

            await expect(
                validate({ query: schema })(async () => {})(ctx)
            ).rejects.toThrow(ValidationError);
        });
    });

    describe("params", () => {

        it("passes validated route params through to the handler", async () => {
            const schema = objectSchema({ id: stringField({ pattern: [/^\d+$/, "id must be numeric"] }) });
            const ctx = contextWith({ params: { id: "42" } });
            let received: unknown;

            await validate({ params: schema })(async (_ctx, data) => {
                received = data.params;
            })(ctx);

            expect(received).toEqual({ id: "42" });
        });

        it("throws ValidationError when a route param fails its schema", async () => {
            const schema = objectSchema({ id: stringField({ pattern: [/^\d+$/, "id must be numeric"] }) });
            const ctx = contextWith({ params: { id: "not-a-number" } });

            await expect(
                validate({ params: schema })(async () => {})(ctx)
            ).rejects.toThrow(ValidationError);
        });
    });

    describe("combined body, query, and params", () => {

        it("validates and passes through all three at once on success", async () => {
            const ctx = contextWith({
                body: { name: "Alice" },
                url: "/users/42?verbose=true",
                params: { id: "42" },
            });
            let received: unknown;

            await validate({
                body: objectSchema({ name: stringField() }),
                query: objectSchema({ verbose: booleanField({ coerce: true }) }),
                params: objectSchema({ id: numberField({ coerce: true }) }),
            })(async (_ctx, data) => {
                received = data;
            })(ctx);

            expect(received).toEqual({
                body: { name: "Alice" },
                query: { verbose: true },
                params: { id: 42 },
            });
        });

        it("reports a failing body and a failing query together, body first", async () => {
            const ctx = contextWith({ body: {}, url: "/users" });

            const error = await failureOf(() => validate({
                body: objectSchema({ name: stringField() }),
                query: objectSchema({ required: stringField() }),
            })(async () => {})(ctx));

            expect(error.details.map((detail) => detail.field)).toEqual(["body.name", "query.required"]);
        });

        it("reports only the location that failed when the others pass", async () => {
            const ctx = contextWith({ body: { name: "Alice" }, url: "/users", params: { id: "abc" } });

            const error = await failureOf(() => validate({
                body: objectSchema({ name: stringField() }),
                query: objectSchema({}),
                params: objectSchema({ id: numberField({ coerce: true }) }),
            })(async () => {})(ctx));

            expect(error.details.map((detail) => detail.field)).toEqual(["params.id"]);
        });
    });

    describe("no schema given", () => {

        it("does not validate a field that has no schema, and it stays undefined", async () => {
            const ctx = contextWith({ body: { anything: "goes" } });
            let received: unknown;

            await validate({})(async (_ctx, data) => {
                received = data;
            })(ctx);

            expect(received).toEqual({ body: undefined, query: undefined, params: undefined });
        });
    });

    describe("any Standard Schema validator", () => {

        it("hands the handler the value a synchronous validator returns", async () => {
            const upperCase = schemaFrom<{ name: string }>((value) => ({
                value: { name: String((value as { name: string }).name).toUpperCase() },
            }));
            const ctx = contextWith({ body: { name: "alice" } });
            let received: unknown;

            await validate({ body: upperCase })(async (_ctx, data) => {
                received = data.body;
            })(ctx);

            // the validated value replaces the raw input, which is how coercion and defaults take effect
            expect(received).toEqual({ name: "ALICE" });
        });

        it("awaits an asynchronous validator on success", async () => {
            const slow = schemaFrom<{ ok: boolean }>(async () => {
                await new Promise((resolve) => setTimeout(resolve, 5));

                return { value: { ok: true } };
            });
            const ctx = contextWith({ body: {} });
            let received: unknown;

            await validate({ body: slow })(async (_ctx, data) => {
                received = data.body;
            })(ctx);

            expect(received).toEqual({ ok: true });
        });

        it("awaits an asynchronous validator on failure", async () => {
            const slow = schemaFrom<never>(async () => {
                await new Promise((resolve) => setTimeout(resolve, 5));

                return { issues: [{ message: "taken", path: ["name"] }] };
            });
            const ctx = contextWith({ body: {} });

            const error = await failureOf(() => validate({ body: slow })(async () => {})(ctx));

            expect(error.details).toEqual([{ field: "body.name", message: "taken" }]);
        });

        it("builds details from every issue, in the order the validator reported them", async () => {
            const many = schemaFrom<never>(() => ({
                issues: [
                    { message: "first", path: ["a"] },
                    { message: "second", path: ["b", 0, "c"] },
                    { message: "third", path: [{ key: "d" }] },
                ],
            }));
            const ctx = contextWith({ body: {} });

            const error = await failureOf(() => validate({ body: many })(async () => {})(ctx));

            expect(error.details).toEqual([
                { field: "body.a", message: "first" },
                { field: "body.b.0.c", message: "second" },
                { field: "body.d", message: "third" },
            ]);
        });

        it("reports a root-level issue as the bare location, without a trailing dot", async () => {
            const whole = schemaFrom<never>(() => ({ issues: [{ message: "must be an object" }] }));
            const ctx = contextWith({ body: 42 });

            const error = await failureOf(() => validate({ body: whole })(async () => {})(ctx));

            expect(error.details).toEqual([{ field: "body", message: "must be an object" }]);
        });

        it("still rejects when the validator fails with an empty issues list", async () => {
            const silent = schemaFrom<never>(() => ({ issues: [] }));
            const ctx = contextWith({ body: {} });

            const error = await failureOf(() => validate({ body: silent })(async () => {})(ctx));

            expect(error.details).toEqual([{ field: "body", message: "Invalid value" }]);
        });

        it("uses the location the failing schema was supplied for", async () => {
            const bad = schemaFrom<never>(() => ({ issues: [{ message: "nope", path: ["x"] }] }));

            const queryError = await failureOf(() =>
                validate({ query: bad })(async () => {})(contextWith({ url: "/?x=1" })));
            const paramsError = await failureOf(() =>
                validate({ params: bad })(async () => {})(contextWith({ params: { x: "1" } })));

            expect(queryError.details[0].field).toBe("query.x");
            expect(paramsError.details[0].field).toBe("params.x");
        });

        it("lets an error thrown by a validator propagate unchanged, as a server fault", async () => {
            const boom = new Error("validator bug");
            const broken = schemaFrom<never>(() => {
                throw boom;
            });
            const ctx = contextWith({ body: {} });

            await expect(validate({ body: broken })(async () => {})(ctx)).rejects.toBe(boom);
        });

        it("reports the body's problems, then the query's, then the params', all in one error", async () => {
            const bad = (label: string) => schemaFrom<never>(() => ({ issues: [{ message: label }] }));
            const ctx = contextWith({ body: {}, url: "/?a=1", params: { id: "1" } });

            const error = await failureOf(() =>
                validate({ body: bad("body failed"), query: bad("query failed"), params: bad("params failed") })(
                    async () => {}
                )(ctx));

            expect(error.details).toEqual([
                { field: "body", message: "body failed" },
                { field: "query", message: "query failed" },
                { field: "params", message: "params failed" },
            ]);
        });

        it("never calls the handler when any one location fails", async () => {
            const ok = schemaFrom<{ n: number }>(() => ({ value: { n: 1 } }));
            const bad = schemaFrom<never>(() => ({ issues: [{ message: "nope" }] }));
            let handlerRan = false;

            await failureOf(() => validate({ body: ok, params: bad })(async () => {
                handlerRan = true;
            })(contextWith({ body: {}, params: { id: "1" } })));

            expect(handlerRan).toBe(false);
        });

        it("still runs the later validators after an earlier one fails", async () => {
            const bad = schemaFrom<never>(() => ({ issues: [{ message: "nope" }] }));
            let queryChecked = false;
            const spy = schemaFrom<{ q: string }>((value) => {
                queryChecked = true;

                return { value: value as { q: string } };
            });

            await failureOf(() => validate({ body: bad, query: spy })(async () => {})(contextWith({ body: {} })));

            expect(queryChecked).toBe(true);
        });

        it("still lets a throwing validator surface as a server fault when an earlier one failed", async () => {
            const bad = schemaFrom<never>(() => ({ issues: [{ message: "nope" }] }));
            const boom = new Error("validator bug");
            const broken = schemaFrom<never>(() => {
                throw boom;
            });

            await expect(
                validate({ body: bad, query: broken })(async () => {})(contextWith({ body: {} }))
            ).rejects.toBe(boom);
        });

        it("does not look at the vendor string", async () => {
            const other = schemaFrom<{ n: number }>(() => ({ value: { n: 1 } }), "valibot-like");
            const ctx = contextWith({ body: {} });
            let received: unknown;

            await validate({ body: other })(async (_ctx, data) => {
                received = data.body;
            })(ctx);

            expect(received).toEqual({ n: 1 });
        });
    });
});
