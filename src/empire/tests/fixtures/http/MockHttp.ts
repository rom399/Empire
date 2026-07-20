import { EventEmitter } from "events";
import type http from "http";

/**
 * A minimal http.ServerResponse stand-in for tests. Captures the written
 * body and headers in memory instead of writing to a real socket.
 *
 * This does not implement the full ServerResponse surface — some of its
 * real members (e.g. `headersSent`) are read-only and backed by an
 * internal socket that doesn't exist in a test. Router and route handlers
 * only ever touch the members built here, so the object is cast to
 * http.ServerResponse at the call site rather than genuinely implementing it.
 */
export type MockResponse = http.ServerResponse & { body: string };

interface MockRequestOptions {
    method?: string;
    url?: string;
    headers?: Record<string, string>;
}

/**
 * Builds a minimal http.IncomingMessage stand-in carrying just the fields
 * Router and Context read: method, url, and headers.
 */
export function createMockRequest(options: MockRequestOptions = {}): http.IncomingMessage {

    const req = new EventEmitter() as unknown as http.IncomingMessage;

    (req as unknown as { method: string }).method = options.method ?? "GET";
    (req as unknown as { url: string }).url = options.url ?? "/";
    (req as unknown as { headers: Record<string, string> }).headers =
        options.headers ?? { host: "localhost" };

    return req;
}

/**
 * Builds a minimal http.ServerResponse stand-in. Tracks statusCode,
 * headers, and the written body without touching a real socket.
 */
export function createMockResponse(): MockResponse {

    const emitter = new EventEmitter();
    const headers: Record<string, unknown> = {};

    const plain = Object.assign(emitter, {
        statusCode: 200,
        headersSent: false,
        body: "",

        setHeader(name: string, value: unknown) {
            headers[name.toLowerCase()] = value;
            return plain;
        },

        getHeader(name: string) {
            return headers[name.toLowerCase()];
        },

        getHeaders() {
            return headers;
        },

        end(data?: unknown) {
            if (typeof data === "string") {
                plain.body += data;
            }
            plain.headersSent = true;
            plain.emit("finish");
            return plain;
        },
    });

    return plain as unknown as MockResponse;
}
