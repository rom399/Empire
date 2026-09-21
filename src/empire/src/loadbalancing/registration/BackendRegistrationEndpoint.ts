import { createHash, timingSafeEqual } from "crypto";
import { z } from "zod";
import { Context } from "../../http/Context";
import { HttpError } from "../../errors/HttpError";
import { Middleware } from "../../types";
import { validate } from "../../validation/validate";
import { BACKEND_ID_PATTERN, normalizeBackendUrl } from "../backends/backendIdentity";
import { BackendRegistrationEndpointOptions } from "./BackendRegistrationEndpointOptions";
import { BackendRegistry } from "../backends/BackendRegistry";
import { isLoopbackAddress } from "../isLoopbackAddress";

const BEARER_PATTERN = /^Bearer\s+(.+)$/i;

const idParams = z.object({
    id: z.string().regex(BACKEND_ID_PATTERN, "must be 1-128 letters, digits, '-', '_' or ':'"),
});

const registrationBody = z.object({
    url: z.string().refine(
        (value) => normalizeBackendUrl(value) !== undefined,
        "must be an absolute http: origin such as http://127.0.0.1:5001 (no path, query or credentials)"
    ),
});

/**
 * Builds the endpoint backends use to register themselves with a
 * BackendRegistry:
 *
 *   PUT    {path}/{id}   body { url }  register or renew  -> 201 / 200 { leaseTtlMs }
 *   DELETE {path}/{id}                 deregister         -> 204 (also when already gone)
 *   GET    {path}                      list, for debugging -> 200
 *
 * Registering and renewing are the same call, so a heartbeat is just a
 * repeated registration. Anything else passes through to next(), so this
 * can sit anywhere before the load balancer middleware, which is terminal.
 *
 * This is the sharp edge of the whole feature - whoever can register can
 * steer traffic - so it is locked down by default: a bearer token is
 * required (compared in constant time), and only loopback clients are
 * served. Both are opt-outs, and both are checked before anything about
 * the registry is revealed.
 */
export function createBackendRegistrationEndpoint(
    registry: BackendRegistry,
    options: BackendRegistrationEndpointOptions
): Middleware {

    const basePath = normalizeMountPath(options.path);
    const expectedToken = resolveToken(options);

    const handleRegister = validate({ params: idParams, body: registrationBody })(
        (ctx, { params, body }) => {
            const { created } = registry.register(params.id, body.url);

            ctx.status(created ? 201 : 200).json({ leaseTtlMs: registry.leaseTtlMs });
        }
    );

    const handleDeregister = validate({ params: idParams })(
        (ctx, { params }) => {
            registry.deregister(params.id);
            ctx.status(204).res.end();
        }
    );

    return async (ctx, next) => {
        const id = matchRegistrationPath(ctx.path, basePath);

        if (id === undefined) {
            return next();
        }

        assertLoopbackUnlessAllowed(ctx, options);
        assertAuthorized(ctx, expectedToken);

        if (id === "") {
            return handleList(ctx, registry);
        }

        ctx.params = { id };

        switch (ctx.method) {
            case "PUT":
                return handleRegister(ctx);
            case "DELETE":
                return handleDeregister(ctx);
            default:
                ctx.header("Allow", "PUT, DELETE");
                throw new HttpError(405, "Method not allowed");
        }
    };
}

/**
 * Configuration mistakes are found at startup, not on the first request:
 * a missing token throws here, at construction, rather than quietly
 * serving an open endpoint.
 */
function resolveToken(options: BackendRegistrationEndpointOptions): Buffer | undefined {
    if (options.token) {
        return hashToken(options.token);
    }

    if (!options.allowUnauthenticated) {
        throw new Error(
            "createBackendRegistrationEndpoint() requires a token - anyone able to register a " +
            "backend can steer the balancer's traffic. Pass token, or set allowUnauthenticated: true " +
            "to knowingly run without one."
        );
    }

    return undefined;
}

function normalizeMountPath(path: string): string {
    const trimmed = path.replace(/\/+$/, "");

    if (!trimmed.startsWith("/")) {
        throw new Error(`Registration endpoint path must start with "/", received "${path}"`);
    }

    return trimmed;
}

/**
 * Returns the id segment ("" for the bare list path), or undefined when the
 * request is not for this endpoint at all - including a deeper path like
 * `{path}/a/b`, which is not a valid registration URL and so falls
 * through rather than being answered here.
 */
function matchRegistrationPath(requestPath: string, basePath: string): string | undefined {
    if (requestPath === basePath || requestPath === `${basePath}/`) {
        return "";
    }

    if (!requestPath.startsWith(`${basePath}/`)) {
        return undefined;
    }

    const rest = requestPath.slice(basePath.length + 1);

    return rest.includes("/") ? undefined : rest;
}

function assertLoopbackUnlessAllowed(ctx: Context, options: BackendRegistrationEndpointOptions): void {
    if (options.allowRemote) {
        return;
    }

    // The raw socket address, not ctx.ipAddress: that prefers the
    // client-supplied X-Forwarded-For header, which would let any remote
    // caller claim to be 127.0.0.1.
    if (!isLoopbackAddress(ctx.req.socket.remoteAddress)) {
        throw new HttpError(403, "Forbidden");
    }
}

function assertAuthorized(ctx: Context, expectedToken: Buffer | undefined): void {
    if (expectedToken === undefined) {
        return;
    }

    const match = BEARER_PATTERN.exec(ctx.headers.authorization ?? "");

    // Both sides are hashed to a fixed length first, so timingSafeEqual
    // never sees mismatched lengths and the comparison leaks nothing about
    // how long the real token is.
    if (!match || !timingSafeEqual(hashToken(match[1]), expectedToken)) {
        ctx.header("WWW-Authenticate", "Bearer");
        throw new HttpError(401, "Unauthorized");
    }
}

function hashToken(token: string): Buffer {
    return createHash("sha256").update(token).digest();
}

function handleList(ctx: Context, registry: BackendRegistry): void {
    if (ctx.method !== "GET") {
        ctx.header("Allow", "GET");
        throw new HttpError(405, "Method not allowed");
    }

    ctx.json({ backends: registry.eligible() });
}
