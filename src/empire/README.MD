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

There is no standalone server file in this project; `npm start` runs
`examples/01-basic-server/server.ts`:

```bash
npm start
```

Any other example can be run directly with `tsx`. See the Examples section
below for what each one demonstrates.

```bash
npx tsx examples/02-routing/server.ts
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

Every HTTP method has a matching registration method - `app.get()`,
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

`HEAD` needs no registration of its own - it's automatically answered
wherever `GET` is registered, with the body discarded but the same
headers set.

`OPTIONS` also needs no registration by default: any path with at least
one other method registered automatically responds `204` with an `Allow`
header listing what's available there. `app.options()` is only needed if
you want custom behavior instead of that automatic response:

```ts
// No app.options("/users/:id", ...) needed - OPTIONS /users/:id already
// responds 204 with Allow: GET, HEAD, PUT, PATCH, DELETE, OPTIONS

app.options("/users", (ctx) => {
    // Custom behavior overrides the automatic response - e.g. for CORS
    // preflight - and takes priority whenever it's registered.
    ctx.header("Access-Control-Allow-Methods", "GET, POST").status(204).text("");
});
```

See `examples/02-routing` for a runnable version of all of this,
alongside query strings and a full REST-style user API.

**Routes are matched in registration order, and the first match wins -
this is the developer's responsibility to get right, not something Empire
resolves automatically.** If two registered routes could both match the
same request, whichever was registered first is used, even if the other
looks like the "more specific" match:

```ts
app.get("/users/:id", (ctx) => ctx.text("param"));
app.get("/users/new", (ctx) => ctx.text("literal"));

// GET /users/new -> "param" - :id already matched "new" first.
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
served automatically - `/about/` and `/about` (no trailing slash) both
serve `root/about/index.html`. A directory with no `index.html` inside it
falls through instead of erroring.

Pass `{ spaFallback: true }` to serve `root/index.html` for any unmatched
`GET` request instead of a `404` - useful for single-page apps using
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

A middleware must call `next()` to continue the chain - if it doesn't,
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
        return; // chain stops here - next() is never called
    }
    await next();
});
```

## Error Handling

`HttpError` is the base class for an error that should become a specific
HTTP response. Throw one from a route handler or a middleware with a status
code and a message:

```ts
import { HttpError } from "./src/errors/HttpError";

app.get("/products/:id", (ctx) => {
    if (!isValidId(ctx.params.id)) {
        throw new HttpError(404, `Product with id ${ctx.params.id} was not found`);
    }
    ctx.json({ id: ctx.params.id });
});
```

`BadRequestError(message)` is a shorthand for `new HttpError(400, message)`.
It is already used internally: `ctx.jsonBody()` throws it on invalid JSON,
and `ctx.form()` throws it when the Content-Type does not match.

An error thrown inside a route handler (or the SPA fallback handler) is
caught by `Router`. An error thrown inside a middleware, or by the routing
step itself before a handler runs, is caught separately by `Empire`'s own
request handler. Both use the same mapping, so from the client's side the
response looks identical either way: an `HttpError` becomes its own status
code with a JSON body, `{ "error": "<message>" }`. Anything else, a plain
`Error` or any other thrown value, always becomes a `500` with a generic
body, `{ "error": "Internal Server Error" }` - the real message is never
sent to the client, only logged server-side via `app.logger.error()`.

```ts
app.get("/crash", () => {
    throw new Error("boom"); // -> 500, { "error": "Internal Server Error" }
});
```

There is no configurable or replaceable error handler. The mapping described
above is fixed logic inside `Empire.ts` and `Router.ts` - there is currently
no hook to register a custom handler or change the response shape.

One sharp edge worth knowing: both catch sites check whether a response has
already been sent before writing anything. A handler that starts streaming a
response (for example `ctx.file()`) and then errors partway through will not
get a conflicting second response written on top of the first - but it also
will not get a clean error response. The client is left with a truncated
response and no error body.

See `examples/05-error-handling` for a runnable version of all of the above,
including the always-500 `/crash` route.

## Authentication

Empire does not ship authentication middleware. The framework owns the
mechanical parts every application needs identically - parsing headers,
rejecting malformed input, producing a correctly formed error response -
but it cannot own the decision about what counts as a valid credential,
since only the application knows about its own users, token format and
storage. Writing this yourself is a small amount of code: middleware that
throws `HttpError(401)` already produces a correct JSON response through
the pipeline described above.

```ts
const authMiddleware: Middleware = (ctx, next) => {
    const user = lookUpUser(ctx.headers.authorization);

    if (!user) {
        throw new HttpError(401, "Invalid or missing credentials");
    }

    ctx.state.user = user; // hand the identity to downstream handlers
    return next();
};
```

`ctx.state` is a `Record<string, unknown>` bag for exactly this: attaching
data in a middleware for a route handler to read later. Reading it back
requires narrowing the value yourself, since `state` has no way to know
what any given application stores there.

Two sharp edges worth knowing. First, Empire does not yet support
per-route middleware, so an `app.use()`-registered auth middleware runs
for every request; excluding a path (e.g. a health check) means having
the middleware itself check `ctx.path` and skip a list of public paths.
Second, a real implementation needs more than this shape covers -
credentials stored hashed rather than in plain text, token expiry, and
constant-time comparison to avoid timing attacks, none of which the
framework can provide for you.

See `examples/08-authentication` for a complete worked example, including
the header parsing details (case-insensitive Bearer scheme matching,
`WWW-Authenticate` on the 401) that are easy to get wrong.

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
    // Throws HttpError(413) automatically if the body is too large -
    // no need to check the size yourself.
    const data = await ctx.jsonBody();

    ctx.json({ received: data });
});
```

See `examples/07-body-size-limit` for a runnable version with a
deliberately small limit so the 413 response is easy to trigger.

## Examples

Each example is a single, runnable `server.ts`. Run one with `npx tsx`,
for example:

```bash
npx tsx examples/02-routing/server.ts
```

| Example | Port | Shows |
|---|---|---|
| `01-basic-server` | 8001 | A minimal server: an HTML route, a JSON health check, and a POST route that echoes its JSON body back |
| `02-routing` | 8002 | A full REST-style user API: route params, query strings, a multi-param nested route, and a literal route registered ahead of an overlapping param route |
| `03-middleware` | 8003 | The built-in `createLoggerMiddleware(logger)`, a short-circuiting auth-header check, and a custom timing middleware, showing pipeline ordering |
| `04-static-files` | 8004 | An unprefixed static folder and a second one mounted under a URL prefix, served side by side |
| `05-error-handling` | 8005 | `HttpError` and `BadRequestError` thrown from route handlers, and an uncaught error on `/crash` becoming a `500` |
| `06-react-app` | 8006 | A real React + React Router app served with `spaFallback: true`, alongside a real API route that takes priority over the fallback |
| `07-body-size-limit` | 8007 | A deliberately small `maxBodySize`, so the automatic `413` response is easy to trigger |
| `08-authentication` | 8008 | A worked example of writing your own auth middleware: Bearer token parsing, `WWW-Authenticate` on rejection, and handing an identity to route handlers via `ctx.state` |

## Testing

Empire is tested with [Vitest](https://vitest.dev). Run the full suite
from `src/empire`:

```bash
npm test
```

Tests are split into two kinds. `tests/unit/` has one file per class,
exercising it directly and in isolation, often against the request and
response stand-ins in `tests/fixtures/http/MockHttp.ts` rather than a
real socket. `tests/integration/` starts a real `Empire` server on an
ephemeral port and exercises it with real HTTP requests, since header
and connection behavior - `WWW-Authenticate`, keep-alive sockets, an
aborted download - is exactly what a mock gets wrong.

### Unit tests, by class

| Class | Test file |
|---|---|
| `Context` | `tests/unit/http/Context.test.ts`, `tests/unit/http/ContextBody.test.ts` |
| `Empire` | `tests/unit/Empire.test.ts` |
| `Router` | `tests/unit/routing/Router.test.ts`, `tests/unit/routing/RouterEdgeCases.test.ts` |
| `RouteMatcher` | `tests/unit/routing/RouteMatcher.test.ts` |
| `StaticFileHandler` | `tests/unit/static/StaticFileHandler.test.ts` |
| `MimeTypes` | `tests/unit/static/MimeTypes.test.ts` |
| `HttpError`, `BadRequestError` | `tests/unit/errors/HttpError.test.ts`, `tests/unit/errors/BadRequestError.test.ts` |
| `ConsoleLogger` | `tests/unit/logging/ConsoleLogger.test.ts` |
| `LoggerMiddleware` | `tests/unit/middleware/BuiltInMiddleware.test.ts` |

### Integration tests

Real servers, real sockets, covering behavior that only shows up across
the full request pipeline rather than inside a single class:

* `ContextSharing.test.ts` - the same `Context` instance is shared
  between middleware and the matched route handler, so state attached in
  one is visible in the other
* `MiddlewarePipeline.test.ts` - registration order, a middleware that
  throws, the double-`next()` guard
* `HttpVerbs.test.ts` - PUT, PATCH, DELETE and OPTIONS over a real socket
* `RoutingPatterns.test.ts` - multi-param routes and literal-vs-param
  overlap, end to end
* `RequestBody.test.ts` - the request body size limit over a real socket
* `FileStreaming.test.ts` - an aborted download settles the handler's
  promise instead of hanging it
* `MalformedRequestPath.test.ts` - a malformed percent-encoded path
  returns `400` consistently, regardless of how many routes are
  registered
* `ExampleAuth.test.ts` - the `examples/08-authentication` middleware's
  actual HTTP-facing behavior: status codes, `WWW-Authenticate`, and the
  identical rejection body for an unknown token versus a disabled account

`StaticFileStreamingAbort.test.ts` is a manual-only exception: it is
gated behind an environment variable and excluded from `npm test`,
because it is flaky under full-suite parallelism for reasons not fully
isolated. Run it on its own with:

```bash
RUN_FLAKY_TESTS=true npx vitest run tests/integration/StaticFileStreamingAbort.test.ts
```

Shared fixtures live in `tests/fixtures/`: `MockHttp.ts` (minimal
`IncomingMessage`/`ServerResponse` stand-ins for unit tests) and
`TestLogger.ts` (an in-memory `ILogger` for asserting on what was
logged, without polluting test output).

## Project Structure

```text
empire/
├── src/
│   ├── Empire.ts
│   ├── types.ts
│   ├── http/          Context, CookieOptions
│   ├── routing/        Route, RouteMatch, RouteMatcher, Router
│   ├── middleware/      LoggerMiddleware
│   ├── static/          MimeTypes, StaticFileHandler and its option types
│   ├── errors/          HttpError, BadRequestError, HttpErrorOptions
│   ├── logging/         ILogger, ConsoleLogger
│   └── di/              empty, Phase 10 placeholder
├── examples/
│   ├── 01-basic-server/
│   ├── 02-routing/
│   ├── 03-middleware/
│   ├── 04-static-files/
│   ├── 05-error-handling/
│   ├── 06-react-app/
│   ├── 07-body-size-limit/
│   └── 08-authentication/
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── http/
│   └── fixtures/
├── doc/
│   ├── ARCHITECTURE.md
│   ├── PROJECT_STATE.md
│   └── features/
├── README.MD
├── PLAN.md
├── CONTRIBUTING.md
├── package.json
└── tsconfig.json
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

MIT. See [LICENSE](../../LICENSE).
