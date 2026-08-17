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

0.14.0 — Missing HTTP Verbs Complete

**v1.0.0 blockers:** none. All Priority items are resolved — see below.
Phase 9.1 (routing test/example coverage), Phase 9.3 (all 13 bug-hunt
findings), and Phase 3's PUT/PATCH/DELETE/OPTIONS routes are all fully
complete. Remaining Phase 3 work (route groups, wildcards, optional
params, trailing-slash support) is lower-priority, not release-blocking.

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

**Update - ctx.state added:**

`ctx.state: Record<string, unknown>` - a per-request bag for middleware to
attach data to (e.g. an authenticated user) for downstream middleware and
route handlers to read. Added as a prerequisite for
`doc/features/EXAMPLE_AUTHENTICATION_MIDDLEWARE.md`, per the additive-only
policy stated above: a new public field, no existing signature changed.
Deliberately untyped (`Record<string, unknown>`) since `Context` has no
way to know what any given application stores here - reading a value
back requires narrowing, not casting with `as`.

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
* 405 handling with an `Allow` header when a path matches a different
  method (RFC 9110 §9.2.2 compliance fix, found via an RFC gap analysis;
  previously returned 404)
* HEAD routes — auto-dispatched to the matching GET handler with the
  response body discarded, headers left exactly as GET would set them
  (RFC 9110 §9.3.2). `Allow` headers list `HEAD` alongside `GET` wherever
  a GET route exists, since HEAD is implicitly supported there too.
* PUT, PATCH, DELETE routes — `app.put()`/`app.patch()`/`app.delete()`,
  mechanically identical to `app.post()`. No changes were needed to
  `Router.handle()`'s matching, `Allow`-header, or error-handling logic
  to support them — all three were already fully verb-agnostic.
* OPTIONS routes — `app.options()` for explicit registration, which works
  through the existing dispatch loop for free, the same as PUT/PATCH/
  DELETE. Additionally, any path with at least one other method
  registered but no explicit OPTIONS handler automatically responds `204`
  with an `Allow` header (RFC 9110 §9.3.7), rather than falling through
  to a 405; an explicit `app.options()` handler always takes priority
  over that automatic response. A path with zero matching routes still
  404s for OPTIONS, same as every other verb — server-wide `OPTIONS *`
  semantics are deliberately out of scope.

  **Design decision:** `Allow` now includes `OPTIONS` itself automatically
  wherever any other method is registered for a path, mirroring the
  existing `HEAD`-alongside-`GET` precedent. This isn't an RFC 9110
  requirement — confirmed by direct research before deciding, not
  assumed — but is recommended practice, and an `Allow` header that
  omitted `OPTIONS` despite the server actually supporting it there would
  be misleading. This changed the exact `Allow` string on 4 existing
  tests (e.g. `"GET, HEAD"` → `"GET, HEAD, OPTIONS"`) — a deliberate spec
  change, not a bug workaround.

  Full build plan and step-by-step history:
  `doc/features/MISSING_HTTP_VERBS.md`.

### Remaining

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

* npm start — runs examples/01-basic-server/server.ts via tsx
* Example applications — 01 through 07 covering all implemented features
* API test files — tests/http/empire.http, tests/http/invalid-json.http
* .npmignore — excludes src/, tests/, examples/ from npm publish
* Project restructured to Empire layout
* GitHub Actions CI (`.github/workflows/ci.yml`, at the git repo root —
  `D:/dev/ROM/.github/`, not under `empire/`) — runs `npm ci`, `npx tsc
  --noEmit`, and `npx vitest run` on every push to `main` and every pull
  request, scoped to the `src/empire` project root
* Dependabot (`.github/dependabot.yml`) — weekly update PRs for npm
  dependencies in `src/empire` and for the GitHub Actions versions pinned
  in the CI workflow

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
* src/middleware/ — PascalCase filenames (LoggerMiddleware)
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

**Update:** the `npm install` sandbox restriction noted below no longer
applies — `vitest` is installed (`^2.1.0`) and `npm test` / `npx vitest run`
both run the full suite directly. The `tsc`/`assert` verification described
below was the workaround used before that access existed; it's kept here
for history.

~~**Note on the dev environment:** `npm install` is not available in the
current sandbox (the npm registry returns 403 here), so `vitest` could not
actually be installed or run to execute these tests in this environment.
The test files below are written in full Vitest syntax and are ready to
run with `npm test` once `npm install` succeeds on a machine with normal
registry access. In the meantime, every case was verified by compiling the
real `Router`/`RouteMatcher` source with `tsc` and re-running the same
assertions through Node's built-in `assert` module directly against the
compiled output — all 20 checks (7 `RouteMatcher` + 13 `Router`) passed.~~

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
* [x] `it('returns 405 with an Allow header when the path matches but the method does not')`
  — fixed from an earlier 404-on-method-mismatch bug found during the RFC 9110/9112
  gap analysis (§9.2.2 requires 405 + Allow, not 404, when the resource exists under
  a different method)
* [x] `it('lists every registered method in Allow when a path has more than one')`
* [x] `it('returns the HttpError status code and JSON body when a handler throws HttpError')`
* [x] `it('returns 500 with a generic message when a handler throws a plain Error')`
* [x] `it('does not write a second response when headers were already sent')`

HEAD support (RFC 9110 §9.3.2, added during the RFC gap analysis):
* [x] `it('dispatches a HEAD request to the matching GET handler')`
* [x] `it('sets the same headers a GET request would set')`
* [x] `it('discards the response body')`
* [x] `it('returns 405 with an Allow header when no GET route matches the path')`
* [x] `it('includes HEAD in the Allow header alongside GET on a 405 for a different path's method')`
* [x] `it('returns 404 when no route matches the path at all')`

* [x] `it('invokes the fallback when no route matches a GET request')`
* [x] `it('prefers a matching route over the fallback')`
* [x] `it('does not invoke the fallback for non-GET requests')`
* [x] `it('replaces a previously registered fallback when called again')`

**`Route.test.ts`, `RouteMatch.test.ts`** — decided: skip. Both are plain
interfaces with no behavior; TypeScript already enforces their shape, and
no concrete regression scenario has come up to justify a smoke test.

### Examples — `examples/` — resolved

* [x] Extend `examples/02-routing/server.ts` with a route using multiple
  `:param` segments in one path — `/users/:userId/posts/:postId`, backed
  by a real `posts` array (previously `/users/:id/posts` returned a
  hardcoded empty `posts: []` stub; it now filters the same array)
* [x] Add two overlapping routes to demonstrate registration-order-wins
  matching — `/users/me` registered before `/users/:id`, so it isn't
  swallowed by the param route
* [x] Add a documented request to an unmatched path so the plain-text 404
  response is visible, not just success paths — see Test Fixtures below
* [x] Update the example's header comment to describe the new routes covered

### Test Fixtures — `tests/http/` — resolved

* [x] Added `tests/http/routing.http` — one request per route (list,
  filtered list, single user, the `/users/me` overlap case, create,
  posts list, single post via multi-param, wrong-postId-for-a-real-user
  404, unmatched-path 404), plus HEAD auto-dispatch and a 405+Allow
  request against `/users/1`, even though neither needs a dedicated
  route to demonstrate

### Tests — `tests/integration/RoutingPatterns.test.ts` — added, not originally scoped

The matching mechanics (multi-param extraction, registration order) were
already unit-tested in `RouteMatcher.test.ts`/`RouterEdgeCases.test.ts`.
This adds end-to-end coverage over a real HTTP server with real app-level
logic on top of that matching, which the lower-level tests don't touch:

* [x] `it('extracts both params from a two-param route over a real request')`
* [x] `it('lets app logic 404 a postId that doesn't belong to the matched userId')`
* [x] `it('reaches the literal route instead of being swallowed by the param route')`

### Verification

* [x] `npx vitest run` — runs directly; see the update in Prerequisites
  above. (This item and the `tsc`/`assert` workaround it replaced both
  predate Phase 9.3, which now runs the full suite routinely.) 157/158
  passing (1 unrelated manual-only skip, see Phase 9.3).
* [x] `npx tsc --noEmit` — no type errors, including the two new test
  fixture files
* [x] Manually exercised every request in `routing.http` against a live
  `npx tsx examples/02-routing/server.ts` run — all behaved as documented,
  including the `/users/me` literal-over-param case, the multi-param
  lookup, both 404 flavors (app-level vs. routing-level), HEAD, and 405
* [x] Updated `doc/PROJECT_STATE.md` and this plan to mark Phase 9.1
  fully complete

**Phase 9.1 is fully complete.**

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

* [x] `it('sets statusCode to the value passed to the constructor')` -
  covered by `'keeps the existing two-argument form working'`, which
  asserts both `statusCode` and `message` together. This file was
  superseded by the FINDING 13 version (code/retryable/name), written
  later and covering these original three items as a byproduct rather
  than under matching titles
* [x] `it('sets message to the value passed to the constructor')` -
  same test as above
* [x] `it('is an instance of Error')` - covered by `'is catchable as an
  Error and as an HttpError'`

### `tests/unit/errors/BadRequestError.test.ts`

Extends `HttpError` with a hardcoded 400. No fixtures needed.

* [x] `it('sets statusCode to 400 regardless of what is passed')`
* [x] `it('sets message to the value passed to the constructor')`
* [x] `it('is an instance of HttpError')`

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

* [x] `it('returns the correct MIME type for a known extension')` -
  implemented as `it.each(cases)('getType(%s) returns %s', ...)`,
  table-driven across all 17 supported extensions as planned, just
  named per Vitest's own `it.each` convention rather than a single
  `it('...')` title
* [x] `it('matching is case-insensitive')` (`.HTML` behaves like `.html`)
* [x] `it('falls back to application/octet-stream for an unknown extension')`

### `tests/unit/http/Context.test.ts`

The highest-value gap. Needs `MockHttp.ts` (already exists from Phase 9.1)
for request/response stand-ins, plus real temp files on disk for `file()`/
`download()`, since they go through `fs.createReadStream()`. Group by
method, matching the file's own structure.

**Request properties/methods**
* [x] `it('headers returns the raw request headers')`
* [x] `it('method defaults to GET when req.method is undefined')`
* [x] `it('path returns the pathname without the query string')`
* [x] `it('query returns parsed query parameters')`
* [x] `it('ipAddress prefers x-forwarded-for over the socket address')`
* [x] `it('ipAddress takes the first address when x-forwarded-for is a comma separated list')`
* [x] `it('ipAddress strips the ::ffff: IPv4-mapped prefix')`
* [x] `it('ipAddress normalises ::1 to 127.0.0.1')`
* [x] `it('userAgent returns the User-Agent header')`
* [x] `it('userAgent returns an empty string when the header is absent')`
* [x] `it('contentType strips parameters like charset')`
* [x] `it('accepts returns true for an exact type match')`
* [x] `it('accepts returns true for */*')`
* [x] `it('accepts returns true for a partial wildcard like text/*')`
* [x] `it('accepts returns false when nothing matches')`
* [x] `it('accepts ignores quality parameters like ;q=0.9')`

**Body parsing**
* [x] `it('body reads the full request stream as a string')`
* [x] `it('jsonBody parses a valid JSON body')`
* [x] `it('jsonBody throws BadRequestError on invalid JSON')`
* [x] `it('form parses an application/x-www-form-urlencoded body into URLSearchParams')`
* [x] `it('form throws BadRequestError when the Content-Type does not match')`

**Response helpers**
* [x] `it('status sets the response status code and is chainable')`
* [x] `it('header sets a single response header and is chainable')`
* [x] `it('addHeaders sets multiple response headers and is chainable')`
* [x] `it('addHeaders skips undefined and null header values')`
* [x] `it('text sets Content-Type to text/plain and writes the body')`
* [x] `it('html sets Content-Type to text/html and writes the body')`
* [x] `it('json sets Content-Type to application/json and writes the serialized body')`
* [x] `it('redirect defaults to status 302 and sets the Location header')`
* [x] `it('redirect uses a custom status code when passed')`

**File serving (needs real temp files — fs.createReadStream can't be
faked with the existing MockHttp response alone; write a temp file, point
file()/download() at it, assert on the piped output)**
* [x] `it('file streams the file contents to the response')`
* [x] `it('file sets the correct Content-Type from the file extension')`
* [x] `it('file sets Content-Length to the file size')`
* [x] `it('file throws HttpError 404 when the file does not exist')`
* [x] `it('download sets Content-Disposition with the file\'s own name by default')`
* [x] `it('download uses a custom filename when passed')`

**Cookies**
* [x] `it('cookie sets a Set-Cookie header with the encoded value')`
* [x] `it('cookie defaults Path to /')`
* [x] `it('cookie includes Max-Age when provided')`
* [x] `it('cookie includes Expires when provided')`
* [x] `it('cookie includes Secure, HttpOnly, and SameSite flags when set')`
* [x] `it('cookie appends to existing Set-Cookie headers rather than overwriting')`
* [x] `it('clearCookie sets an already-expired Set-Cookie header for the given name')`

`tests/fixtures/http/MockHttp.ts` was extended to support this file: `createMockRequest`
now accepts `body` (exposed via `for await...of`, matching how `Context.body()` reads the
request) and `socket.remoteAddress`; `createMockResponse` gained a `write()` method so
`fs.createReadStream(...).pipe(res)` works against the mock in the file-serving tests.

### `tests/unit/static/StaticFileHandler.test.ts`

Needs real temp files/directories on disk (path resolution and traversal
checks depend on real filesystem behavior) and `MockHttp`'s `Context`
stand-in. `tests/fixtures/static/` already has sample files from Phase 7 —
reuse or extend that fixture directory rather than creating a new one.

**Basic resolution**
* [x] `it('serves a file that exists at the request path')`
* [x] `it('sets the correct Content-Type from the file extension')`
* [x] `it('sets Content-Length to the file size')`
* [x] `it('returns false when the file does not exist, so the middleware chain continues')`

**Directory index fallback**
* [x] `it('serves index.html when the request path resolves to a directory containing one')`
* [x] `it('serves index.html when the request path has no trailing slash')` — not
  originally scoped here; added because the request path could resolve to
  the same directory either way and the feature doc verified both give the
  identical result
* [x] `it('returns false when the request path resolves to a directory with no index.html')`

**Path traversal protection**
* [x] `it('returns 403 when the resolved path escapes the root directory')`
  — the test previously here under a different name was vacuous (asserted
  on `res.body`, which the handler never touches on this path); replaced
  with a version that bypasses `ctx.path`'s URL normalisation directly and
  actually reaches the 403 branch, confirmed by a temporary break-and-revert
  of the guard. See `doc/features/PHASE_9_2_CLOSEOUT_TESTS.md` Step 2
* [x] `it('does not serve files outside root even with encoded traversal segments')`

**Prefix matching**
* [x] `it('serves a file when the request path starts with the configured prefix')`
* [x] `it('returns false when the request path does not start with the prefix')`
  — covered by the existing `'ignores requests outside the mounted prefix'`
  test, just never checked off
* [x] `it('strips the prefix before resolving the file on disk')`
* [x] `it('treats a prefix followed by another segment as non-matching, e.g. /assets-other does not match /assets')`
  — covered by the existing `'does not treat /assets-other as being under
  /assets'` test, just never checked off
* [x] `it('normalises a trailing slash on the configured prefix')`
* [x] `it('treats a bare "/" prefix as no prefix at all')`
* [x] `it('has no prefix restriction when none is configured — every path is checked')`
  — implemented as `'has no prefix restriction when none is configured, so
  every path is checked'` (comma instead of the em dash above, matching
  this file's own `it()`-title style)

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
* [x] `it('runs registered middleware in registration order')` — covered by
  `tests/integration/MiddlewarePipeline.test.ts`'s `'runs middleware in
  registration order'` against a real `Empire` instance rather than
  duplicated here; see the research notes in
  `doc/features/TEST_UPDATES_EMPIRE_STATICFILEHANDLER.md`
* [x] `it('does not proceed to the next middleware when one does not call next()')`
* [x] `it('dispatches to a registered route when the middleware chain completes')`
* [x] `it('get() registers a route reachable via the server')`
* [x] `it('post() registers a route reachable via the server')`
* [x] `it('useStaticFiles() serves a file from the given root')`
* [x] `it('useStaticFiles() falls through to routing when no file matches')`
* [x] `it('useStaticFiles() with spaFallback serves index.html for an unmatched GET path')`

### Verification

* [x] `npx vitest run` - 206 passed, 1 skipped
* [x] `npx tsc --noEmit` — no type errors
* [x] Update `doc/PROJECT_STATE.md` and this plan to mark Phase 9.2 complete
  - every item in this section is now checked off, including
  `HttpError.test.ts`, `BadRequestError.test.ts`, and `MimeTypes.test.ts`,
  which turned out to already be covered rather than genuinely missing

**Phase 9.2 is fully complete.**

---

## Phase 9.3 — Critical Bug Fixes (from Regression Test Suite)

Phase 9.2 added test coverage for `Context`, `StaticFileHandler`, and
`Empire`, but writing that coverage surfaced real behavioural bugs, not
just gaps in what was tested. A commit added `tests/integration/` plus
new `tests/unit/` files, each bug pinned down with a `FINDING N` comment
at the point a test catches it, followed by a series of commits fixing
each finding in turn. This phase tracks that work explicitly, separate
from Phase 9.2's coverage-only scope.

**All 13 findings are resolved.** Full suite: 158 tests, 157 passing, 1
skipped (a manual-only test for FINDING 8's `StaticFileHandler` half —
see its own entry below for why).

### Resolved

**FINDING 1 — Context identity split between middleware and route handlers**

`Empire.handleRequest()` built a `Context` for the middleware chain, then
`Router.handle()` built a *second*, different `Context` for the route
handler — anything a middleware attached to `ctx` (auth info, parsed
state) was silently discarded before the handler ran.

Fix: `Context.params` is no longer `readonly`. `Router.handle()` gained an
optional third parameter, `ctx?: Context` — when supplied, it's reused
instead of constructing a new one, with the matched route params attached
to it after matching (`requestCtx.params = match.params`). `Empire.ts`
passes its middleware-chain `ctx` through. The parameter is optional
specifically so `Router.handle(req, res)` keeps working unchanged for the
~20 existing test call sites that invoke it directly without a `Context`.

Files: `src/http/Context.ts`, `src/routing/Router.ts`, `src/Empire.ts`
Tests: `tests/integration/ContextSharing.test.ts`

**FINDING 3 — No error handling around the middleware pipeline**

`Router.invokeHandler()` catches errors thrown from route handlers and
maps them to a response, but `Empire.handleRequest()` had no equivalent
around the middleware chain. A throwing middleware produced an unhandled
promise rejection and left the connection hanging — the client never got
a response, and the request just timed out.

Fix: `handleRequest()` wraps its dispatch call in the same try/catch
pattern `Router.invokeHandler()` already uses — `HttpError` maps to its
`statusCode`, anything else maps to 500, both as a JSON body, guarded by
`res.headersSent` so a response already sent is never double-written.

Files: `src/Empire.ts`
Tests: `tests/integration/MiddlewarePipeline.test.ts`

**FINDING 4 — `next()` not guarded against being called twice**

The middleware pipeline used one `index` variable shared across every
middleware's `next()` closure. Calling `next()` twice from the same
middleware didn't error — it silently advanced `index` past the end of
the chain and re-invoked `Router.handle()` a second time against a
response that may already have been sent.

Fix: replaced the shared counter with recursive `dispatch(index)`, giving
each middleware its own one-shot `next()` (the standard Koa `compose()`
pattern) that throws `"next() called multiple times"` on a second call
instead of re-running downstream work.

Files: `src/Empire.ts`
Tests: `tests/integration/MiddlewarePipeline.test.ts` (`'throws if a
middleware calls next() more than once'`)

**FINDING 6 — `ctx.body()` not cached**

`body()` read `this.req` directly on every call with no memoization. A
real `http.IncomingMessage` is a stream — it can only be consumed once —
so a second call, or a middleware reading the body before the handler
does, got back `""`. `jsonBody()` then reported a misleading `400 Invalid
JSON` for a request whose body had been perfectly valid JSON.

Fix: `body()` now memoizes the *promise* (not just the resolved value, so
two calls in the same tick don't race to read the stream twice) in a new
private `bodyPromise` field, delegating the actual read to a renamed
private `readBody()`. `jsonBody()` and `form()` needed no changes — both
already call `body()`, so they're fixed as a side effect.

Files: `src/http/Context.ts`
Tests: `tests/unit/http/ContextBody.test.ts`,
`tests/integration/RequestBody.test.ts`

**FINDING 5 — Built-in middleware fire-and-forget `next()`**

`LoggerMiddleware`/`AuthMiddleware` called `next()` without awaiting or
returning it — a downstream rejection became an unhandled rejection
instead of propagating, and the pipeline "completed" before downstream
work finished. Shipped as the README's own example middleware.

Fix: `return next();` in both — `next()` already returns a `Promise`, so
returning it directly forwards it without needing `async`/`await`.

Files: `src/middleware/LoggerMiddleware.ts`, `src/middleware/AuthMiddleware.ts`
Tests: `tests/unit/middleware/BuiltInMiddleware.test.ts`

**FINDING 2 — Static-file path-traversal guard used a bare `startsWith`**

`isSafe = absolutePath.startsWith(this.root)` admits a sibling directory
whose name shares the root's prefix as a string (e.g. root `/tmp/x/www`
vs. sibling `/tmp/x/wwwsecret`). Not exploitable through Empire's own
pipeline — `Context.path` already normalises `../` (including
percent-encoded `%2e%2e`) before the handler runs — but it's the only
remaining defence if that changes, or if `StaticFileHandler` is used
directly.

Fix: require a path-separator boundary — `absolutePath === this.root ||
absolutePath.startsWith(this.root + path.sep)`. No test flips red-to-green
here (all 8 `StaticFileHandler` tests already passed); verified via the
full suite count staying unchanged, confirming this is additive
hardening, not a behaviour change.

Files: `src/static/StaticFileHandler.ts`
Tests: `tests/unit/static/StaticFileHandler.test.ts`

**FINDING 9 — Static files ignored `req.method`, so HEAD got a full body**

`Router.discardBody()` only covers routed requests; static middleware
runs before the router ever sees the request, so a HEAD request to a
static file streamed and sent the full body anyway.

Fix: `sendFile()` checks `ctx.method === "HEAD"` after setting
`Content-Type`/`Content-Length` and ends the response immediately,
skipping `fs.createReadStream()` entirely rather than opening it and
discarding the output — the file's contents are never needed for HEAD,
not just discarded after reading.

Files: `src/static/StaticFileHandler.ts`
Tests: `tests/unit/static/StaticFileHandler.test.ts`

**FINDING 12 — `RouteMatcher` silently collapsed doubled slashes**

`.filter(Boolean)` after `split("/")` drops every empty segment, not just
the expected leading one every absolute path has — so `//users//1` and
`/users/1` produced the identical segment array.

Fix: new `splitRequestSegments()` tolerates exactly one leading slash and
one optional trailing slash (so `/users/` still equals `/users`), but
returns `null` — no match — if any other empty segment remains, rather
than silently dropping it. `routeSegments` (the developer-registered
pattern) keeps the old lenient filtering; this is specifically about
untrusted client-supplied request paths.

Files: `src/routing/RouteMatcher.ts`
Tests: `tests/unit/routing/RouterEdgeCases.test.ts`

**FINDING 10 — Route params were never URL-decoded**

`RouteMatcher` matched on raw, still-percent-encoded request segments,
while `Context.path` (via `URL.pathname`) doesn't auto-decode either —
verified directly against Node's actual `URL` behaviour rather than
trusting the original test comment's claim about it. Params like
`/users/john%20smith` came back through `ctx.params` still encoded,
disagreeing with `ctx.path` on what the request path even was.

Fix: `RouteMatcher.match()` decodes each request segment right after
splitting; `Context.path` decodes `url.pathname` to match. Confirmed
safe against reopening path traversal — Node's `URL` parser already
resolves dot-segments (including percent-encoded ones) while building
`.pathname`, before this decode step ever runs. Added coverage for the
malformed-percent-encoding edge case this introduces
(`decodeURIComponent` throws on `"%zz"`): a unit test documenting
`Router.handle()` has no try/catch of its own around matching, and a new
`tests/integration/MalformedRequestPath.test.ts` confirming Empire's
FINDING-3 pipeline-level error handling turns that into a clean 500
instead of a hang, plus a control case confirming a genuinely unmatched
path still 404s when no route exists to trigger a decode attempt at all.

Files: `src/routing/RouteMatcher.ts`, `src/http/Context.ts`
Tests: `tests/unit/routing/RouterEdgeCases.test.ts`,
`tests/integration/MalformedRequestPath.test.ts`

**FINDING 7 — `ctx.body()` had no size cap**

`body()` accumulated the request stream without bound — a large POST
could exhaust memory instead of being rejected.

Fix: `readBody()` tracks accumulated size per chunk and throws
`HttpError(413)` as soon as the limit is crossed, rather than buffering
the full oversized body first. Defaults to 1MB but is overridable:
`Context`'s constructor takes an optional 4th `maxBodySize` parameter,
and `EmpireOptions` gained a matching `maxBodySize?` that `Empire`
threads through to the `Context` it builds per request.

Files: `src/http/Context.ts`, `src/Empire.ts`
Tests: `tests/unit/http/ContextBody.test.ts`, `tests/integration/RequestBody.test.ts`

**FINDING 8 — `sendFile()` only settled on `"finish"`, hanging on client abort**

If the client disconnected mid-download, `"finish"` never fired, the
promise never settled, and the read stream was never destroyed — leaking
a file descriptor per aborted request. Present in both `Context.ts`
(`ctx.file()`/`ctx.download()`) and the identical pattern duplicated in
`StaticFileHandler.ts`.

Fix: both now also listen for `"close"` (which does fire on an aborted
connection), settling with `resolve()` — not `reject()` — so the awaiting
handler completes normally instead of hanging, and destroying the
still-open read stream in a shared cleanup path to stop the descriptor
leak. Verified against a 24MB file aborted 15ms into the stream: settles
in ~350ms instead of timing out.

The `Context.ts` half is covered by `tests/integration/FileStreaming.test.ts`
(observes the awaited handler resolving after abort). The
`StaticFileHandler.ts` half has no equivalent user-code hook to observe
from the same way, so `tests/integration/StaticFileStreamingAbort.test.ts`
instead mocks `fs.createReadStream` to assert the opened stream gets
destroyed. That test is gated behind `RUN_FLAKY_TESTS=true` and excluded
from the normal suite: reliable solo and paired with just
`FileStreaming.test.ts`, but ~40% failure under the full suite's
parallelism — confirmed via a deliberate revert-and-restore of the fix
that this genuinely catches the regression when present; the flakiness
is environment-specific to high concurrency, not a false positive.

Files: `src/http/Context.ts`, `src/static/StaticFileHandler.ts`
Tests: `tests/integration/FileStreaming.test.ts`,
`tests/integration/StaticFileStreamingAbort.test.ts` (manual-only)

**FINDING 11 — Route matching is first-registered-wins**

Decided: this stays as-is. Ordering overlapping routes correctly is the
developer's responsibility, not something Empire resolves automatically
— no code change. Documented in `README.MD`'s new "Routing" section with
a concrete unreachable-route example and its fix.

The original test asserted the *rejected* design (literal wins regardless
of registration order) — it had to change to match the actual decision,
not to dodge a bug. Replaced with two tests documenting both directions:
a param route registered first wins even over a more specific literal
route, and registering the literal route first is what lets it win
instead. `Router.test.ts`'s existing overlap test already registered the
literal route first and asserted it wins, so it needed no change.

Files: `README.MD` (docs only)
Tests: `tests/unit/routing/RouterEdgeCases.test.ts`

**FINDING 13 — `HttpError` had no `code`/`retryable`, and `.name` wasn't set**

Every framework error (including `BadRequestError`) serialised as the
generic `"Error"` instead of its actual class name, and there was nowhere
to attach a machine-readable error code.

Fix: new `src/errors/HttpErrorOptions.ts` (`{ code?, retryable? }`),
following this codebase's one-type-per-file convention, threaded through
`HttpError`'s constructor as an optional 3rd argument — every existing
two-argument call site keeps working unchanged. `this.name =
this.constructor.name` covers `BadRequestError` for free, resolving to
the actual subclass at runtime with no change needed to
`BadRequestError.ts`.

Files: `src/errors/HttpError.ts`, `src/errors/HttpErrorOptions.ts`
Tests: `tests/unit/errors/HttpError.test.ts`

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
