/**
 * 05 - Error Handling (package-example mirror)
 *
 * Same as Empire's examples/05-error-handling, but importing from the
 * published "empire-ts" package instead of the framework's source tree.
 * Demonstrates Empire's error handling with:
 * - Throwing HttpError from a route with a custom status code and message
 * - Throwing BadRequestError (a 400) for invalid input, such as a
 *   missing or malformed field in a request body - see
 *   examples/10-validation for schema-based validation with validate()
 * - Automatic 400 response when ctx.jsonBody() receives invalid JSON
 * - Automatic 500 response for unhandled errors
 * - Server continues running after exceptions
 *
 * Run: npx tsx examples/05-error-handling/server.ts   (from package-example/)
 * Open: http://localhost:9005
 */

import process from "process";
import { Empire, BadRequestError, HttpError } from "empire-ts";

const app = new Empire({
    host: "localhost",
    port: 9005,
});

app.get("/products/:id", (ctx) => {
    const validIds = ["1", "2", "3"];
    const id = ctx.params.id;

    if (!validIds.includes(id)) {
        throw new HttpError(404, `Product with id ${id} was not found`);
    }

    ctx.json({ id, name: `Product ${id}` });
});

app.get("/restricted", () => {
    throw new HttpError(403, "You do not have permission to access this resource");
});

app.post("/orders", async (ctx) => {
    const body = await ctx.jsonBody();

    if (typeof body !== "object" || body === null) {
        throw new BadRequestError("Request body must be a JSON object");
    }

    const { productId, quantity } = body as { productId?: unknown; quantity?: unknown };

    if (typeof productId !== "string" || productId === "") {
        throw new BadRequestError("productId is required");
    }

    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1) {
        throw new BadRequestError("quantity must be a positive number");
    }

    ctx.status(201).json({
        orderId: "ORD-001",
        productId,
        quantity,
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

void start();
