import { describe, it, expect } from "vitest";
import { createToken } from "../../../src/di/ServiceToken";

describe("createToken", () => {

    it("returns a symbol carrying the given name as its description", () => {
        const token = createToken<string>("Greeting");

        expect(typeof token).toBe("symbol");
        expect(token.description).toBe("Greeting");
    });

    it("returns a distinct token on every call, even with the same name", () => {
        const first = createToken<string>("Duplicate");
        const second = createToken<string>("Duplicate");

        expect(first).not.toBe(second);
    });
});
