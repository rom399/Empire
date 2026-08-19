import { BadRequestError } from "./BadRequestError";
import { ValidationIssue } from "./ValidationIssue";

/**
 * Thrown when validate() rejects a request body, query string, or set of
 * route params against its schema. Extends BadRequestError rather than
 * HttpError directly - a validation failure already is a 400, this is
 * just a more specific reason for one. `message` stays a single readable
 * string (so anything that only reads HttpError.message, like logging,
 * needs no changes), while `details` carries the structured per-field
 * breakdown for anything that wants it - see sendErrorResponse.ts.
 */
export class ValidationError extends BadRequestError {

    public readonly details: ValidationIssue[];

    public constructor(details: ValidationIssue[]) {
        super(details.map((issue) => `${issue.field}: ${issue.message}`).join("; "));

        this.details = details;
    }
}
