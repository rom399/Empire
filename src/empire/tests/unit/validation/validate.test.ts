import { describe, it, expect } from "vitest";
import { z } from "zod";
import { Context } from "../../../src/http/Context";
import { ValidationError } from "../../../src/errors/ValidationError";
import { validate } from "../../../src/validation/validate";
import { createMockRequest, createMockResponse } from "../../fixtures/http/MockHttp";

function contextWith(options: { body?: unknown; url?: string; params?: Record<string, string> } = {}): Context {
    const req = createMockRequest({
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        url: options.url ?? "/",
    });

    return new Context(req, createMockResponse(), options.params ?? {});
}

describe("validate", () => {

    describe("body", () => {

        const schema = z.object({
            name: z.string().min(1, "name is required"),
            age: z.number().optional(),
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
            const schema = z.object({
                q: z.string(),
                page: z.coerce.number().int(),
            });
            const ctx = contextWith({ url: "/search?q=empire&page=2" });
            let received: unknown;

            await validate({ query: schema })(async (_ctx, data) => {
                received = data.query;
            })(ctx);

            // page arrived as the string "2" - coerce.number() makes it a
            // real number, not the string that URLSearchParams always gives.
            expect(received).toEqual({ q: "empire", page: 2 });
        });

        it("throws ValidationError when a required query param is missing", async () => {
            const schema = z.object({ q: z.string().min(1) });
            const ctx = contextWith({ url: "/search" });

            await expect(
                validate({ query: schema })(async () => {})(ctx)
            ).rejects.toThrow(ValidationError);
        });
    });

    describe("params", () => {

        it("passes validated route params through to the handler", async () => {
            const schema = z.object({ id: z.string().regex(/^\d+$/, "id must be numeric") });
            const ctx = contextWith({ params: { id: "42" } });
            let received: unknown;

            await validate({ params: schema })(async (_ctx, data) => {
                received = data.params;
            })(ctx);

            expect(received).toEqual({ id: "42" });
        });

        it("throws ValidationError when a route param fails its schema", async () => {
            const schema = z.object({ id: z.string().regex(/^\d+$/, "id must be numeric") });
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
                body: z.object({ name: z.string() }),
                query: z.object({ verbose: z.coerce.boolean() }),
                params: z.object({ id: z.coerce.number() }),
            })(async (_ctx, data) => {
                received = data;
            })(ctx);

            expect(received).toEqual({
                body: { name: "Alice" },
                query: { verbose: true },
                params: { id: 42 },
            });
        });

        it("fails on the first schema checked (body) even if query would also fail", async () => {
            const ctx = contextWith({ body: {}, url: "/users" });

            try {
                await validate({
                    body: z.object({ name: z.string() }),
                    query: z.object({ required: z.string() }),
                })(async () => {})(ctx);
                expect.unreachable("expected validate to throw");
            } catch (err) {
                expect(err).toBeInstanceOf(ValidationError);
                const validationError = err as ValidationError;
                expect(validationError.details[0].field).toMatch(/^body\./);
            }
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
});
