import { describe, it, expect, afterEach } from "vitest";
import { Empire } from "../../src/Empire";
import { TestLogger } from "../fixtures/services/TestLogger";

/**
 * Coverage added alongside the FINDING 10 route-param decoding fix.
 *
 * RouteMatcher.match() now calls decodeURIComponent() on each request path
 * segment, and Context.path does the same on url.pathname. Both throw a
 * URIError for a malformed percent-encoded sequence (e.g. "%zz" — "zz" isn't
 * valid hex). Router.handle() has no try/catch of its own around matching —
 * Empire's pipeline-level error handling (added for FINDING 3) is what
 * stands between a malformed request path and a hung connection. This
 * confirms that safety net actually covers the new decode calls end to end,
 * over a real socket, rather than assuming it does.
 */
describe("Malformed request path", () => {

    let app: Empire | undefined;
    let port = 43500;

    afterEach(async () => {
        await app?.stop();
        app = undefined;
    });

    function makeApp(): Empire {
        port += 1;
        app = new Empire({ host: "127.0.0.1", port, logger: new TestLogger() });
        return app;
    }

    it("returns 500 instead of hanging when a request path has malformed percent-encoding", async () => {
        const a = makeApp();
        a.get("/users/:name", (ctx) => ctx.json({ name: ctx.params.name }));

        await a.start();
        const res = await fetch(`http://127.0.0.1:${port}/users/%zz`);

        expect(res.status).toBe(500);
    });

    it("returns 404, not 500, when no route is registered to trigger a decode attempt", async () => {
        const a = makeApp();
        // No routes at all — Router.handle()'s match loop never runs, so
        // RouteMatcher.match() is never called and never attempts to decode.
        // (Verified separately: decodeURIComponent() runs unconditionally on
        // every request segment before the segment-count comparison, so a
        // *registered* route of any shape would still throw on this path —
        // it's the absence of any route to check, not a shape mismatch,
        // that avoids it here.)
        await a.start();
        const res = await fetch(`http://127.0.0.1:${port}/other/%zz`);

        expect(res.status).toBe(404);
    });
});
