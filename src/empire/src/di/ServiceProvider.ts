import { ServiceToken } from "./ServiceToken";
import { ServiceDescriptor } from "./ServiceDescriptor";
import { Resolver } from "./Resolver";
import { Lifetime } from "./Lifetime";
import { ServiceScope } from "./ServiceScope";
import { isDisposable } from "./Disposable";

/**
 * Resolves services from a sealed set of registrations built by
 * ServiceCollection.build(). Singleton instances are built lazily and
 * cached for the life of the provider; transient services get a fresh
 * instance on every resolve(). Scoped services can't be resolved from the
 * root provider directly - call createScope() first.
 */
export class ServiceProvider implements Resolver {

    private readonly singletons = new Map<ServiceToken<unknown>, Promise<unknown>>();
    private disposed = false;

    public constructor(
        private readonly descriptors: Map<ServiceToken<unknown>, ServiceDescriptor<unknown>>
    ) {}

    /**
     * Resolves a service by its token. Always returns a Promise, even for a
     * token whose factory is fully synchronous.
     */
    public resolve<T>(token: ServiceToken<T>): Promise<T> {
        return this.resolveWithPath(token, new Set());
    }

    /**
     * Creates a new scope for resolving Scoped-lifetime services - one
     * instance per scope, e.g. one per incoming HTTP request. Singleton
     * resolutions made through the scope still come from, and are cached
     * by, this root provider - see ServiceScope.
     */
    public createScope(): ServiceScope {
        return new ServiceScope(this, this.descriptors);
    }

    /**
     * Disposes every singleton this provider built that implements
     * Disposable, in reverse construction order - the same reasoning as
     * ServiceScope.dispose(): a later-constructed singleton may depend on
     * an earlier one, so tear down in the opposite order they were built.
     * Safe by construction: a singleton's dependencies always finish
     * resolving before the singleton itself does (its factory awaits
     * them), so reverse-of-construction-order can never dispose a
     * dependency before something that depends on it - the one way to
     * break that guarantee is a singleton stashing its resolver and
     * reaching for another singleton later, outside its declared
     * dependencies. One instance's dispose() throwing, or one instance
     * having failed to construct in the first place, doesn't stop the
     * rest from being disposed. Safe to call more than once - only the
     * first call does anything. Called automatically by Empire.stop()
     * when this provider was passed via EmpireOptions.services.
     */
    public async dispose(): Promise<void> {
        if (this.disposed) {
            return;
        }

        this.disposed = true;

        // Map iteration follows insertion order, and a singleton is only
        // ever inserted once - see resolveSingleton's cache check above -
        // so reversing the map's own entries is reverse construction
        // order, with no separate tracking needed.
        for (const [token, instance] of [...this.singletons].reverse()) {
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

    /**
     * `path` is the chain of tokens currently under construction for this
     * one top-level resolve() call - construct() threads it through every
     * nested resolver.resolve() a factory makes, so a token reappearing in
     * its own construction chain is a circular dependency. A fresh Set is
     * created per top-level call (see resolve() above), so two concurrent,
     * unrelated resolve() calls never see each other's tokens and can't
     * falsely trip each other's cycle check.
     */
    private resolveWithPath<T>(token: ServiceToken<T>, path: ReadonlySet<ServiceToken<unknown>>): Promise<T> {
        // The map holds every registered service's descriptor together, so
        // its value type is widened to unknown - safe to narrow back to T
        // here, since ServiceCollection.register() only ever stores a
        // ServiceDescriptor<T> under a ServiceToken<T>.
        const descriptor = this.descriptors.get(token) as ServiceDescriptor<T> | undefined;

        if (!descriptor) {
            return Promise.reject(new Error(`Service not registered: "${token.description}"`));
        }

        if (path.has(token)) {
            const cycle = [...path, token].map((seen) => seen.description).join(" -> ");
            return Promise.reject(new Error(`Circular dependency detected: ${cycle}`));
        }

        switch (descriptor.lifetime) {
            case Lifetime.Singleton:
                return this.resolveSingleton(descriptor, path);
            case Lifetime.Transient:
                return this.construct(descriptor, path);
            case Lifetime.Scoped:
                return Promise.reject(new Error(
                    `Cannot resolve scoped service "${token.description}" from the root provider - ` +
                    `resolve it through a scope instead.`
                ));
        }
    }

    private resolveSingleton<T>(
        descriptor: ServiceDescriptor<T>,
        path: ReadonlySet<ServiceToken<unknown>>
    ): Promise<T> {
        const cached = this.singletons.get(descriptor.token) as Promise<T> | undefined;

        if (cached) {
            return cached;
        }

        // Cache the in-flight promise itself, not the awaited result - two
        // concurrent resolve() calls that both miss the cache must share
        // the same construction instead of racing to build two instances.
        const instance = this.construct(descriptor, path);
        this.singletons.set(descriptor.token, instance);
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
        try {
            return Promise.resolve(descriptor.factory(scopedResolver));
        } catch (err) {
            return Promise.reject(err);
        }
    }
}
