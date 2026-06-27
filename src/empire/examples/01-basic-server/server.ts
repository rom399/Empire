/**
 * 01 - Basic Server
 *
 * Demonstrates how to create and start an Empire server with:
 * - ConsoleLogger injected via EmpireOptions
 * - A basic GET route returning an HTML response
 * - A basic POST route returning a JSON response
 * - Graceful shutdown on SIGINT
 *
 * Run: npx tsx examples/01-basic-server/server.ts
 * Open: http://localhost:8001
 */

import process from "process";
import { Empire } from "../../src/Empire";
import { ConsoleLogger } from "../../src/logging/ConsoleLogger";

const app = new Empire({
    host: "localhost",
    port: 8001,
    logger: new ConsoleLogger(),
});

app.get("/", (ctx) => {
    ctx.html(`
        <!DOCTYPE html>
        <html>
            <head>
                <title>Empire</title>
            </head>
            <body>
                <h1>Welcome to Empire</h1>
                <p>A lightweight TypeScript web framework.</p>
            </body>
        </html>
    `);
});

app.get("/health", (ctx) => {
    ctx.json({
        status: "healthy",
        timestamp: new Date().toISOString(),
    });
});

app.post("/echo", async (ctx) => {
    const body = await ctx.jsonBody();

    ctx.json({
        received: body,
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
