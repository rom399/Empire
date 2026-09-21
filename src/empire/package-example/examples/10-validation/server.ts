/**
 * 10 - Validation (package-example mirror)
 *
 * Same as Empire's examples/10-validation, but importing from the
 * published "empire-ts" package instead of the framework's source tree.
 * Demonstrates schema-based validation via validate(), wrapping a handler
 * the same way createLoggerMiddleware(logger) wraps a middleware.
 *
 * validate() accepts any Standard Schema validator (https://standardschema.dev)
 * - Zod, Valibot, ArkType, or one you write yourself. Empire depends on none
 * of them, so this example writes its validators by hand with a small
 * helper (schemaFrom below) and runs with nothing extra installed. To use
 * Zod instead, see "Validation with Zod" in the README.
 *
 * - Body validation, with a typed, already-validated body in the handler
 * - Query validation, including string-to-number conversion (query values
 *   are always strings off the raw URL, so a validator must convert "2"
 *   to 2 itself - with Zod that is z.coerce.number(), here it is Number())
 * - Route param validation
 * - A validation failure throws ValidationError (a BadRequestError),
 *   which goes through Empire's existing error pipeline automatically -
 *   the response includes both a readable `error` string and a
 *   structured `details` array naming each failing field
 *
 * Run: npx tsx examples/10-validation/server.ts   (from package-example/)
 * Open: http://localhost:9010
 *
 * Try it:
 *   curl -X POST http://localhost:9010/users \
 *     -H "Content-Type: application/json" \
 *     -d '{"name":"Alice","email":"alice@example.com"}'          # 201, validated body
 *   curl -X POST http://localhost:9010/users \
 *     -H "Content-Type: application/json" \
 *     -d '{"name":"","email":"not-an-email"}'                    # 400, field-level details
 *   curl "http://localhost:9010/search?q=empire&page=2"          # 200, page is a real number
 *   curl "http://localhost:9010/search"                          # 400, q is required
 *   curl http://localhost:9010/records/42                        # 200, numeric id
 *   curl http://localhost:9010/records/abc                       # 400, id must be a positive integer
 */

import process from "process";
import { Empire, validate, StandardSchemaV1, StandardSchemaIssue } from "empire-ts";

const app = new Empire({
    host: "localhost",
    port: 9010,
});

/**
 * Turns a plain checking function into a Standard Schema validator: the
 * function returns either the typed value or the list of problems it found.
 * This is the whole interface validate() needs - a `~standard` property
 * holding a version, a vendor name and a validate function.
 */
function schemaFrom<T>(
    check: (input: Record<string, unknown>) => { value: T } | { issues: StandardSchemaIssue[] }
): StandardSchemaV1<unknown, T> {
    return {
        "~standard": {
            version: 1,
            vendor: "example",
            validate(value) {
                const input = typeof value === "object" && value !== null
                    ? (value as Record<string, unknown>)
                    : {};

                return check(input);
            },
        },
    };
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface CreateUser {
    name: string;
    email: string;
    age?: number;
}

const createUserSchema = schemaFrom<CreateUser>((input) => {
    const { name, email, age } = input;
    const issues: StandardSchemaIssue[] = [];

    if (typeof name !== "string" || name === "") {
        issues.push({ message: "name is required", path: ["name"] });
    }

    if (typeof email !== "string" || !EMAIL_PATTERN.test(email)) {
        issues.push({ message: "email must be a valid address", path: ["email"] });
    }

    if (age !== undefined && (typeof age !== "number" || !Number.isInteger(age) || age < 13)) {
        issues.push({ message: "must be a whole number of at least 13", path: ["age"] });
    }

    // The checks above are what make this cast safe.
    return issues.length > 0 ? { issues } : { value: { name, email, age } as CreateUser };
});

app.post("/users", validate({ body: createUserSchema })(async (ctx, { body }) => {
    // body: { name: string; email: string; age?: number } - already
    // validated, no casts, no manual checks.
    ctx.status(201).json({ id: "1", ...body });
}));

const searchQuerySchema = schemaFrom<{ q: string; page: number }>((input) => {
    const { q } = input;
    // "?page=2" arrives as the string "2" - Number() converts it, and a
    // missing page falls back to 1.
    const page = input.page === undefined ? 1 : Number(input.page);
    const issues: StandardSchemaIssue[] = [];

    if (typeof q !== "string" || q === "") {
        issues.push({ message: "q is required", path: ["q"] });
    }

    if (!Number.isInteger(page) || page < 1) {
        issues.push({ message: "page must be a whole number of 1 or more", path: ["page"] });
    }

    return issues.length > 0 ? { issues } : { value: { q, page } as { q: string; page: number } };
});

app.get("/search", validate({ query: searchQuerySchema })(async (ctx, { query }) => {
    // query.page is a real number, even though it arrived as the string
    // "2" in the URL - the validator converted it.
    ctx.json({
        query: query.q,
        page: query.page,
        pageIsNumber: typeof query.page === "number",
    });
}));

const recordParamsSchema = schemaFrom<{ id: number }>((input) => {
    const id = Number(input.id);

    return Number.isInteger(id) && id > 0
        ? { value: { id } }
        : { issues: [{ message: "id must be a positive integer", path: ["id"] }] };
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

void start();
