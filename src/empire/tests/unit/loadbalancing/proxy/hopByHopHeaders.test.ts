import { describe, it, expect } from "vitest";
import { stripHopByHopHeaders } from "../../../../src/loadbalancing/proxy/hopByHopHeaders";

describe("stripHopByHopHeaders", () => {

    it("keeps ordinary end-to-end headers", () => {
        const kept = stripHopByHopHeaders({ "content-type": "application/json", authorization: "Bearer x", "x-custom": "1" });

        expect(kept).toEqual({ "content-type": "application/json", authorization: "Bearer x", "x-custom": "1" });
    });

    it.each([
        "connection", "keep-alive", "proxy-connection", "proxy-authenticate",
        "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade",
    ])("removes %s", (name) => {
        const kept = stripHopByHopHeaders({ [name]: "value", "x-keep": "yes" });

        expect(kept).toEqual({ "x-keep": "yes" });
    });

    it("also removes any header named inside Connection", () => {
        const kept = stripHopByHopHeaders({
            connection: "keep-alive, X-Secret",
            "x-secret": "shh",
            "x-public": "hello",
        });

        expect(kept).toEqual({ "x-public": "hello" });
    });

    it("reads the Connection list case-insensitively and tolerates stray whitespace and commas", () => {
        const kept = stripHopByHopHeaders({
            connection: " Close ,  X-Secret ,, ",
            "x-secret": "shh",
            "x-public": "hello",
        });

        expect(kept).toEqual({ "x-public": "hello" });
    });

    it("preserves array-valued headers such as set-cookie", () => {
        const kept = stripHopByHopHeaders({ "set-cookie": ["a=1", "b=2"] });

        expect(kept["set-cookie"]).toEqual(["a=1", "b=2"]);
    });

    it("does not mutate its input", () => {
        const input = { connection: "close", "x-a": "1" };

        stripHopByHopHeaders(input);

        expect(input).toEqual({ connection: "close", "x-a": "1" });
    });

    it("skips undefined values", () => {
        expect(stripHopByHopHeaders({ "x-a": undefined, "x-b": "1" })).toEqual({ "x-b": "1" });
    });
});
