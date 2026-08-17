import http from "http";
import fs from "fs";

/**
 * Streams a file to the response rather than reading it fully into
 * memory first - necessary for large bundles and assets.
 *
 * The client disconnecting mid-stream never fires "finish" on the
 * response - only "close". Settling the returned promise on either,
 * rather than only "finish", and destroying the still-open read stream
 * in the same cleanup path, is what stops an aborted download from
 * hanging the caller and leaking a file descriptor.
 */
export function streamFileToResponse(
    res: http.ServerResponse,
    filePath: string
): Promise<void> {

    return new Promise<void>((resolve, reject) => {
        const stream = fs.createReadStream(filePath);

        const cleanup = () => {
            stream.destroy();
            stream.off("error", onError);
            res.off("finish", onFinish);
            res.off("close", onClose);
        };

        const onFinish = () => {
            cleanup();
            resolve();
        };

        const onClose = () => {
            cleanup();
            resolve();
        };

        const onError = (err: Error) => {
            cleanup();
            reject(err);
        };

        stream.on("error", onError);
        res.on("finish", onFinish);
        res.on("close", onClose);
        stream.pipe(res);
    });
}
