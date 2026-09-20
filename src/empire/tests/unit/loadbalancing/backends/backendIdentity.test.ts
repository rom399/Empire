import { describe, it, expect } from "vitest";
import { BACKEND_ID_PATTERN, normalizeBackendUrl } from "../../../../src/loadbalancing/backends/backendIdentity";

describe("BACKEND_ID_PATTERN", () => {

    it.each(["alpha", "backend-1", "svc_a", "host:5001", "A1"])("accepts %s", (id) => {
        expect(BACKEND_ID_PATTERN.test(id)).toBe(true);
    });

    it.each(["", "has space", "slash/inside", "semi;colon", "<script>", "a".repeat(129)])(
        "rejects %j",
        (id) => {
            expect(BACKEND_ID_PATTERN.test(id)).toBe(false);
        }
    );

    it("accepts the 128-character maximum", () => {
        expect(BACKEND_ID_PATTERN.test("a".repeat(128))).toBe(true);
    });
});

describe("normalizeBackendUrl", () => {

    it("returns the origin of a plain http URL", () => {
        expect(normalizeBackendUrl("http://127.0.0.1:5001")).toBe("http://127.0.0.1:5001");
    });

    it("treats a trailing slash as the same URL", () => {
        expect(normalizeBackendUrl("http://127.0.0.1:5001/")).toBe("http://127.0.0.1:5001");
    });

    it("rejects https, which the balancer does not proxy", () => {
        expect(normalizeBackendUrl("https://example.com")).toBeUndefined();
    });

    it("rejects non-URLs", () => {
        expect(normalizeBackendUrl("not a url")).toBeUndefined();
        expect(normalizeBackendUrl("//no-scheme:80")).toBeUndefined();
    });

    it("rejects other protocols", () => {
        expect(normalizeBackendUrl("ftp://example.com")).toBeUndefined();
        expect(normalizeBackendUrl("javascript:alert(1)")).toBeUndefined();
    });

    it("rejects a URL carrying a path, query, fragment or credentials", () => {
        expect(normalizeBackendUrl("http://host:1/api")).toBeUndefined();
        expect(normalizeBackendUrl("http://host:1/?a=b")).toBeUndefined();
        expect(normalizeBackendUrl("http://host:1/#frag")).toBeUndefined();
        expect(normalizeBackendUrl("http://user:pw@host:1")).toBeUndefined();
    });
});
