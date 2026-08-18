import { ServiceToken } from "./ServiceToken";

/**
 * Resolves a service by its token. Passed into every registered factory so
 * it can pull its own dependencies out of the same container. Always
 * returns a Promise, even for a token whose factory is fully synchronous -
 * callers never need to know or check which is which.
 */
export interface Resolver {
    resolve<T>(token: ServiceToken<T>): Promise<T>;
}
