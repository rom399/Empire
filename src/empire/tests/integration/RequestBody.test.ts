import { describe, it, expect, afterEach } from "vitest";
import { Empire } from "../../src/Empire";
import { TestLogger } from "../fixtures/services/TestLogger";

/**
 * FINDING 6 — body() consumes the underlying stream and caches nothing.
 *
 * NOTE: this cannot be caught by tests/fixtures/http/MockHttp.ts. Its
 * createMockRequest() assigns a generator function to [Symbol.asyncIterator],
 * so every `for await` starts a fresh generator and yields the body again.
 * A real http.IncomingMessage yields nothing on a second read. The fixture is
 * therefore more forgiving than production, which is why these tests run
 * against a real server.
 */
describe("Request body over a real socket", () => {

    let app: Empire | undefined;
    let port = 43300;

    afterEach(async () => {
        await app?.stop();
        app = undefined;
    });

    function makeApp(): Empire {
        port += 1;
        app = new Empire({ host: "127.0.0.1", port, logger: new TestLogger() });
        return app;
    }

    it("returns the same body on a second read", async () => {
        const a = makeApp();
        const reads: string[] = [];

        a.post("/echo", async (ctx) => {
            reads.push(await ctx.body());
            reads.push(await ctx.body());
            ctx.json({ reads });
        });

        await a.start();
        await fetch(`http://127.0.0.1:${port}/echo`, {
            method: "POST",
            body: "hello world",
        });

        expect(reads).toEqual(["hello world", "hello world"]);
    });

    it("lets a handler parse JSON after a middleware read the body", async () => {
        const a = makeApp();

        a.use(async function inspectBody(ctx, next) {
            await ctx.body();          // e.g. a logging or signature-check middleware
            await next();
        });

        a.post("/users", async (ctx) => {
            ctx.json({ parsed: await ctx.jsonBody() });
        });

        await a.start();
        const res = await fetch(`http://127.0.0.1:${port}/users`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: "Roman" }),
        });

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ parsed: { name: "Roman" } });
    });

    it("rejects an oversized body rather than buffering it all", async () => {
        const a = makeApp();

        a.post("/upload", async (ctx) => {
            await ctx.body();
            ctx.text("accepted");
        });

        await a.start();
        const res = await fetch(`http://127.0.0.1:${port}/upload`, {
            method: "POST",
            body: "x".repeat(5 * 1024 * 1024), // 5 MB
        });

        expect(res.status).toBe(413);
    });
});
