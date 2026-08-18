import { ServiceToken } from "./ServiceToken";
import { Lifetime } from "./Lifetime";
import { Factory } from "./Factory";

/**
 * Everything the container needs to construct a registered service: which
 * token it answers to, how long an instance should live, and the factory
 * that builds it.
 */
export interface ServiceDescriptor<T = unknown> {
    token: ServiceToken<T>;
    lifetime: Lifetime;
    factory: Factory<T>;
}
