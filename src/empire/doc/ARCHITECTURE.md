# Empire Framework — Architecture

## Overview

Empire is a lightweight TypeScript HTTP web framework built from scratch on Node's
built-in `http` module. It has no runtime dependencies. The design is inspired by
ASP.NET Core — middleware pipelines, dependency injection, strongly-typed context,
and a clean separation of concerns.

Current version: **0.14.0 — Missing HTTP Verbs Complete**. See
`doc/PROJECT_STATE.md` for the up-to-date status and `PLAN.md` for the full
phase-by-phase roadmap. No v1.0.0 blockers remain.

---

## Coding Standards

These conventions are non-negotiable and apply to every file in the project.

| Rule | Detail |
|------|--------|
| One type per file | One class, interface, or enum per file. Filename matches the type name exactly. |
| Naming | PascalCase for classes, interfaces, enums, and methods. `I` prefix on all interfaces. |
| Enum values | PascalCase — `Singleton`, `Transient`, `Scoped` |
| Readability | Readable over clever. No one-liners that sacrifice clarity. No deeply nested callbacks. |
| Comments | JSDoc on all public members. No inline comments unless the WHY is non-obvious. |
| Imports | Always import from `../../src/` — never cross-import between examples. |
| Async | Always async/await — never raw callbacks or `.then()` chains. |
| Constructor injection | Dependencies (e.g. `ILogger`) are passed into constructors, never reached for via a service locator. |

---

## Directory Structure

```
empire/
├── src/
│   ├── http/
│   │   ├── Context.ts              # Per-request context object — API frozen for v1
│   │   └── CookieOptions.ts        # Options for ctx.cookie()
│   ├── logging/
│   │   ├── ILogger.ts              # Logger interface
│   │   └── ConsoleLogger.ts        # Default console implementation
│   ├── middleware/
│   │   └── LoggerMiddleware.ts     # createLoggerMiddleware(logger) factory
│   ├── errors/
│   │   ├── HttpError.ts            # Base HTTP error class
│   │   └── BadRequestError.ts      # 400 error shorthand
│   ├── static/
│   │   ├── MimeTypes.ts            # Extension → MIME type lookup, 17 extensions
│   │   ├── StaticFileOptions.ts    # Static file config interface (root, prefix?)
│   │   ├── UseStaticFilesOptions.ts # { prefix?, spaFallback? } accepted by Empire.useStaticFiles()
│   │   └── StaticFileHandler.ts    # File resolution, prefix matching, streaming, index.html fallback
│   ├── routing/
│   │   ├── Route.ts                # A single registered route (method, path, handler)
│   │   ├── RouteMatch.ts           # Result of matching a route against a request path
│   │   ├── RouteMatcher.ts         # Segment-based path matching, extracts :params
│   │   └── Router.ts               # Route registration and request dispatch
│   ├── di/                         # Empty — Phase 10 placeholder
│   ├── types.ts                    # Middleware, RouteHandler types
│   └── Empire.ts                   # Main framework class — server lifecycle, middleware, delegates routing to Router
│
├── tests/
│   ├── unit/                       # Vitest unit tests — run via `npm test`
│   │   ├── routing/                # Router, RouteMatcher, RouterEdgeCases (FINDING 10-12)
│   │   ├── http/                   # Context, ContextBody (FINDING 6-7)
│   │   ├── errors/                 # HttpError (FINDING 13)
│   │   ├── static/                 # StaticFileHandler (FINDING 2, 9)
│   │   ├── logging/
│   │   ├── middleware/             # BuiltInMiddleware (FINDING 5)
│   │   └── di/                     # placeholder, Phase 10
│   ├── integration/                # Real-server tests: ContextSharing, MiddlewarePipeline,
│   │                                # RequestBody, FileStreaming (FINDING 1, 3, 4, 6-8) — see
│   │                                # PLAN.md Phase 9.3
│   ├── http/
│   │   ├── empire.http             # REST client tests
│   │   └── invalid-json.http
│   └── fixtures/
│       ├── static/                 # Static file test assets
│       ├── services/                # TestLogger.ts — in-memory ILogger for tests
│       └── http/                    # MockHttp.ts — IncomingMessage/ServerResponse stand-ins
│
├── examples/
│   ├── 01-basic-server/            # Hello world
│   ├── 02-routing/                 # Route params (single and multi-segment), query
│   │                                # strings, overlapping literal/param routes
│   ├── 03-middleware/              # Middleware pipeline
│   ├── 04-static-files/            # Static file serving — unprefixed wwwroot/ and prefixed uploads/
│   ├── 05-error-handling/          # HttpError and BadRequestError
│   ├── 06-react-app/               # SPA support — spaFallback, streaming, index.html fallback, API routes
│   └── 07-body-size-limit/         # Configurable request body size limit, 413 on oversized bodies
│
├── doc/
│   ├── ARCHITECTURE.md             # This file
│   └── PROJECT_STATE.md            # Current status and next steps
│
├── PLAN.md                         # Full phase-by-phase roadmap
├── CONTRIBUTING.md                 # Contribution conventions
├── package.json
└── tsconfig.json
```

CI (`.github/workflows/ci.yml`) and Dependabot (`.github/dependabot.yml`)
config live at the git repo root (`D:/dev/ROM/.github/`), one level above
`empire/` — not shown in the tree above since it sits outside the project
root this document describes. CI runs `npm ci`, `tsc --noEmit`, and
`vitest run` (scoped to `src/empire`) on every push to `main` and every
pull request; Dependabot opens weekly update PRs for npm dependencies and
for the Actions versions the workflow pins.

Note: the routing example additions and their `.http` requests from PLAN.md
Phase 9.1 (multi-param route, overlapping routes) are still open — only the
unit test coverage in that phase is done.

---

## Request Lifecycle

Every HTTP request passes through the following pipeline in order:

```
HTTP Request
    │
    ▼
Empire.handleRequest()
    │
    ▼
Middleware Pipeline (app.use() — runs in registration order)
    │   Each middleware gets its own one-shot next() to continue the
    │   chain — calling it twice throws "next() called multiple times"
    │   rather than silently re-dispatching. If a middleware does not
    │   call next(), the pipeline stops. A throwing middleware is caught
    │   by the same try/catch Router uses for route handlers, mapping
    │   HttpError to its status and anything else to 500, instead of
    │   leaving the connection hanging.
    │   useStaticFiles() registers itself here too — each mounted
    │   folder is its own middleware, falling through when its
    │   prefix (if any) doesn't match or the file isn't found.
    │
    ▼
Router.handle()
    │
    ├─ Matches method and path segments against registered routes (via RouteMatcher)
    ├─ Extracts :param values into ctx.params
    ├─ Reuses the Context Empire built for the middleware chain — the same
    │  instance middleware saw, so anything attached to it survives
    ├─ Calls route.handler(ctx)
    │
    ├─ If handler throws HttpError → returns statusCode + message as JSON
    ├─ If handler throws anything else → returns 500 Internal Server Error
    ├─ If no route matches, and a GET fallback is registered → calls it
    │  (SPA support — see "SPA / React Router Fallback" below)
    └─ If no route matches, and no fallback applies → returns 404 Route not found
```

`Empire.ts` no longer performs route matching or dispatch itself — that was
extracted into `Router` (see below). `Empire.ts`'s only responsibilities are
server lifecycle (`start()`/`stop()`), the middleware pipeline, and delegating
requests to `Router`.

---

## Key Classes

### `Empire` — `src/Empire.ts`

The main entry point. Owns the Node HTTP server, the middleware list, and a
`Router` instance.

```ts
new Empire(options: EmpireOptions)
```

| Member | Description |
|--------|-------------|
| `use(middleware)` | Registers a middleware function |
| `useStaticFiles(root, options?)` | Registers static file middleware for a directory. Optional `{ prefix }` mounts it under a URL prefix — see "Static Files API" below. Optional `{ spaFallback: true }` registers `root/index.html` as the router's fallback — see "SPA / React Router Fallback" below |
| `get(path, handler)` | Registers a GET route — delegates to `router.get()` |
| `post(path, handler)` | Registers a POST route — delegates to `router.post()` |
| `put(path, handler)` | Registers a PUT route — delegates to `router.put()` |
| `patch(path, handler)` | Registers a PATCH route — delegates to `router.patch()` |
| `delete(path, handler)` | Registers a DELETE route — delegates to `router.delete()` |
| `options(path, handler)` | Registers an explicit OPTIONS route — delegates to `router.options()`. Optional; see `Router.handle()` below for the automatic OPTIONS response when no explicit handler is registered |
| `start()` | Starts the HTTP server — returns Promise |
| `stop()` | Stops the HTTP server — returns Promise |
| `logger` | Returns the ILogger instance |

`Router` is constructed in `Empire`'s constructor and injected with the
resolved `ILogger`, per the constructor-injection convention.

---

### `Router` — `src/routing/Router.ts`

Owns route registration and request dispatch. Extracted out of `Empire.ts`
so that server lifecycle, middleware, and routing are separate concerns.
Constructor-injected with `ILogger` — never reaches back into `Empire`.

```ts
new Router(logger: ILogger)
```

| Member | Description |
|--------|-------------|
| `get(path, handler)` | Registers a handler for GET requests |
| `post(path, handler)` | Registers a handler for POST requests |
| `put(path, handler)` | Registers a handler for PUT requests |
| `patch(path, handler)` | Registers a handler for PATCH requests |
| `delete(path, handler)` | Registers a handler for DELETE requests |
| `options(path, handler)` | Registers a handler for OPTIONS requests. Optional — any path with at least one other method registered already answers OPTIONS automatically (204 + `Allow` header, RFC 9110 §9.3.7) without one; register a handler here only for custom behaviour (e.g. CORS preflight), which always takes priority over the automatic response |
| `setFallback(handler)` | Registers a handler invoked instead of the plain-text 404 when no route matches a **GET** request — see "SPA / React Router Fallback" below. Only one fallback can be registered; a later call replaces the previous one |
| `handle(req, res, ctx?)` | Matches the request against registered routes (first match wins) and invokes the handler, converting thrown errors into the correct response. HEAD dispatches to the matching GET handler; OPTIONS with no explicit handler gets the automatic 204 response described above. Falls back to the registered fallback (GET only), a 405 + `Allow` when the path matches under a different method, or 404, when nothing matches. `ctx` is optional — when `Empire` supplies the `Context` it already built for the middleware chain, `handle()` reuses that exact instance (attaching matched params to it) instead of constructing a new one, so state middleware attached to `ctx` survives into the route handler. Omitting it (as every direct test call does) preserves the old behaviour of building a fresh `Context` internally |

Uses a `RouteMatcher` internally for path/segment comparison. Route and
fallback dispatch share error handling via a private `invokeHandler()`, so
an `HttpError` (or any thrown error) thrown from the SPA fallback handler is
converted to a response the same way a thrown route handler error would be.

### `RouteMatcher` — `src/routing/RouteMatcher.ts`

Pure path-matching logic, no I/O. Compares a route's path pattern to a
request path segment by segment; segments starting with `:` bind the value
at that position into `params`.

```ts
match(routePath: string, requestPath: string): RouteMatch
```

### `Route` / `RouteMatch` — `src/routing/Route.ts`, `src/routing/RouteMatch.ts`

Plain interfaces, no behaviour.

```ts
interface Route {
    method: string;
    path: string;
    handler: RouteHandler;
}

interface RouteMatch {
    matched: boolean;
    params: Record<string, string>;
}
```

---

### `Context` — `src/http/Context.ts`

Created per request. Wraps `IncomingMessage` and `ServerResponse` with a
clean, typed API. Passed to every route handler and every middleware.

**The Context API is frozen for v1** — every member below is implemented.
Any method added after v1 must be additive only (no signature changes, no
removals), except `ctx.services`, which is deliberately deferred until
Phase 10 (Dependency Injection) is complete.

**Request properties:**

| Member | Type | Description |
|--------|------|-------------|
| `req` | `IncomingMessage` | Raw Node request |
| `res` | `ServerResponse` | Raw Node response |
| `method` | `string` | HTTP method |
| `path` | `string` | URL pathname without query string |
| `query` | `URLSearchParams` | Parsed query parameters |
| `headers` | `IncomingHttpHeaders` | Incoming request headers |
| `params` | `Record<string, string>` | Route parameters from `:id` segments |
| `state` | `Record<string, unknown>` | Post-v1 addition. Per-request bag for middleware to attach data (e.g. an authenticated user) for downstream middleware and route handlers to read. Untyped by design - reading a value back requires narrowing, not casting with `as` |
| `ipAddress` | `string` | Client IP — handles `x-forwarded-for` and IPv6 |
| `userAgent` | `string` | User-Agent header shorthand, empty string when absent |
| `contentType` | `string` | Content-Type without parameters (strips `; charset=...`) |

**Request methods:**

| Member | Description |
|--------|-------------|
| `accepts(type)` | Checks whether the client accepts the given response type, honouring `*/*` and `text/*`-style wildcards |
| `body()` | Reads full request body as string. Memoizes the read the first time it's called — a real `IncomingMessage` stream can only be consumed once, so repeat calls (including from `jsonBody()`/`form()`) return the same cached result instead of re-reading and getting `""` |
| `jsonBody()` | Parses JSON body — throws `BadRequestError` on invalid JSON |
| `form()` | Parses `application/x-www-form-urlencoded` body into `URLSearchParams` — throws `BadRequestError` on Content-Type mismatch |

**Response methods:**

| Member | Description |
|--------|-------------|
| `status(code)` | Sets status code — chainable, returns `this` |
| `header(name, value)` | Sets a single response header — chainable |
| `addHeaders(headers)` | Sets multiple response headers — chainable |
| `text(value)` | Sends plain text response |
| `html(value)` | Sends HTML response |
| `json(value)` | Sends JSON response |
| `redirect(url, status?)` | Redirect response, defaults to 302 Found |
| `file(path)` | Serves a file from a route handler, streamed via `fs.createReadStream()`. Throws `HttpError` 404 if missing |
| `download(path, filename?)` | Like `file()` but forces download via `Content-Disposition` |
| `cookie(name, value, options?)` | Sets a response cookie — chainable. Appends to existing `Set-Cookie` headers rather than overwriting. Options via `CookieOptions` (`maxAge`, `expires`, `path`, `domain`, `secure`, `httpOnly`, `sameSite`) |
| `clearCookie(name)` | Clears a cookie by name — chainable |

**Deferred:**

| Member | Description |
|--------|-------------|
| `services` | `ServiceProvider` per request — added once Phase 10 (DI) is complete |

---

### `ILogger` — `src/logging/ILogger.ts`

Interface for logging. Injected via `EmpireOptions.logger`. Defaults to
`ConsoleLogger` if not provided.

```ts
interface ILogger {
    info(message: string): void;
    warn(message: string): void;
    error(message: string, error?: unknown): void;
    debug(message: string): void;
}
```

`ConsoleLogger` prefixes every line with an ISO timestamp and a level tag
(`[INFO]`, `[WARN]`, `[DEBUG]`, `[ERROR]`), and formats `Error` objects
passed to `error()` using their stack trace when available.

---

### `HttpError` — `src/errors/HttpError.ts`

Base class for HTTP errors thrown from route handlers. `Router` catches
these and returns the `statusCode` and `message` as a JSON error response
automatically.

```ts
throw new HttpError(404, "User not found");
// → { "error": "User not found" } with status 404
```

### `BadRequestError` — `src/errors/BadRequestError.ts`

Extends `HttpError` with a hardcoded status of 400.

```ts
throw new BadRequestError("productId is required");
// → { "error": "productId is required" } with status 400
```

---

### `StaticFileHandler` — `src/static/StaticFileHandler.ts`

Registered internally by `Empire.useStaticFiles()`. Handles each request
before routing runs.

| Behaviour | Detail |
|-----------|--------|
| Prefix matching | If `options.prefix` is set, requests outside the prefix return `false` immediately — see "Static Files API" below |
| Path traversal | Resolves absolute paths and checks `startsWith(root)` — returns 403 if unsafe (runs after prefix-stripping) |
| Directory index fallback | `resolveTargetPath()` — if the resolved path is a directory, serves an `index.html` inside it if one exists (e.g. `/about/` serves `/about/index.html`); returns `null` (falls through) if neither exists |
| Streaming | `sendFile()` — streams via `fs.createReadStream().pipe(res)` with `Content-Length` set from a single `stat()` call, rather than reading the whole file into memory |
| MIME detection | Delegates to `MimeTypes.getType(extension)` |
| File/directory-index not found | Returns `false` — middleware chain continues to routing |

`StaticFileHandler` does **not** implement SPA/React Router fallback itself
— that's a `Router` concern, see below.

---

## Static Files API

**Decision: `useStaticFiles(root, options?)`, ASP.NET Core style, not Express's `static(prefix, root)`.**

The original roadmap specified an Express-style URL prefix parameter
(`app.static("/public", "./wwwroot")`). Empire kept the ASP.NET Core pattern
instead (`app.useStaticFiles(root)`, mirroring `app.UseStaticFiles()`), per
the coding standard of mirroring ASP.NET Core conventions rather than
Express idioms. A separate `static(prefix, root)` method was considered and
rejected in favour of one method with an optional parameter — smaller API
surface, and consistent with ASP.NET Core's `UseStaticFiles(options)`
overload, which takes an options object rather than exposing a second public
method.

Prefix mounting was later added as an **additive optional second parameter**
rather than a breaking signature change, so single-argument calls made before
the feature existed keep working unchanged:

```ts
// No prefix — every request path is checked against root directly
app.useStaticFiles("./dist");

// Prefixed — only requests under the prefix are checked against this folder.
// Multiple prefixed folders can be mounted on the same server without colliding.
app.useStaticFiles("./public/assets", { prefix: "/assets" });
app.useStaticFiles("./storage/uploads", { prefix: "/uploads" });
```

`StaticFileHandler` normalises the prefix (strips trailing slashes, treats a
bare `"/"` as no prefix) and matches on prefix boundary — `"/assets"` matches
`/assets` and `/assets/logo.png`, but not `/assets-other`, so two prefixes
that share a leading substring never collide. See `examples/04-static-files`
for both patterns side by side.

Types: `StaticFileOptions` (`src/static/StaticFileOptions.ts`) carries
`root` and the internal `prefix?`; `UseStaticFilesOptions`
(`src/static/UseStaticFilesOptions.ts`) is the public `{ prefix?, spaFallback? }`
shape accepted by `Empire.useStaticFiles()`.

---

## SPA / React Router Fallback

**Why this lives in `Router`, not `StaticFileHandler`.**

The goal: `/about` (no matching static file, no matching route) should serve
`dist/index.html` so a client-side router like React Router can render it,
while `/api/users` (also no matching static file, but a *real registered
route*) must still resolve to its own handler — never the HTML shell.

This can't be solved inside static middleware alone. Empire's pipeline runs
the middleware chain first; the chain's final `next()` call is what invokes
`Router.handle()` (see the Request Lifecycle diagram above). By the time a
static middleware has decided "no file matches this path," it has no way of
knowing whether a route registered via `app.get()` will match the same path
later in the pipeline — that check hasn't happened yet. Guessing wrong in
either direction breaks something: unconditionally serving the SPA shell
from static middleware would swallow every API route before `Router` ever
saw the request; unconditionally falling through would leave `/about`
404ing forever.

**The fix:** give `Router` itself an optional fallback handler,
`Router.setFallback(handler)`, invoked only after every registered route has
had a chance to match and none did. `Empire.useStaticFiles(root, { spaFallback: true })`
registers this fallback to serve `root/index.html` via `ctx.file()`. This
keeps routing authoritative — API routes are always checked first, because
the fallback only runs once the route loop in `Router.handle()` has
exhausted every candidate — and is purely additive to `Router`'s existing
contract (a router with no fallback registered behaves exactly as before).

**Deliberately GET-only.** A `POST`/`PUT`/`DELETE` to an unmatched path is
almost always a genuine client error — a typo'd endpoint, a wrong HTTP
method — and should 404 loudly. Falling back to the HTML shell for
non-GET requests would silently return `200` for a broken request, masking
the mistake during development. This was caught during testing: an early
version of the fallback fired for any method, and `POST /api/users` (with
no POST handler registered) incorrectly returned the SPA shell with a `200`
instead of a `404`.

```ts
app.useStaticFiles("./dist", { spaFallback: true });

app.get("/api/users", (ctx) => {
    ctx.json({ users: [] });
});
```

| Request | Result |
|---------|--------|
| `GET /` | Real file — `dist/index.html`, served directly |
| `GET /about` | No file, no route → fallback → `dist/index.html` |
| `GET /api/users` | Matched route → JSON, not the fallback |
| `GET /assets/main.jsx` | Real file, not the fallback |
| `POST /api/users` (no POST handler registered) | Real 404 — fallback does not apply to non-GET |
| `POST /about` (unmatched, non-GET) | Real 404 — fallback does not apply to non-GET |

`examples/06-react-app` is a runnable version of all six cases, and a real
React + React Router app (`BrowserRouter`, not hash-based routing) rather
than a plain-HTML stand-in — React, ReactDOM, and React Router load from a
CDN, with Babel Standalone transpiling the JSX in the browser, so it needs
no npm install or build step. `BrowserRouter` is deliberate: it's the router
mode that actually depends on server-side SPA fallback, since navigating
directly to `/about` (or refreshing on it) sends a real `GET /about` to
Empire.

---

### `MimeTypes` — `src/static/MimeTypes.ts`

Static utility class. Maps file extensions to MIME type strings.

```ts
MimeTypes.getType(".html")  // "text/html"
MimeTypes.getType(".xyz")   // "application/octet-stream"
```

Supported extensions: `.html`, `.css`, `.js`, `.json`, `.png`, `.jpg`, `.jpeg`,
`.gif`, `.svg`, `.ico`, `.txt`, `.pdf`, `.woff`, `.woff2`, `.ttf`, `.eot`, `.map`
— full coverage for a typical React/Vite build output.

---

## Middleware

### Signature (frozen)

```ts
type Middleware = (
    ctx: Context,
    next: () => Promise<void>
) => void | Promise<void>;
```

The middleware migration from `(req, res, next)` to `(ctx, next)` is
complete — every built-in middleware, example, and the `Empire.ts` pipeline
itself use this signature.

### Built-in Middleware

| File | Export | Behaviour |
|------|--------|-----------|
| `src/middleware/LoggerMiddleware.ts` | `createLoggerMiddleware(logger)` | Returns a middleware that logs `METHOD /path` through the given `ILogger` |

---

## Types — `src/types.ts`

```ts
type Middleware = (ctx: Context, next: () => Promise<void>) => void | Promise<void>
type RouteHandler = (ctx: Context) => void | Promise<void>
```

`Route` used to live here but was moved to `src/routing/Route.ts` as part of
the router refactor, since it's a routing-specific concept.

---

## Route Matching

Routes are matched in registration order by `RouteMatcher`. The first match
wins.

- Path segments are split on `/` and compared one by one
- Segments starting with `:` are treated as parameters — the value is captured
  into `ctx.params`
- Query strings are stripped before matching (`/users?page=1` matches `/users`)
- Method must match exactly — GET, POST, PUT, PATCH, DELETE, and OPTIONS
  are all implemented; HEAD dispatches to a matching GET route instead of
  needing its own registration

Example:

```
Route:   /users/:id/posts
Request: /users/42/posts
Result:  ctx.params.id === "42"
```

---

## Configuration

`EmpireOptions`:

```ts
interface EmpireOptions {
    host: string;        // e.g. "localhost"
    port: number;        // e.g. 8001
    logger?: ILogger;    // defaults to ConsoleLogger
}
```

---

## Known Architectural Issues

| Issue | Impact | Plan |
|-------|--------|------|
| Only `GET` and `POST` (and `HEAD`, auto-dispatched) implemented | Can't build a full REST API yet | `PUT`/`PATCH`/`DELETE`/`OPTIONS` — PLAN.md Phase 3 Remaining |
| Only one SPA fallback per server | Can't serve two different single-page apps from one `Empire` instance | Not currently needed; `Router.setFallback()` would need to become a list with its own matching logic if this comes up |
| `ctx.body()` has no size cap (FINDING 7) | A large request body is buffered fully into memory instead of being rejected with 413 | PLAN.md Phase 9.3 |
| `sendFile()` only resolves on the response's `"finish"` event (FINDING 8) | A client aborting mid-download leaves the promise unsettled and leaks the read stream/file descriptor | PLAN.md Phase 9.3 |
| Static files never check `req.method` (FINDING 9) | A HEAD request to a static file gets a full body — `Router.discardBody()` only covers routed requests | PLAN.md Phase 9.3 |
| Route params are never URL-decoded (FINDING 10) | `RouteMatcher` (raw `req.url`) and `Context.path` (decoded `URL.pathname`) disagree on the request path | PLAN.md Phase 9.3 |
| No literal-over-parameter route precedence (FINDING 11) | First-registered-wins is undocumented and easy to get wrong, e.g. `/users/:id` registered before `/users/new` swallows it | PLAN.md Phase 9.3 |
| `RouteMatcher` filters empty path segments (FINDING 12) | `//users//1` matches `/users/:id` — no canonical URL form | PLAN.md Phase 9.3 |
| `HttpError` has no `code`/`retryable`, and `.name` isn't set (FINDING 13) | Serialises as generic `"Error"`; no machine-readable error code to key off of | PLAN.md Phase 9.3 |
| Static file path-traversal guard is a bare `startsWith(root)` (FINDING 2) | Admits a sibling directory whose name shares the root's prefix. Not currently exploitable — `URL.pathname` normalises `..` first — but it's the only remaining defence if that changes | PLAN.md Phase 9.3 |

**Resolved** (kept here for history — see `doc/PROJECT_STATE.md` for current status):
- ~~Routing lived in `Empire.ts`~~ — extracted to `src/routing/Router.ts`
- ~~Middleware took `(req, res, next)` not `(ctx, next)`~~ — migrated
- ~~Static files API undecided~~ — kept `useStaticFiles(root, options?)`, added prefix mounting
- ~~Static files read fully into memory~~ — `StaticFileHandler.sendFile()` streams via `fs.createReadStream()`
- ~~No index.html or React Router fallback~~ — directory index fallback in `StaticFileHandler`, SPA fallback via `Router.setFallback()`, see "SPA / React Router Fallback" above
- ~~`MimeTypes` missing `.map`, `.ttf`, `.eot`~~ — added, full React/Vite build output coverage
- ~~No automated tests for `src/routing/` or the static file features~~ — `tests/unit/routing/`, `tests/unit/static/`, and `tests/integration/` all exist and run via `npm test`
- ~~Context identity split between middleware and route handlers (FINDING 1)~~ — `Router.handle()` now reuses the shared `Context`, see PLAN.md Phase 9.3
- ~~No error handling around the middleware pipeline (FINDING 3)~~ — `Empire.handleRequest()` now catches and maps errors, see PLAN.md Phase 9.3
- ~~`next()` not guarded against double invocation (FINDING 4)~~ — recursive `dispatch()` with a one-shot `next()`, see PLAN.md Phase 9.3
- ~~`ctx.body()` not cached (FINDING 6)~~ — memoized as a promise, see PLAN.md Phase 9.3
