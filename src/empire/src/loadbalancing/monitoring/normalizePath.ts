const NUMERIC_ID = /^\d+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LONG_HEX_ID = /^[0-9a-f]{16,}$/i;
const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/i;

const ID_PLACEHOLDER = ":id";

/**
 * Guesses a route template from a raw path by replacing segments that
 * look like identifiers - all digits, UUIDs, long hex strings and ULIDs -
 * with ":id". Imperfect by design: it is only the fallback for backends
 * that don't report the template they actually matched via X-Empire-Route,
 * and the dashboard marks routes derived this way as guesses. Any query
 * string is dropped first.
 */
export function normalizePath(path: string): string {
    const queryStart = path.indexOf("?");
    const pathOnly = queryStart === -1 ? path : path.slice(0, queryStart);

    return pathOnly
        .split("/")
        .map((segment) => looksLikeId(segment) ? ID_PLACEHOLDER : segment)
        .join("/");
}

function looksLikeId(segment: string): boolean {
    return NUMERIC_ID.test(segment)
        || UUID.test(segment)
        || LONG_HEX_ID.test(segment)
        || ULID.test(segment);
}
