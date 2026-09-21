import { LoadBalancerMonitor } from "../monitoring/LoadBalancerMonitor";

/** Configuration for a BackendRegistry. */
export interface BackendRegistryOptions {
    /**
     * How long a registration lives without being renewed. Backends
     * heartbeat at a third of this, so two missed beats are tolerated
     * before one expires. A longer TTL forgives a backend paused in a
     * debugger; a shorter one drops a killed backend out of rotation
     * sooner. Defaults to 15 seconds.
     */
    leaseTtlMs?: number;

    /** Receives backendAdded / backendRemoved / leaseRenewed events. */
    monitor?: LoadBalancerMonitor;

    /** Clock, injectable for tests. Defaults to Date.now. */
    now?: () => number;
}
