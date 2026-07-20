export interface StaticFileOptions {
    root: string;

    /**
     * URL prefix this handler is mounted under, e.g. "/assets".
     * Requests that do not start with the prefix are ignored, allowing
     * multiple static folders to be mounted at different URL prefixes.
     * When omitted, every request path is checked against root directly.
     */
    prefix?: string;
}
