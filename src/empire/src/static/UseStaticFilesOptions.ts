/**
 * Optional settings for Empire.useStaticFiles().
 */
export interface UseStaticFilesOptions {
    /**
     * URL prefix to mount the static folder under, e.g. "/assets".
     * Lets multiple static folders be served from different URL
     * prefixes on the same server. Omit to serve from the URL root.
     */
    prefix?: string;

    /**
     * Enables single-page-app support: when no static file and no
     * registered route matches a request, root/index.html is served
     * instead of a 404, so client-side routers (e.g. React Router) can
     * render the path themselves. Intended for the unprefixed folder
     * serving the application shell — only one fallback can be active
     * per server, since Router.setFallback() replaces any previous one.
     */
    spaFallback?: boolean;
}
