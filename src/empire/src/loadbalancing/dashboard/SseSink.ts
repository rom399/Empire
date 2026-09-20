/** The slice of http.ServerResponse an SSE client needs - kept narrow so a test can stand in for a slow socket. */
export interface SseSink {
    /** Writes a chunk; false means the connection is backed up and the caller should stop until "drain". */
    write(chunk: string): boolean;

    /** Registers a one-shot listener for the connection emptying again. */
    once(event: "drain", listener: () => void): unknown;
}
