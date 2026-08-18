/**
 * 09 - Dependency Injection
 *
 * Demonstrates Empire's DI container (src/di/) wired into a real app via
 * EmpireOptions.services and ctx.services. Two proof-of-concept services,
 * registered in one composition root:
 *
 * - A singleton in-memory "database" (InMemoryRecordRepository) backing
 *   three separate route handlers - GET /records, GET /records/:id, and
 *   POST /records all resolve the *same* repository instance, showing
 *   several consumers sharing one dependency rather than each importing
 *   their own copy of it.
 * - A scoped UpstreamApiService that calls "an upstream JSON API" over a
 *   real HTTP request via NodeHttpClient (an IHttpClient implementation),
 *   not a mock. To keep this example runnable with no external network
 *   dependency, the "upstream" it calls is this same server's own
 *   /records endpoint - in a real app that would be a different service
 *   entirely, but the plumbing (a real socket, real JSON parsing, a real
 *   IHttpClient behind an interface) is identical either way.
 *
 * See doc/features/DEPENDENCY_INJECTION.md sections 4.2 and 4.3 for the
 * design this follows.
 *
 * Run: npx tsx examples/09-dependency-injection/server.ts
 * Open: http://localhost:8009
 *
 * Try it:
 *   curl http://localhost:8009/records                                # seeded records
 *   curl http://localhost:8009/records/1                               # one record
 *   curl -X POST http://localhost:8009/records \
 *     -H "Content-Type: application/json" \
 *     -d '{"name":"Third sample","value":30}'                          # 201, new record
 *   curl http://localhost:8009/records/nope                            # 404
 *   curl http://localhost:8009/upstream-summary                        # count + total value,
 *                                                                       # fetched via a real
 *                                                                       # HTTP round trip
 */

import process from "process";
import * as http from "http";
import { Empire } from "../../src/Empire";
import { Context } from "../../src/http/Context";
import { HttpError } from "../../src/errors/HttpError";
import { Resolver } from "../../src/di/Resolver";
import { ServiceCollection } from "../../src/di/ServiceCollection";
import { createToken } from "../../src/di/ServiceToken";
import { ILogger } from "../../src/logging/ILogger";
import { ConsoleLogger } from "../../src/logging/ConsoleLogger";

const PORT = 8009;

// --- Sample "database" (DI-7b) ------------------------------------------

interface DataRecord {
    id: string;
    name: string;
    value: number;
}

interface IRecordRepository {
    getAll(): Promise<DataRecord[]>;
    getById(id: string): Promise<DataRecord | undefined>;
    create(data: Omit<DataRecord, "id">): Promise<DataRecord>;
}

class InMemoryRecordRepository implements IRecordRepository {
    private readonly records = new Map<string, DataRecord>();
    private nextId = 1;

    public constructor(seed: DataRecord[] = []) {
        for (const record of seed) {
            this.records.set(record.id, record);
        }

        // Continue numbering after the highest seeded id, rather than
        // always starting at 1 - otherwise the first create() would
        // silently overwrite a seeded record sharing the same id.
        const highestSeededId = seed.reduce((max, record) => Math.max(max, Number(record.id) || 0), 0);
        this.nextId = highestSeededId + 1;
    }

    public async getAll(): Promise<DataRecord[]> {
        return [...this.records.values()];
    }

    public async getById(id: string): Promise<DataRecord | undefined> {
        return this.records.get(id);
    }

    public async create(data: Omit<DataRecord, "id">): Promise<DataRecord> {
        const record: DataRecord = { id: String(this.nextId++), ...data };
        this.records.set(record.id, record);
        return record;
    }
}

// --- HTTP client + upstream API service (DI-7a) -------------------------

interface IHttpClient {
    getJson<T>(url: string): Promise<T>;
}

class NodeHttpClient implements IHttpClient {
    public getJson<T>(url: string): Promise<T> {
        return new Promise((resolve, reject) => {
            const request = http.get(url, (res) => {
                let body = "";
                res.on("data", (chunk: Buffer) => { body += chunk; });
                res.on("end", () => {
                    if (res.statusCode && res.statusCode >= 400) {
                        reject(new Error(`HTTP ${res.statusCode} from ${url}`));
                        return;
                    }

                    try {
                        resolve(JSON.parse(body) as T);
                    } catch (err) {
                        reject(err);
                    }
                });
            });

            request.on("error", reject);
        });
    }
}

interface UpstreamSummary {
    count: number;
    totalValue: number;
}

class UpstreamApiService {
    public constructor(
        private readonly http: IHttpClient,
        private readonly baseUrl: string,
        private readonly logger: ILogger
    ) {}

    public async fetchSummary(): Promise<UpstreamSummary> {
        this.logger.info("Fetching records from upstream");

        const records = await this.http.getJson<DataRecord[]>(`${this.baseUrl}/records`);

        return {
            count: records.length,
            totalValue: records.reduce((sum, record) => sum + record.value, 0),
        };
    }
}

// --- Composition root -----------------------------------------------------

const logger = new ConsoleLogger();

const RecordRepositoryToken = createToken<IRecordRepository>("RecordRepository");
const HttpClientToken = createToken<IHttpClient>("HttpClient");
const UpstreamApiServiceToken = createToken<UpstreamApiService>("UpstreamApiService");

const services = new ServiceCollection();

// Singleton - this *is* the database. Its state has to persist across
// requests, the same reasoning a real connection pool would be a singleton.
services.addSingleton(RecordRepositoryToken, () => new InMemoryRecordRepository([
    { id: "1", name: "First sample", value: 10 },
    { id: "2", name: "Second sample", value: 20 },
]));

// Singleton - stateless, no reason to rebuild it per request.
services.addSingleton(HttpClientToken, () => new NodeHttpClient());

// Scoped - room to hold per-request state later (timing, correlation ids)
// without a redesign, the same reasoning as examples/08-authentication's
// ctx.state pattern for per-request data.
services.addScoped(UpstreamApiServiceToken, async (resolver) =>
    new UpstreamApiService(
        await resolver.resolve(HttpClientToken),
        `http://localhost:${PORT}`,
        logger
    )
);

const provider = services.build();

const app = new Empire({ host: "localhost", port: PORT, logger, services: provider });

// --- Routes -----------------------------------------------------------

// ctx.services is only undefined when EmpireOptions.services was never
// set - this app always sets it, but the check keeps that assumption
// honest instead of a bare non-null assertion, and produces a clear
// error through Empire's normal error pipeline if it's ever wrong.
function requireServices(ctx: Context): Resolver {
    if (!ctx.services) {
        throw new HttpError(500, "Services not configured");
    }

    return ctx.services;
}

app.get("/records", async (ctx) => {
    const repository = await requireServices(ctx).resolve(RecordRepositoryToken);
    ctx.json(await repository.getAll());
});

app.get("/records/:id", async (ctx) => {
    const repository = await requireServices(ctx).resolve(RecordRepositoryToken);
    const record = await repository.getById(ctx.params.id);

    if (!record) {
        throw new HttpError(404, "Record not found");
    }

    ctx.json(record);
});

app.post("/records", async (ctx) => {
    const repository = await requireServices(ctx).resolve(RecordRepositoryToken);
    const body = await ctx.jsonBody() as { name: string; value: number };
    const record = await repository.create(body);

    ctx.status(201).json(record);
});

app.get("/upstream-summary", async (ctx) => {
    const upstreamApi = await requireServices(ctx).resolve(UpstreamApiServiceToken);
    ctx.json(await upstreamApi.fetchSummary());
});

async function start(): Promise<void> {
    try {
        await app.start();
    } catch (err) {
        app.logger.error("Failed to start server", err);
        process.exit(1);
    }
}

process.on("SIGINT", async () => {
    app.logger.info("Shutting down...");

    try {
        await app.stop();
        app.logger.info("Server stopped.");
        process.exit(0);
    } catch (err) {
        app.logger.error("Error during shutdown", err);
        process.exit(1);
    }
});

start();
