import { describe, it, expect, afterEach } from "vitest";
import { Empire } from "../../src/Empire";
import { ServiceCollection } from "../../src/di/ServiceCollection";
import { createToken } from "../../src/di/ServiceToken";
import { TestLogger } from "../fixtures/services/TestLogger";

/**
 * DI-6 — a ServiceScope is created per request, exposed as ctx.services,
 * and disposed once the response ends. Covers the actual wiring in
 * Empire.handleRequest(), not just the DI container in isolation.
 */
describe("Dependency injection over a real request", () => {

    let app: Empire | undefined;
    let port = 44100;

    afterEach(async () => {
        await app?.stop();
        app = undefined;
    });

    it("resolves a registered service inside a route handler", async () => {
        port += 1;
        const services = new ServiceCollection();
        const greetingToken = createToken<string>("Greeting");
        services.addSingleton(greetingToken, () => "hello from DI");
        const provider = services.build();

        app = new Empire({ host: "127.0.0.1", port, logger: new TestLogger(), services: provider });
        app.get("/greeting", async (ctx) => {
            const greeting = await ctx.services?.resolve(greetingToken);
            ctx.json({ greeting });
        });

        await app.start();
        const body = await (await fetch(`http://127.0.0.1:${port}/greeting`)).json();

        expect(body).toEqual({ greeting: "hello from DI" });
    });

    it("shares the same singleton instance across two separate requests", async () => {
        port += 1;
        const services = new ServiceCollection();
        const counterToken = createToken<{ id: number }>("Counter");
        let constructions = 0;
        services.addSingleton(counterToken, () => ({ id: ++constructions }));
        const provider = services.build();

        app = new Empire({ host: "127.0.0.1", port, logger: new TestLogger(), services: provider });
        app.get("/id", async (ctx) => {
            const counter = await ctx.services?.resolve(counterToken);
            ctx.json({ id: counter?.id });
        });

        await app.start();
        const first = await (await fetch(`http://127.0.0.1:${port}/id`)).json();
        const second = await (await fetch(`http://127.0.0.1:${port}/id`)).json();

        expect(first).toEqual({ id: 1 });
        expect(second).toEqual({ id: 1 });
        expect(constructions).toBe(1);
    });

    it("gives each request a different scoped instance", async () => {
        port += 1;
        const services = new ServiceCollection();
        const requestIdToken = createToken<{ id: number }>("RequestId");
        let constructions = 0;
        services.addScoped(requestIdToken, () => ({ id: ++constructions }));
        const provider = services.build();

        app = new Empire({ host: "127.0.0.1", port, logger: new TestLogger(), services: provider });
        app.get("/id", async (ctx) => {
            const requestId = await ctx.services?.resolve(requestIdToken);
            ctx.json({ id: requestId?.id });
        });

        await app.start();
        const first = await (await fetch(`http://127.0.0.1:${port}/id`)).json();
        const second = await (await fetch(`http://127.0.0.1:${port}/id`)).json();

        expect(first).toEqual({ id: 1 });
        expect(second).toEqual({ id: 2 });
        expect(constructions).toBe(2);
    });

    it("reuses the same scoped instance for two resolutions within one request", async () => {
        port += 1;
        const services = new ServiceCollection();
        const requestIdToken = createToken<{ id: number }>("RequestId");
        let constructions = 0;
        services.addScoped(requestIdToken, () => ({ id: ++constructions }));
        const provider = services.build();

        app = new Empire({ host: "127.0.0.1", port, logger: new TestLogger(), services: provider });
        app.get("/id", async (ctx) => {
            const first = await ctx.services?.resolve(requestIdToken);
            const second = await ctx.services?.resolve(requestIdToken);
            ctx.json({ same: first === second });
        });

        await app.start();
        const body = await (await fetch(`http://127.0.0.1:${port}/id`)).json();

        expect(body).toEqual({ same: true });
        expect(constructions).toBe(1);
    });

    it("disposes the request's scoped service once the response finishes", async () => {
        port += 1;
        const services = new ServiceCollection();
        const connectionToken = createToken<{ dispose(): void }>("Connection");
        let disposed = false;
        services.addScoped(connectionToken, () => ({ dispose: () => { disposed = true; } }));
        const provider = services.build();

        app = new Empire({ host: "127.0.0.1", port, logger: new TestLogger(), services: provider });
        app.get("/probe", async (ctx) => {
            await ctx.services?.resolve(connectionToken);
            expect(disposed).toBe(false); // not disposed until the response ends
            ctx.json({ ok: true });
        });

        await app.start();
        await fetch(`http://127.0.0.1:${port}/probe`);

        // dispose() runs off a "finish"/"close" listener, not awaited by
        // the handler itself - give the event loop a tick to run it.
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(disposed).toBe(true);
    });

    it("leaves ctx.services undefined when the app was built without a ServiceProvider", async () => {
        port += 1;
        app = new Empire({ host: "127.0.0.1", port, logger: new TestLogger() });
        app.get("/probe", (ctx) => {
            ctx.json({ hasServices: ctx.services !== undefined });
        });

        await app.start();
        const body = await (await fetch(`http://127.0.0.1:${port}/probe`)).json();

        expect(body).toEqual({ hasServices: false });
    });
});
