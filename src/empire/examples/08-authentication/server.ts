/**
 * 08 - Authentication
 *
 * Demonstrates writing your own authentication middleware for Empire:
 * - Reading and parsing the Authorization header (Bearer scheme)
 * - Rejecting with HttpError(401), so the response goes through Empire's
 *   normal error pipeline instead of being written by hand
 * - Setting WWW-Authenticate on a 401, which most homegrown auth skips
 * - Handing an authenticated identity to route handlers via ctx.state
 * - Working around the lack of per-route middleware by having the
 *   middleware itself skip a list of public paths
 *
 * This is an example of how to write authentication middleware for
 * Empire, not an authentication system you should run as-is. The token
 * store below is hardcoded and the tokens are plain text, which stands
 * in for a real user store so this file stays short enough to read in
 * one sitting. A real implementation needs, at minimum, credentials
 * stored hashed rather than in plain text, token expiry, a real user
 * store, and constant-time comparison to avoid timing attacks. None of
 * that is here. What is worth copying is the shape: where the middleware
 * sits in the pipeline, how it rejects, and how it hands the
 * authenticated user to route handlers. The token checking logic itself
 * is deliberately trivial and is not the point.
 *
 * Run: npx tsx examples/08-authentication/server.ts
 * Open: http://localhost:8008
 *
 * Try it:
 *   curl http://localhost:8008/public                                    # 200, no auth needed
 *   curl http://localhost:8008/protected                                 # 401, no header
 *   curl -H "Authorization: Bearer alice-token" \
 *     http://localhost:8008/protected                                    # 200, active user
 *   curl -H "Authorization: Bearer bob-token" \
 *     http://localhost:8008/protected                                    # 401, known token, disabled account
 *   curl -H "Authorization: Bearer nonsense-token" \
 *     http://localhost:8008/protected                                    # 401, unknown token
 */

import process from "process";
import { Empire } from "../../src/Empire";
import { Context } from "../../src/http/Context";
import { HttpError } from "../../src/errors/HttpError";
import { Middleware } from "../../src/types";

interface DemoUser {
    id: string;
    name: string;
    active: boolean;
}

// Hardcoded plaintext tokens. See the warning at the top of this file:
// this stands in for a real user store so the example stays readable.
const FAKE_TOKENS: Record<string, DemoUser> = {
    "alice-token": { id: "1", name: "Alice", active: true },
    "bob-token": { id: "2", name: "Bob", active: false },
};

const PUBLIC_PATHS = ["/public"];

function unauthorized(ctx: Context): never {
    ctx.res.setHeader("WWW-Authenticate", "Bearer");
    throw new HttpError(401, "Invalid or missing credentials");
}

const authMiddleware: Middleware = (ctx, next) => {

    // Empire does not yet support per-route middleware, so this is how a
    // path gets excluded from an app.use() middleware that otherwise runs
    // for every request. A real framework would let you scope this to a
    // route group instead. This uses ctx.path rather than ctx.req.url so
    // it agrees with what the rest of the app sees as "the path" - the
    // tradeoff is that ctx.path calls decodeURIComponent internally, so a
    // malformed percent sequence here throws BadRequestError before any
    // auth logic runs, rather than being treated as just another path
    // that fails the public-paths check.
    if (PUBLIC_PATHS.includes(ctx.path)) {
        return next();
    }

    // Node lowercases every incoming header name, so
    // ctx.headers["Authorization"] would silently always be undefined.
    const header = ctx.headers.authorization;

    // A duplicated header yields an array rather than a string.
    if (typeof header !== "string") {
        unauthorized(ctx);
    }

    // RFC 9110 defines the auth scheme as case-insensitive, so "bearer",
    // "Bearer" and "BEARER" are all valid. Split on the first space only,
    // rather than on all whitespace, so a token is never assumed to be
    // exactly one word.
    const spaceIndex = header.indexOf(" ");
    const scheme = spaceIndex === -1 ? header : header.slice(0, spaceIndex);
    const token = spaceIndex === -1 ? "" : header.slice(spaceIndex + 1);

    if (scheme.toLowerCase() !== "bearer" || !token) {
        unauthorized(ctx);
    }

    const user = FAKE_TOKENS[token];

    // A token that is simply not in the store, and a token that belongs
    // to a real but disabled user, are different situations server-side
    // but must produce an identical response. Telling a caller "that
    // account is disabled" instead of a generic rejection confirms the
    // token was real, which is exactly what an attacker probing tokens
    // would want to know. This is also why the store needs a case like
    // Bob at all: with only one valid token and one junk string, it would
    // be easy to conclude authentication is just a map lookup, when the
    // real point is that the application decides what "valid" means.
    if (!user || !user.active) {
        unauthorized(ctx);
    }

    // Throwing HttpError here, rather than writing the response by hand,
    // means this 401 goes through the exact same pipeline as every other
    // error Empire produces - same JSON shape, same status handling.
    ctx.state.user = user;

    return next();
};

function isDemoUser(value: unknown): value is DemoUser {
    return typeof value === "object"
        && value !== null
        && "id" in value
        && "name" in value
        && "active" in value;
}

const app = new Empire({
    host: "localhost",
    port: 8008,
});

app.use(authMiddleware);

// Not covered by auth in practice - authMiddleware skips PUBLIC_PATHS
// before it ever checks a header. This route exists to prove that
// unauthenticated requests still work where auth was not applied.
app.get("/public", (ctx) => {
    ctx.json({ message: "This route does not require authentication." });
});

app.get("/protected", (ctx) => {
    const user = ctx.state.user;

    // A cast with "as" would compile even if ctx.state.user were the
    // wrong shape, or missing entirely - authMiddleware runs on this
    // path, so this should never actually fail, but the type system has
    // no way to know that, and the check is what keeps it honest.
    if (!isDemoUser(user)) {
        throw new HttpError(500, "Expected an authenticated user on ctx.state");
    }

    ctx.json({ message: `Hello, ${user.name}. This is protected data.` });
});

// The clearest demonstration of the handoff: authMiddleware resolved an
// identity earlier in the pipeline, and this completely separate
// function consumes it, by name, with no coupling between the two beyond
// ctx.state.
app.get("/me", (ctx) => {
    const user = ctx.state.user;

    if (!isDemoUser(user)) {
        throw new HttpError(500, "Expected an authenticated user on ctx.state");
    }

    ctx.json(user);
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
