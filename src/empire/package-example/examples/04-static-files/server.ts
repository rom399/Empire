/**
 * 04 - Static Files (package-example mirror)
 *
 * Same as Empire's examples/04-static-files, but importing from the
 * published "empire-ts" package instead of the framework's source tree.
 * Demonstrates static file serving with:
 * - app.useStaticFiles(root) pointing to the wwwroot directory, mounted
 *   at the URL root — no prefix, so wwwroot/about.html serves at /about.html
 * - app.useStaticFiles(root, { prefix }) mounting a second folder under
 *   a URL prefix — uploads/report.txt serves at /uploads/report.txt,
 *   letting two static folders coexist on the same server without
 *   colliding
 * - HTML pages that link to each other
 * - A CSS file demonstrating MIME type detection
 * - Files not found falling through to a 404 route
 *
 * Run: npx tsx examples/04-static-files/server.ts   (from package-example/)
 * Open: http://localhost:9004
 */

import process from "process";
import { Empire } from "empire-ts";

const app = new Empire({
    host: "localhost",
    port: 9004,
});

// No prefix — every request path is checked against wwwroot/ directly
app.useStaticFiles("./examples/04-static-files/wwwroot");

// Prefixed — only requests under /uploads are checked against this folder
app.useStaticFiles("./examples/04-static-files/uploads", { prefix: "/uploads" });

app.get("/health", (ctx) => {
    ctx.json({ status: "healthy" });
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
