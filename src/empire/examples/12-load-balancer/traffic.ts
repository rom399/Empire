/**
 * 12 - Load balancer: a traffic generator
 *
 * Sends a steady, mixed stream of requests through the balancer so the
 * dashboard has something to show. Prints a one-line summary every few
 * seconds.
 *
 * Run: npx tsx examples/12-load-balancer/traffic.ts [requestsPerSecond] [seconds]
 *   e.g. npx tsx examples/12-load-balancer/traffic.ts          # 8 per second, until Ctrl-C
 *        npx tsx examples/12-load-balancer/traffic.ts 30 20    # 30 per second, for 20 seconds
 */

import process from "process";

const BALANCER_URL = "http://127.0.0.1:8012";
const DEFAULT_RATE = 8;
const SUMMARY_EVERY_MS = 3000;
const MAX_ID = 500;

const rate = Number(process.argv[2] ?? DEFAULT_RATE);
const seconds = Number(process.argv[3] ?? 0);

if (!Number.isFinite(rate) || rate <= 0 || !Number.isFinite(seconds) || seconds < 0) {
    console.error("Usage: npx tsx examples/12-load-balancer/traffic.ts [requestsPerSecond] [seconds]");
    process.exit(1);
}

interface Call {
    method: "GET" | "POST";
    path: () => string;
    weight: number;
}

function randomId(): number {
    return 1 + Math.floor(Math.random() * MAX_ID);
}

const calls: Call[] = [
    { method: "GET", path: () => `/users/${randomId()}`, weight: 10 },
    { method: "GET", path: () => `/reports/${randomId()}`, weight: 3 },
    { method: "GET", path: () => "/slow", weight: 2 },
    { method: "GET", path: () => "/flaky", weight: 3 },
    { method: "GET", path: () => "/health", weight: 2 },
    { method: "POST", path: () => "/orders", weight: 2 },
];

const totalWeight = calls.reduce((sum, call) => sum + call.weight, 0);

function pick(): Call {
    let roll = Math.random() * totalWeight;

    for (const call of calls) {
        roll -= call.weight;

        if (roll <= 0) {
            return call;
        }
    }

    return calls[0];
}

const outcomes = new Map<string, number>();

function count(label: string): void {
    outcomes.set(label, (outcomes.get(label) ?? 0) + 1);
}

async function send(): Promise<void> {
    const call = pick();

    try {
        const response = await fetch(`${BALANCER_URL}${call.path()}`, { method: call.method });
        await response.arrayBuffer();
        count(String(response.status));
    } catch {
        count("network error");
    }
}

const sender = setInterval(() => void send(), 1000 / rate);

const summary = setInterval(() => {
    const parts = Array.from(outcomes.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([label, n]) => `${label}: ${n}`);
    console.log(`[traffic] ${parts.join("   ") || "nothing sent yet"}`);
    outcomes.clear();
}, SUMMARY_EVERY_MS);

function stop(): void {
    clearInterval(sender);
    clearInterval(summary);
    process.exit(0);
}

process.on("SIGINT", stop);

if (seconds > 0) {
    setTimeout(stop, seconds * 1000);
}

console.log(`[traffic] sending ${rate} requests/second to ${BALANCER_URL}${seconds > 0 ? ` for ${seconds}s` : " until Ctrl-C"}`);
