import { ServiceToken } from "./ServiceToken";
import { ServiceDescriptor } from "./ServiceDescriptor";
import { Resolver } from "./Resolver";
import { Lifetime } from "./Lifetime";
import { ServiceProvider } from "./ServiceProvider";
import { isDisposable } from "./Disposable";

/**
 * Resolves services within one scope's lifetime - e.g. one per incoming
 * HTTP request. Scoped services get one instance per scope, cached the
 * same way ServiceProvider caches singletons - by the in-flight promise, so
 * concurrent resolutions never double-construct. Transient services are
 * never cached, but are still tracked for disposal - see dispose() below.
 * Singleton services are always resolved through the root ServiceProvider
 * rather than built locally, so every scope shares the same singleton
 * instances as every other scope and the root itself, and this scope never
 * tracks them for disposal - that's the root provider's job.
 */
export class ServiceScope implements Resolver {

    private readonly instances = new Map<ServiceToken<unknown>, Promise<unknown>>();
    private readonly constructed: { token: ServiceToken<unknown>; instance: Promise<unknown> }[] = [];
    private disposed = false;

    public constructor(
        private readonly provider: ServiceProvider,
        private readonly descriptors: ReadonlyMap<ServiceToken<unknown>, ServiceDescriptor<unknown>>
    ) {}

    /**
     * Resolves a service by its token. Always returns a Promise, even for a
     * token whose factory is fully synchronous.
     */
    public resolve<T>(token: ServiceToken<T>): Promise<T> {
        return this.resolveWithPath(token, new Set());
    }

    /**
     * Disposes every scoped and transient instance this scope built that
     * implements Disposable - e.g. when an HTTP request finishes. Runs in
     * reverse construction order, the same reasoning as
     * ServiceProvider's singleton disposal: a later-constructed instance
     * may depend on an earlier one, so tear down in the opposite order
     * they were built. One instance's dispose() throwing doesn't stop the
     * rest from being disposed, and neither does one instance having
     * failed to construct in the first place - there's nothing to dispose
     * of in that case, so it's skipped rather than re-throwing the
     * original construction failure here. Safe to call more than once -
     * only the first call does anything.
     */
    public async dispose(): Promise<void> {
        if (this.disposed) {
            return;
        }

        this.disposed = true;

        for (const { token, instance } of [...this.constructed].reverse()) {
            let resolved: unknown;

            try {
                resolved = await instance;
            } catch {
                continue;
            }

            if (isDisposable(resolved)) {
                try {
                    await resolved.dispose();
                } catch (err) {
                    console.error(`Error disposing "${token.description}":`, err);
                }
            }
        }
    }

    private resolveWithPath<T>(token: ServiceToken<T>, path: ReadonlySet<ServiceToken<unknown>>): Promise<T> {
        // Narrowed back from unknown for the same reason as
        // ServiceProvider.resolveWithPath() - only ServiceCollection.register()
        // ever populates this map, always token-and-descriptor matched.
        const descriptor = this.descriptors.get(token) as ServiceDescriptor<T> | undefined;

        if (!descriptor) {
            return Promise.reject(new Error(`Service not registered: "${token.description}"`));
        }

        // Singletons are process-wide - delegate to the root provider so
        // this scope never builds its own copy, and every scope ends up
        // sharing the same instance. The root provider runs its own
        // independent cycle detection for whatever the singleton depends
        // on, so this scope's path isn't threaded any further here.
        if (descriptor.lifetime === Lifetime.Singleton) {
            return this.provider.resolve(token);
        }

        if (path.has(token)) {
            const cycle = [...path, token].map((seen) => seen.description).join(" -> ");
            return Promise.reject(new Error(`Circular dependency detected: ${cycle}`));
        }

        return descriptor.lifetime === Lifetime.Scoped
            ? this.resolveScoped(descriptor, path)
            : this.construct(descriptor, path);
    }

    private resolveScoped<T>(
        descriptor: ServiceDescriptor<T>,
        path: ReadonlySet<ServiceToken<unknown>>
    ): Promise<T> {
        const cached = this.instances.get(descriptor.token) as Promise<T> | undefined;

        if (cached) {
            return cached;
        }

        // Same in-flight-promise-caching rule as ServiceProvider's
        // singletons - two concurrent resolve() calls that both miss the
        // cache share the same construction instead of racing.
        const instance = this.construct(descriptor, path);
        this.instances.set(descriptor.token, instance);
        return instance;
    }

    private construct<T>(descriptor: ServiceDescriptor<T>, path: ReadonlySet<ServiceToken<unknown>>): Promise<T> {
        const nextPath = new Set(path).add(descriptor.token);

        const scopedResolver: Resolver = {
            resolve: (token) => this.resolveWithPath(token, nextPath),
        };

        // A factory that throws synchronously (rather than returning a
        // rejected Promise) must still come back as a rejection here, not
        // a raw throw out of resolve() - that would break the "resolve()
        // always returns a Promise" contract every caller relies on.
        let instance: Promise<T>;

        try {
            instance = Promise.resolve(descriptor.factory(scopedResolver));
        } catch (err) {
            instance = Promise.reject(err);
        }

        this.constructed.push({ token: descriptor.token, instance });
        return instance;
    }
}
