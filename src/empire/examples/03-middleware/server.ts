/**
 * 03 - Middleware
 *
 * Demonstrates Empire's middleware pipeline with:
 * - Registering LoggerMiddleware and AuthMiddleware via app.use()
 * - Writing a custom request timing middleware
 * - Middleware ordering — runs top to bottom before any route handler
 *
 * Run: npx tsx examples/03-middleware/server.ts
 * Open: http://localhost:8003
 */

import process from "process";
import { Empire } from "../../src/Empire";
import { LoggerMiddleware } from "../../src/middleware/LoggerMiddleware";
import { AuthMiddleware } from "../../src/middleware/AuthMiddleware";
import { Middleware } from "../../src/types";

const app = new Empire({
    host: "localhost",
    port: 8003,
});

const timingMiddleware: Middleware = async (ctx, next) => {
    const startedAt = Date.now();

    await next();

    const elapsed = Date.now() - startedAt;

    console.log(`Request completed in ${elapsed}ms`);
};

app.use(LoggerMiddleware);
app.use(AuthMiddleware);
app.use(timingMiddleware);

app.get("/", (ctx) => {
    ctx.json({
        message: "All middleware passed",
    });
});

app.get("/slow", async (ctx) => {
    await new Promise((resolve) => setTimeout(resolve, 200));

    ctx.json({
        message: "Slow route — check timing middleware output",
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
