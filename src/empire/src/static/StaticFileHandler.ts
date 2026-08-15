import * as fs from "fs";
import * as path from "path";
import { Context } from "../http/Context";
import { MimeTypes } from "./MimeTypes";
import { StaticFileOptions } from "./StaticFileOptions";

export class StaticFileHandler {

    private readonly root: string;
    private readonly prefix?: string;

    public constructor(options: StaticFileOptions) {
        this.root = path.resolve(options.root);

        // Normalise so "/assets/" and "/assets" behave identically,
        // and so a bare "/" prefix is treated as no prefix at all
        this.prefix = options.prefix && options.prefix !== "/"
            ? options.prefix.replace(/\/+$/, "")
            : undefined;
    }

    public async handle(ctx: Context): Promise<boolean> {

        const requestedPath = ctx.path;

        if (this.prefix && !this.isUnderPrefix(requestedPath)) {
            return false;
        }

        const pathWithinRoot = this.prefix
            ? requestedPath.slice(this.prefix.length)
            : requestedPath;

        const absolutePath = path.resolve(
            this.root,
            pathWithinRoot.slice(1)
        );

        const isSafe = absolutePath === this.root
            || absolutePath.startsWith(this.root + path.sep);

        if (!isSafe) {
            ctx.status(403).text("Forbidden");
            return true;
        }

        const targetPath = await this.resolveTargetPath(absolutePath);

        if (!targetPath) {
            return false;
        }

        await this.sendFile(ctx, targetPath);

        return true;
    }

    /**
     * Resolves the request path to an actual file on disk. Serves the
     * path directly if it's a file; if it's a directory, falls back to
     * an index.html inside it (e.g. /about/ serves /about/index.html).
     * Returns null when neither exists, so handle() can fall through.
     */
    private async resolveTargetPath(absolutePath: string): Promise<string | null> {

        const stats = await this.stat(absolutePath);

        if (stats?.isFile()) {
            return absolutePath;
        }

        if (stats?.isDirectory()) {
            const indexPath = path.join(absolutePath, "index.html");
            const indexStats = await this.stat(indexPath);

            if (indexStats?.isFile()) {
                return indexPath;
            }
        }

        return null;
    }

    /**
     * Streams a file to the response rather than reading it fully into
     * memory first — necessary for large bundles and assets. For a HEAD
     * request, sets the same headers a GET would but skips opening a read
     * stream entirely (RFC 9110 §9.3.2) — the file's contents are never
     * needed, not just discarded after reading.
     */
    private async sendFile(ctx: Context, filePath: string): Promise<void> {

        const stats = await fs.promises.stat(filePath);
        const mimeType = MimeTypes.getType(path.extname(filePath));

        ctx.res.setHeader("Content-Type", mimeType);
        ctx.res.setHeader("Content-Length", stats.size);

        if (ctx.method === "HEAD") {
            ctx.res.end();
            return;
        }

        await new Promise<void>((resolve, reject) => {
            const stream = fs.createReadStream(filePath);
            stream.on("error", reject);
            ctx.res.on("finish", resolve);
            stream.pipe(ctx.res);
        });
    }

    /**
     * True when the request path falls under this handler's prefix —
     * either an exact match or followed by "/", so "/assets" does not
     * also match a route registered under "/assets-other".
     */
    private isUnderPrefix(requestedPath: string): boolean {
        return requestedPath === this.prefix
            || requestedPath.startsWith(`${this.prefix}/`);
    }

    private async stat(filePath: string): Promise<fs.Stats | null> {

        try {
            return await fs.promises.stat(filePath);
        } catch {
            return null;
        }
    }
}
