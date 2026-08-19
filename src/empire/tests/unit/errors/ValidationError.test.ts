import { describe, it, expect } from "vitest";
import { BadRequestError } from "../../../src/errors/BadRequestError";
import { ValidationError } from "../../../src/errors/ValidationError";

describe("ValidationError", () => {

    it("is an instance of BadRequestError, and carries a 400 status", () => {
        const err = new ValidationError([{ field: "body.name", message: "Required" }]);

        expect(err).toBeInstanceOf(BadRequestError);
        expect(err.statusCode).toBe(400);
    });

    it("sets name to ValidationError so it survives serialisation", () => {
        expect(new ValidationError([{ field: "body.name", message: "Required" }]).name)
            .toBe("ValidationError");
    });

    it("exposes the details array unchanged", () => {
        const details = [
            { field: "body.name", message: "Required" },
            { field: "body.email", message: "Invalid email" },
        ];

        expect(new ValidationError(details).details).toEqual(details);
    });

    it("joins every issue into one readable message", () => {
        const err = new ValidationError([
            { field: "body.name", message: "Required" },
            { field: "body.email", message: "Invalid email" },
        ]);

        expect(err.message).toBe("body.name: Required; body.email: Invalid email");
    });

    it("produces a single-field message unchanged by joining", () => {
        const err = new ValidationError([{ field: "body.name", message: "Required" }]);

        expect(err.message).toBe("body.name: Required");
    });
});
