# Empire Framework Plan

## Goal

Build a lightweight TypeScript web framework from scratch without Express.

Empire should eventually support:

* HTTP server startup/shutdown
* Middleware pipeline
* Routing
* Request/response helpers
* JSON body parsing
* Error handling
* Static files
* Testing support
* Dependency injection

---

## Current Version

0.11.0 — Routing Unit Test Coverage

**v1.0.0 blockers:** none. All Priority items are resolved — see below.
Remaining work before an actual v1.0.0 tag is Phase 9.1 (routing/static
test coverage) and Phase 3's PUT/PATCH/DELETE routes, tracked separately.

**Resolved:**
* Context API freeze — all v1 Context members implemented
* Middleware signature migration to Context-based
* ctx.form() body parsing
* Static files API — kept useStaticFiles(root), see item 3 below
* Router refactor — routing extracted out of Empire.ts into src/routing/, see Phase 9 below
* Static file prefix mounting — useStaticFiles(root, { prefix }) added as an
  additive optional second parameter, see item 3 below
* React application support — streaming, index.html fallback, SPA/React
  Router fallback, and MIME type coverage, see item 0b below

---

## Priority — Required Before Phase 10

These items must be resolved before Dependency Injection work begins.
They are gaps or breaking inconsistencies discovered when comparing the
current implementation against the full roadmap.

### 0. Context API freeze — resolved

The Context API is finalised for v1. Every version after v1 must remain
backward compatible — any method added post-v1 must be additive only, no
signature changes, no removals.

All members required before v1 are implemented in `src/http/Context.ts`,
verified directly against the source:

**Response helpers** — all implemented
* ctx.redirect(url, status?) — redirect to another URL
* ctx.file(path) — serve a file from a route handler
* ctx.download(path, filename?) — force file download via Content-Disposition

**Request helpers** — all implemented
* ctx.ipAddress — resolved client IP, handles proxies and IPv6 normalisation
* ctx.userAgent — User-Agent header shorthand
* ctx.contentType — Content-Type of the incoming request
* ctx.accepts(type) — check what response types the client accepts

**Cookies** — both implemented
* ctx.cookie(name, value, options?) — set a cookie on the response, via `CookieOptions`
* ctx.clearCookie(name) — clear a cookie by setting expired date

**Post-v1 only (depends on DI)**
* ctx.services — deliberately deferred, added after Phase 10 Dependency
  Injection is complete

Files affected:
* `src/http/Context.ts` — all additions
* `src/http/CookieOptions.ts` — options type for `ctx.cookie()`

---

### 0b. React Application Support — resolved

Empire can now serve a React (or any SPA) application. Implemented without
breaking changes to any existing API.

**What was needed, and how each was implemented:**

* Static file streaming — `StaticFileHandler.sendFile()` now streams via
  `fs.createReadStream().pipe(res)` with `Content-Length` set from a single
  `stat()` call, instead of reading the whole file into memory with
  `fs.promises.readFile()`
* Index.html fallback for directory requests — `StaticFileHandler.resolveTargetPath()`
  checks for an `index.html` inside a matched directory (e.g. `/about/` serves
  `/about/index.html`)
* React Router / SPA fallback — see the architectural note below; this
  needed a different mechanism than the two items above
* Correct MIME types — `.ttf`, `.eot`, and `.map` added to `MimeTypes.ts`,
  joining the already-present `.js`, `.css`, `.woff`, `.woff2`

**Architectural note — why SPA fallback needed a Router change, not just a StaticFileHandler change:**

The tricky part is `/about` (no matching file, no matching route) needing to
serve `index.html`, while `/api/users` (no matching file, but a real
registered route) must still resolve to its own handler. This can't be done
purely inside static middleware: middleware runs *before* routing in
Empire's pipeline (`Empire.handleRequest()`'s `next()` chain ends by calling
`Router.handle()`), so by the time a static middleware decides "no file
here," it has no way of knowing whether a route registered later will match
the same path. Guessing wrong in either direction breaks something —
serving the SPA shell unconditionally would swallow every API route;
falling through unconditionally would leave `/about` 404ing.

The fix: `Router` gained an optional fallback handler
(`Router.setFallback(handler)`), invoked only when no registered route
matches. `Empire.useStaticFiles(root, { spaFallback: true })` registers this
fallback to serve `root/index.html` via `ctx.file()`. This keeps routing
authoritative — API routes are always checked first — and only falls back to
the SPA shell once nothing else has claimed the request. The fallback is
deliberately **GET-only**: a POST/PUT/DELETE to an unmatched path is almost
always a real client error (typo'd endpoint, wrong method) and should 404
loudly rather than silently return HTML, which would mask the mistake
during development.

**Actual usage** (see `examples/06-react-app/`):

```ts
const app = new Empire({ host: "localhost", port: 3000 });

// Serve React build output, with SPA fallback for client-side routes
app.useStaticFiles("./dist", { spaFallback: true });

// API routes — matched before the SPA fallback, always
app.get("/api/users", (ctx) => {
    ctx.json({ users: [] });
});

await app.start();
```

**Behaviour (verified in `examples/06-react-app`):**
* `/` → serves `dist/index.html` directly (real file)
* `/about` → no file match, no route match → falls back to `dist/index.html`
  via `Router.setFallback()`, so React Router can render `/about` itself
* `/api/users` → matched by route handler → returns JSON, not the fallback
* `/assets/main.jsx` → serves `dist/assets/main.jsx` directly, not the fallback
* `/favicon.ico` → serves `dist/favicon.ico` directly, not the fallback
* `POST /api/users` (wrong method) and `POST /about` (unmatched, non-GET) →
  real 404, not the SPA shell

Files affected:
* `src/static/StaticFileHandler.ts` — streaming, index.html fallback
* `src/static/MimeTypes.ts` — `.ttf`, `.eot`, `.map` added
* `src/routing/Router.ts` — `setFallback()`, GET-only, shares error handling
  with matched routes via a new private `invokeHandler()`
* `src/static/UseStaticFilesOptions.ts` — `spaFallback?: boolean` added
* `src/Empire.ts` — `useStaticFiles()` wires `spaFallback` to `router.setFallback()`
* `examples/06-react-app/` — new example, `dist/index.html`,
  `dist/assets/main.jsx`, `dist/favicon.ico`, an `/api/users` route. A real
  React + React Router app (`BrowserRouter`, real URL paths) loaded from a
  CDN with Babel Standalone transpiling the JSX in-browser — no npm install,
  no build step, staying dependency-free like Empire's other examples while
  still exercising genuine SPA behaviour

Verified with `tsc --noEmit` and a full runtime pass against every behaviour
listed above, including the GET-only fallback fix (initially the fallback
fired for any method, caught by testing `POST /api/users`).

### 1. Middleware signature — resolved

The old signature was:

```ts
(req: IncomingMessage, res: ServerResponse, next: () => Promise<void>) => void
```

The roadmap required a Context-based signature, and this is what's
implemented everywhere:

```ts
(ctx: Context, next: () => Promise<void>) => void | Promise<void>
```

Files affected, all migrated:
* `src/types.ts` — `Middleware` type is `(ctx, next)`
* `src/Empire.ts` — `handleRequest()` passes `ctx` through the chain, not `req`/`res`
* `src/middleware/LoggerMiddleware.ts` — uses `ctx`
* `src/middleware/AuthMiddleware.ts` — uses `ctx`
* `examples/03-middleware/server.ts` — `timingMiddleware` uses `ctx`
* All other examples using `app.use()` — consistent `(ctx, next)` throughout

Verified directly against the current source, not just prior notes:
`types.ts`, `LoggerMiddleware.ts`, and `examples/03-middleware/server.ts`
all confirmed on the `(ctx, next)` signature.

### 2. form() body parsing — resolved

`ctx.form()` was listed as a completed feature in the roadmap but had not
actually been implemented; it now is.

Actual API (returns `URLSearchParams`, matching `ctx.query`, rather than
`Record<string, string>` as originally sketched — `URLSearchParams` handles
repeated keys correctly, which a plain record can't):

```ts
const data = await ctx.form();
// data is a URLSearchParams parsed from application/x-www-form-urlencoded
// throws BadRequestError if the Content-Type doesn't match
```

Files affected:
* `src/http/Context.ts` — `form()` method

### 3. Static files API — resolved, keeping useStaticFiles(root)

The original roadmap specified a URL prefix parameter, Express-style:

```ts
app.static("/public", "./wwwroot");
```

We implemented, and are keeping, ASP.NET Core style:

```ts
app.useStaticFiles("./wwwroot");
```

**Decision: keep `useStaticFiles(root)`, do not add a URL prefix.**
Per CONTRIBUTING.md, Empire deliberately mirrors ASP.NET Core conventions
(`app.UseStaticFiles()`) rather than Express idioms. There is no current
requirement to mount static assets under a URL prefix, and renaming or
adding a prefix parameter now would be a breaking change to an already
public method right before the v1 freeze. `Empire.ts` already implements
this signature — no code change required to close this item.

If prefix-mounting is needed later, add it post-v1 as an optional second
parameter (`useStaticFiles(root, options?)`) rather than reordering
arguments, to stay additive-only per the Context API freeze precedent.

**Update — prefix mounting implemented:**

```ts
app.useStaticFiles("./dist");
app.useStaticFiles("./public/assets", { prefix: "/assets" });
app.useStaticFiles("./storage/uploads", { prefix: "/uploads" });
```

Implemented exactly as the additive optional-parameter path above, chosen
over a separate `static(prefix, root)` method for a smaller API surface —
one method to learn, matching the ASP.NET Core `UseStaticFiles(options)`
precedent Empire already follows, rather than two overlapping methods.

Files affected:
* `src/static/StaticFileOptions.ts` — added optional `prefix` field
* `src/static/UseStaticFilesOptions.ts` — new, the `{ prefix }` options
  type accepted by `Empire.useStaticFiles()`
* `src/static/StaticFileHandler.ts` — `isUnderPrefix()` checks the request
  path starts with the prefix (exact match or followed by `/`, so
  `/assets` does not also match `/assets-other`) and strips it before
  resolving against `root`; falls through (returns `false`) when the
  prefix doesn't match, so multiple prefixed handlers can coexist in the
  middleware chain
* `src/Empire.ts` — `useStaticFiles(root, options?)`, backward compatible
  with existing single-argument calls

Verified with `tsc --noEmit` and a runtime test mounting three folders
(one unprefixed, two prefixed): correct routing to each folder, prefix
boundary case (`/assets-other` does not match `/assets`), unprefixed
paths 404 against prefixed folders, and the existing path-traversal 403
guard is unaffected since it runs after prefix-stripping using the same
check as before.

### 4. Static file streaming — resolved

Implemented as part of item 0b above — `StaticFileHandler.sendFile()` now
streams via `fs.createReadStream().pipe(res)` instead of `fs.promises.readFile()`.

### 5. Static file index.html fallback — resolved

Implemented as part of item 0b above — `StaticFileHandler.resolveTargetPath()`
serves `index.html` inside a matched directory (e.g. `/about/` serves
`/about/index.html`).

---

## Phase 1 — Foundation

### Completed

* TypeScript project setup
* tsconfig configuration
* Empire class
* HTTP server using Node createServer
* Host and port configuration
* Promise-based start()
* Promise-based stop()
* Graceful shutdown using SIGINT
* .gitignore
* ILogger abstraction
* ConsoleLogger implementation
* Timestamped logging
* Logger injection through EmpireOptions

---

## Phase 2 — Middleware

### Completed

* Middleware type definition
* Middleware collection
* app.use() registration
* Middleware execution pipeline
* Async middleware support
* LoggerMiddleware — logs method and URL for every request
* AuthMiddleware — stub, ready for real auth logic
* Context-based signature — `(ctx, next) => void | Promise<void>` — migration
  complete, see Priority section item 1

---

## Phase 3 — Routing

### Completed

* Route table, owned by `Router` in `src/routing/` (extracted from Empire.ts)
* GET routes via app.get() — delegates to Router.get()
* POST routes via app.post() — delegates to Router.post()
* Route matching with segment comparison, in `RouteMatcher`
* URL parameter extraction — /users/:id → ctx.params.id
* 404 handling — Route not found response

### Remaining

* PUT routes
* PATCH routes
* DELETE routes
* OPTIONS routes
* HEAD routes
* Route groups
* Route-level middleware
* Wildcard routes
* Optional parameters
* Trailing slash support

---

## Phase 4 — Context

### Completed — API frozen for v1

* Context class — wraps req and res
* ctx.req / ctx.res — raw Node objects
* ctx.path — request pathname
* ctx.method — HTTP method
* ctx.query — URLSearchParams from the URL
* ctx.params — route parameters
* ctx.headers — incoming request headers
* ctx.text() — plain text response
* ctx.json() — JSON response with Content-Type header
* ctx.html() — HTML response with Content-Type header
* ctx.status() — chainable status code setter
* ctx.header() — set a single response header
* ctx.addHeaders() — set multiple response headers
* ctx.ipAddress — resolved client IP, handles proxies and IPv6 normalisation
* ctx.redirect(url, status?) — redirect to another URL, defaults to 302
* ctx.file(path) — serve a file from a route handler, streamed via `fs.createReadStream()`
* ctx.download(path, filename?) — force file download via Content-Disposition
* ctx.userAgent — User-Agent header shorthand
* ctx.contentType — Content-Type of the incoming request
* ctx.accepts(type) — check what response types the client accepts, wildcard support
* ctx.cookie(name, value, options?) — set a cookie on the response, via `CookieOptions`
* ctx.clearCookie(name) — clear a cookie by name

### Remaining

**Post-v1 only (depends on Phase 10)**
* ctx.services — ServiceProvider available per request after DI is implemented

**Post-v1**
* ctx.stream() — stream a readable to the response

---

## Phase 5 — Request Bodies

### Completed

* ctx.body() — reads full request stream as string
* ctx.jsonBody() — parses JSON body, throws BadRequestError on invalid JSON
* ctx.form() — parses application/x-www-form-urlencoded body into
  URLSearchParams, throws BadRequestError on Content-Type mismatch

### Remaining

* Request size limits

---

## Phase 6 — Error Handling

### Completed

* HttpError base class — statusCode + message
* BadRequestError — extends HttpError with status 400
* Route handler catches HttpError and returns its status code and message as JSON
* Unhandled errors return 500 Internal Server Error
* Invalid JSON body throws BadRequestError automatically

### Remaining

* Middleware exception handling
* Development vs production error responses

---

## Phase 7 — Static Files

### Completed

* app.useStaticFiles(root, options?) — registers static file middleware;
  optional { prefix } mounts under a URL prefix, optional { spaFallback }
  enables SPA support
* MimeTypes class — maps 17 file extensions to MIME types (added .ttf,
  .eot, .map for full React build output coverage), falls back to
  application/octet-stream
* StaticFileOptions / UseStaticFilesOptions interfaces — root, prefix,
  spaFallback configuration
* StaticFileHandler class — resolves, validates, and serves files from
  disk; streams via fs.createReadStream() rather than reading fully into
  memory; falls back to index.html for directory requests
* Path traversal protection — 403 Forbidden on attempted escape
* Directory serving blocked unless an index.html exists inside — see
  index.html fallback above
* Falls through to routing if file not found; Router.setFallback() (GET
  only) serves the SPA shell if routing also finds no match — see
  Priority section item 0b for the full design rationale
* Multiple static folders, each with its own prefix, can be mounted on
  one server without colliding — see examples/04-static-files
* examples/06-react-app — full SPA example: unprefixed root mount with
  spaFallback, a real API route, and a static asset that is not affected
  by the fallback

### Remaining

**Post v1**
* Cache headers (ETag, Last-Modified, Cache-Control)
* In-memory file cache with configurable size limit
* LRU cache eviction strategy
* Cache entry TTL
* File access frequency tracking

---

## Phase 8 — Developer Experience

### Completed

* npm start — runs examples/basic-server/server.ts via tsx
* Example applications — 01 through 05 covering all implemented features
* API test files — tests/http/empire.http, tests/http/invalid-json.http
* .npmignore — excludes src/, tests/, examples/ from npm publish
* Project restructured to Empire layout

### Remaining

* npm run dev — watch mode with auto-restart
* npm run build — compile TypeScript to dist/
* Documentation

**Resolved — examples**
* `examples/06-react-app/` — serves a real React + React Router app
  (`dist/index.html`, `dist/assets/main.jsx`, `dist/favicon.ico`) with
  `spaFallback: true`, plus a real `/api/users` route, demonstrating every
  behaviour listed in Priority section item 0b. React, ReactDOM, and React
  Router load from a CDN (unpkg) and Babel Standalone transpiles the JSX in
  the browser — no npm install, no build step (`npm install` isn't
  available for adding packages to this project in the current dev
  environment), kept dependency-free like the rest of Empire's examples
  while still exercising genuine `BrowserRouter` path-based routing, which
  is what actually needs the server-side SPA fallback.

---

## Phase 9 — Project Structure

### Completed

* Project renamed from rom-server to empire
* src/http/ — Context lives here
* src/errors/ — HttpError, BadRequestError
* src/middleware/ — PascalCase filenames (AuthMiddleware, LoggerMiddleware)
* src/static/ — MimeTypes, StaticFileHandler, StaticFileOptions
* src/routing/ — Route, RouteMatch, RouteMatcher, Router
* src/di/ — placeholder directory for Phase 10
* src/logging/ — ILogger, ConsoleLogger
* tests/unit/routing/ — RouteMatcher.test.ts, Router.test.ts (Vitest, see
  Phase 9.1); logging/, middleware/, static/, di/ still placeholder
  directories, no tests written yet
* tests/http/ — REST client test files
* tests/fixtures/static/ — static file test assets
* tests/fixtures/services/ — TestLogger.ts (in-memory ILogger for tests)
* tests/fixtures/http/ — MockHttp.ts (request/response stand-ins for
  testing Router without a real socket)
* examples/ — six numbered example applications

### Routing Refactor — complete ✅

Routing responsibilities moved out of `Empire.ts` into a dedicated routing package.

**Goals**

* [x] Create `src/routing/Route.ts` — represents a single registered route
* [x] Create `src/routing/RouteMatch.ts` — represents the result of route matching
* [x] Create `src/routing/RouteMatcher.ts` — matches request paths and extracts parameters
* [x] Create `src/routing/Router.ts` — owns route registration and request dispatching

**Refactor Tasks**

* [x] Move route collection from `Empire.ts` into `Router`
* [x] Move `matchRoute()` into `RouteMatcher`
* [x] Move `handleRoute()` into `Router` (as `Router.handle()`)
* [x] Keep `Empire.ts` responsible only for:

  * Server lifecycle
  * Middleware pipeline
  * Configuration
  * Delegating requests to `Router`

`Router` is constructor-injected with `ILogger` rather than reaching back into
`Empire`, per the constructor-injection convention in CONTRIBUTING.md. Verified
with `tsc --noEmit` and a runtime smoke test against `examples/02-routing`
(GET collection, GET with route param, unmatched 404, POST create).

**Target Structure**

```text
src/
└── routing/
    ├── Route.ts
    ├── RouteMatch.ts
    ├── RouteMatcher.ts
    └── Router.ts
```

---

## Phase 9.1 — Routing Test & Example Coverage

The router refactor (Phase 9) moved routing into `src/routing/` but shipped
with no automated tests and only one example (`examples/02-routing`) covering
the happy path. This phase closes that gap before Phase 10 begins, since DI
will sit on top of `Router` and needs a tested foundation underneath it.

### Prerequisites — resolved

* [x] Add `vitest` as a dev dependency (`^2.1.0` in `package.json`)
* [x] Add `"test": "vitest run"` script to `package.json`
* [x] `vitest.config.ts` — not needed. Vitest transforms TypeScript via
  esbuild independent of `tsc`'s CLI module-resolution settings, so the
  default config works against this project's `tsconfig.json` without
  a dedicated config file.
* [x] Create `tests/fixtures/services/TestLogger.ts` — an `ILogger`
  implementation that records calls instead of writing to the console,
  needed because `Router`'s constructor requires an `ILogger`
* [x] Create `tests/fixtures/http/MockHttp.ts` — `createMockRequest()` /
  `createMockResponse()`, minimal `http.IncomingMessage` /
  `http.ServerResponse` stand-ins carrying only the fields `Router` and
  `Context` actually read (method, url, headers, statusCode, setHeader,
  end, headersSent), needed because `Router.handle()` takes real Node
  request/response objects. Not in the original prerequisites list —
  added once writing `Router.test.ts` made the gap obvious.

**Note on the dev environment:** `npm install` is not available in the
current sandbox (the npm registry returns 403 here), so `vitest` could not
actually be installed or run to execute these tests in this environment.
The test files below are written in full Vitest syntax and are ready to
run with `npm test` once `npm install` succeeds on a machine with normal
registry access. In the meantime, every case was verified by compiling the
real `Router`/`RouteMatcher` source with `tsc` and re-running the same
assertions through Node's built-in `assert` module directly against the
compiled output — all 20 checks (7 `RouteMatcher` + 13 `Router`) passed.

### Unit Tests — `tests/unit/routing/` — resolved

One file per class, named exactly after the class, per CONTRIBUTING.md.

**`RouteMatcher.test.ts`** — all 7 cases written and verified:
* [x] `it('matches an exact static path')`
* [x] `it('does not match when segment counts differ')`
* [x] `it('extracts a single :param from the path')`
* [x] `it('extracts multiple :param segments from the path')`
* [x] `it('matches a static segment that follows a :param')`
* [x] `it('does not match when a static segment differs')`
* [x] `it('matches the root path')`

**`Router.test.ts`** — all 9 originally-scoped cases written and verified,
plus 4 more covering `setFallback()` (added after the SPA fallback feature
landed, post-dating this plan section):
* [x] `it('dispatches a GET request to a registered handler')`
* [x] `it('dispatches a POST request to a registered handler')`
* [x] `it('passes route parameters to the handler via ctx.params')`
* [x] `it('matches the first registered route when patterns overlap')`
* [x] `it('returns 404 with "Route not found" when no route matches')`
* [x] `it('returns 404 when the path matches but the method does not')`
* [x] `it('returns the HttpError status code and JSON body when a handler throws HttpError')`
* [x] `it('returns 500 with a generic message when a handler throws a plain Error')`
* [x] `it('does not write a second response when headers were already sent')`
* [x] `it('invokes the fallback when no route matches a GET request')`
* [x] `it('prefers a matching route over the fallback')`
* [x] `it('does not invoke the fallback for non-GET requests')`
* [x] `it('replaces a previously registered fallback when called again')`

**`Route.test.ts`, `RouteMatch.test.ts`** — decided: skip. Both are plain
interfaces with no behavior; TypeScript already enforces their shape, and
no concrete regression scenario has come up to justify a smoke test.

### Examples — `examples/`

* [ ] Extend `examples/02-routing/server.ts` (or add a new numbered example)
  with a route using multiple `:param` segments in one path, e.g.
  `/users/:userId/posts/:postId`
* [ ] Add two overlapping routes (e.g. `/users/new` registered before
  `/users/:id`) to demonstrate registration-order-wins matching
* [ ] Add a documented request to an unmatched path so the plain-text 404
  response is visible, not just success paths
* [ ] Update the example's header comment to describe the new routes covered

### Test Fixtures — `tests/http/`

* [ ] Add corresponding `.http` requests for the new example routes
  (multi-param route, overlapping routes, unmatched path) to
  `tests/http/empire.http` or a new `tests/http/routing.http`

### Verification

* [ ] `npx vitest run` — not run in this sandbox (npm install unavailable);
  ready to run once `vitest` can actually be installed. All logic verified
  by an equivalent Node `assert`-based run against the compiled source
  instead — see the note in Prerequisites above.
* [x] `npx tsc --noEmit` — no type errors, including the two new test
  fixture files
* [ ] Manually exercise the new example routes with the updated `.http` file
  — blocked on the Examples section below, not yet done
* [ ] Update `doc/PROJECT_STATE.md` and this plan to mark Phase 9.1 fully
  complete — the unit test half is done; the Examples and Test Fixtures
  sections below are still open

---

## Phase 9.2 — Core Class Test Coverage

Phase 9.1 only covered `src/routing/`. Of Empire's 17 source files, 2 have
tests; the rest — including `Context.ts`, the largest and most-used class
in the framework — have none. This phase closes the highest-value gaps
before Phase 10 (DI) adds another untested layer on top. Files with no
behavior (plain interfaces — `Route.ts`, `RouteMatch.ts`, `CookieOptions.ts`,
`StaticFileOptions.ts`, `UseStaticFilesOptions.ts`, `types.ts`, `ILogger.ts`)
are intentionally out of scope, consistent with the Phase 9.1 decision to
skip `Route.test.ts` / `RouteMatch.test.ts`.

Analysis method used for each file below (reusable for future files):

```
Analyze the testing requirements for <file path>.

1. Read the file in full — don't rely on prior summaries.
2. List every public member (method, property, constructor) that has
   observable behavior — skip pure type/interface declarations with
   nothing to assert.
3. For each member, identify:
   - The happy path (typical valid input → expected output)
   - Boundary/edge cases (empty input, missing optional params, first vs
     nth call, ordering-dependent behavior)
   - Error paths (what throws, what the thrown error's shape is, what
     happens when an error occurs mid-operation)
   - Any side effects (writes to a shared resource, mutates state,
     depends on wall-clock time, depends on the filesystem or network)
4. Flag anything that will need a test double or fixture to test in
   isolation (e.g. a fake clock, a fake filesystem, a mock request/response)
   and name the fixture if one already exists in tests/fixtures/.
5. Output one `it('...')` case per behavior, phrased in plain English
   per CONTRIBUTING.md's test-naming convention, grouped by method under
   a `describe()` per method matching the file's own structure.
```

### `tests/unit/errors/HttpError.test.ts`

Smallest file, lowest risk, good first target. `HttpError extends Error`
with a `statusCode` field; no fixtures needed.

* [ ] `it('sets statusCode to the value passed to the constructor')`
* [ ] `it('sets message to the value passed to the constructor')`
* [ ] `it('is an instance of Error')`

### `tests/unit/errors/BadRequestError.test.ts`

Extends `HttpError` with a hardcoded 400. No fixtures needed.

* [ ] `it('sets statusCode to 400 regardless of what is passed')`
* [ ] `it('sets message to the value passed to the constructor')`
* [ ] `it('is an instance of HttpError')`

### `tests/unit/logging/ConsoleLogger.test.ts`

Writes to `console.log`/`console.error` — needs `vi.spyOn(console, "log")`
/ `vi.spyOn(console, "error")` to capture output without polluting test
output, and `vi.useFakeTimers()` (or a regex match ignoring the exact
timestamp) since `write()` calls `new Date().toISOString()` on every call,
which is otherwise untestable for an exact string match.

* [x] `it('writes info messages to console.log with an [INFO] tag')`
* [x] `it('writes warn messages to console.log with a [WARN] tag')`
* [x] `it('writes debug messages to console.log with a [DEBUG] tag')`
* [x] `it('writes error messages to console.error, not console.log, with an [ERROR] tag')`
* [x] `it('includes an ISO timestamp in every log line')`
* [x] `it('appends the error stack when error() is called with an Error object')`
* [x] `it('appends the stringified value when error() is called with a non-Error value')`
* [x] `it('omits the appended detail when error() is called with no second argument')` — writing
  this test caught a real bug: `error()` called `formatMessage(undefined)` when no cause was
  passed, and `String(undefined)` → `"undefined"` is truthy, so every plain `logger.error(msg)`
  call was silently appending `"\nundefined"`. Fixed in `ConsoleLogger.ts` by skipping
  `formatMessage()` entirely when `error === undefined`.

### `tests/unit/static/MimeTypes.test.ts`

Bonus — not in the original request, but trivial to add alongside the
others and closes a gap flagged earlier as having no test coverage at all.

* [ ] `it('returns the correct MIME type for a known extension')` (table-driven
  across all 17 supported extensions)
* [ ] `it('matching is case-insensitive')` (`.HTML` behaves like `.html`)
* [ ] `it('falls back to application/octet-stream for an unknown extension')`

### `tests/unit/http/Context.test.ts`

The highest-value gap. Needs `MockHttp.ts` (already exists from Phase 9.1)
for request/response stand-ins, plus real temp files on disk for `file()`/
`download()`, since they go through `fs.createReadStream()`. Group by
method, matching the file's own structure.

**Request properties/methods**
* [ ] `it('headers returns the raw request headers')`
* [ ] `it('method defaults to GET when req.method is undefined')`
* [ ] `it('path returns the pathname without the query string')`
* [ ] `it('query returns parsed query parameters')`
* [ ] `it('ipAddress prefers x-forwarded-for over the socket address')`
* [ ] `it('ipAddress takes the first address when x-forwarded-for is a comma separated list')`
* [ ] `it('ipAddress strips the ::ffff: IPv4-mapped prefix')`
* [ ] `it('ipAddress normalises ::1 to 127.0.0.1')`
* [ ] `it('userAgent returns the User-Agent header')`
* [ ] `it('userAgent returns an empty string when the header is absent')`
* [ ] `it('contentType strips parameters like charset')`
* [ ] `it('accepts returns true for an exact type match')`
* [ ] `it('accepts returns true for */*')`
* [ ] `it('accepts returns true for a partial wildcard like text/*')`
* [ ] `it('accepts returns false when nothing matches')`
* [ ] `it('accepts ignores quality parameters like ;q=0.9')`

**Body parsing**
* [ ] `it('body reads the full request stream as a string')`
* [ ] `it('jsonBody parses a valid JSON body')`
* [ ] `it('jsonBody throws BadRequestError on invalid JSON')`
* [ ] `it('form parses an application/x-www-form-urlencoded body into URLSearchParams')`
* [ ] `it('form throws BadRequestError when the Content-Type does not match')`

**Response helpers**
* [ ] `it('status sets the response status code and is chainable')`
* [ ] `it('header sets a single response header and is chainable')`
* [ ] `it('addHeaders sets multiple response headers and is chainable')`
* [ ] `it('addHeaders skips undefined and null header values')`
* [ ] `it('text sets Content-Type to text/plain and writes the body')`
* [ ] `it('html sets Content-Type to text/html and writes the body')`
* [ ] `it('json sets Content-Type to application/json and writes the serialized body')`
* [ ] `it('redirect defaults to status 302 and sets the Location header')`
* [ ] `it('redirect uses a custom status code when passed')`

**File serving (needs real temp files — fs.createReadStream can't be
faked with the existing MockHttp response alone; write a temp file, point
file()/download() at it, assert on the piped output)**
* [ ] `it('file streams the file contents to the response')`
* [ ] `it('file sets the correct Content-Type from the file extension')`
* [ ] `it('file sets Content-Length to the file size')`
* [ ] `it('file throws HttpError 404 when the file does not exist')`
* [ ] `it('download sets Content-Disposition with the file\'s own name by default')`
* [ ] `it('download uses a custom filename when passed')`

**Cookies**
* [ ] `it('cookie sets a Set-Cookie header with the encoded value')`
* [ ] `it('cookie defaults Path to /')`
* [ ] `it('cookie includes Max-Age when provided')`
* [ ] `it('cookie includes Expires when provided')`
* [ ] `it('cookie includes Secure, HttpOnly, and SameSite flags when set')`
* [ ] `it('cookie appends to existing Set-Cookie headers rather than overwriting')`
* [ ] `it('clearCookie sets an already-expired Set-Cookie header for the given name')`

### `tests/unit/static/StaticFileHandler.test.ts`

Needs real temp files/directories on disk (path resolution and traversal
checks depend on real filesystem behavior) and `MockHttp`'s `Context`
stand-in. `tests/fixtures/static/` already has sample files from Phase 7 —
reuse or extend that fixture directory rather than creating a new one.

**Basic resolution**
* [ ] `it('serves a file that exists at the request path')`
* [ ] `it('sets the correct Content-Type from the file extension')`
* [ ] `it('sets Content-Length to the file size')`
* [ ] `it('returns false when the file does not exist, so the middleware chain continues')`

**Directory index fallback**
* [ ] `it('serves index.html when the request path resolves to a directory containing one')`
* [ ] `it('returns false when the request path resolves to a directory with no index.html')`

**Path traversal protection**
* [ ] `it('returns 403 when the resolved path escapes the root directory')`
* [ ] `it('does not serve files outside root even with encoded traversal segments')`

**Prefix matching**
* [ ] `it('serves a file when the request path starts with the configured prefix')`
* [ ] `it('returns false when the request path does not start with the prefix')`
* [ ] `it('strips the prefix before resolving the file on disk')`
* [ ] `it('treats a prefix followed by another segment as non-matching, e.g. /assets-other does not match /assets')`
* [ ] `it('normalises a trailing slash on the configured prefix')`
* [ ] `it('treats a bare "/" prefix as no prefix at all')`
* [ ] `it('has no prefix restriction when none is configured — every path is checked')`

### `tests/unit/Empire.test.ts`

More of an integration point than a pure unit — needs a real `http.Server`
bound to an ephemeral port (`port: 0`) and real HTTP requests via
`fetch()` or Node's `http.request()`, since `Empire`'s constructor wires
together the real Node server, not something mockable at this level
without losing most of the value of the test.

* [x] `it('starts and stops the server')` — split into "starts the server so it
  accepts requests", "stops the server so it no longer accepts requests", and
  "rejects start() when the port is already in use" (Phase 1 scope)
* [x] `it('logger defaults to ConsoleLogger when none is provided')` (Phase 1 scope)
* [x] `it('logger uses the provided logger when one is passed in EmpireOptions')` (Phase 1 scope)
* [x] `it('logs a startup message through the injected logger on start()')` (Phase 1 scope, extra case)
* [ ] `it('runs registered middleware in registration order')`
* [ ] `it('does not proceed to the next middleware when one does not call next()')`
* [ ] `it('dispatches to a registered route when the middleware chain completes')`
* [ ] `it('get() registers a route reachable via the server')`
* [ ] `it('post() registers a route reachable via the server')`
* [ ] `it('useStaticFiles() serves a file from the given root')`
* [ ] `it('useStaticFiles() falls through to routing when no file matches')`
* [ ] `it('useStaticFiles() with spaFallback serves index.html for an unmatched GET path')`

### Verification

* [ ] `npx vitest run` — same caveat as Phase 9.1: dependent on `npm install`
  succeeding wherever this runs
* [ ] `npx tsc --noEmit` — no type errors
* [ ] Update `doc/PROJECT_STATE.md` and this plan to mark Phase 9.2 complete

---

## Phase 10 — Dependency Injection

Target API:

```ts
app.services.addSingleton(ILogger, ConsoleLogger);
app.services.addTransient(IUserService, UserService);

const logger = app.services.resolve(ILogger);
```

### Tasks

* ServiceLifetime enum — Singleton, Transient, Scoped
* ServiceDescriptor class — holds token, implementation, lifetime
* ServiceCollection class — addSingleton(), addTransient(), addScoped()
* ServiceProvider class — resolve(), builds and caches instances
* Integration with Empire class via app.services
* Integration with Context via ctx.services

---

## Phase 11 — Validation

### Tasks

* Body validation
* Query validation
* Route parameter validation
* Schema validation
* ValidationException
* Automatic 400 responses

---

## Phase 12 — Authentication

Target API:

```ts
app.use(JwtMiddleware({ secret: "..." }));
```

### Tasks

* JWT authentication middleware
* Cookie-based authentication
* Bearer token extraction
* Role-based authorization
* Policy-based authorization

---

## Phase 13 — Configuration

Target API:

```ts
app.configuration.get("Database");
```

### Tasks

* appsettings.json provider
* Environment variable provider
* Command line provider
* Strongly typed configuration
* Options pattern

---

## Phase 14 — Controllers

Target API:

```ts
@Controller("/users")
class UserController {
}
```

### Tasks

* Controller discovery
* Route generation from decorators
* Constructor injection
* Action execution

---

## Phase 15 — Advanced Dependency Injection

### Tasks

* Constructor injection
* Scoped lifetime
* Factory registrations
* Circular dependency detection
* Open generics

---

## Phase 16 — HTTP Features

### Tasks

* Compression
* CORS middleware
* Response caching
* Request size limits
* Multipart uploads
* File uploads

---

## Phase 17 — Testing

### Tasks

* Unit tests — Vitest
* Integration tests
* Routing tests
* Middleware tests
* Context tests
* Error handling tests

---

## Phase 18 — Advanced Features

### Tasks

* WebSockets
* Server Sent Events
* Hosted services
* Background services
* Health checks
* Metrics
* OpenAPI generation
* Rate limiting
* OpenTelemetry

---

## Long-Term Ideas

* MVC
* Plugin system
* Module system
* CLI tooling
* Project templates
* ORM integration
* Database migrations
* HTTP/2
* HTTP/3
* gRPC
