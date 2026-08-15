import { describe, it, expect } from "vitest";
import { MimeTypes } from "../../../src/static/MimeTypes";

describe("MimeTypes", () => {

    const cases: Array<[extension: string, mimeType: string]> = [
        [".html", "text/html"],
        [".css", "text/css"],
        [".js", "text/javascript"],
        [".json", "application/json"],
        [".png", "image/png"],
        [".jpg", "image/jpeg"],
        [".jpeg", "image/jpeg"],
        [".gif", "image/gif"],
        [".svg", "image/svg+xml"],
        [".ico", "image/x-icon"],
        [".txt", "text/plain"],
        [".pdf", "application/pdf"],
        [".woff", "font/woff"],
        [".woff2", "font/woff2"],
        [".ttf", "font/ttf"],
        [".eot", "application/vnd.ms-fontobject"],
        [".map", "application/json"],
    ];

    it.each(cases)("getType(%s) returns %s", (extension, mimeType) => {
        expect(MimeTypes.getType(extension)).toBe(mimeType);
    });

    it("matching is case-insensitive", () => {
        expect(MimeTypes.getType(".HTML")).toBe("text/html");
        expect(MimeTypes.getType(".Js")).toBe("text/javascript");
    });

    it("falls back to application/octet-stream for an unknown extension", () => {
        expect(MimeTypes.getType(".xyz")).toBe("application/octet-stream");
    });
});
