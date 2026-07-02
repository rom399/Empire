import http, { IncomingHttpHeaders } from "http";
import { BadRequestError } from "../errors/BadRequestError";

export class Context {
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
}