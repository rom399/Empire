const DEFAULT_TIMEOUT_MS = 4000;
const POLL_INTERVAL_MS = 15;

/**
 * Polls until a condition holds instead of sleeping a fixed time - a fixed
 * delay is a race that passes on a quiet machine and fails under load,
 * whereas this fails only when the condition genuinely never becomes true.
 */
export async function waitFor(
    condition: () => boolean,
    what: string,
    timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    while (!condition()) {
        if (Date.now() > deadline) {
            throw new Error(`Timed out waiting for ${what}`);
        }

        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
}
