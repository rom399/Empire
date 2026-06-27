/**
 * 02 - Routing
 *
 * Demonstrates Empire's routing capabilities with:
 * - Route parameters via ctx.params
 * - Query strings via ctx.query
 * - Multiple GET and POST routes
 * - Realistic REST-style user API using only GET and POST
 *
 * Run: npx tsx examples/02-routing/server.ts
 * Open: http://localhost:8002
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

app.get("/users", (ctx) => {
    const role = ctx.query.get("role");

    const result = role
        ? users.filter((u) => u.role === role)
        : users;

    ctx.json(result);
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
        posts:  [],
    });
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
