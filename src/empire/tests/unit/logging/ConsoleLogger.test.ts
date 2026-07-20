import { describe, it, expect, vi, afterEach } from "vitest";
import { ConsoleLogger } from "../../../src/logging/ConsoleLogger";

describe("ConsoleLogger", () => {

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("info / warn / debug", () => {

        it("writes info messages to console.log with an [INFO] tag", () => {
            const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
            const logger = new ConsoleLogger();

            logger.info("server started");

            expect(logSpy).toHaveBeenCalledTimes(1);
            expect(logSpy.mock.calls[0][0]).toContain("[INFO] server started");
        });

        it("writes warn messages to console.log with a [WARN] tag", () => {
            const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
            const logger = new ConsoleLogger();

            logger.warn("low disk space");

            expect(logSpy).toHaveBeenCalledTimes(1);
            expect(logSpy.mock.calls[0][0]).toContain("[WARN] low disk space");
        });

        it("writes debug messages to console.log with a [DEBUG] tag", () => {
            const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
            const logger = new ConsoleLogger();

            logger.debug("cache miss");

            expect(logSpy).toHaveBeenCalledTimes(1);
            expect(logSpy.mock.calls[0][0]).toContain("[DEBUG] cache miss");
        });

        it("includes an ISO timestamp in every log line", () => {
            const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
            const logger = new ConsoleLogger();

            logger.info("checking timestamp");

            const isoTimestampPattern = /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/;
            expect(logSpy.mock.calls[0][0]).toMatch(isoTimestampPattern);
        });
    });

    describe("error", () => {

        it("writes error messages to console.error, not console.log, with an [ERROR] tag", () => {
            const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
            const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
            const logger = new ConsoleLogger();

            logger.error("request failed");

            expect(errorSpy).toHaveBeenCalledTimes(1);
            expect(logSpy).not.toHaveBeenCalled();
            expect(errorSpy.mock.calls[0][0]).toContain("[ERROR] request failed");
        });

        it("appends the error stack when error() is called with an Error object", () => {
            const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
            const logger = new ConsoleLogger();
            const cause = new Error("boom");

            logger.error("request failed", cause);

            const output = errorSpy.mock.calls[0][0] as string;
            expect(output).toContain("request failed\n");
            expect(output).toContain(cause.stack);
        });

        it("appends the stringified value when error() is called with a non-Error value", () => {
            const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
            const logger = new ConsoleLogger();

            logger.error("request failed", "connection reset");

            expect(errorSpy.mock.calls[0][0]).toContain("request failed\nconnection reset");
        });

        it("omits the appended detail when error() is called with no second argument", () => {
            const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
            const logger = new ConsoleLogger();

            logger.error("request failed");

            const output = errorSpy.mock.calls[0][0] as string;
            expect(output).toContain("[ERROR] request failed");
            expect(output).not.toContain("\n");
        });
    });
});
