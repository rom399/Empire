import { CorsOptions } from "./CorsOptions";

/**
 * One entry in a multi-policy CorsConfig - see doc/features/CORS.md §2.6.
 * Lets a single createCorsMiddleware() registration apply a different
 * CorsOptions per path, without Router or Empire.ts involvement.
 */
export interface CorsPolicy {
    /** Matches the request path this policy applies to. */
    match: (path: string) => boolean;
    options: CorsOptions;
}
