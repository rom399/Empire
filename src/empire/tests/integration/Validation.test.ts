import { describe, it, expect, afterEach } from "vitest";
import { z } from "zod";
import { Empire } from "../../src/Empire";
import { validate } from "../../src/validation/validate";
import { TestLogger } from "../fixtures/services/TestLogger";

describe("Validation over a real request", () => {

    let app: Empire | undefined;
    let port = 44200;

    afterEach(async () => {
        await app?.stop();
        app = undefined;
    });

    const createUserSchema = z.object({
        name: z.string().min(1, "name is required"),
        email: z.string().email("email must be a valid address"),
    });

    it("returns 201 with the validated body when the request is valid", async () => {
        port += 1;
        app = new Empire({ host: "127.0.0.1", port, logger: new TestLogger() });
        app.post("/users", validate({ body: createUserSchema })(async (ctx, { body }) => {
            ctx.status(201).json(body);
        }));

        await app.start();
        const res = await fetch(`http://127.0.0.1:${port}/users`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "Alice", email: "alice@example.com" }),
        });

        expect(res.status).toBe(201);
        expect(await res.json()).toEqual({ name: "Alice", email: "alice@example.com" });
    });

    it("returns 400 with field-level details when the body is invalid", async () => {
        port += 1;
        app = new Empire({ host: "127.0.0.1", port, logger: new TestLogger() });
        app.post("/users", validate({ body: createUserSchema })(async (ctx, { body }) => {
            ctx.status(201).json(body);
        }));

        await app.start();
        const res = await fetch(`http://127.0.0.1:${port}/users`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "", email: "not-an-email" }),
        });

        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toContain("body.name");
        expect(body.details).toEqual([
            { field: "body.name", message: "name is required" },
            { field: "body.email", message: "email must be a valid address" },
        ]);
    });

    it("coerces query string values per schema on a real request", async () => {
        port += 1;
        app = new Empire({ host: "127.0.0.1", port, logger: new TestLogger() });
        const searchSchema = z.object({
            q: z.string().min(1),
            page: z.coerce.number().int().min(1).default(1),
        });

        app.get("/search", validate({ query: searchSchema })(async (ctx, { query }) => {
            ctx.json({ q: query.q, page: query.page, pageIsNumber: typeof query.page === "number" });
        }));

        await app.start();
        const res = await fetch(`http://127.0.0.1:${port}/search?q=empire&page=2`);

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ q: "empire", page: 2, pageIsNumber: true });
    });

    it("returns 400 naming the field when a required query param is missing entirely", async () => {
        port += 1;
        app = new Empire({ host: "127.0.0.1", port, logger: new TestLogger() });
        // A missing field fails Zod's own base type check before a custom
        // .min(1, "...") message would ever run - that message only fires
        // when the field is present but empty. Asserting on the field name
        // rather than the exact wording keeps this test honest about that.
        const searchSchema = z.object({ q: z.string() });

        app.get("/search", validate({ query: searchSchema })(async (ctx, { query }) => {
            ctx.json({ q: query.q });
        }));

        await app.start();
        const res = await fetch(`http://127.0.0.1:${port}/search`);

        expect(res.status).toBe(400);
        expect((await res.json()).details[0].field).toBe("query.q");
    });

    it("returns 400 with the custom message when a required query param is present but empty", async () => {
        port += 1;
        app = new Empire({ host: "127.0.0.1", port, logger: new TestLogger() });
        const searchSchema = z.object({ q: z.string().min(1, "q is required") });

        app.get("/search", validate({ query: searchSchema })(async (ctx, { query }) => {
            ctx.json({ q: query.q });
        }));

        await app.start();
        const res = await fetch(`http://127.0.0.1:${port}/search?q=`);

        expect(res.status).toBe(400);
        expect((await res.json()).error).toContain("q is required");
    });

    it("does not reach the handler at all when validation fails", async () => {
        port += 1;
        app = new Empire({ host: "127.0.0.1", port, logger: new TestLogger() });
        let handlerRan = false;

        app.post("/users", validate({ body: createUserSchema })(async (ctx, { body }) => {
            handlerRan = true;
            ctx.status(201).json(body);
        }));

        await app.start();
        await fetch(`http://127.0.0.1:${port}/users`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
        });

        expect(handlerRan).toBe(false);
    });
});
