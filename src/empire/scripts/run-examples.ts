/**
 * Smoke-tests every examples/NN-name/server.ts: starts it, waits for it
 * to accept connections, confirms it completes a real HTTP round trip,
 * then shuts it down via SIGINT - the exact signal every example
 * registers a handler for (app.stop() then process.exit(0)) - and
 * confirms that handler actually exits cleanly, rather than assuming it
 * does. Fails fast: stops at the first example that doesn't pass instead
 * of running all ten and aggregating.
 *
 * Node builtins only, run via tsx - no new dependencies.
 */

import { spawn, ChildProcess } from "child_process";
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
            child.kill("SIGKILL");
            reject(new Error(`Process did not exit within ${timeoutMs}ms of SIGINT - force-killed`));
        }, timeoutMs);

        child.once("exit", (code) => {
            clearTimeout(timer);
            resolve(code);
        });
    });
}

async function runExample(example: Example): Promise<void> {
    console.log(`\n--- ${example.name} (port ${example.port}) ---`);

    // CI (this script's actual target) runs on Linux, where spawn("npx", ...)
    // works directly - no shell needed, no warning. Windows needs shell:true
    // to run npx.cmd at all; Node warns about that combined with an args
    // array (unescaped arguments), which doesn't apply here since
    // example.serverPath comes from a local directory listing, never
    // untrusted input - scoped to Windows only so CI never sees it.
    const child = spawn("npx", ["tsx", example.serverPath], {
        stdio: "inherit",
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

        child.kill("SIGINT");
        const exitCode = await waitForExit(child, SHUTDOWN_TIMEOUT_MS);

        // Windows can't deliver a real SIGINT the way POSIX can - kill()
        // there just force-terminates the process (a null exit code, not
        // the graceful process.exit(0) the example's own handler would
        // produce), so the strict "exited 0" check only means anything on
        // the POSIX platform CI actually runs on. Still confirms the
        // process actually stopped either way - waitForExit already
        // rejects on a genuine hang, regardless of platform.
        if (process.platform !== "win32" && exitCode !== 0) {
            throw new Error(`Exited with code ${exitCode} after SIGINT, expected 0`);
        }

        console.log("  shut down cleanly");
    } catch (err) {
        if (!childExited) {
            child.kill("SIGKILL");
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
