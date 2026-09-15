/**
 * 06 - React App (package-example mirror)
 *
 * Same as Empire's examples/06-react-app, but importing from the
 * published "empire-ts" package instead of the framework's source tree.
 * Demonstrates serving a real React application — with client-side routing
 * via React Router's BrowserRouter. React, ReactDOM, and React Router are
 * loaded from a CDN, and Babel Standalone transpiles the JSX in
 * dist/assets/main.jsx in the browser - no npm install and no build step.
 *
 * Uses useStaticFiles(root, { spaFallback: true }) so that:
 *
 * - "/"                -> serves dist/index.html directly (real file)
 * - "/about"           -> no static file, no route -> falls back to
 *                          dist/index.html, so React Router can render
 *                          the path itself once the page loads
 * - "/api/users"       -> matched by a registered route -> returns JSON,
 *                          NOT the SPA fallback, because routes are always
 *                          checked before the fallback runs
 * - "/assets/main.jsx" -> served directly (real file), not the fallback
 * - "/favicon.ico"     -> served directly (real file), not the fallback
 *
 * Run: npx tsx examples/06-react-app/server.ts   (from package-example/)
 * Open: http://localhost:9006
 */

import process from "process";
import { Empire } from "empire-ts";

const app = new Empire({
    host: "localhost",
    port: 9006,
});

// Serve the built React app, with SPA fallback for client-side routes
app.useStaticFiles("./examples/06-react-app/dist", { spaFallback: true });

// API routes are matched before the SPA fallback — this is a real 200,
// not the index.html shell
app.get("/api/users", (ctx) => {
    ctx.json({
        users: [
            { id: "1", name: "Alice" },
            { id: "2", name: "Bob" },
        ],
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

void start();
