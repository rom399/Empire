import { describe, it, expect } from "vitest";
import { formatIssueField } from "../../../src/validation/formatIssueField";

describe("formatIssueField", () => {

    it("joins string and number path segments with dots", () => {
        expect(formatIssueField("body", ["user", "tags", 2])).toBe("body.user.tags.2");
    });

    it("unwraps a path segment written as { key }", () => {
        expect(formatIssueField("body", [{ key: "name" }])).toBe("body.name");
        expect(formatIssueField("body", ["a", { key: 1 }])).toBe("body.a.1");
    });

    it("reports the location alone for a missing path, without a trailing dot", () => {
        expect(formatIssueField("body", undefined)).toBe("body");
    });

    it("reports the location alone for an empty path, without a trailing dot", () => {
        expect(formatIssueField("body", [])).toBe("body");
    });

    it("renders a symbol segment instead of throwing", () => {
        expect(formatIssueField("body", [Symbol("s")])).toBe("body.Symbol(s)");
        expect(formatIssueField("body", [{ key: Symbol("t") }])).toBe("body.Symbol(t)");
    });

    it.each(["body", "query", "params"] as const)("uses %s verbatim as the prefix", (location) => {
        expect(formatIssueField(location, ["x"])).toBe(`${location}.x`);
    });
});
