import http from "http";

/**
 * Headers that describe a single transport-level connection rather than
 * the message, and so must not be forwarded by a proxy in either direction
 * (RFC 9110 §7.6.1, plus the proxy-auth pair from RFC 7235 that only ever
 * addresses the immediate hop).
 */
const HOP_BY_HOP_HEADERS: ReadonlySet<string> = new Set([
    "connection",
    "keep-alive",
    "proxy-connection",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
]);

/**
 * Copies headers minus the hop-by-hop ones - both the fixed set above and
 * anything the sender named inside its own Connection header, which is how
 * a message declares extra headers as connection-specific. Header names
 * are already lower-cased by Node, so lookups here are exact.
 */
export function stripHopByHopHeaders(headers: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
    const declaredByConnection = namesListedInConnection(headers.connection);
    const kept: http.OutgoingHttpHeaders = {};

    for (const [name, value] of Object.entries(headers)) {
        if (value === undefined || HOP_BY_HOP_HEADERS.has(name) || declaredByConnection.has(name)) {
            continue;
        }

        kept[name] = value;
    }

    return kept;
}

function namesListedInConnection(connection: string | undefined): Set<string> {
    if (!connection) {
        return new Set();
    }

    return new Set(
        connection
            .split(",")
            .map((token) => token.trim().toLowerCase())
            .filter((token) => token.length > 0)
    );
}
