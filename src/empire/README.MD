# Empire

[![CI](https://github.com/rom399/Empire/actions/workflows/ci.yml/badge.svg)](https://github.com/rom399/Empire/actions/workflows/ci.yml)

Empire is a lightweight TypeScript web framework built from scratch using Node.js.

The goal of the project is to understand how modern web frameworks such as Express, Koa, Fastify, and ASP.NET Core work internally by implementing the core features ourselves.

## Current Features

* HTTP server built on Node's `http` module, with configurable host and port
* Promise-based `start()` and `stop()` lifecycle, `stop()` closing the server gracefully
* Routing across all six HTTP methods, with `:param` capture and automatic HEAD and OPTIONS handling
* Middleware pipeline executing in registration order (`app.use()`)
* Static file serving, with optional URL prefixes and SPA fallback
* Centralized error handling built around `HttpError`
* Configurable request body size limit
* Pluggable logging abstraction (`ILogger`), with a built-in console logger
* Written in TypeScript throughout

## Installation

```bash
npm install
```

## Running

```bash
npx tsx server.ts
```

## Example

```ts
import { Empire } from "./src/Empire";

async function main() {

    const app = new Empire({
        host: "localhost",
        port: 8008
    });

    await app.start();
}

main();
```

## Routing

Routes are registered with `app.get()` and `app.post()`, with `:param`
segments captured into `ctx.params`:

```ts
app.get("/users/:id", (ctx) => {
    ctx.json({ id: ctx.params.id });
});
```

A route can have more than one `:param` segment:

```ts
app.get("/users/:userId/posts/:postId", (ctx) => {
    ctx.json({ userId: ctx.params.userId, postId: ctx.params.postId });
});
```

Every HTTP method has a matching registration method — `app.get()`,
`app.post()`, `app.put()`, `app.patch()`, `app.delete()`, and
`app.options()`:

```ts
app.put("/users/:id", async (ctx) => {
    const body = await ctx.jsonBody(); // full replacement
    ctx.json({ id: ctx.params.id, ...body });
});

app.patch("/users/:id", async (ctx) => {
    const body = await ctx.jsonBody(); // partial update
    ctx.json({ id: ctx.params.id, ...body });
});

app.delete("/users/:id", (ctx) => {
    ctx.status(204).text("");
});
```

`HEAD` needs no registration of its own — it's automatically answered
wherever `GET` is registered, with the body discarded but the same
headers set.

`OPTIONS` also needs no registration by default: any path with at least
one other method registered automatically responds `204` with an `Allow`
header listing what's available there. `app.options()` is only needed if
you want custom behavior instead of that automatic response:

```ts
// No app.options("/users/:id", ...) needed — OPTIONS /users/:id already
// responds 204 with Allow: GET, HEAD, PUT, PATCH, DELETE, OPTIONS

app.options("/users", (ctx) => {
    // Custom behavior overrides the automatic response — e.g. for CORS
    // preflight — and takes priority whenever it's registered.
    ctx.header("Access-Control-Allow-Methods", "GET, POST").status(204).text("");
});
```

See `examples/02-routing` for a runnable version of all of this,
alongside query strings and a full REST-style user API.

**Routes are matched in registration order, and the first match wins —
this is the developer's responsibility to get right, not something Empire
resolves automatically.** If two registered routes could both match the
same request, whichever was registered first is used, even if the other
looks like the "more specific" match:

```ts
app.get("/users/:id", (ctx) => ctx.text("param"));
app.get("/users/new", (ctx) => ctx.text("literal"));

// GET /users/new -> "param" — :id already matched "new" first.
// The /users/new route above is unreachable.
```

To get the literal route to win, register it first:

```ts
app.get("/users/new", (ctx) => ctx.text("literal"));
app.get("/users/:id", (ctx) => ctx.text("param"));

// GET /users/new -> "literal"
// GET /users/42  -> "param"
```

**Rule of thumb:** register more specific (literal) routes before more
general (parameterized) ones that could overlap them.

## Static Files

`app.useStaticFiles(root)` serves files from a directory, matched against
the request path before routing runs:

```ts
app.useStaticFiles("./wwwroot");

// GET /style.css -> serves ./wwwroot/style.css
```

Pass `{ prefix }` to mount a folder under a URL prefix instead of checking
every request path against it directly. Multiple prefixed folders can be
mounted on the same server without colliding:

```ts
app.useStaticFiles("./public/assets", { prefix: "/assets" });
app.useStaticFiles("./storage/uploads", { prefix: "/uploads" });

// GET /assets/logo.png  -> ./public/assets/logo.png
// GET /uploads/file.pdf -> ./storage/uploads/file.pdf
```

If a request path resolves to a directory, an `index.html` inside it is
served automatically — `/about/` and `/about` (no trailing slash) both
serve `root/about/index.html`. A directory with no `index.html` inside it
falls through instead of erroring.

Pass `{ spaFallback: true }` to serve `root/index.html` for any unmatched
`GET` request instead of a `404` — useful for single-page apps using
client-side routing. See `examples/06-react-app` for the full behavior
set alongside API routes.

See `examples/04-static-files` for a runnable version of unprefixed and
prefixed mounting side by side.

## Middleware

Middleware can be registered using:

```ts
app.use(logger);
app.use(auth);
```

Middleware executes in registration order.

```text
Request
    |
logger
    |
auth
    |
router
    |
Response
```

A middleware must call `next()` to continue the chain — if it doesn't,
the request is left unanswered (no timeout, no automatic error) rather
than falling through to the next middleware or the router:

```ts
app.use(async (ctx, next) => {
    console.log(ctx.method, ctx.path);
    await next(); // continues to the next middleware / router
});

app.use(async (ctx, next) => {
    if (!isAuthenticated(ctx)) {
        ctx.status(401).text("Unauthorized");
        return; // chain stops here — next() is never called
    }
    await next();
});
```

## Logging

Empire provides a logging abstraction.

```ts
app.logger.info("Server starting");

app.logger.error(
    "Failed to start server",
    err
);
```

Custom loggers can be supplied by implementing the `ILogger` interface.

```ts
const app = new Empire({
    host: "localhost",
    port: 8008,
    logger: new MyCustomLogger()
});
```

## Request Body Size Limit

Empire caps request bodies at 1MB by default. A request over the limit
gets a `413` response as soon as it crosses the limit, instead of being
buffered fully into memory first.

```ts
const app = new Empire({
    host: "localhost",
    port: 8008
});
```

Pass `maxBodySize` (in bytes) to raise or lower the default:

```ts
const app = new Empire({
    host: "localhost",
    port: 8008,
    maxBodySize: 10 * 1024 * 1024 // 10 MB
});
```

The limit applies to `ctx.body()`, and therefore to `ctx.jsonBody()` and
`ctx.form()` too, since both read the body through it:

```ts
app.post("/upload", async (ctx) => {
    // Throws HttpError(413) automatically if the body is too large —
    // no need to check the size yourself.
    const data = await ctx.jsonBody();

    ctx.json({ received: data });
});
```

See `examples/07-body-size-limit` for a runnable version with a
deliberately small limit so the 413 response is easy to trigger.

## Project Structure

```text
rom-server/
├── README.md
├── PLAN.md
├── package.json
├── tsconfig.json
├── server.ts
└── src/
    ├── Empire.ts
    ├── types.ts
    ├── middleware/
    └── logging/
```

## Motivation

This project is a learning exercise and a platform for experimenting with:

* Framework design
* Middleware pipelines
* Routing
* Request processing
* Logging abstractions
* Modern TypeScript development

## License

MIT
