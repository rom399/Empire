/**
 * Backend ids end up in logs and on the dashboard, so they use the same
 * conservative character set as request ids: alphanumerics, "-", "_" and
 * ":", up to 128 characters.
 */
export const BACKEND_ID_PATTERN = /^[A-Za-z0-9_:-]{1,128}$/;

/**
 * Reduces a backend URL to the origin the balancer forwards to, or
 * undefined when it is not usable: it must be an absolute http: URL with
 * no credentials, path, query or fragment - forwarding always uses the
 * client's own request target, so anything beyond the origin would be
 * silently ignored, and that is better rejected than quietly dropped.
 * Normalising means "http://h:1" and "http://h:1/" compare equal when the
 * registry decides whether a re-registration is a renewal or a conflict.
 */
export function normalizeBackendUrl(value: string): string | undefined {
    let parsed: URL;

    try {
        parsed = new URL(value);
    } catch {
        return undefined;
    }

    const hasExtras = parsed.username !== ""
        || parsed.password !== ""
        || parsed.search !== ""
        || parsed.hash !== ""
        || parsed.pathname !== "/";

    if (parsed.protocol !== "http:" || hasExtras) {
        return undefined;
    }

    return parsed.origin;
}
