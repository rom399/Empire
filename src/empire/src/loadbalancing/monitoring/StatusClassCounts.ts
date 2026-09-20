/** An HTTP status grouped by its hundreds digit, e.g. 404 -> "4xx". */
export type StatusClass = "1xx" | "2xx" | "3xx" | "4xx" | "5xx";

/** How many responses fell into each status class. */
export type StatusClassCounts = Record<StatusClass, number>;
