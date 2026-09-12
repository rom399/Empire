import { CorsOptions } from "./CorsOptions";
import { CorsPolicy } from "./CorsPolicy";

/**
 * createCorsMiddleware()'s argument: either a single flat CorsOptions
 * (today's structure) or a path-matched set of policies with an optional
 * fallback - see doc/features/CORS.md §2.6. Adding the policies form is
 * not a breaking change; plain CorsOptions keeps working unchanged.
 */
export type CorsConfig = CorsOptions | { policies: CorsPolicy[]; fallback?: CorsOptions };
