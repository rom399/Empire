import http from "http";

/**
 * Makes a response silently drop any body written to it while still
 * setting status and headers normally.
 *
 * This mutates res.write/res.end directly - after calling this, the
 * response object no longer behaves the way Node's documentation says
 * it does. It exists because RFC 9110 9.3.2 requires HEAD to return
 * exactly the headers GET would, including a correct Content-Length.
 * For a handler that computes its response at request time, the only
 * way to know what those headers would have been is to actually run
 * the handler and let it compute them, then discard the body it wrote.
 */
export function suppressResponseBody(res: http.ServerResponse): void {
    const originalEnd = res.end.bind(res);

    res.write = (() => true) as typeof res.write;
    res.end = ((..._args: unknown[]) => originalEnd()) as typeof res.end;
}
