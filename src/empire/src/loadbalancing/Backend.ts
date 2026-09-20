import { BackendInfo } from "./BackendInfo";

/**
 * A backend eligible to receive traffic, as a strategy sees it.
 */
export interface Backend extends BackendInfo {
    /**
     * Epoch milliseconds at which this backend's lease lapses.
     * Undefined for static backends, which never expire.
     */
    expiresAt?: number;
}
