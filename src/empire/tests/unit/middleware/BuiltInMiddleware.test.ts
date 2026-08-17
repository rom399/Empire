import { describe, it, expect } from "vitest";
import { createLoggerMiddleware } from "../../../src/middleware/LoggerMiddleware";
import { Context } from "../../../src/http/Context";
import { createMockRequest, createMockResponse } from "../../fixtures/http/MockHttp";
import { TestLogger } from "../../fixtures/services/TestLogger";

/**
 * FINDING 5 — the shipped LoggerMiddleware called next() without awaiting
 * it, so a rejection downstream became an unhandled rejection and the
 * pipeline resolved before downstream work completed. It is also the
 * example people will copy from the README.
 */
describe("Built-in middleware", () => {

    function ctxFor() {
        const req = createMockRequest({ method: "GET", url: "/" });
        const res = createMockResponse();
        return new Context(req, res as unknown as never);
    }

    it("LoggerMiddleware awaits next()", async () => {
        let downstreamCompleted = false;
        const loggerMiddleware = createLoggerMiddleware(new TestLogger());

        await loggerMiddleware(ctxFor(), async () => {
            await new Promise((r) => setTimeout(r, 10));
            downstreamCompleted = true;
        });

        expect(downstreamCompleted).toBe(true);
    });

    it("LoggerMiddleware propagates a downstream rejection", async () => {
        const loggerMiddleware = createLoggerMiddleware(new TestLogger());

        await expect(
            loggerMiddleware(ctxFor(), async () => {
                throw new Error("downstream failure");
            })
        ).rejects.toThrow("downstream failure");
    });

    it("LoggerMiddleware logs through the injected logger, not console", async () => {
        const logger = new TestLogger();
        const loggerMiddleware = createLoggerMiddleware(logger);

        await loggerMiddleware(ctxFor(), async () => {});

        expect(logger.infoMessages).toEqual(["GET /"]);
    });
});
