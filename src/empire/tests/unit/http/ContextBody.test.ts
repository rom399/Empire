import { describe, it, expect } from "vitest";
import { Context } from "../../../src/http/Context";
import { createMockRequest, createMockResponse } from "../../fixtures/http/MockHttp";

/**
 * FINDING 6 — body() consumes req via `for await`, and nothing caches the
 * result. A middleware that reads the body leaves the handler with "", which
 * jsonBody() then reports as "Invalid JSON" — a misleading 400 for a request
 * whose JSON was perfectly valid.
 *
 * FINDING 7 — body() accumulates without a cap, so one large POST can exhaust
 * memory. There is no maxBodySize option to configure.
 */
describe("Context body reading", () => {

    function ctxFor(body: string, contentType = "application/json") {
        const req = createMockRequest({
            method: "POST",
            url: "/",
            headers: { host: "localhost", "content-type": contentType },
            body,
        });
        return new Context(req, createMockResponse() as unknown as never);
    }

    it("returns the same body on a second read", async () => {
        const ctx = ctxFor("hello world");

        expect(await ctx.body()).toBe("hello world");
        expect(await ctx.body()).toBe("hello world");
    });

    it("lets jsonBody() succeed after a middleware has already read body()", async () => {
        const ctx = ctxFor(JSON.stringify({ name: "Roman" }));

        await ctx.body();                       // simulate an upstream middleware
        const parsed = await ctx.jsonBody();    // handler reads it again

        expect(parsed).toEqual({ name: "Roman" });
    });

    it("lets form() succeed after body() has been read", async () => {
        const ctx = ctxFor("a=1&b=2", "application/x-www-form-urlencoded");

        await ctx.body();
        const form = await ctx.form();

        expect(form.get("a")).toBe("1");
        expect(form.get("b")).toBe("2");
    });

    it("rejects a body larger than the configured limit", async () => {
        const ctx = ctxFor("x".repeat(2 * 1024 * 1024)); // 2 MB

        // Expected: a 413-shaped HttpError rather than unbounded accumulation.
        await expect(ctx.body()).rejects.toThrow(/too large|413|limit/i);
    });

    it("still reports genuinely malformed JSON as a bad request", async () => {
        const ctx = ctxFor("{ not json");

        await expect(ctx.jsonBody()).rejects.toThrow("Invalid JSON");
    });
});
