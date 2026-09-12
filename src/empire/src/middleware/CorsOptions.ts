/**
 * Configuration for createCorsMiddleware(). See doc/features/CORS.md §2.3
 * for the full design rationale behind each field's default.
 */
export interface CorsOptions {
    /** Which origins may read the response. */
    origin: string | string[] | ((origin: string) => boolean);

    /** Defaults to a standard set: GET, POST, PUT, PATCH, DELETE, OPTIONS. */
    methods?: string[];

    /**
     * No default - an unconfigured allowedHeaders means no headers beyond
     * CORS's own safelisted "simple" set are permitted on the actual
     * request, regardless of what the browser's preflight claims it wants
     * to send. Must be explicitly listed to allow anything else (e.g.
     * ["Content-Type", "Authorization"]) - strict by default, not a
     * reflect-back-whatever-was-asked convenience.
     */
    allowedHeaders?: string[];

    /**
     * Sets Access-Control-Expose-Headers on the actual response (not the
     * preflight). Without this, cross-origin JS can only read a small
     * safelisted set of response headers (Content-Type, Content-Length,
     * a few others) - anything custom (pagination info, a request-id
     * header, rate-limit headers) is invisible to it unless listed here.
     * No default - unset means nothing extra is exposed.
     */
    exposedHeaders?: string[];

    /**
     * Sets Access-Control-Allow-Credentials - see doc/features/CORS.md
     * §2.4 for the wildcard-origin interaction. Combining this with the
     * literal origin: "*" is rejected at creation time (§2.4).
     */
    credentials?: boolean;

    /**
     * Access-Control-Max-Age, in seconds - how long a browser may cache
     * one preflight result. No default - when unset, the header is
     * omitted entirely, and the browser falls back to its own default
     * preflight-cache duration rather than Empire imposing one.
     */
    maxAge?: number;
}
