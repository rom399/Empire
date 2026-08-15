/**
 * 07 - Request Body Size Limit
 *
 * Demonstrates Empire's configurable request body size limit:
 * - EmpireOptions.maxBodySize overrides the 1MB default (in bytes)
 * - A request body over the limit is rejected with 413 as soon as the
 *   limit is crossed, instead of being buffered fully into memory first
 * - Requests within the limit are handled normally
 *
 * Run: npx tsx examples/07-body-size-limit/server.ts
 * Open: http://localhost:8007
 *
 * Try it:
 *   curl -X POST http://localhost:8007/echo -d "short body"                     # 200
 *   node -e "process.stdout.write('x'.repeat(2000))" | \
 *     curl -X POST --data-binary @- http://localhost:8007/echo                  # 413
 */

import process from "process";
import { Empire } from "../../src/Empire";

const app = new Empire({
    host: "localhost",
    port: 8007,
    maxBodySize: 1024, // 1 KB — deliberately small so the limit is easy to trigger
});

app.post("/echo", async (ctx) => {
    const body = await ctx.body();

    ctx.json({
        receivedBytes: Buffer.byteLength(body),
        body,
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
