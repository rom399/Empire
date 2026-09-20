/** One request as it appears in a backend's live call tail. */
export interface RecentCall {
    requestId: string;
    method: string;
    path: string;
    route: string;
    guessedRoute: boolean;
    outcome: "completed" | "failed" | "aborted";
    status?: number;
    durationMs?: number;

    /** Set when outcome is "failed": where in the proxy path it went wrong. */
    phase?: string;
    at: number;
}
