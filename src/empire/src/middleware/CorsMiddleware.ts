import { Context } from "../http/Context";
import { Middleware } from "../types";
import { CorsOptions } from "./CorsOptions";
import { CorsPolicy } from "./CorsPolicy";
import { CorsConfig } from "./CorsConfig";

const DEFAULT_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

/**
 * Builds CORS middleware from either a single CorsOptions policy or a
 * path-matched set of policies, registered via the existing app.use() -
 * see doc/features/CORS.md §2.1 for why this stays a plain middleware
 * rather than a new Empire.ts method.
 *
 * Every CorsOptions (or, for a policy set, every policy's options and the
 * fallback's) is validated synchronously here, before the middleware ever
 * runs - the credentials + wildcard-origin combination (§2.4) crashes the
 * process at startup rather than producing responses browsers will always
 * reject.
 */
export function createCorsMiddleware(config: CorsConfig): Middleware {

    if (isPolicySet(config)) {

        config.policies.forEach((policy, index) =>
            assertValidOptions(policy.options, `CORS policy ${index + 1}`));

        if (config.fallback) {
            assertValidOptions(config.fallback, "CORS fallback policy");
        }

    } else {
        assertValidOptions(config, "createCorsMiddleware()");
    }

    return (ctx, next) => {
        const options = isPolicySet(config) ? resolvePolicy(config, ctx.path) : config;

        if (!options) {
            // No policy matched and no fallback configured - pass through
            // untouched, exactly as if this middleware weren't registered.
            return next();
        }

        return applyOptions(options, ctx, next);
    };
}

/**
 * Applies a single resolved CorsOptions to one request: origin matching,
 * preflight detection/short-circuit, and every header CorsOptions can
 * produce (Allow-Methods, the plain Allow, Allow-Credentials,
 * Allow-Headers, Max-Age, Expose-Headers, Vary).
 */
function applyOptions(
    options: CorsOptions,
    ctx: Context,
    next: () => Promise<void>
): void | Promise<void> {

    const methods = options.methods ?? DEFAULT_METHODS;
    const requestOrigin = ctx.headers.origin;
    const allowOrigin = resolveAllowOrigin(requestOrigin, options.origin);

    // The response depends on the incoming Origin for any config other
    // than the literal wildcard, so a cache in front of the app needs to
    // know that - set on every request this middleware handles, not just
    // ones from an allowed origin (§2.5).
    if (options.origin !== "*") {
        appendVary(ctx);
    }

    // A genuine preflight per the Fetch spec (§2.2): Origin and
    // Access-Control-Request-Method both present. Neither alone is
    // sufficient - a plain cross-origin GET also carries Origin; a
    // same-origin OPTIONS probe carries neither.
    const isPreflight =
        requestOrigin !== undefined &&
        ctx.method === "OPTIONS" &&
        ctx.headers["access-control-request-method"] !== undefined;

    if (isPreflight) {

        if (allowOrigin !== undefined) {
            ctx.header("Access-Control-Allow-Origin", allowOrigin);
            ctx.header("Access-Control-Allow-Methods", methods.join(", "));

            // Sourced from CorsOptions.methods, not Router's actual
            // registered routes - a deliberate approximation, see §2.2.
            ctx.header("Allow", methods.join(", "));

            if (options.credentials) {
                ctx.header("Access-Control-Allow-Credentials", "true");
            }

            if (options.allowedHeaders && options.allowedHeaders.length > 0) {
                ctx.header("Access-Control-Allow-Headers", options.allowedHeaders.join(", "));
            }

            if (options.maxAge !== undefined) {
                ctx.header("Access-Control-Max-Age", String(options.maxAge));
            }
        }

        // Router never sees this request - it owns true preflights
        // entirely, regardless of whether the origin was allowed.
        ctx.status(204);
        ctx.res.end();

        return;
    }

    if (allowOrigin !== undefined) {
        ctx.header("Access-Control-Allow-Origin", allowOrigin);

        if (options.credentials) {
            ctx.header("Access-Control-Allow-Credentials", "true");
        }

        if (options.exposedHeaders && options.exposedHeaders.length > 0) {
            ctx.header("Access-Control-Expose-Headers", options.exposedHeaders.join(", "));
        }
    }

    // No Origin header at all (same-origin, or a non-browser client) falls
    // straight through here too - nothing to check against.
    return next();
}

/**
 * Resolves the value Access-Control-Allow-Origin should carry, or
 * undefined when the request isn't from an allowed origin (or carries no
 * Origin header at all). A literal "*" config always answers "*"; every
 * other form (string, array, function) echoes back the specific
 * requesting Origin - never "*" - so it stays correct alongside
 * credentials (§2.4) and so Vary: Origin (§2.5) means what it says.
 */
function resolveAllowOrigin(
    requestOrigin: string | undefined,
    configuredOrigin: string | string[] | ((origin: string) => boolean)
): string | undefined {

    if (requestOrigin === undefined) {
        return undefined;
    }

    if (configuredOrigin === "*") {
        return "*";
    }

    if (typeof configuredOrigin === "function") {
        return configuredOrigin(requestOrigin) ? requestOrigin : undefined;
    }

    if (Array.isArray(configuredOrigin)) {
        return configuredOrigin.includes(requestOrigin) ? requestOrigin : undefined;
    }

    return configuredOrigin === requestOrigin ? requestOrigin : undefined;
}

function appendVary(ctx: Context): void {

    const existing = ctx.res.getHeader("Vary");

    if (!existing) {
        ctx.header("Vary", "Origin");
        return;
    }

    const values = ([] as string[]).concat(existing as string | string[]);

    if (!values.includes("Origin")) {
        ctx.header("Vary", [...values, "Origin"].join(", "));
    }
}

function resolvePolicy(
    config: { policies: CorsPolicy[]; fallback?: CorsOptions },
    path: string
): CorsOptions | undefined {

    // First match wins - the same precedence rule Empire's own routing
    // already uses (§2.6).
    const matched = config.policies.find((policy) => policy.match(path));

    return matched ? matched.options : config.fallback;
}

function isPolicySet(
    config: CorsConfig
): config is { policies: CorsPolicy[]; fallback?: CorsOptions } {
    return "policies" in config;
}

/**
 * Registration mistakes are startup-time configuration bugs, not
 * recoverable runtime conditions - a try/catch upstream could otherwise
 * swallow a normal throw and let the server boot with CORS responses
 * browsers will always reject. Crashing the process is deliberate,
 * matching ServiceCollection's duplicate-registration crash; see
 * doc/features/CORS.md §2.4 and doc/features/DEPENDENCY_INJECTION.md §2.4.
 */
function assertValidOptions(options: CorsOptions, label: string): void {

    if (options.credentials && options.origin === "*") {
        console.error(
            `FATAL: ${label} combines credentials: true with origin: "*". ` +
            `Access-Control-Allow-Origin: "*" cannot be paired with ` +
            `Access-Control-Allow-Credentials: true - browsers reject the ` +
            `response outright. Configure a specific origin, a list, or a ` +
            `function instead.`
        );
        process.exit(1);
    }
}
