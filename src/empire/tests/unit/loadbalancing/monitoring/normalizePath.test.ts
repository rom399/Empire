import { describe, it, expect } from "vitest";
import { normalizePath } from "../../../../src/loadbalancing/monitoring/normalizePath";

describe("normalizePath", () => {

    it("replaces an all-digit segment with :id", () => {
        expect(normalizePath("/users/42")).toBe("/users/:id");
    });

    it("replaces every id-like segment in the path", () => {
        expect(normalizePath("/users/42/orders/7")).toBe("/users/:id/orders/:id");
    });

    it("replaces a UUID", () => {
        expect(normalizePath("/items/3f2b8c1e-9d4a-4e5f-8a6b-1c2d3e4f5a6b")).toBe("/items/:id");
    });

    it("replaces a long hex string", () => {
        expect(normalizePath("/blobs/9f86d081884c7d659a2feaa0c55ad015")).toBe("/blobs/:id");
    });

    it("replaces a ULID", () => {
        expect(normalizePath("/events/01ARZ3NDEKTSV4RRFFQ69G5FAV")).toBe("/events/:id");
    });

    it("leaves ordinary words untouched", () => {
        expect(normalizePath("/api/users/profile")).toBe("/api/users/profile");
    });

    it("leaves short hex-looking words such as 'cafe' untouched", () => {
        expect(normalizePath("/menu/cafe/dead")).toBe("/menu/cafe/dead");
    });

    it("drops the query string before normalising", () => {
        expect(normalizePath("/users/42?token=abc&page=2")).toBe("/users/:id");
    });

    it("keeps the root path as-is", () => {
        expect(normalizePath("/")).toBe("/");
    });
});
