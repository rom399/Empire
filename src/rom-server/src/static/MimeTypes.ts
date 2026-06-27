export class MimeTypes {

    private static readonly types: Record<string, string> = {
        ".html": "text/html",
        ".css":  "text/css",
        ".js":   "text/javascript",
        ".json": "application/json",
        ".png":  "image/png",
        ".jpg":  "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif":  "image/gif",
        ".svg":  "image/svg+xml",
        ".ico":  "image/x-icon",
        ".txt":  "text/plain",
        ".pdf":  "application/pdf",
        ".woff":  "font/woff",
        ".woff2": "font/woff2",
    };

    private static readonly fallback = "application/octet-stream";

    public static getType(extension: string): string {

        const mimeType = MimeTypes.types[extension.toLowerCase()];

        return mimeType ?? MimeTypes.fallback;
    }
}
