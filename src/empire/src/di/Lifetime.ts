/**
 * Controls how long a resolved service instance is kept alive and reused.
 */
export enum Lifetime {
    /** One instance for the life of the process. */
    Singleton,
    /** One instance per request (or per created scope). */
    Scoped,
    /** A new instance every resolve() call. */
    Transient,
}
