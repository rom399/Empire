import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { Context } from "../../../src/http/Context";
import { HttpError } from "../../../src/errors/HttpError";
import { BadRequestError } from "../../../src/errors/BadRequestError";
import { createMockRequest, createMockResponse } from "../../fixtures/http/MockHttp";

describe("Context", () => {

    describe("request properties/methods", () => {

        it("headers returns the raw request headers", () => {
            const req = createMockRequest({ headers: { host: "localhost", "x-custom": "value" } });
            const ctx = new Context(req, createMockResponse());

            expect(ctx.headers).toEqual({ host: "localhost", "x-custom": "value" });
        });

        it("method defaults to GET when req.method is undefined", () => {
            const req = createMockRequest();
            (req as unknown as { method: undefined }).method = undefined;
            const ctx = new Context(req, createMockResponse());

            expect(ctx.method).toBe("GET");
        });

        it("path returns the pathname without the query string", () => {
            const req = createMockRequest({ url: "/users/42?active=true" });
            const ctx = new Context(req, createMockResponse());

            expect(ctx.path).toBe("/users/42");
        });

        it("path throws BadRequestError, not a raw URIError, for malformed percent-encoding", () => {
            const req = createMockRequest({ url: "/users/%zz" });
            const ctx = new Context(req, createMockResponse());

            expect(() => ctx.path).toThrow(BadRequestError);
        });

        it("query returns parsed query parameters", () => {
            const req = createMockRequest({ url: "/search?q=empire&page=2" });
            const ctx = new Context(req, createMockResponse());

            expect(ctx.query.get("q")).toBe("empire");
            expect(ctx.query.get("page")).toBe("2");
        });

        it("ipAddress prefers x-forwarded-for over the socket address", () => {
            const req = createMockRequest({
                headers: { host: "localhost", "x-forwarded-for": "203.0.113.5" },
                socket: { remoteAddress: "10.0.0.1" },
            });
            const ctx = new Context(req, createMockResponse());

            expect(ctx.ipAddress).toBe("203.0.113.5");
        });

        it("ipAddress takes the first address when x-forwarded-for is a comma separated list", () => {
            const req = createMockRequest({
                headers: { host: "localhost", "x-forwarded-for": "203.0.113.5, 70.41.3.18, 150.172.238.178" },
            });
            const ctx = new Context(req, createMockResponse());

            expect(ctx.ipAddress).toBe("203.0.113.5");
        });

        it("ipAddress strips the ::ffff: IPv4-mapped prefix", () => {
            const req = createMockRequest({ socket: { remoteAddress: "::ffff:192.168.1.5" } });
            const ctx = new Context(req, createMockResponse());

            expect(ctx.ipAddress).toBe("192.168.1.5");
        });

        it("ipAddress normalises ::1 to 127.0.0.1", () => {
            const req = createMockRequest({ socket: { remoteAddress: "::1" } });
            const ctx = new Context(req, createMockResponse());

            expect(ctx.ipAddress).toBe("127.0.0.1");
        });

        it("userAgent returns the User-Agent header", () => {
            const req = createMockRequest({ headers: { host: "localhost", "user-agent": "Mozilla/5.0" } });
            const ctx = new Context(req, createMockResponse());

            expect(ctx.userAgent).toBe("Mozilla/5.0");
        });

        it("userAgent returns an empty string when the header is absent", () => {
            const req = createMockRequest({ headers: { host: "localhost" } });
            const ctx = new Context(req, createMockResponse());

            expect(ctx.userAgent).toBe("");
        });

        it("contentType strips parameters like charset", () => {
            const req = createMockRequest({ headers: { host: "localhost", "content-type": "application/json; charset=utf-8" } });
            const ctx = new Context(req, createMockResponse());

            expect(ctx.contentType).toBe("application/json");
        });

        it("accepts returns true for an exact type match", () => {
            const req = createMockRequest({ headers: { host: "localhost", accept: "application/json" } });
            const ctx = new Context(req, createMockResponse());

            expect(ctx.accepts("application/json")).toBe(true);
        });

        it("accepts returns true for */*", () => {
            const req = createMockRequest({ headers: { host: "localhost", accept: "*/*" } });
            const ctx = new Context(req, createMockResponse());

            expect(ctx.accepts("text/html")).toBe(true);
        });

        it("accepts returns true for a partial wildcard like text/*", () => {
            const req = createMockRequest({ headers: { host: "localhost", accept: "text/*" } });
            const ctx = new Context(req, createMockResponse());

            expect(ctx.accepts("text/html")).toBe(true);
        });

        it("accepts returns false when nothing matches", () => {
            const req = createMockRequest({ headers: { host: "localhost", accept: "application/json" } });
            const ctx = new Context(req, createMockResponse());

            expect(ctx.accepts("text/html")).toBe(false);
        });

        it("accepts ignores quality parameters like ;q=0.9", () => {
            const req = createMockRequest({ headers: { host: "localhost", accept: "text/html;q=0.9" } });
            const ctx = new Context(req, createMockResponse());

            expect(ctx.accepts("text/html")).toBe(true);
        });
    });

    describe("state", () => {

        it("defaults to an empty object", () => {
            const req = createMockRequest();
            const ctx = new Context(req, createMockResponse());

            expect(ctx.state).toEqual({});
        });

        it("holds a value written to it, readable back by a later reader", () => {
            const req = createMockRequest();
            const ctx = new Context(req, createMockResponse());

            ctx.state.user = { id: "1", name: "Alice" };

            expect(ctx.state.user).toEqual({ id: "1", name: "Alice" });
        });

        it("is a fresh object per Context instance, not shared across requests", () => {
            const first = new Context(createMockRequest(), createMockResponse());
            const second = new Context(createMockRequest(), createMockResponse());

            first.state.user = { id: "1", name: "Alice" };

            expect(second.state.user).toBeUndefined();
        });
    });

    describe("body parsing", () => {

        it("body reads the full request stream as a string", async () => {
            const req = createMockRequest({ body: "raw body text" });
            const ctx = new Context(req, createMockResponse());

            expect(await ctx.body()).toBe("raw body text");
        });

        it("jsonBody parses a valid JSON body", async () => {
            const req = createMockRequest({ body: JSON.stringify({ name: "Empire" }) });
            const ctx = new Context(req, createMockResponse());

            expect(await ctx.jsonBody()).toEqual({ name: "Empire" });
        });

        it("jsonBody throws BadRequestError on invalid JSON", async () => {
            const req = createMockRequest({ body: "{not valid json" });
            const ctx = new Context(req, createMockResponse());

            let caught: unknown;
            try {
                await ctx.jsonBody();
            } catch (err) {
                caught = err;
            }

            expect(caught).toBeInstanceOf(BadRequestError);
        });

        it("form parses an application/x-www-form-urlencoded body into URLSearchParams", async () => {
            const req = createMockRequest({
                headers: { host: "localhost", "content-type": "application/x-www-form-urlencoded" },
                body: "name=Empire&version=1",
            });
            const ctx = new Context(req, createMockResponse());

            const form = await ctx.form();

            expect(form.get("name")).toBe("Empire");
            expect(form.get("version")).toBe("1");
        });

        it("form throws BadRequestError when the Content-Type does not match", async () => {
            const req = createMockRequest({
                headers: { host: "localhost", "content-type": "application/json" },
                body: "{}",
            });
            const ctx = new Context(req, createMockResponse());

            let caught: unknown;
            try {
                await ctx.form();
            } catch (err) {
                caught = err;
            }
            expect(caught).toBeInstanceOf(BadRequestError);
        });
    });

    describe("response helpers", () => {

        it("status sets the response status code and is chainable", () => {
            const res = createMockResponse();
            const ctx = new Context(createMockRequest(), res);

            const returned = ctx.status(201);

            expect(res.statusCode).toBe(201);
            expect(returned).toBe(ctx);
        });

        it("header sets a single response header and is chainable", () => {
            const res = createMockResponse();
            const ctx = new Context(createMockRequest(), res);

            const returned = ctx.header("X-Powered-By", "Empire");

            expect(res.getHeader("X-Powered-By")).toBe("Empire");
            expect(returned).toBe(ctx);
        });

        it("addHeaders sets multiple response headers and is chainable", () => {
            const res = createMockResponse();
            const ctx = new Context(createMockRequest(), res);

            const returned = ctx.addHeaders({ "X-One": "1", "X-Two": "2" });

            expect(res.getHeader("X-One")).toBe("1");
            expect(res.getHeader("X-Two")).toBe("2");
            expect(returned).toBe(ctx);
        });

        it("addHeaders skips undefined and null header values", () => {
            const res = createMockResponse();
            const ctx = new Context(createMockRequest(), res);

            ctx.addHeaders({ "X-Set": "value", "X-Undefined": undefined as unknown as string, "X-Null": null as unknown as string });

            expect(res.getHeader("X-Set")).toBe("value");
            expect(res.getHeader("X-Undefined")).toBe(undefined);
            expect(res.getHeader("X-Null")).toBe(undefined);
        });

        it("text sets Content-Type to text/plain and writes the body", () => {
            const res = createMockResponse();
            const ctx = new Context(createMockRequest(), res);

            ctx.text("hello");

            expect(res.getHeader("Content-Type")).toBe("text/plain");
            expect(res.body).toBe("hello");
        });

        it("html sets Content-Type to text/html and writes the body", () => {
            const res = createMockResponse();
            const ctx = new Context(createMockRequest(), res);

            ctx.html("<p>hi</p>");

            expect(res.getHeader("Content-Type")).toBe("text/html");
            expect(res.body).toBe("<p>hi</p>");
        });

        it("json sets Content-Type to application/json and writes the serialized body", () => {
            const res = createMockResponse();
            const ctx = new Context(createMockRequest(), res);

            ctx.json({ ok: true });

            expect(res.getHeader("Content-Type")).toBe("application/json");
            expect(res.body).toBe(JSON.stringify({ ok: true }));
        });

        it("redirect defaults to status 302 and sets the Location header", () => {
            const res = createMockResponse();
            const ctx = new Context(createMockRequest(), res);

            ctx.redirect("/login");

            expect(res.statusCode).toBe(302);
            expect(res.getHeader("Location")).toBe("/login");
        });

        it("redirect uses a custom status code when passed", () => {
            const res = createMockResponse();
            const ctx = new Context(createMockRequest(), res);

            ctx.redirect("/login", 301);

            expect(res.statusCode).toBe(301);
        });
    });

    describe("file serving", () => {

        let tmpDir: string;

        afterEach(() => {
            if (tmpDir) {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            }
        });

        function writeTempFile(name: string, content: string): string {
            tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "empire-context-test-"));
            const filePath = path.join(tmpDir, name);
            fs.writeFileSync(filePath, content);
            return filePath;
        }

        it("file streams the file contents to the response", async () => {
            const filePath = writeTempFile("greeting.txt", "hello from disk");
            const res = createMockResponse();
            const ctx = new Context(createMockRequest(), res);

            await ctx.file(filePath);

            expect(res.body).toBe("hello from disk");
        });

        it("file sets the correct Content-Type from the file extension", async () => {
            const filePath = writeTempFile("page.html", "<html></html>");
            const res = createMockResponse();
            const ctx = new Context(createMockRequest(), res);

            await ctx.file(filePath);

            expect(res.getHeader("Content-Type")).toBe("text/html");
        });

        it("file sets Content-Length to the file size", async () => {
            const filePath = writeTempFile("greeting.txt", "hello from disk");
            const res = createMockResponse();
            const ctx = new Context(createMockRequest(), res);

            await ctx.file(filePath);

            expect(res.getHeader("Content-Length")).toBe(Buffer.byteLength("hello from disk"));
        });

        it("file throws HttpError 404 when the file does not exist", async () => {
            const res = createMockResponse();
            const ctx = new Context(createMockRequest(), res);

            let caught: unknown;
            try {
                await ctx.file("/does/not/exist.txt");
            } catch (err) {
                caught = err;
            }

            expect(caught).toBeInstanceOf(HttpError);
            expect((caught as HttpError).statusCode).toBe(404);
        });

        it("download sets Content-Disposition with the file's own name by default", async () => {
            const filePath = writeTempFile("report.csv", "a,b,c");
            const res = createMockResponse();
            const ctx = new Context(createMockRequest(), res);

            await ctx.download(filePath);

            expect(res.getHeader("Content-Disposition")).toBe('attachment; filename="report.csv"');
        });

        it("download uses a custom filename when passed", async () => {
            const filePath = writeTempFile("report.csv", "a,b,c");
            const res = createMockResponse();
            const ctx = new Context(createMockRequest(), res);

            await ctx.download(filePath, "yearly-report.csv");

            expect(res.getHeader("Content-Disposition")).toBe('attachment; filename="yearly-report.csv"');
        });
    });

    describe("cookies", () => {

        it("cookie sets a Set-Cookie header with the encoded value", () => {
            const res = createMockResponse();
            const ctx = new Context(createMockRequest(), res);

            ctx.cookie("session", "a b");

            expect(res.getHeader("Set-Cookie")).toEqual(["session=a%20b; Path=/"]);
        });

        it("cookie defaults Path to /", () => {
            const res = createMockResponse();
            const ctx = new Context(createMockRequest(), res);

            ctx.cookie("session", "value");

            expect((res.getHeader("Set-Cookie") as string[])[0]).toContain("Path=/");
        });

        it("cookie includes Max-Age when provided", () => {
            const res = createMockResponse();
            const ctx = new Context(createMockRequest(), res);

            ctx.cookie("session", "value", { maxAge: 3600 });

            expect((res.getHeader("Set-Cookie") as string[])[0]).toContain("Max-Age=3600");
        });

        it("cookie includes Expires when provided", () => {
            const res = createMockResponse();
            const ctx = new Context(createMockRequest(), res);
            const expires = new Date("2030-01-01T00:00:00.000Z");

            ctx.cookie("session", "value", { expires });

            expect((res.getHeader("Set-Cookie") as string[])[0]).toContain(`Expires=${expires.toUTCString()}`);
        });

        it("cookie includes Secure, HttpOnly, and SameSite flags when set", () => {
            const res = createMockResponse();
            const ctx = new Context(createMockRequest(), res);

            ctx.cookie("session", "value", { secure: true, httpOnly: true, sameSite: "Strict" });

            const header = (res.getHeader("Set-Cookie") as string[])[0];
            expect(header).toContain("Secure");
            expect(header).toContain("HttpOnly");
            expect(header).toContain("SameSite=Strict");
        });

        it("cookie appends to existing Set-Cookie headers rather than overwriting", () => {
            const res = createMockResponse();
            const ctx = new Context(createMockRequest(), res);

            ctx.cookie("first", "1");
            ctx.cookie("second", "2");

            const header = res.getHeader("Set-Cookie") as string[];
            expect(header.length).toBe(2);
            expect(header[0]).toContain("first=1");
            expect(header[1]).toContain("second=2");
        });

        it("clearCookie sets an already-expired Set-Cookie header for the given name", () => {
            const res = createMockResponse();
            const ctx = new Context(createMockRequest(), res);

            ctx.clearCookie("session");

            const header = (res.getHeader("Set-Cookie") as string[])[0];
            expect(header).toContain("session=");
            expect(header).toContain(`Expires=${new Date(0).toUTCString()}`);
        });
    });
});
