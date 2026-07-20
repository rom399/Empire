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

        const isSafe = absolutePath.startsWith(this.root);

        if (!isSafe) {
            ctx.status(403).text("Forbidden");
            return true;
        }

        const fileExists = await this.exists(absolutePath);

        if (!fileExists) {
            return false;
        }

        const extension = path.extname(absolutePath);
        const mimeType  = MimeTypes.getType(extension);

        const fileContents = await fs.promises.readFile(absolutePath);

        ctx.res.setHeader("Content-Type", mimeType);
        ctx.res.end(fileContents);

        return true;
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

    private async exists(filePath: string): Promise<boolean> {

        try {
            const stat = await fs.promises.stat(filePath);
            return stat.isFile();
        } catch {
            return false;
        }
    }
}
