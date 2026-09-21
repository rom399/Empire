import { describe, it, expect } from "vitest";
import { resolveRequestId } from "../../../../src/loadbalancing/proxy/resolveRequestId";
import { Context } from "../../../../src/http/Context";
import { createMockRequest, createMockResponse } from "../../../fixtures/http/MockHttp";

describe("resolveRequestId", () => {

    function ctx(): Context {
        return new Context(createMockRequest(), createMockResponse() as unknown as never);
    }

    it("generates an id when nothing was stored", () => {
        expect(resolveRequestId(ctx(), () => "generated-1")).toBe("generated-1");
    });

    it("reuses a safe id stored in ctx.state.requestId", () => {
        const context = ctx();
        context.state.requestId = "trace-42";

        expect(resolveRequestId(context, () => "generated-1")).toBe("trace-42");
    });

    it.each(["has space", "new\nline", "semi;colon", "", "a".repeat(129)])("ignores an unsafe stored id %j", (unsafe) => {
        const context = ctx();
        context.state.requestId = unsafe;

        expect(resolveRequestId(context, () => "generated-1")).toBe("generated-1");
    });

    it.each([42, null, undefined, {}, ["a"]])("ignores a stored id that is not a string: %j", (value) => {
        const context = ctx();
        context.state.requestId = value;

        expect(resolveRequestId(context, () => "generated-1")).toBe("generated-1");
    });

    it("only calls the generator when it needs to", () => {
        const context = ctx();
        context.state.requestId = "trace-42";
        let calls = 0;

        resolveRequestId(context, () => { calls += 1; return "x"; });

        expect(calls).toBe(0);
    });
});
