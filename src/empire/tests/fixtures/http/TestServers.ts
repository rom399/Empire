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

/** How many times startEmpire() picks a fresh port if the one it chose is taken before it can listen. */
const MAX_PORT_ATTEMPTS = 5;

/**
 * Starts an Empire app on a free port. The caller configures routes and
 * middleware in `configure` before it starts listening.
 *
 * Asking the OS for a free port and then listening on it are two steps, and
 * another test process running in parallel can take the port in between - so
 * when it is not pinned by the caller, an EADDRINUSE is retried with a new
 * port instead of failing an unrelated test.
 */
export async function startEmpire(
    configure: (app: Empire) => void,
    port?: number
): Promise<RunningServer & { app: Empire; logger: TestLogger }> {
    for (let attempt = 1; ; attempt++) {
        const logger = new TestLogger();
        const chosenPort = port ?? await getFreePort();
        const app = new Empire({ host: LOOPBACK, port: chosenPort, logger, shutdownTimeoutMs: 1000 });

        configure(app);

        try {
            await app.start();
        } catch (err) {
            const portTaken = err instanceof Error && "code" in err && err.code === "EADDRINUSE";

            if (port !== undefined || !portTaken || attempt >= MAX_PORT_ATTEMPTS) {
                throw err;
            }

            continue;
        }

        return {
            app,
            logger,
            port: chosenPort,
            url: `http://${LOOPBACK}:${chosenPort}`,
            stop: () => app.stop(),
        };
    }
}
