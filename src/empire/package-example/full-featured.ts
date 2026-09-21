/**
 * A small "users" API exercising several empire-ts features together,
 * all wired up using only what "empire-ts" exports - no reach-ins to
 * internal files:
 *
 * - Dependency injection: a singleton in-memory repository, resolved
 *   per-request via ctx.services
 * - CORS: a single allowed origin, credentials enabled
 * - Logging middleware
 * - Request body checking, with BadRequestError answering 400
 * - HttpError for a clean 404
 *
 * Run: npx tsx full-featured.ts   (from this directory, after npm install)
 * Open: http://localhost:9012
 *
 * Try it:
 *   curl http://localhost:9012/users
 *   curl -X POST http://localhost:9012/users \
 *     -H "Content-Type: application/json" \
 *     -d '{"name":"Ada","email":"ada@example.com"}'
 *   curl http://localhost:9012/users/1
 *   curl http://localhost:9012/users/999          # 404
 */

import process from "process";
import {
    Empire,
    ConsoleLogger,
    ServiceCollection,
    createToken,
    createLoggerMiddleware,
    createCorsMiddleware,
    BadRequestError,
    HttpError,
    Resolver,
} from "empire-ts";

interface User {
    id: string;
    name: string;
    email: string;
}

interface UserRepository {
    all(): User[];
    findById(id: string): User | undefined;
    add(name: string, email: string): User;
}

const UserRepositoryToken = createToken<UserRepository>("UserRepository");

const services = new ServiceCollection();

services.addSingleton(UserRepositoryToken, () => {
    const users: User[] = [{ id: "1", name: "Ada Lovelace", email: "ada@example.com" }];
    let nextId = 2;

    return {
        all: () => users,
        findById: (id) => users.find((u) => u.id === id),
        add: (name, email) => {
            const user: User = { id: String(nextId++), name, email };
            users.push(user);
            return user;
        },
    };
});

const logger = new ConsoleLogger();

const app = new Empire({
    host: "localhost",
    port: 9012,
    logger,
    services: services.build(),
});

app.use(createLoggerMiddleware(logger));

app.use(createCorsMiddleware({
    origin: ["http://localhost:5173"],
    credentials: true,
}));

async function getRepo(ctxServices: Resolver | undefined): Promise<UserRepository> {
    if (!ctxServices) {
        throw new HttpError(500, "DI container not configured");
    }

    return ctxServices.resolve(UserRepositoryToken);
}

app.get("/users", async (ctx) => {
    const repo = await getRepo(ctx.services);
    ctx.json(repo.all());
});

app.post("/users", async (ctx) => {
    const body = await ctx.jsonBody();

    if (typeof body !== "object" || body === null) {
        throw new BadRequestError("Request body must be a JSON object");
    }

    const { name, email } = body as { name?: unknown; email?: unknown };

    if (typeof name !== "string" || name === "") {
        throw new BadRequestError("name is required");
    }

    if (typeof email !== "string" || !email.includes("@")) {
        throw new BadRequestError("email must be a valid address");
    }

    const repo = await getRepo(ctx.services);
    const user = repo.add(name, email);
    ctx.status(201).json(user);
});

app.get("/users/:id", async (ctx) => {
    const repo = await getRepo(ctx.services);
    const user = repo.findById(ctx.params.id);

    if (!user) {
        throw new HttpError(404, `User ${ctx.params.id} was not found`);
    }

    ctx.json(user);
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

void start();
