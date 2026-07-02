# Empire Framework — Architecture

## Overview

Empire is a lightweight TypeScript HTTP web framework built from scratch on Node's
built-in `http` module. It has no runtime dependencies. The design is inspired by
ASP.NET Core — middleware pipelines, dependency injection, strongly-typed context,
and a clean separation of concerns.

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

---

## Directory Structure

```
empire/
├── src/
│   ├── http/
│   │   └── Context.ts              # Per-request context object
│   ├── logging/
│   │   ├── ILogger.ts              # Logger interface
│   │   └── ConsoleLogger.ts        # Default console implementation
│   ├── middleware/
│   │   ├── LoggerMiddleware.ts     # Logs method + URL per request
│   │   └── AuthMiddleware.ts       # Auth stub — always authorized
│   ├── errors/
│   │   ├── HttpError.ts            # Base HTTP error class
│   │   └── BadRequestError.ts      # 400 error shorthand
│   ├── static/
│   │   ├── MimeTypes.ts            # Extension → MIME type lookup
│   │   ├── StaticFileOptions.ts    # Static file config interface
│   │   └── StaticFileHandler.ts    # File resolution and serving
│   ├── di/                         # Empty — Phase 10 placeholder
│   ├── routing/                    # Empty — planned Router refactor
│   ├── types.ts                    # Middleware, RouteHandler, Route types
│   └── Empire.ts                   # Main framework class
│
├── tests/
│   ├── unit/                       # Vitest unit tests (not yet written)
│   │   ├── logging/
│   │   ├── middleware/
│   │   ├── static/
│   │   └── di/
│   ├── http/
│   │   ├── empire.http             # REST client tests
│   │   └── invalid-json.http
│   └── fixtures/
│       └── static/                 # Static file test assets
│
├── examples/
│   ├── basic-server/               # Original dev server
│   ├── 01-basic-server/            # Hello world
│   ├── 02-routing/                 # Route params and query strings
│   ├── 03-middleware/              # Middleware pipeline
│   ├── 04-static-files/            # Static file serving with wwwroot/
│   └── 05-error-handling/          # HttpError and BadRequestError
│
├── doc/
│   ├── ARCHITECTURE.md             # This file
│   └── PROJECT_STATE.md            # Current status and next steps
│
├── PLAN.md                         # Full phase-by-phase roadmap
├── package.json
└── tsconfig.json
```

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
    │   Each middleware calls next() to continue the chain.
    │   If a middleware does not call next(), the pipeline stops.
    │
    ▼
Empire.handleRoute()
    │
    ├─ Matches method and path segments against registered routes
    ├─ Extracts :param values into ctx.params
    ├─ Creates a Context for the matched route
    ├─ Calls route.handler(ctx)
    │
    ├─ If handler throws HttpError → returns statusCode + message as JSON
    ├─ If handler throws anything else → returns 500 Internal Server Error
    └─ If no route matches → returns 404 Route not found
```

---

## Key Classes

### `Empire` — `src/Empire.ts`

The main entry point. Owns the Node HTTP server, middleware list, and route table.

```ts
new Empire(options: EmpireOptions)
```

| Member | Description |
|--------|-------------|
| `use(middleware)` | Registers a middleware function |
| `useStaticFiles(root)` | Registers static file middleware for a directory |
| `get(path, handler)` | Registers a GET route |
| `post(path, handler)` | Registers a POST route |
| `start()` | Starts the HTTP server — returns Promise |
| `stop()` | Stops the HTTP server — returns Promise |
| `logger` | Returns the ILogger instance |

**Known issue:** Route matching (`matchRoute`) and request dispatch (`handleRoute`)
live inside `Empire.ts`. These will be extracted to `src/routing/` in the router
refactor — see PLAN.md Phase 9 Remaining.

---

### `Context` — `src/http/Context.ts`

Created per request. Wraps `IncomingMessage` and `ServerResponse` with a clean,
typed API. Passed to every route handler and (after the middleware migration) to
every middleware.

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
| `ipAddress` | `string` | Client IP — handles `x-forwarded-for` and IPv6 |

**Response methods:**

| Member | Description |
|--------|-------------|
| `status(code)` | Sets status code — chainable, returns `this` |
| `header(name, value)` | Sets a single response header — chainable |
| `addHeaders(headers)` | Sets multiple response headers — chainable |
| `text(value)` | Sends plain text response |
| `html(value)` | Sends HTML response |
| `json(value)` | Sends JSON response |

**Body methods:**

| Member | Description |
|--------|-------------|
| `body()` | Reads full request body as string |
| `jsonBody()` | Parses JSON body — throws `BadRequestError` on invalid JSON |

**Not yet implemented (required before v1):**
`redirect()`, `file()`, `download()`, `form()`, `cookie()`, `clearCookie()`,
`userAgent`, `contentType`, `accepts()`

---

### `ILogger` — `src/logging/ILogger.ts`

Interface for logging. Injected via `EmpireOptions.logger`. Defaults to
`ConsoleLogger` if not provided.

```ts
interface ILogger {
    info(message: string, ...args: unknown[]): void;
    error(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    debug(message: string, ...args: unknown[]): void;
}
```

---

### `HttpError` — `src/errors/HttpError.ts`

Base class for HTTP errors thrown from route handlers. Empire catches these and
returns the `statusCode` and `message` as a JSON error response automatically.

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

Registered internally by `Empire.useStaticFiles()`. Handles each request before
routing runs.

| Behaviour | Detail |
|-----------|--------|
| Path traversal | Resolves absolute paths and checks `startsWith(root)` — returns 403 if unsafe |
| Directory guard | Uses `stat.isFile()` — directories are never served |
| MIME detection | Delegates to `MimeTypes.getType(extension)` |
| File not found | Returns `false` — middleware chain continues to routing |
| **Not yet implemented** | Streaming, index.html fallback, React Router fallback |

---

### `MimeTypes` — `src/static/MimeTypes.ts`

Static utility class. Maps file extensions to MIME type strings.

```ts
MimeTypes.getType(".html")  // "text/html"
MimeTypes.getType(".xyz")   // "application/octet-stream"
```

Supported extensions: `.html`, `.css`, `.js`, `.json`, `.png`, `.jpg`, `.jpeg`,
`.gif`, `.svg`, `.ico`, `.txt`, `.pdf`, `.woff`, `.woff2`

---

## Middleware

### Current Signature

```ts
type Middleware = (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    next: () => Promise<void>
) => void | Promise<void>;
```

**This signature is being replaced.** See Priority section below.

### Target Signature (v1)

```ts
type Middleware = (
    ctx: Context,
    next: () => Promise<void>
) => void | Promise<void>;
```

### Built-in Middleware

| File | Export | Behaviour |
|------|--------|-----------|
| `src/middleware/LoggerMiddleware.ts` | `LoggerMiddleware` | Logs `METHOD /path` to console |
| `src/middleware/AuthMiddleware.ts` | `AuthMiddleware` | Stub — always authorized |

---

## Types — `src/types.ts`

```ts
type Middleware = (req, res, next) => void | Promise<void>  // pending migration to ctx-based
type RouteHandler = (ctx: Context) => void | Promise<void>

interface Route {
    method: string;
    path: string;
    handler: RouteHandler;
}
```

---

## Route Matching

Routes are matched in registration order. The first match wins.

- Path segments are split on `/` and compared one by one
- Segments starting with `:` are treated as parameters — the value is captured
  into `ctx.params`
- Query strings are stripped before matching (`/users?page=1` matches `/users`)
- Method must match exactly (`GET`, `POST`)

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
| Routing lives in `Empire.ts` | `Empire.ts` has too many responsibilities | Extract to `src/routing/Router.ts` — see PLAN.md Phase 9 |
| Middleware takes `(req, res, next)` not `(ctx, next)` | Inconsistent with route handlers | Breaking change — migrate before v1 |
| Static files read fully into memory | Poor performance for large files | Replace with `fs.createReadStream()` |
| No index.html or React Router fallback | Cannot serve SPAs | Add to `StaticFileHandler` before v1 |
