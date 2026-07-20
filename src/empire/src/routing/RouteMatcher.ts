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

        const requestSegments =
            requestPath.split("/").filter(Boolean);

        if (routeSegments.length !== requestSegments.length) {
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
}
