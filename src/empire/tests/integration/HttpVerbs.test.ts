import { describe, it, expect, afterEach } from "vitest";
import { Empire } from "../../src/Empire";
import { TestLogger } from "../fixtures/services/TestLogger";

/**
 * Real-server coverage for PUT/PATCH/DELETE/OPTIONS (Missing HTTP Verbs —
 * see doc/MISSING_HTTP_VERBS.md). Router.test.ts already proves basic
 * dispatch works via mocks; this proves the same verbs work end to end
 * with real request bodies, real app-level logic, and real response
 * headers over an actual socket, the way an actual REST resource would
 * use them.
 */
describe("PUT / PATCH / DELETE", () => {

    let app: Empire | undefined;
    let port = 43800;

    afterEach(async () => {
        await app?.stop();
        app = undefined;
    });

    function makeApp(): Empire {
        port += 1;
        app = new Empire({ host: "127.0.0.1", port, logger: new TestLogger() });
        return app;
    }

    it("PUT replaces a resource using the request body", async () => {
        const a = makeApp();
        const users: Record<string, { id: string; name: string }> = {
            "1": { id: "1", name: "Alice" },
        };

        a.put("/users/:id", async (ctx) => {
            const body = await ctx.jsonBody() as { name: string };
            users[ctx.params.id] = { id: ctx.params.id, name: body.name };
            ctx.json(users[ctx.params.id]);
        });

        await a.start();
        const res = await fetch(`http://127.0.0.1:${port}/users/1`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: "Alice Updated" }),
        });

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ id: "1", name: "Alice Updated" });
    });

    it("PATCH partially updates a resource, leaving other fields untouched", async () => {
        const a = makeApp();
        const user = { id: "1", name: "Alice", role: "admin" };

        a.patch("/users/:id", async (ctx) => {
            const body = await ctx.jsonBody() as Partial<typeof user>;
            Object.assign(user, body);
            ctx.json(user);
        });

        await a.start();
        const res = await fetch(`http://127.0.0.1:${port}/users/1`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ role: "user" }),
        });

        expect(await res.json()).toEqual({ id: "1", name: "Alice", role: "user" });
    });

    it("DELETE removes a resource and returns 204", async () => {
        const a = makeApp();
        const ids = new Set(["1"]);

        a.delete("/users/:id", (ctx) => {
            ids.delete(ctx.params.id);
            ctx.status(204).text("");
        });

        await a.start();
        const res = await fetch(`http://127.0.0.1:${port}/users/1`, { method: "DELETE" });

        expect(res.status).toBe(204);
        expect(ids.has("1")).toBe(false);
    });

    it("DELETE on a nonexistent resource can 404 via app logic", async () => {
        const a = makeApp();

        a.delete("/users/:id", (ctx) => {
            ctx.status(404).json({ error: "User not found" });
        });

        await a.start();
        const res = await fetch(`http://127.0.0.1:${port}/users/999`, { method: "DELETE" });

        expect(res.status).toBe(404);
    });
});

describe("OPTIONS", () => {

    let app: Empire | undefined;
    let port = 43900;

    afterEach(async () => {
        await app?.stop();
        app = undefined;
    });

    function makeApp(): Empire {
        port += 1;
        app = new Empire({ host: "127.0.0.1", port, logger: new TestLogger() });
        return app;
    }

    it("responds 204 with a real Allow header over an actual socket", async () => {
        const a = makeApp();
        a.get("/users", (ctx) => ctx.json({}));
        a.post("/users", (ctx) => ctx.json({}));

        await a.start();
        const res = await fetch(`http://127.0.0.1:${port}/users`, { method: "OPTIONS" });

        expect(res.status).toBe(204);
        expect(res.headers.get("allow")).toBe("GET, HEAD, POST, OPTIONS");
    });

    it("lets an explicit options() handler override the automatic response", async () => {
        const a = makeApp();
        a.get("/users", (ctx) => ctx.json({}));
        a.options("/users", (ctx) => ctx.status(200).header("X-Custom", "yes").text("custom"));

        await a.start();
        const res = await fetch(`http://127.0.0.1:${port}/users`, { method: "OPTIONS" });

        expect(res.status).toBe(200);
        expect(res.headers.get("x-custom")).toBe("yes");
        expect(await res.text()).toBe("custom");
    });
});
