import * as fs from "fs";
import * as path from "path";
import { Context } from "../http/Context";
import { MimeTypes } from "./MimeTypes";
import { StaticFileOptions } from "./StaticFileOptions";

export class StaticFileHandler {

    private readonly root: string;

    public constructor(options: StaticFileOptions) {
        this.root = path.resolve(options.root);
    }

    public async handle(ctx: Context): Promise<boolean> {

        const requestedPath = ctx.path;

        const absolutePath = path.resolve(
            this.root,
            requestedPath.slice(1)
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

    private async exists(filePath: string): Promise<boolean> {

        try {
            const stat = await fs.promises.stat(filePath);
            return stat.isFile();
        } catch {
            return false;
        }
    }
}
