/** Configuration for createLoadBalancerDashboard(). */
export interface LoadBalancerDashboardOptions {
    /** URL the dashboard is mounted under, e.g. "/_lb". Must not be the site root. */
    path: string;

    /**
     * Serve non-loopback clients. By default only 127.0.0.1 / ::1 may open
     * the dashboard, because it exposes backend URLs and request paths.
     */
    allowRemote?: boolean;

    /**
     * Where the browser loads three.js from, as a URL ending in "/" that
     * has the package's own layout beneath it (build/three.module.js,
     * examples/jsm/...). Defaults to a pinned version on the jsDelivr CDN,
     * which needs no install but does need internet access and trusts that
     * host; ignored when threeLocalPath is set.
     */
    three?: { baseUrl?: string };

    /**
     * Directory of an installed `three` package - typically
     * `path.dirname(require.resolve("three/package.json"))`. When set, the
     * dashboard serves it itself under `{path}/vendor/three/`, so an offline
     * machine works. `three` is then *your* dependency, never Empire's.
     */
    threeLocalPath?: string;

    /** Interval between SSE keep-alive comments. Defaults to 15 seconds. */
    heartbeatIntervalMs?: number;
}
