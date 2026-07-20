import http, { IncomingHttpHeaders } from "http";
import fs from "fs";
import path from "path";
import { BadRequestError } from "../errors/BadRequestError";
import { HttpError } from "../errors/HttpError";
import { MimeTypes } from "../static/MimeTypes";
import { CookieOptions } from "./CookieOptions";

export class Context {
    private static readonly DEFAULT_REDIRECT_STATUS = 302;
    private static readonly FORM_CONTENT_TYPE = "application/x-www-form-urlencoded";

    public readonly req: http.IncomingMessage;
    public readonly res: http.ServerResponse;
    public readonly params: Record<string, string>;

    public constructor(
        req: http.IncomingMessage,
        res: http.ServerResponse,
        params: Record<string, string> = {}
    ) {
        this.req = req;
        this.res = res;
        this.params = params;
    }

    public get headers(): IncomingHttpHeaders {
        return this.req.headers;
    }

    public get method(): string {
        return this.req.method ?? "GET";
    }

    public get path(): string {
        return this.url.pathname;
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

    public async body(): Promise<string> {

        const decoder = new TextDecoder('utf-8');

        let data = '';
        for await (const chunk of this.req) {
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
                // IncomingHttpHeaders may have string | string[] values; cast to any
                this.res.setHeader(name, value as any);
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

        // Stream rather than read into memory — files may be large
        await new Promise<void>((resolve, reject) => {
            const stream = fs.createReadStream(filePath);
            stream.on("error", reject);
            this.res.on("finish", resolve);
            stream.pipe(this.res);
        });
    }
}