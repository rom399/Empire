import { describe, it, expect } from "vitest";
import { HttpError } from "../../../src/errors/HttpError";
import { BadRequestError } from "../../../src/errors/BadRequestError";

/**
 * FINDING 13 — HttpError carries only a status and message. A machine-readable
 * `code` (and a `retryable` hint) is the smallest useful addition, and it is
 * purely additive: existing two-argument calls keep working.
 *
 * Worth settling before anyone depends on the serialised error shape.
 */
describe("HttpError", () => {

    it("keeps the existing two-argument form working", () => {
        const err = new HttpError(404, "Not found");

        expect(err.statusCode).toBe(404);
        expect(err.message).toBe("Not found");
    });

    it("carries an optional machine-readable code", () => {
        const err = new HttpError(503, "Upstream down", { code: "UPSTREAM_UNAVAILABLE" });

        expect(err.code).toBe("UPSTREAM_UNAVAILABLE");
    });

    it("carries an optional retryable hint", () => {
        const err = new HttpError(503, "Upstream down", {
            code: "UPSTREAM_UNAVAILABLE",
            retryable: true,
        });

        expect(err.retryable).toBe(true);
    });

    it("leaves code undefined when not supplied", () => {
        expect(new HttpError(500, "Boom").code).toBeUndefined();
    });

    it("sets the error name so it survives serialisation", () => {
        expect(new HttpError(404, "Not found").name).toBe("HttpError");
        expect(new BadRequestError("Bad").name).toBe("BadRequestError");
    });

    it("is catchable as an Error and as an HttpError", () => {
        const err = new BadRequestError("Name is required");

        expect(err).toBeInstanceOf(Error);
        expect(err).toBeInstanceOf(HttpError);
        expect(err.statusCode).toBe(400);
    });
});
