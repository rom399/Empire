# Empire — Core Routing & Request Pipeline: Design & Build Doc

**Status:** Implemented
**Scope:** Native TypeScript architecture. Phases 1-9 in `PLAN.md` (foundation, middleware, routing, context, request bodies, error handling, static files, developer experience, project structure and hardening).
**Timeline:** Designed by Opus ➡️ Executed by Sonnet

---

## 1. Context & Architectural Goals

### 1.1 The Problem

Empire is a TypeScript HTTP framework built from scratch on Node's `http` module, modelled on ASP.NET
Core. Everything else in this folder (dependency injection, validation, CORS, the load balancer) is
built *on top of* one small core, and this document is that core: what happens between a socket
delivering a request and a response leaving.

That core has to answer several separate questions, and keep them separate:

* **How does a request travel?** Cross-cutting concerns (logging, CORS, authentication, static files)
  must compose in a defined order without every handler repeating them.
* **How is a request matched to a handler?** By method and path, with parameters, and with the
  HTTP-correct answers when nothing matches: `404`, `405` with `Allow`, an automatic `OPTIONS`, `HEAD`
  for free wherever `GET` exists (RFC 9110).
* **What does a handler get?** A typed, ergonomic wrapper over `IncomingMessage` and `ServerResponse`
  whose API can be frozen, so growth after v1 is additive only.
* **What happens when something throws?** One consistent JSON error response, produced in one place.
* **How are bodies and files handled safely?** Read once, with a size cap; streamed rather than
  buffered; never escaping the served directory.

The design constraint over all of it is the project's own: zero runtime dependencies, one class per
file, constructor injection, and no reaching back into a framework object from the layer below.

### 1.2 System Goals

* **Goal 1 - `Empire` owns lifecycle only.** `start()` and `stop()` are promise-based; `stop()` is a
  graceful shutdown (see `02_Dependency_Injection.md`). Routing, dispatch and errors live elsewhere.
* **Goal 2 - A middleware pipeline** with the signature `(ctx, next)`: registration order, async
  support, a one-shot `next()`, and every thrown error mapped to a response instead of a hung socket.
* **Goal 3 - A separate `Router`.** Routes for `GET`, `POST`, `PUT`, `PATCH`, `DELETE` and `OPTIONS`,
  `:param` capture, first-registered-wins, and RFC-correct `404`, `405`, `HEAD` and `OPTIONS`
  behaviour.
* **Goal 4 - A `Context` whose API is frozen for v1.** Request accessors, response builders, body
  parsing, cookies and file serving; anything added later is additive only.
* **Goal 5 - One error response, produced once.** An `HttpError` hierarchy, and a single function that
  turns any thrown error into a response, shared by the pipeline and the router.
* **Goal 6 - Safe request bodies.** Read once and memoised, parsed on demand (`json`, `form`), and
  capped (`413`) as the limit is crossed rather than after the fact.
* **Goal 7 - Static files and SPA support** that stream, mount under prefixes, serve directory
  indexes, refuse path traversal, and never let a single-page-app fallback shadow a real route.
* **Goal 8 - A logging abstraction** (`ILogger`, `ConsoleLogger`) injected rather than reached for.
* **Goal 9 - Runnable and verified.** Numbered examples for every feature, tests at unit, integration
  and real-socket levels, and one `npm run verify` that CI runs.

### 1.3 Non-Goals (Scope Guardrails)

* **Non-Goal 1 - Route groups, route-level (path-scoped) middleware, wildcard routes, optional
  parameters and trailing-slash configuration.** Recorded as remaining in `PLAN.md` Phase 3. Route-level
  middleware is the one that matters: every middleware currently runs for every request, so features
  that need scoping (authentication, CORS policies) each hand-roll path checks. Building it changes
  `Empire.handleRequest()`'s dispatch model rather than wrapping it.
* **Non-Goal 2 - Server-wide `OPTIONS *`.** An `OPTIONS` to a path with no routes still `404`s, like
  every other verb.
* **Non-Goal 3 - Authentication in the framework.** Empire owns the mechanics (an `HttpError(401)`
  becomes a correct JSON response); the application owns the decision about what a valid credential is.
  It ships as an example (rule 17), not as middleware.
* **Non-Goal 4 - Decorators and reflection.** Not now and not "as a stepping stone".
* **Non-Goal 5 - More than one SPA fallback per server.** `Router.setFallback()` takes one handler; a
  second call replaces the first.
* **Non-Goal 6 - Static-file caching** (`ETag`, `Last-Modified`, `Cache-Control`, an in-memory or LRU
  cache, TTLs, access-frequency tracking) and `ctx.stream()`. Post-v1.
* **Non-Goal 7 - Development versus production error responses**, and richer error bodies. The response
  is `{ error }` (plus `details` for a `ValidationError`); `HttpError.code` and `retryable` exist on the
  error but deliberately do not reach the body today.
* **Non-Goal 8 - Splitting `Context` further.** It holds request accessors, response builders, body
  parsing, cookies and file serving in about 370 lines, and there is no obvious seam; splitting for its
  own sake would make the API harder to follow. Revisit if it passes roughly 450.
* **Non-Goal 9 - Signal handling in the library.** Empire registers no `SIGTERM` / `SIGINT` handlers;
  the application calls `stop()` (see `02_Dependency_Injection.md`).
* **Non-Goal 10 - A compiled or indexed route table.** Matching is a linear scan with segment-by-segment
  comparison. For the number of routes a framework this size sees it is readable, has no compilation
  step, and the performance difference is irrelevant.

### 1.4 Dependency Stance

**Zero runtime dependencies. Native Node.js modules only.**

The core uses `http`, `fs`, `path` and `url` and nothing else; `package.json` has no `dependencies`
block. Development tooling (Vitest, `tsx`, `oxlint`, TypeScript) is dev-only and is not part of the
package. Everything the core offers - routing, the middleware pipeline, cookies, MIME detection, path
normalisation - is written in the framework, and every feature built later (`02` to `06`) keeps to the
same rule.

---

## 2. Design & API Contracts (The Opus Blueprint)

### 2.1 Public User API

```ts
const app = new Empire({
    host: "localhost",
    port: 8001,
    logger: new ConsoleLogger(),      // optional; ConsoleLogger by default
    maxBodySize: 1024 * 1024,         // optional; 1 MB by default
    services: provider,               // optional; see 02_Dependency_Injection.md
    shutdownTimeoutMs: 10_000,        // optional; the default
});

// Middleware: registration order; each decides whether to continue
app.use(createLoggerMiddleware(app.logger));
app.use(async (ctx, next) => {
    ctx.state.startedAt = Date.now();
    await next();
});

// Routes
app.get("/users/:id", (ctx) => ctx.json({ id: ctx.params.id }));
app.post("/users",    async (ctx) => { const body = await ctx.jsonBody(); ctx.status(201).json(body); });
app.put("/users/:id", handler);
app.patch("/users/:id", handler);
app.delete("/users/:id", (ctx) => { ctx.status(204).res.end(); });
app.options("/users", handler);       // optional: only for custom behaviour (rule 8)

// Static files: root, optional prefix, optional SPA fallback
app.useStaticFiles("./public/assets", { prefix: "/assets" });
app.useStaticFiles("./dist", { spaFallback: true });

// Errors: throw, and the pipeline converts it
app.get("/restricted", () => { throw new HttpError(403, "You do not have permission"); });

await app.start();   // resolves once listening
await app.stop();    // graceful; resolves once shut down
```

**Signatures (frozen):**

```ts
type Middleware   = (ctx: Context, next: () => Promise<void>) => void | Promise<void>;
type RouteHandler = (ctx: Context) => void | Promise<void>;
```

**Middleware that owns a dependency is a factory**, because the frozen `Middleware` signature receives
only `ctx` and `next` and cannot reach the server's logger:

```ts
export function createLoggerMiddleware(logger: ILogger): Middleware;
```

**`Empire` members:**

| Member | Description |
|---|---|
| `use(middleware)` | Registers a middleware |
| `useStaticFiles(root, options?)` | One middleware per mounted folder; `{ prefix }` mounts under a URL prefix; `{ spaFallback: true }` registers `root/index.html` as the router's fallback |
| `get` / `post` / `put` / `patch` / `delete` / `options` `(path, handler)` | Register a route; each delegates to the matching `router.*()` |
| `start()` / `stop()` | Promise-based lifecycle |
| `logger` | The `ILogger` in use |
| `services` | The root `ServiceProvider`, if one was supplied |

**Static files: the API decision.** `useStaticFiles(root, options?)` follows ASP.NET Core's
`UseStaticFiles`, not Express's `static(prefix, root)`: the coding standard is to mirror ASP.NET Core
conventions, and one method with an optional parameter is a smaller surface than a second public method.
Prefix mounting was added as an *additive* optional second parameter, so single-argument calls made before
it existed still work.

### 2.2 Core Interfaces & Data Models

**Layout** (one class, interface or enum per file, filename matching the type):

```
src/
├── Empire.ts, EmpireOptions (in Empire.ts), types.ts, index.ts (the public barrel)
├── routing/    Router, RouteMatcher, Route, RouteMatch
├── http/       Context, CookieOptions, streamFile, suppressResponseBody
├── errors/     HttpError, HttpErrorOptions, BadRequestError, ValidationError, ValidationIssue, sendErrorResponse
├── static/     StaticFileHandler, StaticFileOptions, UseStaticFilesOptions, MimeTypes
├── logging/    ILogger, ConsoleLogger
├── middleware/ LoggerMiddleware, CorsMiddleware (+ options types), RouteHeaderMiddleware
├── di/, validation/, loadbalancing/   # the other design docs
```

**Routing types** - plain interfaces with no behaviour:

```ts
interface Route      { method: string; path: string; handler: RouteHandler }
interface RouteMatch { matched: boolean; params: Record<string, string> }
```

**`Router`** is constructor-injected with `ILogger` and never reaches back into `Empire`. It exposes
`get`, `post`, `put`, `patch`, `delete`, `options`, `setFallback(handler)` and
`handle(req, res, ctx?)`. `RouteMatcher.match(routePath, requestPath): RouteMatch` is pure path
comparison with no I/O.

**`Context`** - created per request, wrapping `IncomingMessage` and `ServerResponse`. **Frozen for v1**:
every member below is implemented, and anything added later is additive only (no signature changes, no
removals). Three post-v1 additions exist: `state`, `services` and `route`.

| Request members | Description |
|---|---|
| `req`, `res` | The raw Node objects |
| `method`, `path`, `query`, `headers`, `params` | Method; pathname without the query string (URL-decoded); `URLSearchParams`; incoming headers; `:param` values |
| `ipAddress`, `userAgent`, `contentType` | Client IP (handles `x-forwarded-for` and IPv6); the `User-Agent`, empty when absent; `Content-Type` without parameters |
| `state` | *Post-v1.* An untyped `Record<string, unknown>` bag for middleware to hand data (an authenticated user) to later middleware and handlers. Reading a value back means narrowing, not `as` |
| `services` | *Post-v1.* A `Resolver` over a per-request DI scope; `undefined` without `EmpireOptions.services` |
| `route` | *Post-v1.* The route *pattern* matched (`/users/:id`), set by `Router`; `undefined` before routing and for a 404, 405, automatic `OPTIONS` or the SPA fallback |
| `accepts(type)` | Whether the client accepts a response type, honouring `*/*` and `text/*` |
| `body()` | The request body as a string, read once and memoised |
| `jsonBody()` / `form()` | Parsed JSON, or `URLSearchParams`; each throws `BadRequestError` on bad input |

| Response members | Description |
|---|---|
| `status(code)`, `header(name, value)`, `addHeaders(headers)` | Chainable |
| `text`, `html`, `json` | Send a response with the right `Content-Type` |
| `redirect(url, status?)` | Defaults to `302` |
| `file(path)`, `download(path, filename?)` | Streamed; `download` forces `Content-Disposition`; `404` if missing |
| `cookie(name, value, options?)`, `clearCookie(name)` | Chainable; `Set-Cookie` is appended, never overwritten; `CookieOptions` covers `maxAge`, `expires`, `path`, `domain`, `secure`, `httpOnly`, `sameSite` |

**Errors:**

```ts
class HttpError extends Error {
    readonly statusCode: number;
    readonly code?: string;         // present on the error, not in the response body
    readonly retryable?: boolean;   // likewise
    constructor(statusCode: number, message: string, options?: HttpErrorOptions);   // name is set to the class name
}
class BadRequestError extends HttpError { /* status 400 */ }
class ValidationError extends BadRequestError { /* details: ValidationIssue[] - see 03_Request_Validation.md */ }

function sendErrorResponse(res, err: unknown, logger: ILogger, logMessage: string): void;
```

**Logging:**

```ts
interface ILogger {
    info(message: string): void;
    warn(message: string): void;
    error(message: string, error?: unknown): void;
    debug(message: string): void;
}
```

`ConsoleLogger` prefixes every line with an ISO timestamp and a level tag and formats `Error` objects
with their stack.

**Static files:** `StaticFileOptions` (`root` and the internal `prefix?`), `UseStaticFilesOptions` (the
public `{ prefix?, spaFallback? }`), `StaticFileHandler`, and `MimeTypes.getType(extension)` covering the
extensions a React or Vite build emits (`.html`, `.css`, `.js`, `.json`, images, fonts, `.map`, ...) with
`application/octet-stream` as the fallback.

### 2.3 Internal Processing Logic Rules

**The request pipeline**

1. **The lifecycle of a request.**
   ```
   HTTP request -> Empire.handleRequest()
     -> build Context (and a DI scope if a provider exists)
     -> middleware chain, in registration order (each mounted static folder is one of them)
     -> the chain's final next() calls Router.handle(req, res, ctx)
          -> match -> params -> handler
          -> or: automatic OPTIONS 204 | 405 + Allow | SPA fallback (GET only) | 404
   ```
   `Empire` does no route matching or dispatch itself. Its responsibilities are server lifecycle, the
   middleware pipeline, and handing the request to `Router`.
2. **`next()` is one-shot.** Each middleware receives its own `next()`; calling it twice throws
   `next() called multiple times` rather than silently re-dispatching. A middleware that does not call
   `next()` stops the pipeline - and if it also sends no response, the connection is left hanging (no
   timeout, no error). This is documented in the README, and a test covers it (Step 3).
3. **A middleware must return or await `next()`.** A fire-and-forget `next()` turns a downstream rejection
   into an unhandled rejection and lets the pipeline "complete" before downstream work finishes. This was
   a real defect in the first built-in middleware (Finding 5, Step 2).
4. **One `Context` per request, shared.** `Empire` builds the `Context` for the middleware chain, and
   `Router.handle()` *reuses that exact instance*, attaching `params` and `route` to it, so anything
   middleware put on `ctx` (`state`, `services`) survives into the route handler. Omitting the `ctx`
   argument, as direct unit-test calls do, builds a fresh one.
5. **Errors become responses in one place.** A throw anywhere in the middleware chain is caught by
   `handleRequest()`, and a throw from a route handler or the fallback is caught by `Router`'s private
   `invokeHandler()`. Both call `sendErrorResponse(res, err, logger, logMessage)` - the messages
   `"Unhandled middleware error"` and `"Unhandled route error"` are kept as a parameter because they say
   where the error came from. It logs the error; if headers are already sent it stops there; an
   `HttpError` responds with its status and `{ error: message }` as JSON (a `ValidationError` adds
   `details`); anything else responds `500` with `{ error: "Internal Server Error" }`.

**Routing**

6. **Matching.** `RouteMatcher` compares a route pattern to the request path segment by segment; a
   segment starting with `:` binds that position into `params`. The query string is stripped before
   matching. The **first registered route that matches wins**, so a literal route registered before an
   overlapping `:param` route wins, and the reverse does not. That is a deliberate decision rather than a
   bug (a route-precedence scheme was considered and declined) and the README's "Routing" section says so.
   Path segments are URL-decoded consistently (in `RouteMatcher` and in `Context.path`). **Doubled slashes
   are rejected rather than collapsed**: `//` never silently matches a shorter path.
7. **A malformed path is a `400`.** `Router.handle()` calls `assertValidEncoding(path)` *before* the
   matching loop, so a malformed percent sequence (`%zz`) throws `BadRequestError` (`400`) whether zero or
   many routes are registered. `Context.path` applies the same treatment, so a static-file request behaves
   the same as a routed one. (Previously the same input gave `500` when a route existed and `404` when none
   did, because the decode only ran inside the matching loop.)
8. **`HEAD`, `OPTIONS`, `405`.** Any verb is dispatched the same way (adding `PUT`, `PATCH` and `DELETE`
   needed no change to matching, `Allow` or error handling; only `OPTIONS` is structurally different).
   * **`HEAD`** dispatches to the matching `GET` handler with the response body discarded and every header
     left as `GET` would set it, including `Content-Length` (RFC 9110 §9.3.2).
   * **`OPTIONS`:** an explicit `app.options()` handler always takes priority. Otherwise, any path with at
     least one other method registered answers `204` with an `Allow` header (RFC 9110 §9.3.7). A path with
     no routes at all still `404`s.
   * **`405`:** a path that matches under a different method answers `405` with `Allow` (RFC 9110
     §9.2.2), not `404`.
   * **`Allow`** lists every method registered for the path, `HEAD` alongside `GET`, and `OPTIONS`
     wherever any method is registered. `OPTIONS` in `Allow` is not an RFC requirement (confirmed by direct
     research, not assumed) but is recommended, and an `Allow` that omitted a method the server supports
     would be misleading. It changed the expected string in four existing tests (`"GET, HEAD"` became
     `"GET, HEAD, OPTIONS"`), a deliberate specification change rather than a workaround.
   * `Allow` considers every pattern that matches the *path*, not only the route that would have been
     selected: `POST /users/me` lists `GET, HEAD, PUT, PATCH, DELETE, OPTIONS`, because `/users/:id` also
     matches `/users/me`.
9. **`Router.handle()` separates finding from deciding.** A private `findRoute(path, method)` owns the loop,
   the matcher calls and the `allowedMethods` accumulation (including the implicit `HEAD`), and nothing
   else. `handle()` then reads as a short sequence: find, dispatch if matched, automatic `OPTIONS`, `405`,
   fallback, `404`. The RFC references live on whichever method owns the behaviour.
10. **`HEAD` has one deliberate strategy, in two places.** For a routed `GET`, `Router` calls
    `suppressResponseBody(res)`, which replaces `res.write` and `res.end` on the live response so the real
    handler runs unchanged and its body is dropped - the only way to guarantee the same headers
    (`Content-Length` included) for dynamic responses. It is a named helper that says plainly it mutates
    the response. `StaticFileHandler` handles `HEAD` more directly (set the headers, `end()`, never open a
    stream) because it knows it is serving a file. The alternative - having every `Context` response
    method check for `HEAD` - spreads the concern across more code and risks a handler that computes
    headers by hand getting it wrong, so it was declined.
11. **The SPA fallback belongs to `Router`.** `/about` (no file, no route) should serve `index.html` so a
    client-side router can render it, while `/api/users` (no file, but a real route) must reach its own
    handler. Static middleware cannot decide this: it runs *before* routing, so it cannot know whether a
    route will match later, and guessing wrong either swallows every API route or 404s the SPA forever.
    So `Router.setFallback(handler)` runs only after every route has had its chance, and
    `useStaticFiles(root, { spaFallback: true })` registers a handler serving `root/index.html`.
    * **GET only, deliberately.** A `POST`, `PUT` or `DELETE` to an unmatched path is almost always a
      genuine client error (a typo'd endpoint, a wrong method) and must `404` loudly; falling back to the
      HTML shell would return `200` for a broken request. An early version fired for every method and
      `POST /api/users` with no `POST` handler wrongly returned the shell with `200`.
    * The fallback shares `invokeHandler()`, so an error thrown from it is converted like any handler error.
    * Behaviour: `GET /` real file; `GET /about` fallback; `GET /api/users` the matched route;
      `GET /assets/main.jsx` the real file; `POST /api/users` (no handler) and `POST /about` real `404`s.

**Context and request bodies**

12. **Bodies.** `body()` reads the whole stream once and **memoises the promise**, because an
    `IncomingMessage` can only be consumed once: `jsonBody()` and `form()` (and repeat calls) share the
    cached result instead of re-reading and getting `""`. `jsonBody()` throws `BadRequestError("Invalid
    JSON")`; `form()` throws `BadRequestError` when the `Content-Type` is not
    `application/x-www-form-urlencoded`.
13. **A body size cap.** `EmpireOptions.maxBodySize` (default 1 MB) is enforced **as the limit is crossed**,
    rejecting with `HttpError(413, "Request body too large")` rather than buffering the whole body first.
14. **Headers and cookies.** Node lowercases every incoming header name, so `ctx.headers["Authorization"]`
    is silently always `undefined`; use `ctx.headers.authorization`. A header value may be
    `string | string[]`. `ctx.cookie()` appends to existing `Set-Cookie` values rather than overwriting.
    `ctx.addHeaders()` narrows its values to what `setHeader` accepts, so there is no `any` in the codebase.

**Static files**

15. **`StaticFileHandler`** runs as middleware before routing and returns whether it handled the request:
    * **Prefix matching** is on a path-segment boundary: `/assets` matches `/assets` and
      `/assets/logo.png`, not `/assets-other`, so prefixes that share a leading substring never collide.
      The prefix is normalised (trailing slashes stripped, a bare `/` means none) and stripped before the
      file is resolved.
    * **Path traversal.** The resolved absolute path must sit inside `root`, checked on a path-separator
      boundary (a bare `startsWith(root)` would accept a sibling directory whose name shares the root's prefix, such as `wwwsecret` for root `www`),
      and answers `403` otherwise. This is defence in depth: `ctx.path` already normalises `..` before the
      handler sees it.
    * **Directory index.** A request resolving to a directory serves `index.html` inside it if present
      (`/about` and `/about/` both work) and falls through if not.
    * **Streaming.** A file is streamed with `Content-Length` from one `stat()`, never read into memory. The
      stream logic lives in one function, `streamFileToResponse(res, filePath)`, shared by `StaticFileHandler`
      and `ctx.file()`, which settle on `close` as well as `finish`, so a client that aborts mid-download
      neither leaves a promise pending forever nor leaks a file descriptor. The callers keep only what
      genuinely differs before streaming (`ctx.file()` throws `404` when missing; the static handler falls
      through).
    * **`HEAD`** sets the headers and ends without opening a stream (rule 10). A missing file returns
      `false` so the chain continues.
    * Several folders, each with its own prefix, can be mounted on one server.

**Extension points**

16. **Middleware that needs configuration is a factory** (`createLoggerMiddleware(logger)`,
    `createCorsMiddleware(config)`, `validate(schemas)(handler)`): the frozen `(ctx, next)` signature is
    never widened, and nothing in the core changes to admit a new feature. That is how DI, validation,
    CORS and the load balancer were all added.
17. **The framework ships no authentication middleware.** The mechanics are Empire's: an
    `HttpError(401)` thrown from a middleware already becomes a correct JSON response through the same
    pipeline. The decision about what counts as a valid credential is the application's, and a framework
    wrapper around a callback would add maintained surface for little gain. An earlier `AuthMiddleware`
    stub (`const authorized = true;`, always calling `next()`) read as authentication that silently
    approves every request and was deleted. In its place `examples/08-authentication` is a worked example
    of *shape*: where the middleware sits, how it rejects, and how it hands the user to a handler. It
    reads the lowercase `authorization` header and guards against a non-string value; matches the scheme
    case-insensitively and splits on the first space only; throws `HttpError(401)` with
    `WWW-Authenticate: Bearer` set *before* the throw (RFC 9110 §11.6.1); returns an **identical message
    for an unknown token and a disabled account** so a caller cannot probe which tokens are real; puts the
    user on `ctx.state.user`, narrowed in the handler by a type guard rather than cast; and skips a small
    `PUBLIC_PATHS` list with a comment stating this is a workaround for the missing path-scoped middleware
    (Non-Goal 1). Its header says plainly that the fake token store is not an implementation to copy, and
    the store is named `FAKE_TOKENS` so it is unmistakable in a diff.

### 2.4 Security & Performance Defaults

**Security**

* **No path traversal** out of a served directory (rule 15), with a boundary-aware check.
* **A malformed URL is the client's error** (`400`), not the server's, and the outcome does not depend on
  which routes are registered (rule 7).
* **Bodies are capped** (`413`) and read once (rule 13).
* **Errors do not leak internals:** an unhandled error responds with a generic `500` body and the detail
  goes to the logger; `HttpError.code` and `retryable` stay off the response.
* **The authentication example is deliberately unusable as an implementation** (rule 17): example
  authentication code is the most copy-pasted file in any framework repository, so it is useful as a shape
  and obviously not a real store.
* **`ctx.ipAddress` prefers `X-Forwarded-For`,** which any client can forge. A `trustedProxies` design is
  separate; anything that makes a security decision must use the socket address instead (the load
  balancer's endpoint guard does).

**Performance**

* Static files and `ctx.file()` are **streamed**, not buffered.
* Route matching is a linear scan with no compilation step (Non-Goal 10).
* Bodies are buffered for `body()`, bounded by `maxBodySize`.
* Idle keep-alive sockets close immediately on `stop()` (see `02_Dependency_Injection.md`).

**Known limits**

* **Every middleware runs for every request** (Non-Goal 1), so scoping is hand-rolled by each feature.
* **A middleware that sends nothing and does not call `next()` hangs the request** (rule 2).
* **One SPA fallback per server** (Non-Goal 5).
* **The `HEAD` body suppression mutates the response object** (rule 10); it is isolated in one named helper.

---

## 3. Iterative Build Steps & Test Strategy (The Sonnet Instructions)

Each step lands with its tests before the next starts; `npx tsc --noEmit` and `npx vitest run` must both
be green before moving on.

### Step 1: Types & Structural Definitions

* **Description:** Define the frozen contracts under `src/`: `Middleware` and `RouteHandler` (`types.ts`),
  `Route` and `RouteMatch`, `ILogger`, `HttpError` with `HttpErrorOptions`, `BadRequestError`,
  `EmpireOptions`, `StaticFileOptions` and `UseStaticFilesOptions`, and `CookieOptions`. One type per file.
* **Sonnet Check:** `npx tsc --noEmit` clean; the public barrel `src/index.ts` exports only what a consumer
  should touch (it omits `Router`, `RouteMatcher`, `StaticFileHandler`, `MimeTypes` and `sendErrorResponse`).
* [x] Types and options
* **Vitest Assertions** (`tests/unit/errors/`): `HttpError` carries `statusCode`, `code` and `retryable` and
  sets `.name` to the class name; `BadRequestError` is a `400`.

### Step 2: Component Logic & Isolated Unit Tests

* **Description:** Implement each component that needs no socket, with the behaviour of rules 5-15.
* [x] Phase 1 - `Empire` lifecycle (`start` / `stop`, `ILogger`, `ConsoleLogger`, logger injection)
* [x] Phase 2 - the middleware pipeline and `createLoggerMiddleware`
* [x] Phase 3 - `Router` and `RouteMatcher`: routes, params, `404`, `405` with `Allow`, `HEAD`, `OPTIONS`
* [x] Phase 4 - `Context`, API frozen for v1
* [x] Phase 5 - `body()`, `jsonBody()`, `form()`
* [x] Phase 6 - the error hierarchy and `sendErrorResponse`
* [x] Phase 7 - `StaticFileHandler`, `MimeTypes`, prefix mounting, the SPA fallback
* **Vitest Assertions** (`tests/unit/routing`, `http`, `static`, `errors`, `logging`, `middleware`, and
  `Empire.test.ts`):
  * [x] **Routing:** first match wins; params captured and decoded; query stripped; doubled slashes
    rejected; a literal route before an overlapping `:param` route wins; every verb dispatches; `HEAD`
    reaches the `GET` handler with the body dropped; `Allow` lists three or more verbs, `HEAD` beside `GET`,
    and `OPTIONS`; an explicit `OPTIONS` handler overrides the automatic `204`; `OPTIONS` on an unregistered
    path is `404`; a fallback runs for `GET` only and after routes; `ctx.route` is set for a matched route
    and `undefined` for a `404`, `405` and the fallback.
  * [x] **Context:** every accessor and builder; `body()` memoised; `jsonBody()` and `form()` failures;
    `redirect` defaults to `302`; `cookie()` appends and `clearCookie()` clears; `accepts()` wildcards.
  * [x] **Static:** file resolution and `Content-Type` from the extension; `Content-Length` from the file
    size; directory index with and without a trailing slash; a directory with no `index.html` returns
    `false`; a missing file returns `false`; the `403` traversal guard, tested by overriding `ctx.path` so
    the handler is fed the raw string (a request-level test was **vacuous**: `ctx.path` had already
    normalised `..` away, and the test kept passing with the guard deliberately broken - confirmed by
    temporarily setting `isSafe = true`); encoded traversal (`%2e%2e`) falls through; prefix cases
    (positive serve, prefix stripped before resolving, trailing-slash normalisation, a bare `/`, no prefix
    configured, `/assets-other` not under `/assets`).
  * [x] **Empire:** `get()` and `post()` register routes reachable through a real server (matching the
    `put`, `patch` and `delete` tests); a middleware that does not call `next()` halts the chain; a
    completed chain dispatches to a route; `useStaticFiles()` serves a file, falls through to routing, and
    honours `spaFallback`.
* **Defects found by review and fixed, each with a regression test** (from the hardening pass, Phase 9.3):

  | # | Defect | Fix |
  |---|---|---|
  | 1 | Middleware and route handlers saw different `Context` instances, dropping anything middleware attached | `Router.handle()` reuses the shared `Context` (rule 4) |
  | 2 | The traversal guard was a bare `startsWith(root)` | Requires a path-separator boundary (rule 15) |
  | 3 | No error handling around the middleware pipeline | `handleRequest()` catches and maps errors (rule 5) |
  | 4 | `next()` could be invoked twice | A recursive `dispatch()` with a one-shot `next()` (rule 2) |
  | 5 | Built-in middleware called `next()` without returning it | Return or await it (rule 3) |
  | 6 | `ctx.body()` was not cached | Memoised as a promise (rule 12) |
  | 7 | `ctx.body()` had no size cap | `maxBodySize`, `413` as the limit is crossed (rule 13) |
  | 8 | `sendFile()` settled only on `finish`, hanging and leaking on a client abort | Also settles on `close`, in the shared `streamFileToResponse` (rule 15) |
  | 9 | The static handler ignored `HEAD` | Sets headers and ends without opening a stream (rule 10) |
  | 10 | Route params were never URL-decoded | `RouteMatcher` and `Context.path` decode consistently (rule 6) |
  | 11 | Literal-over-parameter precedence | Decided: first registered wins, by design and documented (rule 6) |
  | 12 | `RouteMatcher` silently filtered empty segments | Doubled slashes are rejected (rule 6) |
  | 13 | `HttpError` had no `code` or `retryable`, and `.name` was unset | Both added, `.name` set (Step 1) |

### Step 3: Network Pipeline Integration & Live Sockets

* **Description:** Exercise the assembled pipeline over a real `http.Server` on ephemeral ports.
* [x] Real-server integration tests:
  * `MiddlewarePipeline` - registration order, the double-`next()` guard, error-to-response mapping.
  * `ContextSharing` - what middleware attaches to `ctx` reaches the handler (Finding 1).
  * `RequestBody` - `body()`, `jsonBody()`, `form()` and the size cap over a real request.
  * `FileStreaming` and `StaticFileStreamingAbort` - streamed files and aborted downloads.
  * `HttpVerbs` - `PUT` full replace, `PATCH` partial update, `DELETE` and `204`, delete-on-missing `404`,
    and `OPTIONS` (the automatic `204` with `Allow` over a socket, and an explicit `options()` overriding it).
  * `RoutingPatterns` and `MalformedRequestPath` - patterns end to end; `/users/%zz` is a `400` with a route
    registered, and `/other/%zz` is the same `400` with none.
  * `ExampleAuth` - the example's middleware: no header, a non-Bearer scheme, lowercase `bearer alice-token`
    succeeding, an unknown token, a disabled account's token, `WWW-Authenticate` present, **identical bodies**
    for the unknown-token and disabled-account cases (asserted against each other, not a literal), a
    successful request reaching the handler with `ctx.state.user`, and a public path with no header at all.
* **Lessons kept, so they are not relearned:**
  * A middleware that never calls `next()` leaves the response unsent; a plain `fetch()` would hang the test
    and the open socket would hang `app.stop()`. Fire the request, wait briefly, assert on in-memory flags,
    then abort.
  * `fetch()` keeps its socket alive, and `server.close()` waits for every connection, so `app.stop()` waited
    out the server's keep-alive timeout (about 3 s a test). Sending `Connection: close` on the affected
    requests took the file from 6234 ms to 210 ms, without changing `Empire`'s server configuration.
  * Abort-mid-stream tests compete for I/O under full-suite parallelism and flaked intermittently; the
    abort test is gated behind `RUN_FLAKY_TESTS` and excluded from `npm test`.
  * A fixed test port in the OS ephemeral range collided on CI; fixed ports now sit below that range, and
    helpers pick free ports and retry on `EADDRINUSE`.

### Step 4: Verification, Benchmarking, & Example App

* **Description:** Runnable examples, request files, CI, and the documentation.
* [x] **Examples** `examples/01-basic-server` to `08-authentication` (ports 8001-8008), mirrored in
  `package-example/` against the published `"empire-ts"` package (+1000 on the port):
  `01-basic-server`, `02-routing` (a full REST-style user API: params, query strings, a multi-param nested
  route, a literal route ahead of an overlapping `:param` route, `PUT`, `PATCH`, `DELETE`),
  `03-middleware` (logger, a short-circuiting check, a timing middleware), `04-static-files` (unprefixed
  and prefixed folders), `05-error-handling`, `06-react-app` (a real React and React Router app on
  `BrowserRouter` via CDN and in-browser Babel, so it needs no install or build, with `spaFallback` and a
  real API route), `07-body-size-limit`, `08-authentication`. `npm start` runs `01`.
* [x] **Request files** `tests/http/empire.http`, `routing.http` (one request per route plus the `404`,
  `HEAD`, `405` and `OPTIONS` cases) and `invalid-json.http`, each request exercised against a live server.
* [x] **CI.** `npm run verify` (`typecheck && test && examples`) runs on every push to `main` and every pull
  request, so local development and CI run the identical command; `scripts/run-examples.ts` smoke-tests
  every app in `examples/`. Dependabot opens weekly update PRs for npm and for the pinned Actions.
* [x] **Docs.** The README's "Routing", "Static Files", "Middleware" and "Server Lifecycle" sections
  (including that a middleware must call `next()` and what happens if it does not), the examples table, and
  `doc/ARCHITECTURE.md`.
* [x] **Code review pass** - eight refactors, each keeping `tsc` and the tests green:
  * The duplicated streaming block became `streamFileToResponse` (rule 15).
  * The duplicated error-to-response block became `sendErrorResponse` (rule 5); the unused `code` and
    `retryable` were left off the body as a separate decision.
  * `Router.handle()` was split into `findRoute` and the decision sequence (rule 9).
  * The `HEAD` body suppression moved into a named helper and was documented as one deliberate decision
    with the static handler's strategy (rule 10).
  * The always-approving `AuthMiddleware` stub was removed and replaced by the example (rule 17), and
    `LoggerMiddleware` became `createLoggerMiddleware(logger)` so it uses `ILogger` instead of `console.log`.
  * `package.json` was corrected: `"license": "MIT"` with a `LICENSE` file, `description`, `author` and
    `keywords` filled in, and `main` pointing at the build output.
  * A malformed request path became a `400` (rule 7).
  * The only `any` in the codebase, in `Context.addHeaders`, was removed (rule 14).
* **Build record worth keeping (adding `PUT`, `PATCH`, `DELETE` and `OPTIONS`):** live verification caught
  two things a passing test suite did not. A **stale server process from an earlier run still held port
  8002**, so the first verification silently tested old code and every new request wrongly showed `405`;
  and an `Allow` assumption in the request file was wrong (`POST /users/me` also matches `/users/:id`,
  rule 8). Both were found by running the requests against a freshly started server.
* [ ] **Remaining, not built** (Non-Goals 1, 5, 6 and 7): route groups, route-level middleware, wildcard
  routes, optional parameters, trailing-slash support, multiple SPA fallbacks, static-file caching,
  `ctx.stream()`, and development versus production error responses.
