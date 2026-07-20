/**
 * The result of matching a registered route's path pattern
 * against an incoming request path.
 */
export interface RouteMatch {
    /** True when the request path satisfies the route pattern. */
    matched: boolean;

    /** Route parameters extracted from ":name" segments. Empty when unmatched. */
    params: Record<string, string>;
}
