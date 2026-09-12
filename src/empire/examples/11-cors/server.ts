/**
 * 11 - CORS
 *
 * Demonstrates createCorsMiddleware() (src/middleware/CorsMiddleware.ts),
 * wrapping requests the same way createLoggerMiddleware(logger) does - no
 * changes to Router or Context needed to add this. See
 * doc/features/CORS.md for the full design.
 *
 * - A cross-origin GET only gets a readable response because
 *   Access-Control-Allow-Origin is set for the configured origin
 * - A cross-origin POST with a JSON body and an Authorization header
 *   triggers a real preflight, since neither header is on CORS's "simple
 *   request" safelist - allowedHeaders must explicitly list both or the
 *   browser refuses to send them
 * - credentials: true echoes back the specific requesting Origin, never
 *   "*", and sets Access-Control-Allow-Credentials
 * - /admin/* uses a separate, stricter policy (a different allowed
 *   origin, no credentials) via the multi-policy form - §2.6
 *
 * Run: npx tsx examples/11-cors/server.ts
 * Open: http://localhost:8011
 *
 * Try it (curl doesn't enforce CORS itself, but shows the exact headers
 * a browser would act on):
 *   curl -i http://localhost:8011/api/data \
 *     -H "Origin: http://localhost:5173"                          # 200, Access-Control-Allow-Origin echoed
 *   curl -i http://localhost:8011/api/data \
 *     -H "Origin: http://evil.example"                            # 200, but no Access-Control-Allow-Origin - a real browser would block reading it
 *   curl -i -X OPTIONS http://localhost:8011/api/orders \
 *     -H "Origin: http://localhost:5173" \
 *     -H "Access-Control-Request-Method: POST" \
 *     -H "Access-Control-Request-Headers: authorization, content-type" # 204 preflight, Allow-Headers lists both
 *   curl -i http://localhost:8011/admin/stats \
 *     -H "Origin: http://localhost:5173"                          # 200, but no Allow-Origin - only https://admin.example.com is permitted here
 */

import process from "process";
import { Empire } from "../../src/Empire";
import { createCorsMiddleware } from "../../src/middleware/CorsMiddleware";

const app = new Empire({
    host: "localhost",
    port: 8011,
});

app.use(createCorsMiddleware({
    policies: [
        {
            match: (path) => path.startsWith("/admin"),
            options: {
                origin: ["https://admin.example.com"],
            },
        },
        {
            match: (path) => path.startsWith("/api"),
            options: {
                origin: ["http://localhost:5173"],
                credentials: true,
                allowedHeaders: ["Content-Type", "Authorization"],
                exposedHeaders: ["X-Request-Id"],
                maxAge: 600,
            },
        },
    ],
    // No fallback - a path matching neither policy (like "/") gets no
    // CORS headers at all, same as if this middleware weren't registered.
}));

app.get("/", (ctx) => {
    ctx.json({ status: "ok" });
});

app.get("/api/data", (ctx) => {
    ctx.header("X-Request-Id", "demo-request-id");
    ctx.json({ hello: "world" });
});

app.post("/api/orders", async (ctx) => {
    // Authorization is readable here because the preflight already
    // approved it - if allowedHeaders hadn't listed it, the browser
    // would have refused to send this request at all.
    const body = await ctx.jsonBody();
    ctx.status(201).json({ received: body });
});

app.get("/admin/stats", (ctx) => {
    ctx.json({ visits: 42 });
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
