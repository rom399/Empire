import { describe, it, expect } from "vitest";
import { sendErrorResponse } from "../../../src/errors/sendErrorResponse";
import { HttpError } from "../../../src/errors/HttpError";
import { BadRequestError } from "../../../src/errors/BadRequestError";
import { ValidationError } from "../../../src/errors/ValidationError";
import { createMockResponse } from "../../fixtures/http/MockHttp";
import { TestLogger } from "../../fixtures/services/TestLogger";

describe("sendErrorResponse", () => {

    it("writes an HttpError's own status code and message as JSON", () => {
        const res = createMockResponse();

        sendErrorResponse(res, new HttpError(404, "Not found"), new TestLogger(), "msg");

        expect(res.statusCode).toBe(404);
        expect(JSON.parse(res.body)).toEqual({ error: "Not found" });
    });

    it("does not include a details field for a plain HttpError or BadRequestError", () => {
        const res = createMockResponse();

        sendErrorResponse(res, new BadRequestError("Bad"), new TestLogger(), "msg");

        expect(JSON.parse(res.body)).not.toHaveProperty("details");
    });

    it("includes details for a ValidationError, additively alongside error", () => {
        const res = createMockResponse();
        const details = [{ field: "body.name", message: "Required" }];

        sendErrorResponse(res, new ValidationError(details), new TestLogger(), "msg");

        expect(res.statusCode).toBe(400);
        expect(JSON.parse(res.body)).toEqual({
            error: "body.name: Required",
            details,
        });
    });

    it("returns a generic 500 for a non-HttpError", () => {
        const res = createMockResponse();

        sendErrorResponse(res, new Error("boom"), new TestLogger(), "msg");

        expect(res.statusCode).toBe(500);
        expect(JSON.parse(res.body)).toEqual({ error: "Internal Server Error" });
    });

    it("logs through the given logger", () => {
        const logger = new TestLogger();

        sendErrorResponse(createMockResponse(), new Error("boom"), logger, "Unhandled error");

        expect(logger.errorMessages).toContain("Unhandled error");
    });
});
