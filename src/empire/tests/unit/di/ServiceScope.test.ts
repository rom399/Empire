import { describe, it, expect } from "vitest";
import { ServiceCollection } from "../../../src/di/ServiceCollection";
import { ServiceScope } from "../../../src/di/ServiceScope";
import { createToken } from "../../../src/di/ServiceToken";

describe("ServiceScope", () => {

    it("is what ServiceProvider.createScope() returns", () => {
        const scope = new ServiceCollection().build().createScope();

        expect(scope).toBeInstanceOf(ServiceScope);
    });

    describe("scoped", () => {

        it("returns the same instance within one scope", async () => {
            const services = new ServiceCollection();
            const token = createToken<{ id: number }>("PerRequest");
            let calls = 0;
            services.addScoped(token, () => ({ id: ++calls }));
            const provider = services.build();
            const scope = provider.createScope();

            const first = await scope.resolve(token);
            const second = await scope.resolve(token);

            expect(first).toBe(second);
            expect(calls).toBe(1);
        });

        it("returns a different instance across two separate scopes", async () => {
            const services = new ServiceCollection();
            const token = createToken<{ id: number }>("PerRequest");
            let calls = 0;
            services.addScoped(token, () => ({ id: ++calls }));
            const provider = services.build();

            const first = await provider.createScope().resolve(token);
            const second = await provider.createScope().resolve(token);

            expect(first).not.toBe(second);
            expect(calls).toBe(2);
        });

        it("does not construct an async scoped service twice under concurrent resolve() calls", async () => {
            const services = new ServiceCollection();
            const token = createToken<{ id: number }>("SlowPerRequest");
            let calls = 0;
            services.addScoped(token, async () => {
                await new Promise((resolve) => setTimeout(resolve, 10));
                return { id: ++calls };
            });
            const scope = services.build().createScope();

            const [first, second] = await Promise.all([
                scope.resolve(token),
                scope.resolve(token),
            ]);

            expect(first).toBe(second);
            expect(calls).toBe(1);
        });
    });

    describe("transient", () => {

        it("returns a new instance on every resolution, even within the same scope", async () => {
            const services = new ServiceCollection();
            const token = createToken<{ id: number }>("Thing");
            let calls = 0;
            services.addTransient(token, () => ({ id: ++calls }));
            const scope = services.build().createScope();

            const first = await scope.resolve(token);
            const second = await scope.resolve(token);

            expect(first).not.toBe(second);
            expect(calls).toBe(2);
        });
    });

    describe("singleton", () => {

        it("shares the same instance between two different scopes and the root provider", async () => {
            const services = new ServiceCollection();
            const token = createToken<{ id: number }>("Shared");
            let calls = 0;
            services.addSingleton(token, () => ({ id: ++calls }));
            const provider = services.build();

            const fromRoot = await provider.resolve(token);
            const fromScopeA = await provider.createScope().resolve(token);
            const fromScopeB = await provider.createScope().resolve(token);

            expect(fromScopeA).toBe(fromRoot);
            expect(fromScopeB).toBe(fromRoot);
            expect(calls).toBe(1);
        });
    });

    describe("missing registration", () => {

        it("rejects with a message naming the token", async () => {
            const scope = new ServiceCollection().build().createScope();
            const token = createToken<string>("NeverRegistered");

            await expect(scope.resolve(token)).rejects.toThrow(/NeverRegistered/);
        });
    });

    describe("a factory that throws synchronously", () => {

        it("rejects rather than throwing out of resolve() for a scoped service", async () => {
            const services = new ServiceCollection();
            const token = createToken<string>("Broken");
            services.addScoped(token, () => {
                throw new Error("construction failed");
            });
            const scope = services.build().createScope();

            await expect(scope.resolve(token)).rejects.toThrow("construction failed");
        });

        it("rejects rather than throwing out of resolve() for a transient service", async () => {
            const services = new ServiceCollection();
            const token = createToken<string>("Broken");
            services.addTransient(token, () => {
                throw new Error("construction failed");
            });
            const scope = services.build().createScope();

            await expect(scope.resolve(token)).rejects.toThrow("construction failed");
        });
    });

    describe("circular dependencies", () => {

        it("rejects two scoped services that depend on each other", async () => {
            const services = new ServiceCollection();
            const tokenA = createToken<unknown>("A");
            const tokenB = createToken<unknown>("B");
            services.addScoped(tokenA, (resolver) => resolver.resolve(tokenB));
            services.addScoped(tokenB, (resolver) => resolver.resolve(tokenA));
            const scope = services.build().createScope();

            await expect(scope.resolve(tokenA)).rejects.toThrow(/circular dependency/i);
        });

        it("rejects a cycle mixing a scoped and a transient service", async () => {
            const services = new ServiceCollection();
            const tokenA = createToken<unknown>("A");
            const tokenB = createToken<unknown>("B");
            services.addScoped(tokenA, (resolver) => resolver.resolve(tokenB));
            services.addTransient(tokenB, (resolver) => resolver.resolve(tokenA));
            const scope = services.build().createScope();

            await expect(scope.resolve(tokenA)).rejects.toThrow(/circular dependency/i);
        });

        it("does not falsely flag a singleton dependency as a cycle", async () => {
            const services = new ServiceCollection();
            const loggerToken = createToken<string>("Logger");
            const serviceToken = createToken<string>("Service");
            services.addSingleton(loggerToken, () => "logger");
            services.addScoped(serviceToken, async (resolver) => `service using ${await resolver.resolve(loggerToken)}`);
            const scope = services.build().createScope();

            await expect(scope.resolve(serviceToken)).resolves.toBe("service using logger");
        });
    });

    describe("relationship to the root provider", () => {

        it("can resolve a scoped token that the root provider rejects directly", async () => {
            const services = new ServiceCollection();
            const token = createToken<string>("PerRequest");
            services.addScoped(token, () => "value");
            const provider = services.build();

            await expect(provider.resolve(token)).rejects.toThrow(/root provider/i);
            await expect(provider.createScope().resolve(token)).resolves.toBe("value");
        });
    });

    describe("dispose", () => {

        it("disposes a scoped instance when the scope is disposed", async () => {
            const services = new ServiceCollection();
            const token = createToken<{ dispose(): void }>("Connection");
            let disposed = false;
            services.addScoped(token, () => ({ dispose: () => { disposed = true; } }));
            const scope = services.build().createScope();

            await scope.resolve(token);
            await scope.dispose();

            expect(disposed).toBe(true);
        });

        it("disposes a transient instance when the scope is disposed", async () => {
            const services = new ServiceCollection();
            const token = createToken<{ dispose(): void }>("Handle");
            let disposed = false;
            services.addTransient(token, () => ({ dispose: () => { disposed = true; } }));
            const scope = services.build().createScope();

            await scope.resolve(token);
            await scope.dispose();

            expect(disposed).toBe(true);
        });

        it("does not dispose a singleton resolved through the scope", async () => {
            const services = new ServiceCollection();
            const token = createToken<{ dispose(): void }>("Shared");
            let disposed = false;
            services.addSingleton(token, () => ({ dispose: () => { disposed = true; } }));
            const provider = services.build();
            const scope = provider.createScope();

            await scope.resolve(token);
            await scope.dispose();

            expect(disposed).toBe(false);
        });

        it("does not throw when an instance has no dispose method", async () => {
            const services = new ServiceCollection();
            const token = createToken<{ value: number }>("PlainValue");
            services.addScoped(token, () => ({ value: 42 }));
            const scope = services.build().createScope();

            await scope.resolve(token);

            await expect(scope.dispose()).resolves.toBeUndefined();
        });

        it("does not call dispose() a second time if dispose() is called twice", async () => {
            const services = new ServiceCollection();
            const token = createToken<{ dispose(): void }>("Connection");
            let disposeCalls = 0;
            services.addScoped(token, () => ({ dispose: () => { disposeCalls += 1; } }));
            const scope = services.build().createScope();

            await scope.resolve(token);
            await scope.dispose();
            await scope.dispose();

            expect(disposeCalls).toBe(1);
        });

        it("disposes instances in reverse construction order", async () => {
            const services = new ServiceCollection();
            const order: string[] = [];
            const firstToken = createToken<{ dispose(): void }>("First");
            const secondToken = createToken<{ dispose(): void }>("Second");
            services.addScoped(firstToken, () => ({ dispose: () => { order.push("first"); } }));
            services.addScoped(secondToken, () => ({ dispose: () => { order.push("second"); } }));
            const scope = services.build().createScope();

            await scope.resolve(firstToken);
            await scope.resolve(secondToken);
            await scope.dispose();

            expect(order).toEqual(["second", "first"]);
        });

        it("does not re-throw when a tracked instance had failed to construct", async () => {
            const services = new ServiceCollection();
            const order: string[] = [];
            const brokenToken = createToken<unknown>("NeverBuilt");
            const healthyToken = createToken<{ dispose(): void }>("Healthy");
            services.addScoped(brokenToken, () => {
                throw new Error("construction failed");
            });
            services.addScoped(healthyToken, () => ({ dispose: () => { order.push("healthy"); } }));
            const scope = services.build().createScope();

            await expect(scope.resolve(brokenToken)).rejects.toThrow("construction failed");
            await scope.resolve(healthyToken);

            await expect(scope.dispose()).resolves.toBeUndefined();
            expect(order).toEqual(["healthy"]);
        });

        it("continues disposing remaining instances even if one dispose() throws", async () => {
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
                services.addScoped(brokenToken, () => ({
                    dispose: () => { throw new Error("dispose failed"); },
                }));
                services.addScoped(healthyToken, () => ({ dispose: () => { order.push("healthy"); } }));
                const scope = services.build().createScope();

                await scope.resolve(brokenToken);
                await scope.resolve(healthyToken);

                await expect(scope.dispose()).resolves.toBeUndefined();
                expect(order).toEqual(["healthy"]);
            } finally {
                console.error = originalError;
            }
        });
    });
});
