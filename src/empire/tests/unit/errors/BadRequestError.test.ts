import { describe, it, expect } from "vitest";
import { HttpError } from "../../../src/errors/HttpError";
import { BadRequestError } from "../../../src/errors/BadRequestError";

describe("BadRequestError", () => {

    it("sets statusCode to 400 regardless of what is passed", () => {
        expect(new BadRequestError("Bad").statusCode).toBe(400);
    });

    it("sets message to the value passed to the constructor", () => {
        expect(new BadRequestError("Name is required").message).toBe("Name is required");
    });

    it("is an instance of HttpError", () => {
        expect(new BadRequestError("Bad")).toBeInstanceOf(HttpError);
    });
});
