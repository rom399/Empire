/**
 * Basic server - consuming the published empire-ts package.
 *
 * Unlike Empire's own examples/ (which import the framework's source
 * directly, via "../../src/Empire"), this file imports only from the
 * package name, "empire-ts" - exactly what installing it from npm gives
 * you. Everything here comes from the single barrel export at
 * dist/index.js; there's no reaching into internal files.
 *
 * Run: npx tsx basic-server.ts   (from this directory, after npm install)
 * Open: http://localhost:9001
 */

import process from "process";
import { Empire, ConsoleLogger } from "empire-ts";

const app = new Empire({
    host: "localhost",
    port: 9001,
    logger: new ConsoleLogger(),
});

app.get("/", (ctx) => {
    ctx.html(`
        <!DOCTYPE html>
        <html>
            <head>
                <title>empire-ts</title>
            </head>
            <body>
                <h1>Hello from empire-ts</h1>
                <p>This server is running entirely off the published npm package.</p>
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
