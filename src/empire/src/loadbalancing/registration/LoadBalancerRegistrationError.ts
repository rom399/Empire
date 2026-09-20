/**
 * A registration or heartbeat the balancer answered with an error status.
 * Carries the status so the client can tell a problem retrying will never
 * fix (401 wrong token, 409 id clash) from one it might (a 5xx while the
 * balancer restarts).
 */
export class LoadBalancerRegistrationError extends Error {

    /** The HTTP status the balancer answered with. */
    public readonly status: number;

    /** Wraps a refused registration or heartbeat with the status it was refused with. */
    public constructor(status: number, message: string) {
        super(message);

        this.name = this.constructor.name;
        this.status = status;
    }
}
