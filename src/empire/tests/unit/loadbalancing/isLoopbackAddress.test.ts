import { describe, it, expect } from "vitest";
import { isLoopbackAddress } from "../../../src/loadbalancing/isLoopbackAddress";

describe("isLoopbackAddress", () => {

    it.each(["127.0.0.1", "127.0.0.2", "127.255.255.254", "::1", "::ffff:127.0.0.1", "::ffff:127.9.9.9"])(
        "accepts %s",
        (address) => {
            expect(isLoopbackAddress(address)).toBe(true);
        }
    );

    it.each(["10.0.0.1", "192.168.1.5", "203.0.113.9", "::ffff:10.0.0.1", "2001:db8::1", "::2", "128.0.0.1", "localhost", "1127.0.0.1", ""])(
        "rejects %j",
        (address) => {
            expect(isLoopbackAddress(address)).toBe(false);
        }
    );

    it("rejects an unknown address rather than assuming it is local", () => {
        expect(isLoopbackAddress(undefined)).toBe(false);
    });
});
