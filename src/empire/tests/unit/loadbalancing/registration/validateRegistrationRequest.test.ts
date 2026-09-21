import { describe, it, expect } from "vitest";
import { ValidationError } from "../../../../src/errors/ValidationError";
import {
    validateBackendId,
    validateRegistrationRequest,
} from "../../../../src/loadbalancing/registration/validateRegistrationRequest";

const GOOD_URL = "http://127.0.0.1:5001";
const URL_MESSAGE = "must be an absolute http: origin such as http://127.0.0.1:5001 (no path, query or credentials)";

function detailsOf(run: () => unknown): ValidationError["details"] {
    try {
        run();
    } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);

        return (err as ValidationError).details;
    }

    return expect.unreachable("expected a ValidationError");
}

describe("validateRegistrationRequest", () => {

    it("returns the id and the normalised url for a valid request", () => {
        expect(validateRegistrationRequest("alpha", { url: `${GOOD_URL}/` })).toEqual({
            id: "alpha",
            url: GOOD_URL,
        });
    });

    describe("id", () => {

        it.each([1, 128])("accepts an id of %i characters", (length) => {
            const id = "a".repeat(length);

            expect(validateRegistrationRequest(id, { url: GOOD_URL }).id).toBe(id);
        });

        it.each([0, 129])("rejects an id of %i characters", (length) => {
            expect(detailsOf(() => validateRegistrationRequest("a".repeat(length), { url: GOOD_URL }))).toEqual([
                { field: "params.id", message: "must be 1-128 letters, digits, '-', '_' or ':'" },
            ]);
        });

        it.each([" ", "/", ";", "<", "a b", "a/b"])("rejects an id containing %j", (bad) => {
            const details = detailsOf(() => validateRegistrationRequest(`x${bad}y`, { url: GOOD_URL }));

            expect(details.map((detail) => detail.field)).toEqual(["params.id"]);
        });

        it("accepts letters, digits, dash, underscore and colon", () => {
            expect(validateRegistrationRequest("Az09-_:x", { url: GOOD_URL }).id).toBe("Az09-_:x");
        });
    });

    describe("url", () => {

        it.each(["ftp://x", "http://h:1/api", "http://user:pw@h:1", "", "not a url"])(
            "rejects %j as not an absolute http: origin", (url) => {
                expect(detailsOf(() => validateRegistrationRequest("alpha", { url }))).toEqual([
                    { field: "body.url", message: URL_MESSAGE },
                ]);
            }
        );

        it.each([
            ["missing", {}],
            ["null", { url: null }],
            ["a number", { url: 42 }],
            ["an array", { url: ["a"] }],
        ])("rejects a url that is %s", (_label, body) => {
            expect(detailsOf(() => validateRegistrationRequest("alpha", body))).toEqual([
                { field: "body.url", message: "must be a string" },
            ]);
        });
    });

    describe("body", () => {

        it.each([
            ["null", null],
            ["an array", []],
            ["a string", "text"],
            ["a number", 42],
        ])("rejects a body that is %s with a single body issue", (_label, body) => {
            expect(detailsOf(() => validateRegistrationRequest("alpha", body))).toEqual([
                { field: "body", message: "must be a JSON object" },
            ]);
        });

        it("ignores keys it does not know, and leaves Object.prototype alone", () => {
            const body = JSON.parse(`{"url":"${GOOD_URL}","weight":3,"__proto__":{"polluted":true}}`);

            expect(validateRegistrationRequest("alpha", body)).toEqual({ id: "alpha", url: GOOD_URL });
            expect(({} as Record<string, unknown>).polluted).toBeUndefined();
        });
    });

    describe("reporting every problem", () => {

        it("lists a bad id and a bad url together, id first", () => {
            expect(detailsOf(() => validateRegistrationRequest("bad id", { url: "ftp://x" }))).toEqual([
                { field: "params.id", message: "must be 1-128 letters, digits, '-', '_' or ':'" },
                { field: "body.url", message: URL_MESSAGE },
            ]);
        });

        it("lists a bad id and a body that is not an object together", () => {
            const details = detailsOf(() => validateRegistrationRequest("bad id", null));

            expect(details.map((detail) => detail.field)).toEqual(["params.id", "body"]);
        });

        it("puts every problem into the one error's message", () => {
            try {
                validateRegistrationRequest("bad id", { url: 1 });
                expect.unreachable("expected a ValidationError");
            } catch (err) {
                expect((err as ValidationError).message).toContain("params.id");
                expect((err as ValidationError).message).toContain("body.url");
            }
        });
    });
});

describe("validateBackendId", () => {

    it("returns a valid id", () => {
        expect(validateBackendId("alpha")).toEqual({ id: "alpha" });
    });

    it.each([0, 129])("rejects an id of %i characters", (length) => {
        expect(detailsOf(() => validateBackendId("a".repeat(length)))).toEqual([
            { field: "params.id", message: "must be 1-128 letters, digits, '-', '_' or ':'" },
        ]);
    });

    it.each([" ", "/", ";", "<"])("rejects an id containing %j", (bad) => {
        expect(detailsOf(() => validateBackendId(`x${bad}y`)).map((detail) => detail.field)).toEqual(["params.id"]);
    });

    it("accepts the same boundary lengths as registration", () => {
        expect(validateBackendId("a").id).toBe("a");
        expect(validateBackendId("a".repeat(128)).id).toHaveLength(128);
    });
});
