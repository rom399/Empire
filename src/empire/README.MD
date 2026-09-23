# Using empire-ts

**empire-ts** is a lightweight TypeScript HTTP framework built from
scratch on Node's `http` module, with zero runtime dependencies -
routing, middleware, a typed `Context`, dependency injection,
schema-based validation, CORS, and centralized error handling. It also
exports a small layer-7 load balancer, built from the same pieces:
backends register themselves with the balancer over plain HTTP, and the
GIF below shows its live dashboard - backends under traffic, a
drill-down into one, and one deregistering and rejoining, with no config
to edit. This document covers installing and using the published
package - the framework first, then the load balancer.

![The load balancer example running: backends under traffic, a drill-down into one, and one deregistering and rejoining](https://raw.githubusercontent.com/rom399/Empire/main/src/empire/doc/images/load-balancer-example.gif)

Every example below runs against `empire-ts` the way a real consumer
would install it - `import { Empire } from "empire-ts"`, nothing else -
and is demoed in
[`package-example`](https://github.com/rom399/Empire/tree/main/src/empire/package-example),
a standalone project inside the Empire monorepo that exercises the
actual **published package shape**, only what `dist/index.js` exports.
This is deliberately separate from Empire's own
[`examples/`](https://github.com/rom399/Empire/tree/main/src/empire/examples)
folder, which is **for developers extending Empire itself** and imports
the framework's source directly rather than the published package.
`package-example` lives in the monorepo for convenience, but nothing in
it is Empire-specific tooling - delete its `node_modules/` and
`package-lock.json` and it works as a completely independent project.

## Empire Framework

### Getting Started

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

`empire-ts` has no runtime dependencies. For request validation, see
[Validation](#validation) below.

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

#### `01-basic-server`

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

void start();
```

Run (from `package-example/`): `npx tsx examples/01-basic-server/server.ts`

#### `02-routing`

```ts
import process from "process";
import { Empire, BadRequestError } from "empire-ts";

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

// A JSON body arrives as `unknown`, so each handler checks the fields it needs
// and throws BadRequestError (a 400) for anything missing or malformed. For
// schema-based checking with per-field details, see examples/10-validation.
function readObject(body: unknown): Record<string, unknown> {
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new BadRequestError("Request body must be a JSON object");
    }

    return body as Record<string, unknown>;
}

function readText(body: Record<string, unknown>, field: string): string | undefined {
    const value = body[field];

    if (value === undefined) {
        return undefined;
    }

    if (typeof value !== "string" || value === "") {
        throw new BadRequestError(`${field} must be a non-empty string`);
    }

    return value;
}

function requireText(body: Record<string, unknown>, field: string): string {
    const value = readText(body, field);

    if (value === undefined) {
        throw new BadRequestError(`${field} is required`);
    }

    return value;
}

app.post("/users", async (ctx) => {
    const body = readObject(await ctx.jsonBody());

    const newUser = {
        id:   String(users.length + 1),
        name: requireText(body, "name"),
        role: readText(body, "role") ?? "user",
    };

    users.push(newUser);

    ctx.status(201).json(newUser);
});

app.put("/users/:id", async (ctx) => {
    // The body is checked before the lookup, so an invalid body answers 400
    // even when the id does not exist.
    const body = readObject(await ctx.jsonBody());
    const name = requireText(body, "name");
    const role = requireText(body, "role");

    const index = users.findIndex((u) => u.id === ctx.params.id);

    if (index === -1) {
        ctx.status(404).json({ error: "User not found" });
        return;
    }

    // Full replace — every field comes from the request body, nothing
    // carries over from the existing user except the id from the URL.
    users[index] = { id: ctx.params.id, name, role };

    ctx.json(users[index]);
});

app.patch("/users/:id", async (ctx) => {
    const body = readObject(await ctx.jsonBody());
    const name = readText(body, "name");
    const role = readText(body, "role");

    const user = users.find((u) => u.id === ctx.params.id);

    if (!user) {
        ctx.status(404).json({ error: "User not found" });
        return;
    }

    // Partial update — only fields present in the body are touched.
    if (name !== undefined) {
        user.name = name;
    }

    if (role !== undefined) {
        user.role = role;
    }

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

void start();
```

Run (from `package-example/`): `npx tsx examples/02-routing/server.ts`

The remaining nine live at
[`package-example/examples`](https://github.com/rom399/Empire/tree/main/src/empire/package-example/examples)
on GitHub, one folder per row in the table above.

#### [`full-featured.ts`](https://github.com/rom399/Empire/blob/main/src/empire/package-example/full-featured.ts) (bonus)

Not a mirror of a numbered example - a twelfth, combined showcase
wiring several features together in one app through nothing but the
public exports of `empire-ts`: a singleton repository via the DI
container, logger and CORS middleware, request body checking,
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

All twelve were run for real against `node_modules/empire-ts` installed
from the actual `npm pack` tarball - not a symlink into the source
tree, not hand-copied files. If `tsc --noEmit` and every server works
here, the package genuinely works as published: the right things are
exported from `dist/index.js`, the `.d.ts` files type-check correctly
for a consumer, and `main`/`types` in `package.json` point where they
should.

This file ships with the published npm package, so it can only link
elsewhere by full URL - a relative link to a file that isn't bundled in
the package would be broken for anyone reading this from npmjs.com or
from inside an installed `node_modules/empire-ts`. If you want to modify
empire-ts itself - add a feature, fix a bug, run the test suite,
understand how the framework is built - see
[README_DEVELOPMENT.MD](https://github.com/rom399/Empire/blob/main/src/empire/README_DEVELOPMENT.MD)
on GitHub.

### Routing

Routes are registered with `app.get()`, `app.post()`, and one method for
each of the other four HTTP verbs, with `:param` segments captured into
`ctx.params`:

```ts
app.get("/users/:id", (ctx) => {
    ctx.json({ id: ctx.params.id });
});
```

`HEAD` needs no registration of its own - it's automatically answered
wherever `GET` is registered, body discarded but the same headers set.
`OPTIONS` also needs no registration by default: any path with at least
one other method registered automatically responds `204` with an
`Allow` header listing what's available there.

**Routes are matched in registration order, and the first match wins -
this is the developer's responsibility to get right, not something
Empire resolves automatically.** Register more specific (literal)
routes before more general (parameterized) ones that could overlap
them:

```ts
app.get("/users/new", (ctx) => ctx.text("literal"));
app.get("/users/:id", (ctx) => ctx.text("param"));

// GET /users/new -> "literal"
// GET /users/42  -> "param"
```

See `examples/02-routing` above for a runnable version of all of this,
alongside query strings and a full REST-style user API.

### Static Files

`app.useStaticFiles(root)` serves files from a directory, matched
against the request path before routing runs. Pass `{ prefix }` to
mount a folder under a URL prefix instead of checking every request
path against it directly, and multiple prefixed folders can be mounted
on the same server without colliding:

```ts
app.useStaticFiles("./public/assets", { prefix: "/assets" });
app.useStaticFiles("./storage/uploads", { prefix: "/uploads" });
```

If a request path resolves to a directory, an `index.html` inside it is
served automatically. Pass `{ spaFallback: true }` to serve
`root/index.html` for any unmatched `GET` request instead of a `404` -
useful for single-page apps using client-side routing; a `POST` or
other non-`GET` request to an unmatched path still gets a real `404`,
so a broken request is never silently masked by the HTML shell. See
`examples/04-static-files` for prefixed and unprefixed mounting side by
side, and `examples/06-react-app` for the SPA fallback with a real
React Router app.

### Request & Response Helpers

Beyond `ctx.params` and `ctx.query`, `Context` exposes `ctx.ipAddress`
(preferring `X-Forwarded-For` over the raw socket address),
`ctx.userAgent`, `ctx.contentType`, and `ctx.accepts(type)` on the
request side. On the response side, `ctx.redirect(url, status?)`
defaults to a `302`, `ctx.file(path)` streams a single file from inside
a route handler with the correct MIME type (throwing `HttpError(404)`
if missing - this differs from `app.useStaticFiles()`, which mounts a
whole directory, not one file from a handler you write), and
`ctx.download(path, filename?)` does the same but forces a download via
`Content-Disposition`.

### Cookies

```ts
app.post("/login", (ctx) => {
    ctx.cookie("session", "abc123", { httpOnly: true, secure: true, maxAge: 3600 });
    ctx.json({ ok: true });
});
```

`ctx.cookie(name, value, options?)` sets a `Set-Cookie` header,
appending to any already set rather than overwriting, since a response
can set more than one. `ctx.clearCookie(name)` sets the same cookie
with an already-expired date, instructing the browser to delete it.

### Middleware

Middleware is registered with `app.use()` and runs in registration
order. A middleware must call `next()` to continue the chain - if it
doesn't, the request is left unanswered rather than falling through:

```ts
app.use(async (ctx, next) => {
    if (!isAuthenticated(ctx)) {
        ctx.status(401).text("Unauthorized");
        return; // chain stops here - next() is never called
    }
    await next();
});
```

See `examples/03-middleware` for the built-in `createLoggerMiddleware(logger)`,
a short-circuiting check, and a custom timing middleware, showing pipeline
ordering.

### Error Handling

`HttpError` is the base class for an error that should become a
specific HTTP response. Throw one from a route handler or middleware
with a status code and a message; `BadRequestError(message)` is a
shorthand for `new HttpError(400, message)`.

```ts
app.get("/products/:id", (ctx) => {
    if (!isValidId(ctx.params.id)) {
        throw new HttpError(404, `Product with id ${ctx.params.id} was not found`);
    }
    ctx.json({ id: ctx.params.id });
});
```

An `HttpError` becomes its own status code with a JSON body,
`{ "error": "<message>" }`. Anything else - a plain `Error` or any other
thrown value - always becomes a `500` with a generic body; the real
message is never sent to the client, only logged server-side. There is
no configurable or replaceable error handler - this mapping is fixed.
See `examples/05-error-handling` for a runnable version, including the
always-500 `/crash` route.

### Server Lifecycle

```ts
await app.start(); // resolves once the server is listening
await app.stop();  // resolves once it has shut down
```

`stop()` is a graceful shutdown, not a bare socket close: idle
keep-alive connections close immediately, requests already in flight
are given time to finish, anything still open after
`shutdownTimeoutMs` (default 10 seconds) is force-closed, and any
singletons registered via `EmpireOptions.services` are disposed in
reverse construction order (see Dependency Injection below). **Empire
does not register `SIGTERM`/`SIGINT` handlers itself** - wire that up
yourself, the way `01-basic-server` above does, since a library
registering process-wide signal handlers as a side effect of
construction would risk interfering with, for example, a test runner's
own `Ctrl+C` handling.

### Dependency Injection

A hand-rolled DI container with singleton, scoped, and transient
lifetimes. Register services on `EmpireOptions.services`, and resolve
them inside a request via `ctx.services`, which is backed by a
per-request scope Empire creates and disposes automatically once the
response ends:

```ts
import { Empire, ServiceCollection, createToken } from "empire-ts";

interface IUserRepository { findAll(): User[]; }
const UserRepository = createToken<IUserRepository>("UserRepository");

const services = new ServiceCollection();
services.addSingleton(UserRepository, () => new InMemoryUserRepository());

const app = new Empire({ host: "localhost", port: 9009, services: services.build() });

app.get("/users", async (ctx) => {
    const repo = await ctx.services!.resolve(UserRepository);
    ctx.json(repo.findAll());
});
```

`ctx.services` is `undefined` when the app was built without
`EmpireOptions.services` - dependency injection is entirely opt-in. See
`examples/09-dependency-injection` for a singleton in-memory repository
and a scoped service that calls an "upstream" API over a real HTTP
request.

### Validation

`validate()` wraps a route handler with schema-based validation of the
request body, query string, and/or route params, using any validator
that implements [Standard Schema](https://standardschema.dev) - [Zod](https://zod.dev), Valibot, ArkType, or one
you write by hand. Empire depends on none of them: you install the one you want
(`npm install zod`), and Empire relies only on the small interface they all share
(see [`doc/features/03_Request_Validation.md`](https://github.com/rom399/Empire/blob/main/src/empire/doc/features/03_Request_Validation.md) for the design).
It wraps a handler the same way `createLoggerMiddleware(logger)` wraps a
middleware, so it needs no changes to `Router` or `Context`.

#### Using Zod

Empire's own repository contains no validation library - not even as a dev dependency - so
add Zod to *your* project first:

```bash
npm install zod
```

Then import it and pass a schema to `validate()`:

```ts
import { z } from "zod";
import { Empire, validate } from "empire-ts";

const app = new Empire({ host: "localhost", port: 3000 });

const createUserSchema = z.object({
    name: z.string().min(1, "name is required"),
    email: z.string().email("email must be a valid address"),
});

app.post("/users", validate({ body: createUserSchema })(async (ctx, { body }) => {
    // body.name and body.email are validated and typed - no casts, no manual checks
    ctx.status(201).json(body);
}));

await app.start();
```

A request that fails answers `400` with `{ "error": "...", "details": [{ "field": "body.name", "message": "name is required" }] }`,
listing the problems from the body, the query and the params together.
Remember that query strings and route params always arrive as text, so a number needs
`z.coerce.number()` rather than `z.number()`:

```ts
validate({ query: z.object({ page: z.coerce.number().int().min(1).default(1) }) })
```

Empire does not install, pin or test against Zod, Valibot or ArkType - they are named because they
implement the standard.

#### Bring your own validator

Anything with a `~standard` property works, so a validator can be a few
lines and no library at all:

```ts
import { validate, StandardSchemaV1 } from "empire-ts";

const pageQuery: StandardSchemaV1<unknown, { page: number }> = {
    "~standard": {
        version: 1,
        vendor: "my-app",
        validate(value) {
            const page = Number((value as Record<string, unknown>).page ?? 1);

            return Number.isInteger(page) && page >= 1
                ? { value: { page } }
                : { issues: [{ message: "must be a whole number of 1 or more", path: ["page"] }] };
        },
    },
};

app.get("/things", validate({ query: pageQuery })((ctx, { query }) => ctx.json({ page: query.page })));
```

`examples/10-validation` validates this way, which is how the repository stays free of any
validation library. A failure produces exactly the same `400` body as the Zod examples above,
with the issue's path turned into `field` (`query.page`); an issue with no path applies to the
whole value and reports just `body` (or `query`, `params`). A validator that *throws* instead of
returning issues is treated as a bug and answers `500`.

### CORS

`createCorsMiddleware()` wraps requests with cross-origin header logic,
registered via the same `app.use()` (see [`doc/features/04_CORS_Compliance.md`](https://github.com/rom399/Empire/blob/main/src/empire/doc/features/04_CORS_Compliance.md)
for the full design):

```ts
import { createCorsMiddleware } from "empire-ts";

app.use(createCorsMiddleware({
    origin: ["http://localhost:5173"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 600,
}));
```

A genuine preflight - an `OPTIONS` request carrying both `Origin` and
`Access-Control-Request-Method` - is answered directly by the middleware;
every other request falls through untouched. `allowedHeaders` and
`exposedHeaders` are strict by default, and `credentials: true` always
echoes the specific requesting `Origin` rather than `*`; combining
credentials with the literal `origin: "*"` is rejected, since browsers
reject that combination outright. A single call can also apply
different policies by path:

```ts
app.use(createCorsMiddleware({
    policies: [
        { match: (path) => path.startsWith("/admin"), options: { origin: ["https://admin.example.com"] } },
        { match: (path) => path.startsWith("/api"), options: { origin: "*" } },
    ],
}));
```

See `examples/11-cors` for an allowed and a disallowed origin, a
preflight with custom headers and credentials, and the multi-policy
form together.

### Authentication

Empire does not ship authentication middleware - it owns the mechanical
parts every application needs identically (parsing headers, producing a
correctly formed error response), but only the application knows what
counts as a valid credential. Writing this yourself is a small amount
of code:

```ts
const authMiddleware = (ctx, next) => {
    const user = lookUpUser(ctx.headers.authorization);

    if (!user) {
        throw new HttpError(401, "Invalid or missing credentials");
    }

    ctx.state.user = user; // hand the identity to downstream handlers
    return next();
};
```

See `examples/08-authentication` for a complete worked example,
including Bearer token parsing and `WWW-Authenticate` on rejection.

### Logging

```ts
app.logger.info("Server starting");
app.logger.error("Failed to start server", err);
```

Custom loggers implement `ILogger` and are passed via
`EmpireOptions.logger`; `ConsoleLogger` is the default.

### Request Body Size Limit

Empire caps request bodies at 1MB by default, rejecting anything larger
with a `413` as soon as the limit is crossed rather than buffering the
whole thing first. Pass `maxBodySize` (in bytes) to change it:

```ts
const app = new Empire({ host: "localhost", port: 9007, maxBodySize: 10 * 1024 * 1024 });
```

The limit applies to `ctx.body()`, and therefore `ctx.jsonBody()` and
`ctx.form()` too. See `examples/07-body-size-limit` for a deliberately
small limit that's easy to trigger.

## Load Balancer

`empire-ts` also exports a small layer-7 load balancer -
`createLoadBalancerMiddleware`, `BackendRegistry`,
`createBackendRegistrationEndpoint`, `LoadBalancerRegistration` and
`createLoadBalancerDashboard`, with the live three.js dashboard shown at
the top of this file. It is a **learning and local-development tool, not
a production edge**: no TLS, no HTTP/2, no WebSocket upgrades, no
retries.

### How it works

Backends register themselves and hold a *lease*; a backend that crashes
simply stops renewing and drops out of rotation when the lease expires.
Requests are streamed to backends by a pluggable strategy -
`RoundRobinStrategy` by default, or `LeastConnectionsStrategy`, which
sends each request to the backend with the fewest requests in flight.

### Rules to know before using it

- Register the dashboard and the registration endpoint *before* the load
  balancer middleware, which is terminal, and register the load balancer
  before any middleware that reads the request body - the body is streamed
  through, not buffered.
- A backend should serve first and *then* register; on shutdown it should
  deregister first and *then* stop serving, so requests already in flight
  on it finish.
- Registration is locked down by default: a bearer token is required, and
  only loopback clients are served. Whoever can register a backend can steer
  your traffic - do not combine `allowRemote` with `allowUnauthenticated`.
- The dashboard loads three.js from a CDN in the browser by default; pass a
  local `three` install via `threeLocalPath` to work offline.

The registration endpoint validates the id and the backend URL without
any external library. A request with several problems - a bad id *and*
a bad URL - gets one `400` whose `details` list all of them.

### Learn more

This is not mirrored in `package-example/` yet. The full walkthrough is in
[README_DEVELOPMENT.MD](https://github.com/rom399/Empire/blob/main/src/empire/README_DEVELOPMENT.MD)
and the design in
[`doc/features/05_Loadbalancer_Core_L7.md`](https://github.com/rom399/Empire/blob/main/src/empire/doc/features/05_Loadbalancer_Core_L7.md)
and
[`doc/features/06_Loadbalancer_Least_Conn.md`](https://github.com/rom399/Empire/blob/main/src/empire/doc/features/06_Loadbalancer_Least_Conn.md).
