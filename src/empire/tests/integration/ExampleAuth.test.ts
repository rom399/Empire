import { describe, it, expect, afterEach } from "vitest";
import { Empire } from "../../src/Empire";
import { HttpError } from "../../src/errors/HttpError";
import { Context } from "../../src/http/Context";
import { Middleware } from "../../src/types";
import { TestLogger } from "../fixtures/services/TestLogger";

/**
 * Mirrors authMiddleware in examples/08-authentication/server.ts exactly.
 * Not imported directly: that file calls app.start() unconditionally at
 * module scope, like every other example, so importing it for its
 * middleware would bind a real port as a side effect of loading the
 * module. Tests the middleware's actual HTTP-facing behaviour (status
 * codes, headers, response bodies) over a real socket throughout, rather
 * than mixing in MockHttp, since that is what every other file in this
 * directory does and this is exactly the kind of behaviour mocks get
 * wrong.
 */
interface DemoUser {
    id: string;
    name: string;
    active: boolean;
}

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

    if (PUBLIC_PATHS.includes(ctx.path)) {
        return next();
    }

    const header = ctx.headers.authorization;

    if (typeof header !== "string") {
        unauthorized(ctx);
    }

    const spaceIndex = header.indexOf(" ");
    const scheme = spaceIndex === -1 ? header : header.slice(0, spaceIndex);
    const token = spaceIndex === -1 ? "" : header.slice(spaceIndex + 1);

    if (scheme.toLowerCase() !== "bearer" || !token) {
        unauthorized(ctx);
    }

    const user = FAKE_TOKENS[token];

    if (!user || !user.active) {
        unauthorized(ctx);
    }

    ctx.state.user = user;

    return next();
};

describe("Example: authentication middleware", () => {

    let app: Empire | undefined;
    let port = 44000;

    afterEach(async () => {
        await app?.stop();
        app = undefined;
    });

    function makeApp(): Empire {
        port += 1;
        app = new Empire({ host: "127.0.0.1", port, logger: new TestLogger() });
        app.use(authMiddleware);
        app.get("/public", (ctx) => ctx.json({ ok: true }));
        app.get("/protected", (ctx) => ctx.json({ user: ctx.state.user }));
        return app;
    }

    it("returns 401 when the Authorization header is absent", async () => {
        const a = makeApp();
        await a.start();

        const res = await fetch(`http://127.0.0.1:${port}/protected`, {
            headers: { connection: "close" },
        });

        expect(res.status).toBe(401);
    });

    it("returns 401 when the header does not use the Bearer scheme", async () => {
        const a = makeApp();
        await a.start();

        const res = await fetch(`http://127.0.0.1:${port}/protected`, {
            headers: { authorization: "Basic alice-token", connection: "close" },
        });

        expect(res.status).toBe(401);
    });

    it("succeeds with a lowercase bearer scheme, proving case-insensitive matching", async () => {
        const a = makeApp();
        await a.start();

        const res = await fetch(`http://127.0.0.1:${port}/protected`, {
            headers: { authorization: "bearer alice-token", connection: "close" },
        });

        expect(res.status).toBe(200);
    });

    it("returns 401 for an unknown token", async () => {
        const a = makeApp();
        await a.start();

        const res = await fetch(`http://127.0.0.1:${port}/protected`, {
            headers: { authorization: "Bearer nonsense-token", connection: "close" },
        });

        expect(res.status).toBe(401);
    });

    it("returns 401 for a known token belonging to an inactive user", async () => {
        const a = makeApp();
        await a.start();

        const res = await fetch(`http://127.0.0.1:${port}/protected`, {
            headers: { authorization: "Bearer bob-token", connection: "close" },
        });

        expect(res.status).toBe(401);
    });

    it("sets WWW-Authenticate on a 401", async () => {
        const a = makeApp();
        await a.start();

        const res = await fetch(`http://127.0.0.1:${port}/protected`, {
            headers: { connection: "close" },
        });

        expect(res.headers.get("www-authenticate")).toBe("Bearer");
    });

    it("returns an identical rejection body for an unknown token and an inactive user", async () => {
        const a = makeApp();
        await a.start();

        const unknownRes = await fetch(`http://127.0.0.1:${port}/protected`, {
            headers: { authorization: "Bearer nonsense-token", connection: "close" },
        });
        const inactiveRes = await fetch(`http://127.0.0.1:${port}/protected`, {
            headers: { authorization: "Bearer bob-token", connection: "close" },
        });

        expect(await unknownRes.json()).toEqual(await inactiveRes.json());
    });

    it("reaches the handler with ctx.state.user set for a valid active token", async () => {
        const a = makeApp();
        await a.start();

        const res = await fetch(`http://127.0.0.1:${port}/protected`, {
            headers: { authorization: "Bearer alice-token", connection: "close" },
        });

        expect(await res.json()).toEqual({
            user: { id: "1", name: "Alice", active: true },
        });
    });

    it("succeeds on a public path with no Authorization header at all", async () => {
        const a = makeApp();
        await a.start();

        const res = await fetch(`http://127.0.0.1:${port}/public`, {
            headers: { connection: "close" },
        });

        expect(res.status).toBe(200);
    });
});
