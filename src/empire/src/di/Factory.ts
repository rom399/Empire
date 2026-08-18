import { Resolver } from "./Resolver";

/**
 * Builds a service instance, given a resolver for fetching its own
 * dependencies. May be synchronous or return a Promise - the container
 * always awaits the result either way.
 */
export type Factory<T> = (resolver: Resolver) => T | Promise<T>;
