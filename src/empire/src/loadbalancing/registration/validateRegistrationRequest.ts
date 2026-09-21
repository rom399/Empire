import { ValidationError } from "../../errors/ValidationError";
import { ValidationIssue } from "../../errors/ValidationIssue";
import { BACKEND_ID_PATTERN, normalizeBackendUrl } from "../backends/backendIdentity";

const ID_MESSAGE = "must be 1-128 letters, digits, '-', '_' or ':'";
const URL_MESSAGE = "must be an absolute http: origin such as http://127.0.0.1:5001 (no path, query or credentials)";

/**
 * Checks a registration request - the id from the path and the JSON body -
 * and returns the clean values, or throws one ValidationError listing every
 * problem found. Reporting them all at once means a backend with both a bad
 * id and a bad url learns about both from a single 400.
 *
 * Written by hand rather than with a validation library because the rules
 * are two fields long, and Empire keeps no dependencies. The body is read
 * with plain property access and never copied from, so a "__proto__" key
 * in it is just an ignored field.
 */
export function validateRegistrationRequest(id: string, body: unknown): { id: string; url: string } {
    const issues: ValidationIssue[] = [];

    if (!BACKEND_ID_PATTERN.test(id)) {
        issues.push({ field: "params.id", message: ID_MESSAGE });
    }

    let url = "";

    if (typeof body !== "object" || body === null || Array.isArray(body)) {
        issues.push({ field: "body", message: "must be a JSON object" });
    } else {
        const candidate = (body as { url?: unknown }).url;

        if (typeof candidate !== "string") {
            issues.push({ field: "body.url", message: "must be a string" });
        } else {
            const normalized = normalizeBackendUrl(candidate);

            if (normalized === undefined) {
                issues.push({ field: "body.url", message: URL_MESSAGE });
            } else {
                url = normalized;
            }
        }
    }

    if (issues.length > 0) {
        throw new ValidationError(issues);
    }

    return { id, url };
}

/** For DELETE, which carries no body: only the id is checked. */
export function validateBackendId(id: string): { id: string } {
    if (!BACKEND_ID_PATTERN.test(id)) {
        throw new ValidationError([{ field: "params.id", message: ID_MESSAGE }]);
    }

    return { id };
}
