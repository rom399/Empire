import { describe, it, expect, afterEach } from "vitest";
import { Empire } from "../../src/Empire";
import { TestLogger } from "../fixtures/services/TestLogger";

/**
 * End-to-end coverage for the routing patterns added to
 * examples/02-routing/server.ts for PLAN.md Phase 9.1. The underlying
 * matching mechanics (multi-param extraction, registration order) are
 * already unit-tested in RouteMatcher.test.ts and RouterEdgeCases.test.ts —
 * this instead proves the same patterns work over a real HTTP server with
 * real app-level logic on top, which those lower-level tests don't touch
 * (e.g. a valid :userId with a :postId that doesn't belong to that user).
 */
describe("Routing patterns", () => {

    let app: Empire | undefined;
    let port = 43700;

    afterEach(async () => {
        await app?.stop();
        app = undefined;
    });

    function makeApp(): Empire {
        port += 1;
        app = new Empire({ host: "127.0.0.1", port, logger: new TestLogger() });
        return app;
    }

    describe("multi-param routes", () => {

        it("extracts both params from a two-param route over a real request", async () => {
            const a = makeApp();
            a.get("/users/:userId/posts/:postId", (ctx) => ctx.json(ctx.params));

            await a.start();
            const res = await fetch(`http://127.0.0.1:${port}/users/7/posts/99`);

            expect(await res.json()).toEqual({ userId: "7", postId: "99" });
        });

        it("lets app logic 404 a postId that doesn't belong to the matched userId", async () => {
            const a = makeApp();
            const posts = [{ id: "101", userId: "1" }];

            a.get("/users/:userId/posts/:postId", (ctx) => {
                const post = posts.find(
                    (p) => p.userId === ctx.params.userId && p.id === ctx.params.postId
                );

                if (!post) {
                    ctx.status(404).json({ error: "Post not found" });
                    return;
                }

                ctx.json(post);
            });

            await a.start();
            // Right shape, wrong postId — the route matches, app logic 404s.
            const res = await fetch(`http://127.0.0.1:${port}/users/1/posts/999`);

            expect(res.status).toBe(404);
        });
    });

    describe("overlapping routes registered literal-first", () => {

        it("reaches the literal route instead of being swallowed by the param route", async () => {
            const a = makeApp();

            a.get("/users/me", (ctx) => ctx.text("current user"));
            a.get("/users/:id", (ctx) => ctx.text(`param:${ctx.params.id}`));

            await a.start();
            const res = await fetch(`http://127.0.0.1:${port}/users/me`);

            expect(await res.text()).toBe("current user");
        });
    });
});
