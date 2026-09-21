import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { createLoadBalancerDashboard, THREE_VERSION } from "../../../../src/loadbalancing/dashboard/LoadBalancerDashboard";
import { ILoadBalancerDashboard } from "../../../../src/loadbalancing/dashboard/ILoadBalancerDashboard";
import { LoadBalancerDashboardOptions } from "../../../../src/loadbalancing/dashboard/LoadBalancerDashboardOptions";
import { LoadBalancerMonitor } from "../../../../src/loadbalancing/monitoring/LoadBalancerMonitor";
import { Context } from "../../../../src/http/Context";
import { HttpError } from "../../../../src/errors/HttpError";
import { createMockRequest, createMockResponse } from "../../../fixtures/http/MockHttp";
import { startEmpire, RunningServer } from "../../../fixtures/http/TestServers";
import { waitFor } from "../../../fixtures/http/waitFor";
import { TestLogger } from "../../../fixtures/services/TestLogger";

const MOUNT = "/_lb";

interface OpenStream {
    status: number;
    headers: http.IncomingHttpHeaders;
    received: () => string;
    ended: () => boolean;
    close: () => void;
}

describe("createLoadBalancerDashboard", () => {

    let monitor: LoadBalancerMonitor;
    let clock: number;
    const cleanups: (() => Promise<void> | void)[] = [];

    beforeEach(() => {
        clock = 1_000_000;
        monitor = new LoadBalancerMonitor({ logger: new TestLogger(), removedGraceMs: 1000, now: () => clock });
        monitor.publish({ type: "backendAdded", backend: { id: "alpha", url: "http://127.0.0.1:1", source: "registered" }, expiresAt: clock + 15_000, at: clock });
    });

    afterEach(async () => {
        while (cleanups.length > 0) {
            await cleanups.pop()?.();
        }
    });

    async function dashboard(options: Partial<LoadBalancerDashboardOptions> = {}): Promise<RunningServer & { dashboard: ILoadBalancerDashboard }> {
        const instance = createLoadBalancerDashboard(monitor, { path: MOUNT, ...options });
        const server = await startEmpire((app) => {
            app.use(instance);
            app.get("/other", (ctx) => ctx.text("router"));
        });
        cleanups.push(() => instance.dispose());
        cleanups.push(() => server.stop());

        return { ...server, dashboard: instance };
    }

    function openStream(server: RunningServer): Promise<OpenStream> {
        return new Promise((resolve, reject) => {
            const req = http.get(`${server.url}${MOUNT}/events`, (res) => {
                let text = "";
                let ended = false;
                res.setEncoding("utf8");
                res.on("data", (chunk: string) => { text += chunk; });
                res.on("end", () => { ended = true; });
                res.on("close", () => { ended = true; });
                res.on("error", () => undefined);

                const stream: OpenStream = {
                    status: res.statusCode ?? 0, headers: res.headers,
                    received: () => text, ended: () => ended, close: () => req.destroy(),
                };
                cleanups.push(() => req.destroy());
                resolve(stream);
            });

            req.on("error", (err) => { if (!req.destroyed) { reject(err); } });
        });
    }

    describe("the page", () => {

        it("serves HTML at the mount path", async () => {
            const { url } = await dashboard();

            const response = await fetch(`${url}${MOUNT}`);

            expect(response.status).toBe(200);
            expect(response.headers.get("content-type")).toContain("text/html");
            expect(await response.text()).toContain(MOUNT);
        });

        it("also serves it with a trailing slash", async () => {
            const { url } = await dashboard();

            expect((await fetch(`${url}${MOUNT}/`)).status).toBe(200);
        });

        it("is not cacheable, framable or sniffable", async () => {
            const { url } = await dashboard();

            const response = await fetch(`${url}${MOUNT}`);

            expect(response.headers.get("cache-control")).toBe("no-store");
            expect(response.headers.get("x-frame-options")).toBe("DENY");
            expect(response.headers.get("x-content-type-options")).toBe("nosniff");
        });

        it("points the page at the pinned CDN build of three.js by default", async () => {
            const { url } = await dashboard();

            const html = await (await fetch(`${url}${MOUNT}`)).text();

            expect(html).toContain(`https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/`);
        });

        it("points the page at a custom baseUrl when one is given", async () => {
            const { url } = await dashboard({ three: { baseUrl: "https://mirror.example/three/" } });

            const html = await (await fetch(`${url}${MOUNT}`)).text();

            expect(html).toContain("https://mirror.example/three/");
            expect(html).not.toContain("cdn.jsdelivr.net");
        });

        it("adds a trailing slash to a baseUrl that lacks one", async () => {
            const { url } = await dashboard({ three: { baseUrl: "https://mirror.example/three" } });

            const html = await (await fetch(`${url}${MOUNT}`)).text();

            expect(html).toContain("https://mirror.example/three/");
        });

        it("rejects methods other than GET and HEAD with 405", async () => {
            const { url } = await dashboard();

            const response = await fetch(`${url}${MOUNT}`, { method: "POST" });

            expect(response.status).toBe(405);
            expect(response.headers.get("allow")).toBe("GET, HEAD");
        });

        it.each(["/", "/other", "/_lbx", "/_lb/unknown", "/_lb/backends", "/_lb/backends/a/b"])(
            "passes %s through to the rest of the app",
            async (route) => {
                const { url } = await dashboard();

                const response = await fetch(`${url}${route}`);

                expect(response.status).toBe(route === "/other" ? 200 : 404);
                expect(response.headers.get("content-type") ?? "").not.toContain("text/html");
            }
        );
    });

    describe("the event stream", () => {

        it("is a text/event-stream response", async () => {
            const server = await dashboard();

            const stream = await openStream(server);

            expect(stream.status).toBe(200);
            expect(stream.headers["content-type"]).toBe("text/event-stream");
            expect(stream.headers["cache-control"]).toContain("no-cache");
        });

        it("sends a snapshot first, containing the current backends and strategy", async () => {
            monitor.setStrategyName("round-robin");
            const server = await dashboard();

            const stream = await openStream(server);
            await waitFor(() => stream.received().includes("event: snapshot"), "the snapshot");

            const text = stream.received();
            const snapshotAt = text.indexOf("event: snapshot");
            const payload = JSON.parse(text.slice(text.indexOf("data: ", snapshotAt) + "data: ".length).split("\n")[0]) as {
                strategy: string; backends: { id: string }[];
            };

            expect(text.indexOf("retry:")).toBeLessThan(snapshotAt);
            expect(payload.strategy).toBe("round-robin");
            expect(payload.backends.map((backend) => backend.id)).toEqual(["alpha"]);
        });

        it("streams each later monitor event as it happens", async () => {
            const server = await dashboard();
            const stream = await openStream(server);
            await waitFor(() => stream.received().includes("event: snapshot"), "the snapshot");

            monitor.publish({ type: "dispatched", requestId: "r1", backendId: "alpha", method: "GET", path: "/users/1", at: clock });
            monitor.publish({ type: "completed", requestId: "r1", backendId: "alpha", status: 200, durationMs: 12, route: "/users/:id", at: clock });

            await waitFor(() => stream.received().includes('"type":"completed"'), "the completed event");

            expect(stream.received()).toContain('data: {"type":"dispatched","requestId":"r1"');
            expect(stream.received()).toContain('"route":"/users/:id"');
        });

        it("delivers events to every connected tab", async () => {
            const server = await dashboard();
            const first = await openStream(server);
            const second = await openStream(server);
            await waitFor(() => first.received().includes("snapshot") && second.received().includes("snapshot"), "both snapshots");

            monitor.publish({ type: "backendAdded", backend: { id: "beta", url: "http://127.0.0.1:2", source: "static" }, at: clock });

            await waitFor(() => first.received().includes('"id":"beta"') && second.received().includes('"id":"beta"'), "both tabs to see beta");
        });

        it("sends keep-alive comments so an idle stream is not timed out", async () => {
            const server = await dashboard({ heartbeatIntervalMs: 30 });
            const stream = await openStream(server);

            await waitFor(() => stream.received().includes(": heartbeat"), "a heartbeat comment");
        });

        it("stops listening and clears its heartbeat timer when the tab disconnects", async () => {
            const clearSpy = vi.spyOn(globalThis, "clearInterval");
            const server = await dashboard({ heartbeatIntervalMs: 30 });
            const stream = await openStream(server);
            await waitFor(() => stream.received().includes("snapshot"), "the snapshot");

            stream.close();

            await waitFor(() => clearSpy.mock.calls.length > 0, "the heartbeat timer to be cleared");
            clearSpy.mockRestore();
        });

        it("is ended by dispose(), so shutdown is not held up by open tabs", async () => {
            const server = await dashboard();
            const stream = await openStream(server);
            await waitFor(() => stream.received().includes("snapshot"), "the snapshot");

            server.dashboard.dispose();

            await waitFor(() => stream.ended(), "the stream to end");
        });

        it("rejects methods other than GET with 405", async () => {
            const { url } = await dashboard();

            const response = await fetch(`${url}${MOUNT}/events`, { method: "POST" });

            expect(response.status).toBe(405);
        });
    });

    describe("backend detail", () => {

        it("returns route stats and recent calls for a known backend", async () => {
            monitor.publish({ type: "dispatched", requestId: "r1", backendId: "alpha", method: "GET", path: "/users/1", at: clock });
            monitor.publish({ type: "completed", requestId: "r1", backendId: "alpha", status: 200, durationMs: 9, route: "/users/:id", at: clock });
            const { url } = await dashboard();

            const response = await fetch(`${url}${MOUNT}/backends/alpha`);
            const detail = await response.json() as { backend: { id: string; total: number }; routes: { key: string }[]; recentCalls: { requestId: string }[] };

            expect(response.status).toBe(200);
            expect(response.headers.get("cache-control")).toBe("no-store");
            expect(detail.backend).toMatchObject({ id: "alpha", total: 1 });
            expect(detail.routes.map((route) => route.key)).toEqual(["GET /users/:id"]);
            expect(detail.recentCalls.map((call) => call.requestId)).toEqual(["r1"]);
        });

        it("answers 404 for an unknown backend", async () => {
            const { url } = await dashboard();

            expect((await fetch(`${url}${MOUNT}/backends/ghost`)).status).toBe(404);
        });

        it("still serves a removed backend during the monitor's grace window, then 404s", async () => {
            const { url } = await dashboard();
            monitor.publish({ type: "backendRemoved", backendId: "alpha", reason: "expired", at: clock });

            const during = await fetch(`${url}${MOUNT}/backends/alpha`);
            const detail = await during.json() as { backend: { removed?: { reason: string } } };

            expect(during.status).toBe(200);
            expect(detail.backend.removed?.reason).toBe("expired");

            clock += 5000;

            expect((await fetch(`${url}${MOUNT}/backends/alpha`)).status).toBe(404);
        });

        it("decodes a percent-encoded id", async () => {
            monitor.publish({ type: "backendAdded", backend: { id: "host:5001", url: "http://127.0.0.1:5001", source: "registered" }, at: clock });
            const { url } = await dashboard();

            expect((await fetch(`${url}${MOUNT}/backends/host%3A5001`)).status).toBe(200);
        });
    });

    describe("serving three.js locally", () => {

        let vendorRoot: string;
        let secretOutside: string;

        beforeEach(() => {
            const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "empire-lb-three-"));
            vendorRoot = path.join(sandbox, "three");
            fs.mkdirSync(path.join(vendorRoot, "build"), { recursive: true });
            fs.writeFileSync(path.join(vendorRoot, "build", "three.module.js"), "export const REVISION = 'test';");
            secretOutside = path.join(sandbox, "secret.txt");
            fs.writeFileSync(secretOutside, "do not serve");
            cleanups.push(() => fs.rmSync(sandbox, { recursive: true, force: true }));
        });

        it("serves files from threeLocalPath under {path}/vendor/three/ as JavaScript", async () => {
            const { url } = await dashboard({ threeLocalPath: vendorRoot });

            const response = await fetch(`${url}${MOUNT}/vendor/three/build/three.module.js`);

            expect(response.status).toBe(200);
            expect(response.headers.get("content-type")).toContain("javascript");
            expect(await response.text()).toContain("REVISION");
        });

        it("points the page's import map at the locally served copy", async () => {
            const { url } = await dashboard({ threeLocalPath: vendorRoot });

            const html = await (await fetch(`${url}${MOUNT}`)).text();

            expect(html).toContain(`${MOUNT}/vendor/three/`);
            expect(html).not.toContain("cdn.jsdelivr.net");
        });

        it("answers 404 for a file that does not exist", async () => {
            const { url } = await dashboard({ threeLocalPath: vendorRoot });

            expect((await fetch(`${url}${MOUNT}/vendor/three/build/missing.js`)).status).toBe(404);
        });

        async function rawStatus(port: number, requestPath: string): Promise<{ status: number; body: string }> {
            return new Promise((resolve, reject) => {
                http.get({ host: "127.0.0.1", port, path: requestPath, agent: false }, (res) => {
                    let body = "";
                    res.on("data", (chunk: Buffer) => { body += chunk.toString(); });
                    res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
                }).on("error", reject);
            });
        }

        it("refuses a path-traversal attempt out of the vendor directory", async () => {
            const { port } = await dashboard({ threeLocalPath: vendorRoot });

            // %2e%2e is normalised away by URL parsing before it ever reaches the handler; %2f is not,
            // so it decodes into a real "../" that only the static handler's own containment check stops.
            const dotDot = await rawStatus(port, `${MOUNT}/vendor/three/%2e%2e/secret.txt`);
            const slash = await rawStatus(port, `${MOUNT}/vendor/three/..%2f..%2fsecret.txt`);

            expect(dotDot.body).not.toContain("do not serve");
            expect(slash.status).toBe(403);
            expect(slash.body).not.toContain("do not serve");
        });

        it("answers 404 for the vendor path when no local copy is configured", async () => {
            const { url } = await dashboard();

            expect((await fetch(`${url}${MOUNT}/vendor/three/build/three.module.js`)).status).toBe(404);
        });

        it("throws at creation when threeLocalPath is not a directory", () => {
            expect(() => createLoadBalancerDashboard(monitor, { path: MOUNT, threeLocalPath: secretOutside }))
                .toThrow(/not a directory/);
            expect(() => createLoadBalancerDashboard(monitor, { path: MOUNT, threeLocalPath: path.join(vendorRoot, "nope") }))
                .toThrow(/not a directory/);
        });
    });

    describe("loopback guard", () => {

        async function callAs(remoteAddress: string | undefined, requestPath: string, options: Partial<LoadBalancerDashboardOptions> = {}) {
            const instance = createLoadBalancerDashboard(monitor, { path: MOUNT, ...options });
            const req = createMockRequest({ url: requestPath, socket: { remoteAddress } });
            const res = createMockResponse();
            let nextCalled = false;

            try {
                await instance(new Context(req, res as unknown as never), async () => { nextCalled = true; });
                return { status: res.statusCode, nextCalled };
            } catch (err) {
                return { status: err instanceof HttpError ? err.statusCode : 500, nextCalled };
            }
        }

        it.each([`${MOUNT}`, `${MOUNT}/events`, `${MOUNT}/backends/alpha`, `${MOUNT}/vendor/three/x.js`])(
            "answers 403 to a remote client for %s",
            async (requestPath) => {
                expect((await callAs("203.0.113.9", requestPath)).status).toBe(403);
            }
        );

        it("answers 403 when the peer address is unknown", async () => {
            expect((await callAs(undefined, MOUNT)).status).toBe(403);
        });

        it("cannot be bypassed with a spoofed X-Forwarded-For", async () => {
            const instance = createLoadBalancerDashboard(monitor, { path: MOUNT });
            const req = createMockRequest({ url: MOUNT, headers: { host: "localhost", "x-forwarded-for": "127.0.0.1" }, socket: { remoteAddress: "203.0.113.9" } });

            await expect(instance(new Context(req, createMockResponse() as unknown as never), async () => undefined))
                .rejects.toMatchObject({ statusCode: 403 });
        });

        it("serves a remote client when allowRemote is set", async () => {
            expect((await callAs("203.0.113.9", MOUNT, { allowRemote: true })).status).toBe(200);
        });

        it.each(["127.0.0.1", "::1", "::ffff:127.0.0.1"])("serves loopback client %s", async (address) => {
            expect((await callAs(address, MOUNT)).status).toBe(200);
        });

        it("does not guard paths it does not own", async () => {
            const result = await callAs("203.0.113.9", "/unrelated");

            expect(result.nextCalled).toBe(true);
            expect(result.status).toBe(200);
        });
    });

    describe("construction", () => {

        it.each(["/", "", "no-slash"])("rejects the mount path %j", (mount) => {
            expect(() => createLoadBalancerDashboard(monitor, { path: mount })).toThrow(/must start with/);
        });

        it("tolerates a trailing slash on the mount path", async () => {
            const { url } = await dashboard({ path: `${MOUNT}/` });

            expect((await fetch(`${url}${MOUNT}`)).status).toBe(200);
        });
    });
});
