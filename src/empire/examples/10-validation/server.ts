/**
 * 10 - Validation
 *
 * Demonstrates schema-based validation via validate() (src/validation/),
 * wrapping a handler the same way createLoggerMiddleware(logger) wraps a
 * middleware - no changes to Router or Context needed to add this.
 *
 * - Body validation, with a typed, already-validated body in the handler
 * - Query validation, including string-to-number coercion (query values
 *   are always strings off the raw URL - z.coerce.number() is required,
 *   z.number() alone will reject a well-formed "?page=2")
 * - Route param validation
 * - A validation failure throws ValidationError (a BadRequestError),
 *   which goes through Empire's existing error pipeline automatically -
 *   the response includes both a readable `error` string and a
 *   structured `details` array naming each failing field
 *
 * Run: npx tsx examples/10-validation/server.ts
 * Open: http://localhost:8010
 *
 * Try it:
 *   curl -X POST http://localhost:8010/users \
 *     -H "Content-Type: application/json" \
 *     -d '{"name":"Alice","email":"alice@example.com"}'          # 201, validated body
 *   curl -X POST http://localhost:8010/users \
 *     -H "Content-Type: application/json" \
 *     -d '{"name":"","email":"not-an-email"}'                    # 400, field-level details
 *   curl "http://localhost:8010/search?q=empire&page=2"          # 200, page is a real number
 *   curl "http://localhost:8010/search"                          # 400, q is required
 *   curl http://localhost:8010/records/42                        # 200, numeric id
 *   curl http://localhost:8010/records/abc                       # 400, id must be numeric
 */

import process from "process";
import { z } from "zod";
import { Empire } from "../../src/Empire";
import { validate } from "../../src/validation/validate";

const app = new Empire({
    host: "localhost",
    port: 8010,
});

const createUserSchema = z.object({
    name: z.string().min(1, "name is required"),
    email: z.string().email("email must be a valid address"),
    age: z.number().int().min(13, "must be at least 13").optional(),
});

app.post("/users", validate({ body: createUserSchema })(async (ctx, { body }) => {
    // body: { name: string; email: string; age?: number } - already
    // validated, no casts, no manual checks.
    ctx.status(201).json({ id: "1", ...body });
}));

const searchQuerySchema = z.object({
    q: z.string().min(1, "q is required"),
    page: z.coerce.number().int().min(1).default(1),
});

app.get("/search", validate({ query: searchQuerySchema })(async (ctx, { query }) => {
    // query.page is a real number, even though it arrived as the string
    // "2" in the URL - z.coerce.number() converts it during validation.
    ctx.json({
        query: query.q,
        page: query.page,
        pageIsNumber: typeof query.page === "number",
    });
}));

const recordParamsSchema = z.object({
    id: z.coerce.number().int().positive("id must be a positive integer"),
});

app.get("/records/:id", validate({ params: recordParamsSchema })(async (ctx, { params }) => {
    ctx.json({ id: params.id, idIsNumber: typeof params.id === "number" });
}));

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
