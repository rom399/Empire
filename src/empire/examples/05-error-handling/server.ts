/**
 * 05 - Error Handling
 *
 * Demonstrates Empire's error handling with:
 * - Throwing HttpError from a route with a custom status code and message
 * - Throwing BadRequestError for invalid input
 * - Automatic 400 response when ctx.jsonBody() receives invalid JSON
 * - Automatic 500 response for unhandled errors
 * - Server continues running after exceptions
 *
 * Run: npx tsx examples/05-error-handling/server.ts
 * Open: http://localhost:8005
 */

import process from "process";
import { Empire } from "../../src/Empire";
import { HttpError } from "../../src/errors/HttpError";
import { BadRequestError } from "../../src/errors/BadRequestError";

const app = new Empire({
    host: "localhost",
    port: 8005,
});

app.get("/products/:id", (ctx) => {
    const validIds = ["1", "2", "3"];
    const id = ctx.params.id;

    if (!validIds.includes(id)) {
        throw new HttpError(404, `Product with id ${id} was not found`);
    }

    ctx.json({ id, name: `Product ${id}` });
});

app.get("/restricted", (ctx) => {
    throw new HttpError(403, "You do not have permission to access this resource");
});

app.post("/orders", async (ctx) => {
    const body = await ctx.jsonBody() as { productId: string; quantity: number };

    if (!body.productId) {
        throw new BadRequestError("productId is required");
    }

    if (!body.quantity || body.quantity < 1) {
        throw new BadRequestError("quantity must be a positive number");
    }

    ctx.status(201).json({
        orderId: "ORD-001",
        productId: body.productId,
        quantity: body.quantity,
    });
});

app.get("/crash", () => {
    throw new Error("Unexpected error — server should survive this and return 500");
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
