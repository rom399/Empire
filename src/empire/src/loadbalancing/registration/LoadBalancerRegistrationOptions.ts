import { ILogger } from "../../logging/ILogger";

/** Configuration for a LoadBalancerRegistration. */
export interface LoadBalancerRegistrationOptions {
    /** The balancer's registration endpoint, e.g. "http://127.0.0.1:5000/_lb/registry". */
    registryUrl: string;

    /** This backend's unique id. Two backends must never share one. */
    id: string;

    /** The origin the balancer should forward to, e.g. "http://127.0.0.1:5001". */
    url: string;

    /** Sent as `Authorization: Bearer <token>` - must match the endpoint's token. */
    token?: string;

    /** Where heartbeat failures are reported. Defaults to a ConsoleLogger. */
    logger?: ILogger;

    /**
     * Upper bound on a single register/heartbeat request, so a hung
     * balancer cannot stall the heartbeat loop. Defaults to 5 seconds.
     */
    requestTimeoutMs?: number;
}
