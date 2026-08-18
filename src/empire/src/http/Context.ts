import http, { IncomingHttpHeaders } from "http";
import fs from "fs";
import path from "path";
import { BadRequestError } from "../errors/BadRequestError";
import { HttpError } from "../errors/HttpError";
import { MimeTypes } from "../static/MimeTypes";
import { CookieOptions } from "./CookieOptions";
import { streamFileToResponse } from "./streamFile";
import { Resolver } from "../di/Resolver";

export class Context {
    private static readonly DEFAULT_REDIRECT_STATUS = 302;
    private static readonly FORM_CONTENT_TYPE = "application/x-www-form-urlencoded";
    private static readonly DEFAULT_MAX_BODY_SIZE = 1024 * 1024; // 1 MB

    public readonly req: http.IncomingMessage;
    public readonly res: http.ServerResponse;
    public params: Record<string, string>;

    /**
     * A per-request bag for middleware to attach data to for downstream
     * middleware and route handlers to read, e.g. an authenticated user
     * resolved by an auth middleware. Untyped by design, since Context
     * has no way to know what any given application will store here -
     * reading a value back requires narrowing it to the expected shape
     * rather than casting with `as`.
     */
    public readonly state: Record<string, unknown> = {};

    /**
     * Resolves dependencies registered on the Empire instance, backed by a
     * ServiceScope Empire creates and disposes per request - see
     * Empire.handleRequest(). Typed as the narrower Resolver rather than
     * ServiceScope itself, so a route handler can resolve() but has no way
     * to reach the scope's dispose() - that stays Empire's responsibility.
     * Undefined when the app was constructed without EmpireOptions.services.
     */
    public readonly services?: Resolver;

    private readonly maxBodySize: number;
    private bodyPromise?: Promise<string>;

    public constructor(
        req: http.IncomingMessage,
        res: http.ServerResponse,
        params: Record<string, string> = {},
        maxBodySize: number = Context.DEFAULT_MAX_BODY_SIZE,
        services?: Resolver
    ) {
        this.req = req;
        this.res = res;
        this.params = params;
        this.maxBodySize = maxBodySize;
        this.services = services;
    }

    public get headers(): IncomingHttpHeaders {
        return this.req.headers;
    }

    public get method(): string {
        return this.req.method ?? "GET";
    }

    /**
     * The decoded request path, without the query string.
     * Throws BadRequestError rather than a raw URIError when the path
     * contains malformed percent-encoding (e.g. "%zz"), so this is always
     * a client error (400), not an unhandled exception that surfaces as
     * a generic 500 wherever this getter happens to be read from.
     */
    public get path(): string {
        try {
            return decodeURIComponent(this.url.pathname);
        } catch {
            throw new BadRequestError("Malformed request path");
        }
    }

    public get query(): URLSearchParams {

        return this.url.searchParams;
    }

    public get ipAddress(): string {
        // Check forwarded headers first — set by proxies and load balancers
        const forwarded = this.req.headers["x-forwarded-for"];

        if (forwarded) {
            // x-forwarded-for can be a comma separated list — first is the real client
            const first = Array.isArray(forwarded) 
                ? forwarded[0] 
                : forwarded.split(",")[0];
            return first.trim();
        }

        const raw = this.req.socket.remoteAddress ?? "unknown";

        if (raw.startsWith("::ffff:")) {
            return raw.substring(7);
        }

        if (raw === "::1") {
            return "127.0.0.1";
        }

        return raw;
    }

    /**
     * The User-Agent header of the incoming request.
     * Returns an empty string when the header is absent.
     */
    public get userAgent(): string {
        return this.req.headers["user-agent"] ?? "";
    }

    /**
     * The Content-Type of the incoming request without parameters.
     * "application/json; charset=utf-8" returns "application/json".
     */
    public get contentType(): string {
        const raw = this.req.headers["content-type"] ?? "";
        return raw.split(";")[0].trim();
    }

    /**
     * Checks whether the client accepts the given response type,
     * honouring full and partial wildcards such as "text/*".
     */
    public accepts(type: string): boolean {
        const acceptHeader = this.req.headers.accept ?? "*/*";

        // Strip quality parameters — "text/html;q=0.9" becomes "text/html"
        const accepted = acceptHeader
            .split(",")
            .map((part) => part.split(";")[0].trim());

        for (const candidate of accepted) {
            if (candidate === "*/*" || candidate === type) {
                return true;
            }

            // "text/*" matches any subtype of text
            if (candidate.endsWith("/*") && type.startsWith(candidate.slice(0, -1))) {
                return true;
            }
        }

        return false;
    }

    private get url(): URL {

        const host =
            this.req.headers.host ??
            "localhost";

        return new URL(
            this.req.url ?? "/",
            `http://${host}`
        );
    }

    public body(): Promise<string> {
        if (!this.bodyPromise) {
            this.bodyPromise = this.readBody();
        }

        return this.bodyPromise;
    }

    private async readBody(): Promise<string> {

        const decoder = new TextDecoder('utf-8');

        let data = '';
        let size = 0;

        for await (const chunk of this.req) {
            size += (chunk as Uint8Array).length;

            if (size > this.maxBodySize) {
                throw new HttpError(413, "Request body too large");
            }

            data += decoder.decode(chunk as Uint8Array, { stream: true });
        }
        // Decoder flush.
        data += decoder.decode();

        return data;
    }

    public html(value: string): void {

        this.res.setHeader(
            "Content-Type", "text/html"
        );

        this.res.end(value);
    }

    public header(name: string, value: string): this {
        this.res.setHeader(name, value);
        return this;
    }

    public addHeaders(headers: IncomingHttpHeaders | Record<string, string>): this {
        for (const [name, value] of Object.entries(headers)) {
            if (value !== undefined && value !== null) {
                this.res.setHeader(name, value as number | string | readonly string[]);
            }
        }

        return this;
    }

    public status(code: number): this {
        this.res.statusCode = code;
        return this;
    }

    public text(value: string): void {
        this.res.setHeader(
            "Content-Type",
            "text/plain"
        );

        this.res.end(value);
    }

    public json(value: unknown): void {
        this.res.setHeader(
            "Content-Type",
            "application/json"
        );

        this.res.end(
            JSON.stringify(value)
        );
    }

    public async jsonBody(): Promise<unknown> {
        let body = await this.body();

        try {
            return JSON.parse(body);
        } catch (error) {
            throw new BadRequestError("Invalid JSON");
        }
    }

    /**
     * Parses an application/x-www-form-urlencoded request body.
     * Throws BadRequestError when the Content-Type does not match.
     */
    public async form(): Promise<URLSearchParams> {
        if (this.contentType !== Context.FORM_CONTENT_TYPE) {
            throw new BadRequestError(
                `Expected ${Context.FORM_CONTENT_TYPE} but received ${this.contentType || "no content type"}`
            );
        }

        return new URLSearchParams(await this.body());
    }

    /**
     * Redirects the client to another URL.
     * Defaults to 302 Found; pass 301 for a permanent redirect.
     */
    public redirect(url: string, status: number = Context.DEFAULT_REDIRECT_STATUS): void {
        this.res.statusCode = status;
        this.res.setHeader("Location", url);
        this.res.end();
    }

    /**
     * Serves a file from a route handler with the correct MIME type.
     * Throws HttpError 404 when the file does not exist.
     */
    public async file(filePath: string): Promise<void> {
        await this.sendFile(filePath);
    }

    /**
     * Forces the browser to download a file rather than display it.
     * The saved name defaults to the file's own name.
     */
    public async download(filePath: string, filename?: string): Promise<void> {
        const name = filename ?? path.basename(filePath);

        this.res.setHeader("Content-Disposition", `attachment; filename="${name}"`);

        await this.sendFile(filePath);
    }

    /**
     * Sets a cookie on the response. Chainable.
     */
    public cookie(name: string, value: string, options: CookieOptions = {}): this {
        const parts = [`${name}=${encodeURIComponent(value)}`];

        if (options.maxAge !== undefined) {
            parts.push(`Max-Age=${options.maxAge}`);
        }

        if (options.expires) {
            parts.push(`Expires=${options.expires.toUTCString()}`);
        }

        parts.push(`Path=${options.path ?? "/"}`);

        if (options.domain) {
            parts.push(`Domain=${options.domain}`);
        }

        if (options.secure) {
            parts.push("Secure");
        }

        if (options.httpOnly) {
            parts.push("HttpOnly");
        }

        if (options.sameSite) {
            parts.push(`SameSite=${options.sameSite}`);
        }

        // Append rather than overwrite — a response may set multiple cookies
        const existing = this.res.getHeader("Set-Cookie");
        const cookies = existing
            ? ([] as string[]).concat(existing as string | string[])
            : [];

        cookies.push(parts.join("; "));
        this.res.setHeader("Set-Cookie", cookies);

        return this;
    }

    /**
     * Clears a cookie by name. Chainable.
     */
    public clearCookie(name: string): this {
        // An already-expired date instructs the browser to delete the cookie
        return this.cookie(name, "", { expires: new Date(0), path: "/" });
    }

    private async sendFile(filePath: string): Promise<void> {
        const stats = await fs.promises.stat(filePath).catch(() => null);

        if (!stats || !stats.isFile()) {
            throw new HttpError(404, "File not found");
        }

        this.res.setHeader("Content-Type", MimeTypes.getType(path.extname(filePath)));
        this.res.setHeader("Content-Length", stats.size);

        await streamFileToResponse(this.res, filePath);
    }
}