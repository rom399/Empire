# Using empire-ts

A standalone demo of consuming **empire-ts** the way a real npm
consumer would - `import { Empire } from "empire-ts"`, nothing else.
This is deliberately separate from Empire's own
[`examples/`](https://github.com/rom399/Empire/tree/main/src/empire/examples)
folder, which imports the framework's source directly
(`../../src/Empire`) to exercise the code as currently written;
`package-example` instead exercises the actual **published package
shape** - only what `dist/index.js` exports, nothing from internal
files.

> `package-example` lives inside the Empire monorepo for convenience,
> but nothing in it is Empire-specific tooling - delete its
> `node_modules/` and `package-lock.json` and it works as a completely
> independent project.

## Setup

**If empire-ts is published on npm:**

```bash
npm install empire-ts
```

**If you're running this from inside the Empire repo, before/without a
real publish** (which is how `package-example`'s own `package.json` is
set up right now): build the package first, then point at the tarball
it produces.

```bash
cd ..                  # src/empire
npm run build
npm pack                # produces empire-ts-<version>.tgz
cd package-example
npm install             # installs the tarball referenced in package.json
```

Either way, `import { Empire } from "empire-ts"` resolves the same way -
there's nothing local-install-specific about the example code itself.

## Examples

[`package-example/examples`](https://github.com/rom399/Empire/tree/main/src/empire/package-example/examples)
mirrors Empire's own eleven numbered examples 1:1 - same behavior, same
routes, only the import changed from the framework's source tree to
`"empire-ts"`, and each port shifted by 1000 so both sets can run side
by side without colliding.

| Example | Port | Shows |
|---|---|---|
| `01-basic-server` | 9001 | A minimal server: an HTML route, a JSON health check, and a POST route that echoes its JSON body back |
| `02-routing` | 9002 | A full REST-style user API: route params, query strings, a multi-param nested route, and a literal route registered ahead of an overlapping param route |
| `03-middleware` | 9003 | The built-in `createLoggerMiddleware(logger)`, a short-circuiting auth-header check, and a custom timing middleware |
| `04-static-files` | 9004 | An unprefixed static folder and a second one mounted under a URL prefix, served side by side |
| `05-error-handling` | 9005 | `HttpError` and `BadRequestError` thrown from route handlers, and an uncaught error on `/crash` becoming a `500` |
| `06-react-app` | 9006 | A real React + React Router app served with `spaFallback: true`, alongside a real API route that takes priority over the fallback |
| `07-body-size-limit` | 9007 | A deliberately small `maxBodySize`, so the automatic `413` response is easy to trigger |
| `08-authentication` | 9008 | A worked example of writing your own auth middleware: Bearer token parsing, `WWW-Authenticate` on rejection, and handing an identity to route handlers via `ctx.state` |
| `09-dependency-injection` | 9009 | The DI container wired into a real app: a singleton in-memory repository backing three `/records` routes, and a scoped service that calls an "upstream" API over a real HTTP request via `ctx.services` |
| `10-validation` | 9010 | `validate()` covering body, query (with `z.coerce`), and route param validation, each with a passing and a failing request |
| `11-cors` | 9011 | `createCorsMiddleware()` covering an allowed vs. disallowed origin, a preflight with custom headers and credentials, and a stricter multi-policy for `/admin` |

The first two, in full, showing exactly how the package is consumed -
every other row in the table above follows the same shape, just
swapping which `empire-ts` exports it uses for the feature it covers.

### `01-basic-server`

```ts
import process from "process";
import { Empire, ConsoleLogger } from "empire-ts";

const app = new Empire({
    host: "localhost",
    port: 9001,
    logger: new ConsoleLogger(),
});

app.get("/", (ctx) => {
    ctx.html(`
        <!DOCTYPE html>
        <html>
            <head>
                <title>Empire</title>
            </head>
            <body>
                <h1>Welcome to Empire</h1>
                <p>A lightweight TypeScript web framework.</p>
            </body>
        </html>
    `);
});

app.get("/health", (ctx) => {
    ctx.json({
        status: "healthy",
        timestamp: new Date().toISOString(),
    });
});

app.post("/echo", async (ctx) => {
    const body = await ctx.jsonBody();

    ctx.json({
        received: body,
    });
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
```

Run (from `package-example/`): `npx tsx examples/01-basic-server/server.ts`

### `02-routing`

```ts
import process from "process";
import { Empire } from "empire-ts";

const app = new Empire({
    host: "localhost",
    port: 9002,
});

const users = [
    { id: "1", name: "Alice", role: "admin" },
    { id: "2", name: "Bob",   role: "user"  },
    { id: "3", name: "Carol", role: "user"  },
];

const posts = [
    { id: "101", userId: "1", title: "Hello, Empire" },
    { id: "102", userId: "1", title: "Routing deep dive" },
    { id: "201", userId: "2", title: "Bob's first post" },
];

app.get("/users", (ctx) => {
    const role = ctx.query.get("role");

    const result = role
        ? users.filter((u) => u.role === role)
        : users;

    ctx.json(result);
});

// Registered before /users/:id so it isn't swallowed by the param route.
app.get("/users/me", (ctx) => {
    ctx.json(users[0]);
});

app.get("/users/:id", (ctx) => {
    const user = users.find((u) => u.id === ctx.params.id);

    if (!user) {
        ctx.status(404).json({ error: "User not found" });
        return;
    }

    ctx.json(user);
});

app.post("/users", async (ctx) => {
    const body = await ctx.jsonBody() as { name: string; role: string };

    const newUser = {
        id:   String(users.length + 1),
        name: body.name,
        role: body.role ?? "user",
    };

    users.push(newUser);

    ctx.status(201).json(newUser);
});

app.put("/users/:id", async (ctx) => {
    const index = users.findIndex((u) => u.id === ctx.params.id);

    if (index === -1) {
        ctx.status(404).json({ error: "User not found" });
        return;
    }

    const body = await ctx.jsonBody() as { name: string; role: string };

    // Full replace — every field comes from the request body, nothing
    // carries over from the existing user except the id from the URL.
    users[index] = { id: ctx.params.id, name: body.name, role: body.role };

    ctx.json(users[index]);
});

app.patch("/users/:id", async (ctx) => {
    const user = users.find((u) => u.id === ctx.params.id);

    if (!user) {
        ctx.status(404).json({ error: "User not found" });
        return;
    }

    // Partial update — only fields present in the body are touched.
    const body = await ctx.jsonBody() as Partial<{ name: string; role: string }>;

    Object.assign(user, body);

    ctx.json(user);
});

app.delete("/users/:id", (ctx) => {
    const index = users.findIndex((u) => u.id === ctx.params.id);

    if (index === -1) {
        ctx.status(404).json({ error: "User not found" });
        return;
    }

    users.splice(index, 1);

    ctx.status(204).text("");
});

app.get("/users/:id/posts", (ctx) => {
    const user = users.find((u) => u.id === ctx.params.id);

    if (!user) {
        ctx.status(404).json({ error: "User not found" });
        return;
    }

    const page = ctx.query.get("page") ?? "1";

    ctx.json({
        userId: ctx.params.id,
        page:   Number(page),
        posts:  posts.filter((p) => p.userId === ctx.params.id),
    });
});

app.get("/users/:userId/posts/:postId", (ctx) => {
    const user = users.find((u) => u.id === ctx.params.userId);

    if (!user) {
        ctx.status(404).json({ error: "User not found" });
        return;
    }

    const post = posts.find(
        (p) => p.userId === ctx.params.userId && p.id === ctx.params.postId
    );

    if (!post) {
        ctx.status(404).json({ error: "Post not found" });
        return;
    }

    ctx.json(post);
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
```

Run (from `package-example/`): `npx tsx examples/02-routing/server.ts`

The remaining nine live at
[`package-example/examples`](https://github.com/rom399/Empire/tree/main/src/empire/package-example/examples)
on GitHub, one folder per row in the table above.

### [`full-featured.ts`](https://github.com/rom399/Empire/blob/main/src/empire/package-example/full-featured.ts) (bonus)

Not a mirror of a numbered example - a twelfth, combined showcase
wiring several features together in one app through nothing but the
public exports of `empire-ts`: a singleton repository via the DI
container, logger and CORS middleware, Zod-based request validation,
and `HttpError` for a clean 404.

```bash
npx tsx full-featured.ts
```

```bash
curl http://localhost:9012/users
curl -X POST http://localhost:9012/users -H "Content-Type: application/json" -d '{"name":"Ada","email":"ada@example.com"}'
curl http://localhost:9012/users/1
curl http://localhost:9012/users/999   # 404
```

## What this proves

All twelve were run for real against `node_modules/empire-ts` installed
from the actual `npm pack` tarball - not a symlink into the source
tree, not hand-copied files. If `tsc --noEmit` and every server works
here, the package genuinely works as published: the right things are
exported from `dist/index.js`, the `.d.ts` files type-check correctly
for a consumer, and `main`/`types` in `package.json` point where they
should.

## Updating the Source Code

This file ships with the published npm package, so it can only link
elsewhere by full URL - a relative link to a file that isn't bundled in
the package (like the one below) would be broken for anyone reading this
from npmjs.com or from inside an installed `node_modules/empire-ts`.

If you want to modify empire-ts itself - add a feature, fix a bug, run
the test suite, understand how the framework is built - see
[README_DEVELOPMENT.MD](https://github.com/rom399/Empire/blob/main/src/empire/README_DEVELOPMENT.MD)
on GitHub.

## Learn more

Full API walkthrough, the complete example suite, and contribution
guidelines: [github.com/rom399/Empire](https://github.com/rom399/Empire/tree/main/src/empire).
