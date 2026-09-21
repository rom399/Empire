/** The two values the dashboard page is rendered around. */
export interface DashboardPageOptions {
    /** Where the dashboard is mounted, e.g. "/_lb" - the page fetches its events and detail from here. */
    basePath: string;

    /** Base URL, ending in "/", that three.js and its addons are loaded from. */
    threeBaseUrl: string;
}
