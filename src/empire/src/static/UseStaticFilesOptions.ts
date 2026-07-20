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
}
