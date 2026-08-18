/**
 * A service that needs to release resources (open connections, file
 * handles, timers) when its container - a scope or the whole provider - is
 * torn down.
 */
export interface Disposable {
    dispose(): void | Promise<void>;
}

/**
 * Narrows an unknown resolved instance to Disposable. Most services don't
 * implement dispose(), so callers check for it rather than requiring every
 * factory to declare it.
 */
export function isDisposable(instance: unknown): instance is Disposable {
    return (
        typeof instance === "object" &&
        instance !== null &&
        typeof (instance as Disposable).dispose === "function"
    );
}
