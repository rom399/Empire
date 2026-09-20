import { StatusClass, StatusClassCounts } from "./StatusClassCounts";

/** Builds an all-zero status class tally. */
export function emptyStatusClassCounts(): StatusClassCounts {
    return { "1xx": 0, "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0 };
}

/** Maps a status code to its class, or undefined for a code outside 100-599. */
export function statusClassOf(status: number): StatusClass | undefined {
    const digit = Math.floor(status / 100);

    return digit >= 1 && digit <= 5 ? (`${digit}xx` as StatusClass) : undefined;
}
