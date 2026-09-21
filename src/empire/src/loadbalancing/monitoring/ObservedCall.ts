/** The request-level facts every terminal event needs in order to be recorded. */
export interface ObservedCall {
    requestId: string;
    method: string;
    path: string;

    /** Route template - reported by the backend, or guessed from the path. */
    route: string;
    guessedRoute: boolean;
    at: number;
}
