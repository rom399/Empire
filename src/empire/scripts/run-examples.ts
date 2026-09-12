/**
 * Smoke-tests every examples/NN-name/server.ts: starts it, waits for it
 * to accept connections, confirms it completes a real HTTP round trip,
 * then shuts it down - on POSIX via a real SIGINT, the exact signal every
 * example registers a handler for (app.stop() then process.exit(0)),
 * confirming that handler actually exits cleanly rather than assuming it
 * does; on Windows via killTree()'s tree-kill instead, since a signal
 * can't reach the real process there anyway (see that function's
 * comment). Fails fast: stops at the first example that doesn't pass
 * instead of running all ten and aggregating.
 *
 * Node builtins only, run via tsx - no new dependencies.
 */

import { spawn, ChildProcess, execFileSync } from "child_process";
import { connect } from "net";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

const EXAMPLES_DIR = join(__dirname, "..", "examples");
const READY_TIMEOUT_MS = 10_000;
// Comfortably longer than Empire.stop()'s own 10s default shutdown
// timeout, so a legitimately-slow-but-graceful shutdown isn't mistaken
// for a hang.
const SHUTDOWN_TIMEOUT_MS = 15_000;

interface Example {
    name: string;
    serverPath: string;
    port: number;
}

function discoverExamples(): Example[] {
    return readdirSync(EXAMPLES_DIR)
        .filter((name) => statSync(join(EXAMPLES_DIR, name)).isDirectory())
        .sort()
        .map((name) => {
            const serverPath = join(EXAMPLES_DIR, name, "server.ts");
            const source = readFileSync(serverPath, "utf-8");

            return { name, serverPath, port: extractPort(source, serverPath) };
        });
}

/**
 * Extracted from the source rather than assumed from the 8000 + N
 * convention, so this doesn't silently drift from reality if a future
 * example ever breaks that pattern. Handles both styles actually in use:
 * an inline literal (`port: 8010`) and a named constant referenced by
 * `port:` (`const PORT = 8009; ... port: PORT`), the latter needed by any
 * example that reuses its own port elsewhere (e.g. a loopback URL).
 */
function extractPort(source: string, serverPath: string): number {
    const literal = source.match(/port:\s*(\d+)/);

    if (literal) {
        return Number(literal[1]);
    }

    const reference = source.match(/port:\s*(\w+)/);

    if (reference) {
        const constant = source.match(new RegExp(`const\\s+${reference[1]}\\s*=\\s*(\\d+)`));

        if (constant) {
            return Number(constant[1]);
        }
    }

    throw new Error(`Could not determine the port ${serverPath} listens on`);
}

function waitForPort(port: number, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    return new Promise((resolve, reject) => {
        function attempt(): void {
            // "localhost", not the literal 127.0.0.1 - every example
            // binds to "localhost", and on a machine where that resolves
            // to ::1 first, connecting to the IPv4 literal specifically
            // would miss the IPv6 socket the server is actually on.
            const socket = connect({ port, host: "localhost" }, () => {
                socket.end();
                resolve();
            });

            socket.on("error", () => {
                socket.destroy();

                if (Date.now() > deadline) {
                    reject(new Error(`Timed out waiting for port ${port} to accept connections`));
                    return;
                }

                setTimeout(attempt, 100);
            });
        }

        attempt();
    });
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<number | null> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            killTree(child);
            reject(new Error(`Process did not exit within ${timeoutMs}ms of SIGINT - force-killed`));
        }, timeoutMs);

        child.once("exit", (code) => {
            clearTimeout(timer);
            resolve(code);
        });
    });
}

/**
 * Force-terminates a spawned example, including everything running
 * underneath it. On Windows, tsx.cmd needs shell: true (see runExample()),
 * so the process spawn() hands back is actually cmd.exe - the real
 * tsx/node server process runs as its grandchild. Windows has no
 * POSIX-style process groups, so child.kill() only ever reaches that
 * cmd.exe wrapper: killing it exits the ChildProcess object this script
 * is watching (satisfying waitForExit() below), while the real server
 * process is silently orphaned - still bound to its port, still holding
 * the stdio pipe this script inherits open, indefinitely. taskkill's /t
 * (tree) flag kills the whole subtree instead of just the wrapper.
 * POSIX doesn't need any of this - the process spawn() returns there IS
 * the real one, so a plain signal reaches it directly.
 */
function killTree(child: ChildProcess): void {
    if (process.platform === "win32" && child.pid !== undefined) {
        try {
            execFileSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
        } catch {
            // Already gone between whatever check triggered this call and
            // taskkill actually running - not a failure worth surfacing.
        }
        return;
    }

    child.kill("SIGKILL");
}

async function runExample(example: Example): Promise<void> {
    console.log(`\n--- ${example.name} (port ${example.port}) ---`);

    // Spawn tsx's own binary directly, not "npx tsx". npx is a wrapper
    // process - a real CI run showed SIGINT sent to it does not reliably
    // reach the actual node/tsx process running underneath, so the
    // example's own shutdown handler never saw it. Resolving the local
    // binary path means the spawned child IS the example process, and
    // kill("SIGINT") below reaches its handler directly, no forwarding.
    const tsxBin = join(
        __dirname, "..", "node_modules", ".bin",
        process.platform === "win32" ? "tsx.cmd" : "tsx"
    );
    const child = spawn(tsxBin, [example.serverPath], {
        stdio: "inherit",
        // .cmd files can't be spawned directly on Windows without a
        // shell; the real POSIX binary on the CI runner needs none.
        shell: process.platform === "win32",
    });

    let childExited = false;
    child.once("exit", () => { childExited = true; });

    try {
        await waitForPort(example.port, READY_TIMEOUT_MS);
        console.log("  ready");

        if (childExited) {
            throw new Error("Process exited before it could be tested");
        }

        const response = await fetch(`http://localhost:${example.port}/`);
        // Any completed HTTP response - even a 404 - proves the server
        // accepted the connection and completed a real round trip through
        // Empire's pipeline. This isn't asserting each example's specific
        // routes, just that the server is genuinely alive and speaking HTTP.
        console.log(`  responded: HTTP ${response.status}`);

        if (process.platform === "win32") {
            // A real SIGINT can't reach the actual tsx/node process this
            // way on Windows regardless (see killTree()'s comment) - go
            // straight to a full tree-kill rather than sending a signal
            // that would only exit the cmd.exe wrapper and orphan the
            // server underneath it.
            killTree(child);
        } else {
            child.kill("SIGINT");
        }

        const exitCode = await waitForExit(child, SHUTDOWN_TIMEOUT_MS);

        // On Windows the process above was force-killed, not given a
        // chance at graceful shutdown, so a null exit code there is
        // expected - the strict "exited 0" check only means anything on
        // the POSIX platform CI actually runs on. Still confirms the
        // process actually stopped either way - waitForExit already
        // rejects on a genuine hang, regardless of platform.
        if (process.platform !== "win32" && exitCode !== 0) {
            throw new Error(`Exited with code ${exitCode} after SIGINT, expected 0`);
        }

        console.log("  shut down cleanly");
    } catch (err) {
        if (!childExited) {
            killTree(child);
        }
        throw err;
    }
}

async function main(): Promise<void> {
    const examples = discoverExamples();
    console.log(`Found ${examples.length} example(s) to smoke-test.`);

    for (const example of examples) {
        try {
            await runExample(example);
        } catch (err) {
            console.error(`\nFAILED: ${example.name}`);
            console.error(err instanceof Error ? err.message : err);
            process.exit(1);
        }
    }

    console.log(`\nAll ${examples.length} examples passed.`);
}

main();
