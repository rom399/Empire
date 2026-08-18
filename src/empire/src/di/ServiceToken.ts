/**
 * A unique, type-carrying identifier for a registered service. TypeScript
 * interfaces and types are erased at runtime, so a Symbol provides the
 * actual runtime identity - the `__type` field is never assigned, it exists
 * only so the compiler can infer T at each call site that uses the token.
 */
export type ServiceToken<T> = symbol & { __type?: T };

/**
 * Creates a new service token. `name` is for diagnostics only - it becomes
 * the Symbol's description, shown in error messages - and does not need to
 * be unique, since the Symbol itself is what provides identity.
 */
export function createToken<T>(name: string): ServiceToken<T> {
    return Symbol(name) as ServiceToken<T>;
}
