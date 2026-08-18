import { ServiceToken } from "./ServiceToken";
import { Lifetime } from "./Lifetime";
import { Factory } from "./Factory";
import { ServiceDescriptor } from "./ServiceDescriptor";
import { ServiceProvider } from "./ServiceProvider";

/**
 * Accumulates service registrations before the container is built. Mirrors
 * ASP.NET Core's IServiceCollection - register everything up front in the
 * composition root, then call build() once to get a ServiceProvider.
 */
export class ServiceCollection {

    private readonly descriptors = new Map<ServiceToken<unknown>, ServiceDescriptor<unknown>>();
    private sealed = false;

    /**
     * Registers a service with singleton lifetime - one instance for the
     * life of the process, shared by every resolution.
     */
    public addSingleton<T>(token: ServiceToken<T>, factory: Factory<T>): void {
        this.register(token, Lifetime.Singleton, factory);
    }

    /**
     * Registers a service with scoped lifetime - one instance per request
     * (or per created scope), shared only within that scope.
     */
    public addScoped<T>(token: ServiceToken<T>, factory: Factory<T>): void {
        this.register(token, Lifetime.Scoped, factory);
    }

    /**
     * Registers a service with transient lifetime - a new instance is
     * built on every resolve() call.
     */
    public addTransient<T>(token: ServiceToken<T>, factory: Factory<T>): void {
        this.register(token, Lifetime.Transient, factory);
    }

    /**
     * Seals the collection and builds a ServiceProvider from everything
     * registered so far. No further registrations are allowed afterwards -
     * see register() for what happens if one is attempted. The provider
     * gets its own copy of the descriptor map, never a live reference back
     * to this collection.
     */
    public build(): ServiceProvider {
        this.sealed = true;

        return new ServiceProvider(new Map(this.descriptors));
    }

    private register<T>(token: ServiceToken<T>, lifetime: Lifetime, factory: Factory<T>): void {
        if (this.sealed) {
            this.crash(
                `attempted to register "${token.description}" after build() was already called.\n` +
                `  ServiceCollection is sealed once a ServiceProvider is built from it - ` +
                `all registrations must happen up front, in the composition root.`
            );
        }

        const existing = this.descriptors.get(token);

        if (existing) {
            this.crash(
                `duplicate service registration for "${token.description}".\n` +
                `  First registered as: ${Lifetime[existing.lifetime]}\n` +
                `  Registered again as: ${Lifetime[lifetime]}`
            );
        }

        this.descriptors.set(token, { token, lifetime, factory });
    }

    /**
     * Registration mistakes are startup-time configuration bugs, not
     * recoverable runtime conditions - a try/catch upstream could otherwise
     * swallow a normal throw and let the server boot with a broken
     * container. Crashing the process is deliberate; see
     * doc/features/DEPENDENCY_INJECTION.md section 2.4.
     */
    private crash(message: string): never {
        console.error(`FATAL: ${message}`);
        process.exit(1);
    }
}
