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
* DELETE routes

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

---

## Phase 5 — Request Bodies

### Completed

* ctx.body() — reads full request stream as string
* ctx.jsonBody() — parses JSON body, throws BadRequestError on invalid JSON

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

* app.useStaticFiles(root) — registers static file middleware
* MimeTypes class — maps 14 file extensions to MIME types, falls back to application/octet-stream
* StaticFileOptions interface — root directory configuration
* StaticFileHandler class — resolves, validates, and serves files from disk
* Path traversal protection — 403 Forbidden on attempted escape
* Directory serving blocked — stat.isFile() check
* Falls through to routing if file not found

### Remaining

* File caching / cache headers
* Index file fallback (serve index.html for directory requests)

---

## Phase 8 — Developer Experience

### Completed

* npm start — runs examples/basic-server/server.ts via tsx
* Example application — examples/basic-server/server.ts
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
* examples/basic-server/ — demo application

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

---

## Future Ideas

### Configuration

```ts
app.configuration.get("Database");
```

### Controllers

```ts
app.controller(UserController);
```

### OpenAPI / Swagger

```ts
app.useSwagger();
```

---

## Current Version

0.7.0 - Static Files Complete
