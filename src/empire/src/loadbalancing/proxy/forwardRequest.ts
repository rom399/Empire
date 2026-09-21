import http from "http";
import { Context } from "../../http/Context";
import { HttpError } from "../../errors/HttpError";
import { ROUTE_HEADER } from "../../middleware/RouteHeaderMiddleware";
import { Backend } from "../Backend";
import { ForwardRequestOptions } from "./ForwardRequestOptions";
import { stripHopByHopHeaders } from "./hopByHopHeaders";
import { LoadBalancerEvent } from "../monitoring/LoadBalancerEvent";

const HTTP_DEFAULT_PORT = 80;
const BAD_GATEWAY = 502;
const GATEWAY_TIMEOUT = 504;
const IPV4_MAPPED_PREFIX = "::ffff:";

/** A backend chooses what it reports as a route; cap it so a careless one cannot bloat what the monitor stores. */
const MAX_REPORTED_ROUTE_LENGTH = 256;

/**
 * Proxies one request to a backend and streams the response back. It
 * streams in both directions and never buffers - a buffering proxy would
 * distort exactly the latencies the dashboard exists to show - so a
 * middleware that reads the request body must not run before this does,
 * or there is nothing left to pipe.
 *
 * Every call reports "dispatched" and then exactly one of "completed",
 * "failed" or "aborted" to the monitor. Failures before the backend has
 * answered throw an HttpError (502 or 504) so they take the normal error
 * path; a failure after response headers have gone out cannot change the
 * status any more, so the client's connection is destroyed instead - a
 * truncated response must look truncated, not like a clean short one.
 */
export async function forwardRequest(
    ctx: Context,
    backend: Backend,
    options: ForwardRequestOptions
): Promise<void> {

    const { req, res } = ctx;
    const target = new URL(backend.url);
    const requestTarget = toOriginForm(req.url);
    const reportedPath = options.includeQueryString ? requestTarget : requestTarget.split("?")[0];
    const method = req.method ?? "GET";
    const startedAt = Date.now();

    if (req.readableEnded && declaresBody(req)) {
        options.logger?.debug(
            `Request ${options.requestId}: its body was already consumed before reaching the load balancer - ` +
            `register the balancer before any middleware that reads the body`
        );
        throw new HttpError(500, "Request body was already consumed before the load balancer");
    }

    const publish = (event: LoadBalancerEvent): void => options.monitor?.publish(event);

    publish({
        type: "dispatched", requestId: options.requestId, backendId: backend.id,
        method, path: reportedPath, at: startedAt,
    });

    return new Promise<void>((resolve, reject) => {

        let finished = false;
        let timedOut = false;
        let upstreamResponse: http.IncomingMessage | undefined;

        const upstreamRequest = http.request({
            agent: options.agent,
            protocol: "http:",
            hostname: target.hostname.replace(/^\[|\]$/g, ""),
            port: target.port || HTTP_DEFAULT_PORT,
            method,
            path: requestTarget,
            headers: buildUpstreamHeaders(ctx, target, options.requestId),
        });

        // Bounds time to response headers only - cleared the moment they arrive.
        const timeout = setTimeout(() => {
            timedOut = true;
            upstreamRequest.destroy();
        }, options.timeoutMs);

        /**
         * The single exit. Whichever of the many things that can end a
         * proxied request happens first wins; anything after it is ignored,
         * which is what guarantees exactly one terminal event per request.
         */
        const finish = (event: LoadBalancerEvent, error?: HttpError): void => {
            if (finished) {
                return;
            }

            finished = true;
            clearTimeout(timeout);
            res.off("close", onClientClose);
            publish(event);

            if (error) {
                reject(error);
                return;
            }

            resolve();
        };

        const failed = (phase: "connect" | "timeout" | "stream"): LoadBalancerEvent => ({
            type: "failed", requestId: options.requestId, backendId: backend.id,
            phase, durationMs: Date.now() - startedAt, at: Date.now(),
        });

        // Discards whatever the client is still uploading, so a keep-alive
        // connection is left clean after we answer without proxying the body.
        const drainClientBody = (): void => {
            req.unpipe(upstreamRequest);
            req.resume();
        };

        const onClientClose = (): void => {
            if (res.writableFinished) {
                return;
            }

            upstreamRequest.destroy();
            upstreamResponse?.destroy();
            finish({ type: "aborted", requestId: options.requestId, backendId: backend.id, at: Date.now() });
        };

        res.on("close", onClientClose);
        req.on("error", onClientClose);

        // Backend died after answering: headers are gone, so the only honest signal left is a dead connection.
        const abandonStream = (): void => {
            if (finished) {
                return;
            }

            finish(failed("stream"));
            res.destroy();
        };

        upstreamRequest.on("error", () => {
            if (finished) {
                return;
            }

            drainClientBody();

            if (timedOut) {
                finish(failed("timeout"), new HttpError(GATEWAY_TIMEOUT, "Gateway Timeout"));
            } else if (upstreamResponse) {
                abandonStream();
            } else {
                finish(failed("connect"), new HttpError(BAD_GATEWAY, "Bad Gateway"));
            }
        });

        upstreamRequest.on("response", (upstream) => {
            clearTimeout(timeout);
            upstreamResponse = upstream;

            const responseHeaders = stripHopByHopHeaders(upstream.headers);
            const reportedRoute = firstValue(upstream.headers[ROUTE_HEADER.toLowerCase()])?.slice(0, MAX_REPORTED_ROUTE_LENGTH) || undefined;

            // Route structure is between the backend and the balancer, not something to hand to callers.
            delete responseHeaders[ROUTE_HEADER.toLowerCase()];

            res.writeHead(upstream.statusCode ?? BAD_GATEWAY, upstream.statusMessage, responseHeaders);

            upstream.on("end", () => {
                finish({
                    type: "completed", requestId: options.requestId, backendId: backend.id,
                    status: upstream.statusCode ?? BAD_GATEWAY, durationMs: Date.now() - startedAt,
                    route: reportedRoute, at: Date.now(),
                });
            });
            upstream.on("error", abandonStream);
            upstream.on("close", () => {
                if (!upstream.complete) {
                    abandonStream();
                }
            });

            upstream.pipe(res);
        });

        if (req.readableEnded) {
            upstreamRequest.end();
        } else {
            req.pipe(upstreamRequest);
        }
    });
}

/**
 * Builds the headers sent upstream: the client's own, minus hop-by-hop,
 * with the forwarding headers a backend needs to reconstruct who the real
 * caller was.
 *
 * `Host` becomes the backend's, as YARP does by default, with the original
 * kept in X-Forwarded-Host. Existing X-Forwarded-Host / -Proto values are
 * preserved so a balancer sitting behind another proxy doesn't overwrite
 * the outer, more accurate answer; X-Forwarded-For is appended to, not
 * replaced, so the whole chain survives - deciding how much of it to
 * believe is the backend's job.
 *
 * `Expect` is dropped because Node's server has already answered
 * `100 Continue` to the client; forwarding it would make the upstream
 * request wait for a second one.
 */
function buildUpstreamHeaders(ctx: Context, target: URL, requestId: string): http.OutgoingHttpHeaders {
    const incoming = ctx.req.headers;
    const headers = stripHopByHopHeaders(incoming);

    delete headers.expect;

    headers.host = target.host;
    headers["x-forwarded-host"] = firstValue(incoming["x-forwarded-host"]) ?? incoming.host;
    headers["x-forwarded-proto"] = firstValue(incoming["x-forwarded-proto"]) ?? "http";
    headers["x-forwarded-for"] = appendForwardedFor(incoming["x-forwarded-for"], clientAddress(ctx.req));
    headers["x-request-id"] = requestId;

    return headers;
}

function appendForwardedFor(existing: string | string[] | undefined, address: string): string {
    const chain = Array.isArray(existing) ? existing.join(", ") : existing;

    return chain ? `${chain}, ${address}` : address;
}

/** The socket's peer address - never a header, which the client controls. */
function clientAddress(req: http.IncomingMessage): string {
    const raw = req.socket.remoteAddress ?? "unknown";

    return raw.startsWith(IPV4_MAPPED_PREFIX) ? raw.slice(IPV4_MAPPED_PREFIX.length) : raw;
}

/**
 * Normalises a request target to origin-form ("/path?query"). Clients
 * talking to a proxy may send absolute-form ("http://host/path"), and
 * "*" or an authority-form target has no path at all.
 */
function toOriginForm(target: string | undefined): string {
    if (!target || target === "*") {
        return "/";
    }

    if (target.startsWith("/")) {
        return target;
    }

    try {
        const parsed = new URL(target);

        return `${parsed.pathname}${parsed.search}`;
    } catch {
        return "/";
    }
}

/** True when the request declared a body, by length or chunked framing. */
function declaresBody(req: http.IncomingMessage): boolean {
    const length = Number(req.headers["content-length"] ?? 0);

    return length > 0 || req.headers["transfer-encoding"] !== undefined;
}

function firstValue(value: string | string[] | undefined): string | undefined {
    return Array.isArray(value) ? value[0] : value;
}
