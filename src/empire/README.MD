# Empire

Empire is a lightweight TypeScript web framework built from scratch using Node.js.

The goal of the project is to understand how modern web frameworks such as Express, Koa, Fastify, and ASP.NET Core work internally by implementing the core features ourselves.

## Current Features

* HTTP server built on Node.js
* Configurable host and port
* Promise-based startup lifecycle
* Promise-based shutdown lifecycle
* Graceful shutdown using SIGINT
* Middleware registration (`app.use()`)
* Pluggable logging abstraction (`ILogger`)
* Built-in console logger with timestamps
* TypeScript support

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

See `examples/02-routing` for a runnable version of both, alongside query
strings and a realistic REST-style user API.

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
