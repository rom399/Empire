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

0.7.0 - Static Files Complete

---

## Priority — Required Before Phase 10

These items must be resolved before Dependency Injection work begins.
They are gaps or breaking inconsistencies discovered when comparing the
current implementation against the full roadmap.

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

### 3. Static files API — inconsistency with roadmap

The roadmap specifies a URL prefix parameter:

```ts
app.static("/public", "./wwwroot");
```

We implemented:

```ts
app.useStaticFiles("./wwwroot");
```

Decision needed: align the API to the roadmap or keep the current design.
If aligning, files affected:
* `src/Empire.ts` — update useStaticFiles() or rename to static()
* `src/static/StaticFileOptions.ts` — add urlPrefix property
* `src/static/StaticFileHandler.ts` — filter requests by URL prefix
* All examples using static files

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

* Update middleware signature from (req, res, next) to (ctx, next) — see Priority section

---

## Phase 3 — Routing

### Completed

* Route table
* GET routes via app.get()
* POST routes via app.post()
* Route matching with segment comparison
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

* ctx.redirect()
* ctx.file()
* ctx.download()
* ctx.stream()
* ctx.cookie()
* ctx.clearCookie()
* ctx.accepts()
* ctx.contentType()
* ctx.ipAddress
* ctx.userAgent

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

* URL prefix support — app.static("/public", "./wwwroot") — see Priority section
* Stream files instead of reading fully into memory — see Priority section
* Index.html fallback for directory requests — see Priority section
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

---

## Phase 9 — Project Structure

### Completed

* Project renamed from rom-server to empire
* src/http/ — Context lives here
* src/errors/ — HttpError, BadRequestError
* src/middleware/ — PascalCase filenames (AuthMiddleware, LoggerMiddleware)
* src/static/ — MimeTypes, StaticFileHandler, StaticFileOptions
* src/di/ — placeholder directory for Phase 10
* src/logging/ — ILogger, ConsoleLogger
* tests/unit/ — directory structure ready for Vitest (logging, middleware, static, di)
* tests/http/ — REST client test files
* tests/fixtures/static/ — static file test assets
* examples/ — five numbered example applications

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
