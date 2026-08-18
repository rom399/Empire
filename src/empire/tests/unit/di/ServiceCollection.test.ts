import { describe, it, expect, afterEach } from "vitest";
import { ServiceCollection } from "../../../src/di/ServiceCollection";
import { ServiceProvider } from "../../../src/di/ServiceProvider";
import { createToken } from "../../../src/di/ServiceToken";

/**
 * Registration mistakes (duplicate tokens, registering after build()) are
 * startup-time configuration bugs, not recoverable runtime conditions - the
 * collection crashes the process instead of throwing, so a try/catch
 * upstream can't swallow the mistake and let the server boot with a broken
 * container. See doc/features/DEPENDENCY_INJECTION.md section 2.4.
 */
describe("ServiceCollection", () => {

    describe("addSingleton / addScoped / addTransient", () => {

        it("accepts one registration per token without crashing", () => {
            const services = new ServiceCollection();
            const loggerToken = createToken<string>("Logger");
            const configToken = createToken<string>("Config");
            const requestIdToken = createToken<string>("RequestId");

            services.addSingleton(loggerToken, () => "logger");
            services.addScoped(configToken, () => "config");
            services.addTransient(requestIdToken, () => "request-id");

            expect(services.build()).toBeInstanceOf(ServiceProvider);
        });
    });

    describe("build", () => {

        it("returns a ServiceProvider", () => {
            expect(new ServiceCollection().build()).toBeInstanceOf(ServiceProvider);
        });
    });

    describe("crash paths", () => {

        let exitCode: number | undefined;
        let loggedMessage = "";

        const originalExit = process.exit;
        const originalError = console.error;

        function stubCrash(): void {
            exitCode = undefined;
            loggedMessage = "";

            // Test-only escape hatch: throw a sentinel instead of actually
            // killing the test runner. Application code never gets this -
            // process.exit(1) really does end the process.
            process.exit = ((code?: number) => {
                exitCode = code;
                throw new Error("__process_exit_stub__");
            }) as typeof process.exit;

            console.error = (message: string) => {
                loggedMessage = message;
            };
        }

        afterEach(() => {
            process.exit = originalExit;
            console.error = originalError;
        });

        it("crashes the process instead of throwing on a duplicate registration", () => {
            stubCrash();

            const services = new ServiceCollection();
            const token = createToken<string>("Duplicate");

            services.addSingleton(token, () => "first");

            expect(() => services.addSingleton(token, () => "second"))
                .toThrow("__process_exit_stub__");
            expect(exitCode).toBe(1);
            expect(loggedMessage).toMatch(/duplicate service registration/i);
            expect(loggedMessage).toContain("Duplicate");
        });

        it("names both lifetimes in the duplicate-registration message", () => {
            stubCrash();

            const services = new ServiceCollection();
            const token = createToken<string>("Mismatched");

            services.addSingleton(token, () => "first");

            expect(() => services.addTransient(token, () => "second"))
                .toThrow("__process_exit_stub__");
            expect(loggedMessage).toContain("Singleton");
            expect(loggedMessage).toContain("Transient");
        });

        it("crashes the process instead of throwing when registering after build()", () => {
            const services = new ServiceCollection();
            services.build();

            stubCrash();

            const token = createToken<string>("TooLate");

            expect(() => services.addSingleton(token, () => "value"))
                .toThrow("__process_exit_stub__");
            expect(exitCode).toBe(1);
            expect(loggedMessage).toMatch(/after build\(\) was already called/i);
        });
    });
});
