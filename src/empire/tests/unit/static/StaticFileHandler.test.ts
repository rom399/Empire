import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { StaticFileHandler } from "../../../src/static/StaticFileHandler";
import { Context } from "../../../src/http/Context";
import { createMockRequest, createMockResponse } from "../../fixtures/http/MockHttp";

/**
 * FINDING 2 (revised) — the traversal guard is `absolutePath.startsWith(root)`,
 * which also admits a SIBLING directory whose name merely begins with the root
 * ("/tmp/x/www" vs "/tmp/x/wwwsecret").
 *
 * This is NOT currently exploitable through Empire's own pipeline: Context.path
 * reads URL.pathname, which normalises "..", "/a/../.." and even "%2e%2e"
 * before the handler runs. The guard is defence-in-depth — but it is the only
 * defence left if that normalisation changes, if the handler is constructed
 * directly, or on a platform where path.resolve honours other separators.
 *
 * FINDING 9 — the static handler never checks req.method, so HEAD is served a
 * full body. Router.discardBody() only covers routed requests, and the static
 * middleware runs before the router.
 */
describe("StaticFileHandler", () => {

    let base: string;
    let root: string;
    let sibling: string;

    beforeAll(() => {
        base = fs.mkdtempSync(path.join(os.tmpdir(), "empire-static-"));

        root = path.join(base, "www");
        sibling = path.join(base, "wwwsecret");

        fs.mkdirSync(root);
        fs.mkdirSync(sibling);

        fs.writeFileSync(path.join(root, "index.html"), "<h1>public</h1>");
        fs.writeFileSync(path.join(root, "style.css"), "body { color: red; }");
        fs.writeFileSync(path.join(sibling, "secrets.txt"), "TOP SECRET");

        fs.mkdirSync(path.join(root, "about"));
        fs.writeFileSync(path.join(root, "about", "index.html"), "<h1>about</h1>");

        fs.mkdirSync(path.join(root, "empty"));
    });

    afterAll(() => {
        fs.rmSync(base, { recursive: true, force: true });
    });

    function contextFor(url: string, method = "GET") {
        const req = createMockRequest({ method, url });
        const res = createMockResponse();
        return { ctx: new Context(req, res as unknown as never), res };
    }

    describe("basic resolution", () => {

        it("serves a file that exists at the request path", async () => {
            const handler = new StaticFileHandler({ root });
            const { ctx, res } = contextFor("/index.html");

            expect(await handler.handle(ctx)).toBe(true);
            expect(res.body).toContain("public");
        });

        it("sets the correct Content-Type from the file extension", async () => {
            const handler = new StaticFileHandler({ root });
            const { ctx, res } = contextFor("/style.css");

            await handler.handle(ctx);

            expect(res.getHeader("content-type")).toBe("text/css");
        });

        it("sets Content-Length to the file size", async () => {
            const handler = new StaticFileHandler({ root });
            const { ctx, res } = contextFor("/index.html");

            await handler.handle(ctx);

            expect(res.getHeader("content-length")).toBe(
                fs.statSync(path.join(root, "index.html")).size
            );
        });

        it("returns false when the file does not exist, so the middleware chain continues", async () => {
            const handler = new StaticFileHandler({ root });
            const { ctx } = contextFor("/missing.html");

            expect(await handler.handle(ctx)).toBe(false);
        });
    });

    describe("directory index fallback", () => {

        it("serves index.html when the request path resolves to a directory containing one", async () => {
            const handler = new StaticFileHandler({ root });
            const { ctx, res } = contextFor("/about/");

            expect(await handler.handle(ctx)).toBe(true);
            expect(res.body).toContain("about");
        });

        it("serves index.html when the request path has no trailing slash", async () => {
            const handler = new StaticFileHandler({ root });
            const { ctx, res } = contextFor("/about");

            expect(await handler.handle(ctx)).toBe(true);
            expect(res.body).toContain("about");
        });

        it("returns false when the request path resolves to a directory with no index.html", async () => {
            const handler = new StaticFileHandler({ root });
            const { ctx } = contextFor("/empty/");

            expect(await handler.handle(ctx)).toBe(false);
        });
    });

    describe("path traversal guard", () => {

        it("has a root boundary that a prefix-sharing sibling cannot satisfy", () => {
            const escaped = path.join(sibling, "secrets.txt");

            // The bug's precondition: a bare startsWith() admits the sibling.
            expect(escaped.startsWith(root)).toBe(true);

            // The guard should require a separator boundary.
            const correct = escaped === root || escaped.startsWith(root + path.sep);
            expect(correct).toBe(false);
        });

        it("never serves a file from a prefix-sharing sibling directory", async () => {
            const handler = new StaticFileHandler({ root });
            const { ctx, res } = contextFor("/../wwwsecret/secrets.txt");

            await handler.handle(ctx);

            expect(res.body).not.toContain("TOP SECRET");
        });

        it("serves a legitimate file inside the root", async () => {
            const handler = new StaticFileHandler({ root });
            const { ctx, res } = contextFor("/index.html");

            expect(await handler.handle(ctx)).toBe(true);
            expect(res.body).toContain("public");
        });

        it("falls through when a normalised path misses", async () => {
            const handler = new StaticFileHandler({ root });
            const { ctx } = contextFor("/../../etc/passwd");

            expect(await handler.handle(ctx)).toBe(false);
        });
    });

    describe("HEAD requests", () => {

        it("does not write a body for a HEAD request", async () => {
            const handler = new StaticFileHandler({ root });
            const { ctx, res } = contextFor("/index.html", "HEAD");

            await handler.handle(ctx);

            expect(res.body).toBe("");
        });

        it("still sets Content-Length and Content-Type for a HEAD request", async () => {
            const handler = new StaticFileHandler({ root });
            const { ctx, res } = contextFor("/index.html", "HEAD");

            await handler.handle(ctx);

            expect(res.getHeader("content-type")).toBe("text/html");
            expect(res.getHeader("content-length")).toBe(
                fs.statSync(path.join(root, "index.html")).size
            );
        });
    });

    describe("prefix handling", () => {

        it("ignores requests outside the mounted prefix", async () => {
            const handler = new StaticFileHandler({ root, prefix: "/assets" });
            const { ctx } = contextFor("/index.html");

            expect(await handler.handle(ctx)).toBe(false);
        });

        it("does not treat /assets-other as being under /assets", async () => {
            const handler = new StaticFileHandler({ root, prefix: "/assets" });
            const { ctx } = contextFor("/assets-other/index.html");

            expect(await handler.handle(ctx)).toBe(false);
        });
    });
});
