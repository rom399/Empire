import { describe, it, expect, afterEach } from "vitest";
import { Empire } from "../../src/Empire";
import { TestLogger } from "../fixtures/services/TestLogger";

/**
 * Coverage added alongside the FINDING 10 route-param decoding fix, later
 * revised for the code review task list's Task 7.
 *
 * RouteMatcher.match() calls decodeURIComponent() on each request path
 * segment, and Context.path does the same on url.pathname. Both used to
 * throw a raw URIError for a malformed percent-encoded sequence (e.g. "%zz"
 * - "zz" isn't valid hex), which Empire's pipeline-level error handling
 * (added for FINDING 3) mapped to a generic 500. Worse, since the decode
 * only ran inside Router.handle()'s per-route matching loop, the same
 * malformed input 500'd when a route was registered but 404'd when none
 * was, purely because the loop body never ran in the second case.
 *
 * Router.handle() now calls assertValidEncoding(path) unconditionally,
 * before the matching loop runs at all, converting a malformed sequence
 * into a BadRequestError (400) regardless of how many routes are
 * registered. Context.path applies the same treatment for the same
 * malformed input reached through, e.g., a static file request rather
 * than a route.
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

    it("returns 400, not 500, when a request path has malformed percent-encoding", async () => {
        const a = makeApp();
        a.get("/users/:name", (ctx) => ctx.json({ name: ctx.params.name }));

        await a.start();
        const res = await fetch(`http://127.0.0.1:${port}/users/%zz`);

        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: "Malformed request path" });
    });

    it("returns 400, not 404, when no route is registered to match against", async () => {
        const a = makeApp();
        // No routes at all - this used to mean Router.handle()'s match
        // loop never ran, so nothing ever attempted to decode the path,
        // and the request 404'd instead of exposing the malformed input at
        // all. assertValidEncoding() now runs before the loop, so the
        // outcome no longer depends on whether any route exists to check.
        await a.start();
        const res = await fetch(`http://127.0.0.1:${port}/other/%zz`);

        expect(res.status).toBe(400);
    });
});
