/**
 * 02 - Routing
 *
 * Demonstrates Empire's routing capabilities with:
 * - Route parameters via ctx.params, including multiple :params in one path
 * - Query strings via ctx.query
 * - A full REST-style user API: GET (list/single), POST (create), PUT (full
 *   replace), PATCH (partial update), DELETE (remove) — see doc/features/
 *   MISSING_HTTP_VERBS.md for how PUT/PATCH/DELETE/OPTIONS were added
 * - Overlapping routes, registered literal-first so the literal route wins
 *   over a colliding :param route — see the "Routing" section of the README
 *
 * Run: npx tsx examples/02-routing/server.ts
 * Open: http://localhost:8002
 *
 * See tests/http/routing.http for requests covering every route below,
 * plus the unmatched-path 404, HEAD/OPTIONS auto-dispatch, and a 405
 * example, none of which need a dedicated route to demonstrate.
 */

import process from "process";
import { Empire } from "../../src/Empire";

const app = new Empire({
    host: "localhost",
    port: 8002,
});

const users = [
    { id: "1", name: "Alice", role: "admin" },
    { id: "2", name: "Bob",   role: "user"  },
    { id: "3", name: "Carol", role: "user"  },
];

const posts = [
    { id: "101", userId: "1", title: "Hello, Empire" },
    { id: "102", userId: "1", title: "Routing deep dive" },
    { id: "201", userId: "2", title: "Bob's first post" },
];

app.get("/users", (ctx) => {
    const role = ctx.query.get("role");

    const result = role
        ? users.filter((u) => u.role === role)
        : users;

    ctx.json(result);
});

// Registered before /users/:id so it isn't swallowed by the param route —
// see the "Routing" section of the README for why order matters here.
app.get("/users/me", (ctx) => {
    ctx.json(users[0]);
});

app.get("/users/:id", (ctx) => {
    const user = users.find((u) => u.id === ctx.params.id);

    if (!user) {
        ctx.status(404).json({ error: "User not found" });
        return;
    }

    ctx.json(user);
});

app.post("/users", async (ctx) => {
    const body = await ctx.jsonBody() as { name: string; role: string };

    const newUser = {
        id:   String(users.length + 1),
        name: body.name,
        role: body.role ?? "user",
    };

    users.push(newUser);

    ctx.status(201).json(newUser);
});

app.put("/users/:id", async (ctx) => {
    const index = users.findIndex((u) => u.id === ctx.params.id);

    if (index === -1) {
        ctx.status(404).json({ error: "User not found" });
        return;
    }

    const body = await ctx.jsonBody() as { name: string; role: string };

    // Full replace — every field comes from the request body, nothing
    // carries over from the existing user except the id from the URL.
    users[index] = { id: ctx.params.id, name: body.name, role: body.role };

    ctx.json(users[index]);
});

app.patch("/users/:id", async (ctx) => {
    const user = users.find((u) => u.id === ctx.params.id);

    if (!user) {
        ctx.status(404).json({ error: "User not found" });
        return;
    }

    // Partial update — only fields present in the body are touched.
    const body = await ctx.jsonBody() as Partial<{ name: string; role: string }>;

    Object.assign(user, body);

    ctx.json(user);
});

app.delete("/users/:id", (ctx) => {
    const index = users.findIndex((u) => u.id === ctx.params.id);

    if (index === -1) {
        ctx.status(404).json({ error: "User not found" });
        return;
    }

    users.splice(index, 1);

    ctx.status(204).text("");
});

app.get("/users/:id/posts", (ctx) => {
    const user = users.find((u) => u.id === ctx.params.id);

    if (!user) {
        ctx.status(404).json({ error: "User not found" });
        return;
    }

    const page = ctx.query.get("page") ?? "1";

    ctx.json({
        userId: ctx.params.id,
        page:   Number(page),
        posts:  posts.filter((p) => p.userId === ctx.params.id),
    });
});

app.get("/users/:userId/posts/:postId", (ctx) => {
    const user = users.find((u) => u.id === ctx.params.userId);

    if (!user) {
        ctx.status(404).json({ error: "User not found" });
        return;
    }

    const post = posts.find(
        (p) => p.userId === ctx.params.userId && p.id === ctx.params.postId
    );

    if (!post) {
        ctx.status(404).json({ error: "Post not found" });
        return;
    }

    ctx.json(post);
});

async function start(): Promise<void> {
    try {
        await app.start();
    } catch (err) {
        app.logger.error("Failed to start server", err);
        process.exit(1);
    }
}

process.on("SIGINT", async () => {
    app.logger.info("Shutting down...");

    try {
        await app.stop();
        app.logger.info("Server stopped.");
        process.exit(0);
    } catch (err) {
        app.logger.error("Error during shutdown", err);
        process.exit(1);
    }
});

start();
