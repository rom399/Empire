import { describe, it, expect } from "vitest";
import { ServiceCollection } from "../../../src/di/ServiceCollection";
import { ServiceProvider } from "../../../src/di/ServiceProvider";
import { createToken } from "../../../src/di/ServiceToken";

describe("ServiceProvider", () => {

    it("is what ServiceCollection.build() returns", () => {
        const provider = new ServiceCollection().build();

        expect(provider).toBeInstanceOf(ServiceProvider);
    });

    describe("singleton", () => {

        it("returns the value built by the factory", async () => {
            const services = new ServiceCollection();
            const token = createToken<string>("Greeting");
            services.addSingleton(token, () => "hello");

            await expect(services.build().resolve(token)).resolves.toBe("hello");
        });

        it("returns the same instance on every resolution", async () => {
            const services = new ServiceCollection();
            const token = createToken<{ id: number }>("Thing");
            let calls = 0;
            services.addSingleton(token, () => ({ id: ++calls }));
            const provider = services.build();

            const first = await provider.resolve(token);
            const second = await provider.resolve(token);

            expect(first).toBe(second);
            expect(calls).toBe(1);
        });

        it("does not construct an async singleton twice under concurrent resolve() calls", async () => {
            const services = new ServiceCollection();
            const token = createToken<{ id: number }>("SlowThing");
            let calls = 0;
            services.addSingleton(token, async () => {
                await new Promise((resolve) => setTimeout(resolve, 10));
                return { id: ++calls };
            });
            const provider = services.build();

            const [first, second] = await Promise.all([
                provider.resolve(token),
                provider.resolve(token),
            ]);

            expect(first).toBe(second);
            expect(calls).toBe(1);
        });
    });

    describe("transient", () => {

        it("returns a new instance on every resolution", async () => {
            const services = new ServiceCollection();
            const token = createToken<{ id: number }>("Thing");
            let calls = 0;
            services.addTransient(token, () => ({ id: ++calls }));
            const provider = services.build();

            const first = await provider.resolve(token);
            const second = await provider.resolve(token);

            expect(first).not.toBe(second);
            expect(calls).toBe(2);
        });
    });

    describe("scoped", () => {

        it("rejects when resolved directly from the root provider", async () => {
            const services = new ServiceCollection();
            const token = createToken<string>("PerRequest");
            services.addScoped(token, () => "value");
            const provider = services.build();

            await expect(provider.resolve(token)).rejects.toThrow(/root provider/i);
        });
    });

    describe("missing registration", () => {

        it("rejects with a message naming the token", async () => {
            const services = new ServiceCollection();
            const token = createToken<string>("NeverRegistered");
            const provider = services.build();

            await expect(provider.resolve(token)).rejects.toThrow(/NeverRegistered/);
        });
    });

    describe("a factory that throws synchronously", () => {

        it("rejects rather than throwing out of resolve()", async () => {
            const services = new ServiceCollection();
            const token = createToken<string>("Broken");
            services.addSingleton(token, () => {
                throw new Error("construction failed");
            });
            const provider = services.build();

            // Must not throw during this expression's evaluation - resolve()
            // always returns a Promise, even when its factory doesn't.
            await expect(provider.resolve(token)).rejects.toThrow("construction failed");
        });
    });

    describe("circular dependencies", () => {

        it("rejects a service that depends on itself", async () => {
            const services = new ServiceCollection();
            const token = createToken<unknown>("SelfReferential");
            services.addSingleton(token, (resolver) => resolver.resolve(token));
            const provider = services.build();

            await expect(provider.resolve(token)).rejects.toThrow(/circular dependency/i);
        });

        it("rejects an indirect cycle across two services", async () => {
            const services = new ServiceCollection();
            const tokenA = createToken<unknown>("A");
            const tokenB = createToken<unknown>("B");
            services.addSingleton(tokenA, (resolver) => resolver.resolve(tokenB));
            services.addSingleton(tokenB, (resolver) => resolver.resolve(tokenA));
            const provider = services.build();

            await expect(provider.resolve(tokenA)).rejects.toThrow(/circular dependency/i);
        });

        it("does not false-positive across two concurrent, unrelated resolve() calls", async () => {
            const services = new ServiceCollection();
            const tokenX = createToken<string>("X");
            const tokenY = createToken<string>("Y");
            services.addSingleton(tokenX, async () => {
                await new Promise((resolve) => setTimeout(resolve, 10));
                return "x";
            });
            services.addSingleton(tokenY, async (resolver) => `y depends on ${await resolver.resolve(tokenX)}`);
            const provider = services.build();

            // resolve(Y) resolves X internally while resolve(X) is also
            // running as its own top-level call - a shared resolution
            // stack could misread this as X reappearing in Y's path.
            const [x, y] = await Promise.all([
                provider.resolve(tokenX),
                provider.resolve(tokenY),
            ]);

            expect(x).toBe("x");
            expect(y).toBe("y depends on x");
        });
    });

    describe("dispose", () => {

        it("disposes a constructed singleton", async () => {
            const services = new ServiceCollection();
            const token = createToken<{ dispose(): void }>("Connection");
            let disposed = false;
            services.addSingleton(token, () => ({ dispose: () => { disposed = true; } }));
            const provider = services.build();

            await provider.resolve(token);
            await provider.dispose();

            expect(disposed).toBe(true);
        });

        it("does not throw when a singleton has no dispose method", async () => {
            const services = new ServiceCollection();
            const token = createToken<{ value: number }>("PlainValue");
            services.addSingleton(token, () => ({ value: 42 }));
            const provider = services.build();

            await provider.resolve(token);

            await expect(provider.dispose()).resolves.toBeUndefined();
        });

        it("does not call dispose() a second time if dispose() is called twice", async () => {
            const services = new ServiceCollection();
            const token = createToken<{ dispose(): void }>("Connection");
            let disposeCalls = 0;
            services.addSingleton(token, () => ({ dispose: () => { disposeCalls += 1; } }));
            const provider = services.build();

            await provider.resolve(token);
            await provider.dispose();
            await provider.dispose();

            expect(disposeCalls).toBe(1);
        });

        it("disposes singletons in reverse construction order", async () => {
            const services = new ServiceCollection();
            const order: string[] = [];
            const firstToken = createToken<{ dispose(): void }>("First");
            const secondToken = createToken<{ dispose(): void }>("Second");
            services.addSingleton(firstToken, () => ({ dispose: () => { order.push("first"); } }));
            services.addSingleton(secondToken, () => ({ dispose: () => { order.push("second"); } }));
            const provider = services.build();

            await provider.resolve(firstToken);
            await provider.resolve(secondToken);
            await provider.dispose();

            expect(order).toEqual(["second", "first"]);
        });

        it("continues disposing remaining singletons even if one dispose() throws", async () => {
            // dispose() deliberately logs via console.error when a
            // disposable's own dispose() throws - stub it so this
            // intentional failure path doesn't print to real test output.
            const originalError = console.error;
            console.error = () => {};

            try {
                const services = new ServiceCollection();
                const order: string[] = [];
                const brokenToken = createToken<{ dispose(): void }>("Broken");
                const healthyToken = createToken<{ dispose(): void }>("Healthy");
                services.addSingleton(brokenToken, () => ({
                    dispose: () => { throw new Error("dispose failed"); },
                }));
                services.addSingleton(healthyToken, () => ({ dispose: () => { order.push("healthy"); } }));
                const provider = services.build();

                await provider.resolve(brokenToken);
                await provider.resolve(healthyToken);

                await expect(provider.dispose()).resolves.toBeUndefined();
                expect(order).toEqual(["healthy"]);
            } finally {
                console.error = originalError;
            }
        });

        it("does not re-throw when a singleton had failed to construct", async () => {
            const services = new ServiceCollection();
            const order: string[] = [];
            const brokenToken = createToken<unknown>("NeverBuilt");
            const healthyToken = createToken<{ dispose(): void }>("Healthy");
            services.addSingleton(brokenToken, () => {
                throw new Error("construction failed");
            });
            services.addSingleton(healthyToken, () => ({ dispose: () => { order.push("healthy"); } }));
            const provider = services.build();

            await expect(provider.resolve(brokenToken)).rejects.toThrow("construction failed");
            await provider.resolve(healthyToken);

            await expect(provider.dispose()).resolves.toBeUndefined();
            expect(order).toEqual(["healthy"]);
        });

        it("does not dispose a transient instance, since the provider never tracks it", async () => {
            const services = new ServiceCollection();
            const token = createToken<{ dispose(): void }>("Handle");
            let disposed = false;
            services.addTransient(token, () => ({ dispose: () => { disposed = true; } }));
            const provider = services.build();

            await provider.resolve(token);
            await provider.dispose();

            expect(disposed).toBe(false);
        });
    });
});
