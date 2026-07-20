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

0.9.1 — Static File Prefix Mounting

**v1.0.0 blockers:**
* React application support — index.html fallback and React Router fallback
* Static file streaming (StaticFileHandler middleware — ctx.file()/ctx.download() already stream)

This is the only remaining v1.0.0 blocker.

**Resolved:**
* Context API freeze — all v1 Context members implemented
* Middleware signature migration to Context-based
* ctx.form() body parsing
* Static files API — kept useStaticFiles(root), see item 3 below
* Router refactor — routing extracted out of Empire.ts into src/routing/, see Phase 9 below
* Static file prefix mounting — useStaticFiles(root, { prefix }) added as an
  additive optional second parameter, see item 3 below

---

## Priority — Required Before Phase 10

These items must be resolved before Dependency Injection work begins.
They are gaps or breaking inconsistencies discovered when comparing the
current implementation against the full roadmap.

### 0. Context API freeze — no breaking changes after v1

The Context API must be finalised before v1 is released. Every version
after v1 must remain backward compatible. Any method added post-v1 must
be additive only — no signature changes, no removals.

The following Context members must be implemented before v1:

**Response helpers**
* ctx.redirect(url, status?) — redirect to another URL
* ctx.file(path) — serve a file from a route handler
* ctx.download(path, filename?) — force file download via Content-Disposition

**Request helpers**
* ctx.ipAddress — resolved client IP, handles proxies and IPv6 normalisation
* ctx.userAgent — User-Agent header shorthand
* ctx.contentType — Content-Type of the incoming request
* ctx.accepts(type) — check what response types the client accepts

**Cookies**
* ctx.cookie(name, value, options?) — set a cookie on the response
* ctx.clearCookie(name) — clear a cookie by setting expired date

**Post-v1 only (depends on DI)**
* ctx.services — added after Phase 10 Dependency Injection is complete

Files affected:
* `src/http/Context.ts` — all additions go here

---

### 0b. React Application Support — required before v1

Empire must be able to serve a React application before v1 is released.
This is a core use case and must work without breaking changes post-v1.

**What is needed:**

* Index.html fallback for directory requests — e.g. `/about/` serves `/about/index.html`
* React Router fallback — any path that does not match a file or route serves
  the root `/index.html` so React Router can handle client-side routing
* Static file streaming — large JS bundles and assets should stream rather
  than load fully into memory
* Correct MIME types for `.js`, `.css`, `.map`, `.woff`, `.woff2` — already
  partially covered, verify all React build output types are handled

**Target usage:**

```ts
const app = new Empire({ host: "localhost", port: 3000 });

// Serve React build output
app.useStaticFiles("./dist");

// API routes — matched before React fallback
app.get("/api/users", (ctx) => {
    ctx.json({ users: [] });
});

await app.start();
```

**Behaviour:**
* `/` → serves `dist/index.html`
* `/about` → no file match → serves `dist/index.html` → React Router renders `/about`
* `/api/users` → matched by route handler → returns JSON
* `/assets/main.js` → serves `dist/assets/main.js` directly
* `/favicon.ico` → serves `dist/favicon.ico` directly

Files affected:
* `src/static/StaticFileHandler.ts` — index.html fallback and React Router fallback
* `src/static/MimeTypes.ts` — verify all React build output MIME types are present

### 1. Middleware signature — breaking change required

The current middleware signature is:

```ts
(req: IncomingMessage, res: ServerResponse, next: () => Promise<void>) => void
```

The roadmap requires a Context-based signature:

```ts
(ctx: Context, next: () => Promise<void>) => void | Promise<void>
```

Files affected:
* `src/types.ts` — update Middleware type
* `src/Empire.ts` — update handleRequest() to pass ctx instead of req/res
* `src/middleware/LoggerMiddleware.ts` — update to use ctx
* `src/middleware/AuthMiddleware.ts` — update to use ctx
* `examples/03-middleware/server.ts` — update timingMiddleware
* All other examples using app.use()

### 2. form() body parsing — missing from Phase 5

`ctx.form()` is listed as a completed feature in the roadmap but has not been implemented.

Target API:

```ts
const data = await ctx.form();
// data is Record<string, string> parsed from application/x-www-form-urlencoded
```

Files affected:
* `src/http/Context.ts` — add form() method

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

### 4. Static file streaming — not implemented

Files are currently read fully into memory with `fs.promises.readFile()`.
Large files should be streamed using `fs.createReadStream()` and `stream.pipe()`.

Files affected:
* `src/static/StaticFileHandler.ts` — replace readFile with stream pipe

### 5. Static file index.html fallback — not implemented

Requests to a directory path (e.g. `/about/`) should fall back to serving
`/about/index.html` if it exists.

Files affected:
* `src/static/StaticFileHandler.ts` — add index fallback logic

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

### Remaining

* Migrate middleware to Context-based signature:
  `(ctx, next) => void | Promise<void>`

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

### Completed

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

### Remaining

**Required before v1 — API freeze**
* ctx.redirect(url, status?) — redirect to another URL
* ctx.file(path) — serve a file from a route handler
* ctx.download(path, filename?) — force file download via Content-Disposition
* ctx.ipAddress — resolved client IP, handles proxies and IPv6 normalisation
* ctx.userAgent — User-Agent header shorthand
* ctx.contentType — Content-Type of the incoming request
* ctx.accepts(type) — check what response types the client accepts
* ctx.cookie(name, value, options?) — set a cookie on the response
* ctx.clearCookie(name) — clear a cookie by name

**Post-v1 only (depends on Phase 10)**
* ctx.services — ServiceProvider available per request after DI is implemented

**Post-v1**
* ctx.stream() — stream a readable to the response

---

## Phase 5 — Request Bodies

### Completed

* ctx.body() — reads full request stream as string
* ctx.jsonBody() — parses JSON body, throws BadRequestError on invalid JSON

### Remaining

* ctx.form() — parse application/x-www-form-urlencoded body — see Priority section
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

* app.useStaticFiles(root) — registers static file middleware
* MimeTypes class — maps 14 file extensions to MIME types, falls back to application/octet-stream
* StaticFileOptions interface — root directory configuration
* StaticFileHandler class — resolves, validates, and serves files from disk
* Path traversal protection — 403 Forbidden on attempted escape
* Directory serving blocked — stat.isFile() check
* Falls through to routing if file not found

### Remaining

**Required before v1 — React support**
* Index.html fallback for directory requests — see Priority section
* React Router fallback — serve root index.html for unmatched paths
* Stream files instead of reading fully into memory — see Priority section
* Verify MIME types cover all React build output — .js, .css, .map, .woff, .woff2, .woff, .ttf, .eot

**Resolved — API alignment**
* Static files API decision — kept `useStaticFiles(root)`, no URL prefix — see Priority section item 3

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

**Examples to add before v1**
* `examples/06-react-app/` — serve a built React application with React Router support
* `examples/06-react-app/client/` — minimal React app with React Router for testing
* `examples/06-react-app/server.ts` — Empire serving the React build output with API routes

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
* tests/unit/ — directory structure ready for Vitest (logging, middleware, static, di)
* tests/http/ — REST client test files
* tests/fixtures/static/ — static file test assets
* examples/ — five numbered example applications

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

### Prerequisites

* [ ] Add `vitest` as a dev dependency
* [ ] Add `"test": "vitest run"` script to `package.json` (replace the
  placeholder `echo "Error: no test specified"` script)
* [ ] Add `vitest.config.ts` if the default config doesn't resolve
  `NodeNext` module resolution correctly against `tsconfig.json`
* [ ] Create `tests/fixtures/services/TestLogger.ts` — an `ILogger`
  implementation that records calls instead of writing to the console,
  needed because `Router`'s constructor requires an `ILogger`

### Unit Tests — `tests/unit/routing/`

One file per class, named exactly after the class, per CONTRIBUTING.md.

**`RouteMatcher.test.ts`**
* [ ] `it('matches an exact static path')`
* [ ] `it('does not match when segment counts differ')`
* [ ] `it('extracts a single :param from the path')`
* [ ] `it('extracts multiple :param segments from the path')`
* [ ] `it('matches a static segment that follows a :param')`
* [ ] `it('does not match when a static segment differs')`
* [ ] `it('matches the root path')`

**`Router.test.ts`**
* [ ] `it('dispatches a GET request to a registered handler')`
* [ ] `it('dispatches a POST request to a registered handler')`
* [ ] `it('passes route parameters to the handler via ctx.params')`
* [ ] `it('matches the first registered route when patterns overlap')`
* [ ] `it('returns 404 with "Route not found" when no route matches')`
* [ ] `it('returns 404 when the path matches but the method does not')`
* [ ] `it('returns the HttpError status code and JSON body when a handler throws HttpError')`
* [ ] `it('returns 500 with a generic message when a handler throws a plain Error')`
* [ ] `it('does not write a second response when headers were already sent')`

**`Route.test.ts`, `RouteMatch.test.ts`**
* [ ] Evaluate whether these are worth writing — both are plain interfaces
  with no behavior, so TypeScript already enforces their shape. Skip unless
  a concrete regression scenario justifies a smoke test.

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

* [ ] `npx vitest run` — all new tests pass
* [ ] `npx tsc --noEmit` — no type errors
* [ ] Manually exercise the new example routes with the updated `.http` file
* [ ] Update `doc/PROJECT_STATE.md` and this plan to mark Phase 9.1 complete

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
