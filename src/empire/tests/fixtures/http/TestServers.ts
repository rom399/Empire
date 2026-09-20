import http from "http";
import net from "net";
import { Empire } from "../../../src/Empire";
import { TestLogger } from "../services/TestLogger";

const LOOPBACK = "127.0.0.1";

/** Asks the OS for a port nothing is listening on right now. */
export function getFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();

        probe.once("error", reject);
        probe.listen(0, LOOPBACK, () => {
            const address = probe.address();
            const port = typeof address === "object" && address ? address.port : 0;

            probe.close(() => resolve(port));
        });
    });
}

export interface RunningServer {
    port: number;
    url: string;
    stop(): Promise<void>;
}

/**
 * Starts a bare http.Server on an OS-assigned port. Used to stand in for a
 * backend, where the test needs full control of what it answers and when.
 */
export function startHttpServer(handler: http.RequestListener): Promise<RunningServer & { server: http.Server }> {
    return new Promise((resolve, reject) => {
        const server = http.createServer(handler);

        server.once("error", reject);
        server.listen(0, LOOPBACK, () => {
            const address = server.address();
            const port = typeof address === "object" && address ? address.port : 0;

            resolve({
                server,
                port,
                url: `http://${LOOPBACK}:${port}`,
                stop: () => new Promise<void>((done) => {
                    server.closeAllConnections();
                    server.close(() => done());
                }),
            });
        });
    });
}

/**
 * Starts an Empire app on a free port. The caller configures routes and
 * middleware in `configure` before it starts listening.
 */
export async function startEmpire(
    configure: (app: Empire) => void,
    port?: number
): Promise<RunningServer & { app: Empire; logger: TestLogger }> {
    const logger = new TestLogger();
    const chosenPort = port ?? await getFreePort();
    const app = new Empire({ host: LOOPBACK, port: chosenPort, logger, shutdownTimeoutMs: 1000 });

    configure(app);
    await app.start();

    return {
        app,
        logger,
        port: chosenPort,
        url: `http://${LOOPBACK}:${chosenPort}`,
        stop: () => app.stop(),
    };
}
