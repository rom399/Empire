import { RouteMatch } from "./RouteMatch";

/**
 * Matches request paths against registered route path patterns,
 * extracting ":name" route parameters along the way.
 */
export class RouteMatcher {

    /**
     * Compares a route's path pattern to an incoming request path
     * segment by segment. Segments starting with ":" bind whatever
     * value appears in that position as a route parameter.
     */
    public match(routePath: string, requestPath: string): RouteMatch {

        const routeSegments =
            routePath.split("/").filter(Boolean);

        const requestSegments = this.splitRequestSegments(requestPath);

        if (!requestSegments || routeSegments.length !== requestSegments.length) {
            return {
                matched: false,
                params: {}
            };
        }

        const params: Record<string, string> = {};

        for (let i = 0; i < routeSegments.length; i++) {

            const routeSegment = routeSegments[i];
            const requestSegment = requestSegments[i];

            if (routeSegment.startsWith(":")) {

                const paramName = routeSegment.slice(1);
                params[paramName] = requestSegment;

                continue;
            }

            if (routeSegment !== requestSegment) {
                return {
                    matched: false,
                    params: {}
                };
            }
        }

        return {
            matched: true,
            params
        };
    }

    /**
     * Splits a request path into decoded segments. Tolerates a single
     * leading slash (every absolute path has one) and a single trailing
     * slash ("/users" and "/users/" are the same route), but any OTHER
     * empty segment means a doubled "//" somewhere in the path — returns
     * null rather than silently collapsing it into a shorter match.
     */
    private splitRequestSegments(requestPath: string): string[] | null {

        const raw = requestPath.split("/");

        if (raw[0] === "") {
            raw.shift();
        }

        if (raw.length > 0 && raw[raw.length - 1] === "") {
            raw.pop();
        }

        if (raw.includes("")) {
            return null;
        }

        return raw.map((segment) => decodeURIComponent(segment));
    }
}
