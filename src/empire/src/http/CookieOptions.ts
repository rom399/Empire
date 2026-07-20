/**
 * Options controlling how a response cookie is written.
 * Mirrors ASP.NET Core's CookieOptions.
 */
export interface CookieOptions {
    /** Lifetime in seconds. Takes precedence over expires in browsers. */
    maxAge?: number;

    /** Absolute expiry date. */
    expires?: Date;

    /** URL path the cookie applies to. Defaults to "/". */
    path?: string;

    /** Domain the cookie applies to. */
    domain?: string;

    /** Only send over HTTPS. */
    secure?: boolean;

    /** Hide from client-side JavaScript. */
    httpOnly?: boolean;

    /** Cross-site request behaviour. */
    sameSite?: "Strict" | "Lax" | "None";
}
