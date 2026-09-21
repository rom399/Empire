import { CorsOptions } from "./CorsOptions";

/**
 * One entry in a multi-policy CorsConfig - see doc/features/04_CORS_Compliance.md §2.3, rule 8.
 * Lets a single createCorsMiddleware() registration apply a different
 * CorsOptions per path, without Router or Empire.ts involvement.
 */
export interface CorsPolicy {
    /** Matches the request path this policy applies to. */
    match: (path: string) => boolean;
    options: CorsOptions;
}
