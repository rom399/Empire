import { describe, it, expect } from "vitest";
import { RouteMatcher } from "../../../src/routing/RouteMatcher";

describe("RouteMatcher", () => {

    describe("match", () => {

        it("matches an exact static path", () => {
            const matcher = new RouteMatcher();

            const result = matcher.match("/users", "/users");

            expect(result.matched).toBe(true);
            expect(result.params).toEqual({});
        });

        it("does not match when segment counts differ", () => {
            const matcher = new RouteMatcher();

            const result = matcher.match("/users", "/users/1");

            expect(result.matched).toBe(false);
            expect(result.params).toEqual({});
        });

        it("extracts a single :param from the path", () => {
            const matcher = new RouteMatcher();

            const result = matcher.match("/users/:id", "/users/42");

            expect(result.matched).toBe(true);
            expect(result.params).toEqual({ id: "42" });
        });

        it("extracts multiple :param segments from the path", () => {
            const matcher = new RouteMatcher();

            const result = matcher.match(
                "/users/:userId/posts/:postId",
                "/users/7/posts/99"
            );

            expect(result.matched).toBe(true);
            expect(result.params).toEqual({ userId: "7", postId: "99" });
        });

        it("matches a static segment that follows a :param", () => {
            const matcher = new RouteMatcher();

            const result = matcher.match(
                "/users/:id/posts",
                "/users/42/posts"
            );

            expect(result.matched).toBe(true);
            expect(result.params).toEqual({ id: "42" });
        });

        it("does not match when a static segment differs", () => {
            const matcher = new RouteMatcher();

            const result = matcher.match("/users/:id/posts", "/users/42/comments");

            expect(result.matched).toBe(false);
            expect(result.params).toEqual({});
        });

        it("matches the root path", () => {
            const matcher = new RouteMatcher();

            const result = matcher.match("/", "/");

            expect(result.matched).toBe(true);
            expect(result.params).toEqual({});
        });
    });
});
