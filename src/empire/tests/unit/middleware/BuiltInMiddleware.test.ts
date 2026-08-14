import { describe, it, expect } from "vitest";
import { LoggerMiddleware } from "../../../src/middleware/LoggerMiddleware";
import { AuthMiddleware } from "../../../src/middleware/AuthMiddleware";
import { Context } from "../../../src/http/Context";
import { createMockRequest, createMockResponse } from "../../fixtures/http/MockHttp";

/**
 * FINDING 5 — both shipped middleware call next() without awaiting it, so a
 * rejection downstream becomes an unhandled rejection and the pipeline
 * resolves before downstream work completes. They are also the examples
 * people will copy from the README.
 */
describe("Built-in middleware", () => {

    function ctxFor() {
        const req = createMockRequest({ method: "GET", url: "/" });
        const res = createMockResponse();
        return new Context(req, res as unknown as never);
    }

    it("LoggerMiddleware awaits next()", async () => {
        let downstreamCompleted = false;

        await LoggerMiddleware(ctxFor(), async () => {
            await new Promise((r) => setTimeout(r, 10));
            downstreamCompleted = true;
        });

        expect(downstreamCompleted).toBe(true);
    });

    it("LoggerMiddleware propagates a downstream rejection", async () => {
        await expect(
            LoggerMiddleware(ctxFor(), async () => {
                throw new Error("downstream failure");
            })
        ).rejects.toThrow("downstream failure");
    });

    it("AuthMiddleware awaits next()", async () => {
        let downstreamCompleted = false;

        await AuthMiddleware(ctxFor(), async () => {
            await new Promise((r) => setTimeout(r, 10));
            downstreamCompleted = true;
        });

        expect(downstreamCompleted).toBe(true);
    });

    it("AuthMiddleware propagates a downstream rejection", async () => {
        await expect(
            AuthMiddleware(ctxFor(), async () => {
                throw new Error("downstream failure");
            })
        ).rejects.toThrow("downstream failure");
    });
});
