/** Configuration for createBackendRegistrationEndpoint(). */
export interface BackendRegistrationEndpointOptions {
    /** URL the endpoint is mounted under, e.g. "/_lb/registry". Backends PUT to `${path}/{id}`. */
    path: string;

    /**
     * Shared secret backends present as `Authorization: Bearer <token>`.
     * Required unless allowUnauthenticated is set: an open registration
     * endpoint lets anyone who can reach it register a backend of their
     * choosing and receive a share of all traffic.
     */
    token?: string;

    /**
     * Opts out of the token requirement. Named loudly on purpose - the
     * unsafe choice should be something you have to type out, not
     * something you get by omission.
     */
    allowUnauthenticated?: boolean;

    /**
     * Accept requests from non-loopback clients. By default only
     * 127.0.0.1 / ::1 may register backends. Combined with
     * allowUnauthenticated this is an open relay - do not do both.
     */
    allowRemote?: boolean;
}
