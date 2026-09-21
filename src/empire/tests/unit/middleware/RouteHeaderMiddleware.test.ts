import { describe, it, expect, afterEach } from "vitest";
import { createRouteHeaderMiddleware, ROUTE_HEADER } from "../../../src/middleware/RouteHeaderMiddleware";
import { startEmpire, RunningServer } from "../../fixtures/http/TestServers";

/**
 * Uses a real Empire and real sockets: the whole point of this middleware
 * is hooking Node's real writeHead, which a mock response cannot exercise.
 */
describe("createRouteHeaderMiddleware", () => {

    let server: RunningServer | undefined;

    afterEach(async () => {
        await server?.stop();
        server = undefined;
    });

    async function run(configure: Parameters<typeof startEmpire>[0]): Promise<RunningServer> {
        server = await startEmpire((app) => {
            app.use(createRouteHeaderMiddleware());
            configure(app);
        });

        return server;
    }

    it("adds the matched route template as X-Empire-Route", async () => {
        const { url } = await run((app) => app.get("/users/:id", (ctx) => ctx.json({ id: ctx.params.id })));

        const response = await fetch(`${url}/users/42`);

        expect(response.status).toBe(200);
        expect(response.headers.get(ROUTE_HEADER)).toBe("/users/:id");
    });

    it("uses the header name the balancer reads", () => {
        expect(ROUTE_HEADER).toBe("X-Empire-Route");
    });

    it("is absent on a 404, where no route matched", async () => {
        const { url } = await run((app) => app.get("/users/:id", (ctx) => ctx.json({})));

        const response = await fetch(`${url}/nothing`);

        expect(response.status).toBe(404);
        expect(response.headers.has(ROUTE_HEADER)).toBe(false);
    });

    it("is absent on a 405, where the path matched but the method did not", async () => {
        const { url } = await run((app) => app.get("/users/:id", (ctx) => ctx.json({})));

        const response = await fetch(`${url}/users/1`, { method: "DELETE" });

        expect(response.status).toBe(405);
        expect(response.headers.has(ROUTE_HEADER)).toBe(false);
    });

    it("works when the handler writes headers itself with writeHead", async () => {
        const { url } = await run((app) => app.get("/raw/:x", (ctx) => {
            ctx.res.writeHead(201, { "Content-Type": "text/plain", "X-Custom": "yes" });
            ctx.res.end("made");
        }));

        const response = await fetch(`${url}/raw/1`);

        expect(response.status).toBe(201);
        expect(response.headers.get(ROUTE_HEADER)).toBe("/raw/:x");
        expect(response.headers.get("x-custom")).toBe("yes");
        expect(await response.text()).toBe("made");
    });

    it("works when the handler streams and flushes headers before finishing", async () => {
        const { url } = await run((app) => app.get("/stream/:x", (ctx) => {
            ctx.res.write("first ");
            ctx.res.end("second");
        }));

        const response = await fetch(`${url}/stream/1`);

        expect(response.headers.get(ROUTE_HEADER)).toBe("/stream/:x");
        expect(await response.text()).toBe("first second");
    });

    it("is present on an error response from a matched route", async () => {
        const { url } = await run((app) => app.get("/boom/:x", () => { throw new Error("nope"); }));

        const response = await fetch(`${url}/boom/1`);

        expect(response.status).toBe(500);
        expect(response.headers.get(ROUTE_HEADER)).toBe("/boom/:x");
    });

    it("reports the GET template for a HEAD request", async () => {
        const { url } = await run((app) => app.get("/users/:id", (ctx) => ctx.json({})));

        const response = await fetch(`${url}/users/1`, { method: "HEAD" });

        expect(response.headers.get(ROUTE_HEADER)).toBe("/users/:id");
    });

    it("does not break the response when the route contains a character a header cannot carry", async () => {
        const { url } = await run((app) => app.get("/emoji-\u{1F600}", (ctx) => ctx.json({ ok: true })));

        const response = await fetch(`${url}/emoji-%F0%9F%98%80`);

        expect(response.status).toBe(200);
        expect(response.headers.has(ROUTE_HEADER)).toBe(false);
        expect(await response.json()).toEqual({ ok: true });
    });

    it("leaves responses untouched when the middleware is not registered", async () => {
        server = await startEmpire((app) => app.get("/users/:id", (ctx) => ctx.json({})));

        const response = await fetch(`${server.url}/users/1`);

        expect(response.headers.has(ROUTE_HEADER)).toBe(false);
    });
});
