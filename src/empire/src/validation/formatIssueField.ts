import { StandardSchemaIssue } from "./standard/StandardSchemaIssue";

/**
 * Turns a validator's issue path into the dotted `field` a client sees,
 * e.g. `body.user.tags.2`. A path step may be a bare key or a `{ key }`
 * object; String() is used because Array.join throws on a symbol. An issue
 * with no path applies to the whole value, so it reports the location
 * alone (`body`, not `body.`).
 */
export function formatIssueField(
    location: "body" | "query" | "params",
    path: StandardSchemaIssue["path"]
): string {
    if (path === undefined || path.length === 0) {
        return location;
    }

    const segments = path.map((segment) =>
        String(typeof segment === "object" ? segment.key : segment)
    );

    return [location, ...segments].join(".");
}
