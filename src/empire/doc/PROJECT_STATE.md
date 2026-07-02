# Empire Framework — Project State

## Current Version

**0.7.0 — Static Files Complete**

---

## v1.0.0 Blockers

These items must be complete before v1.0.0 is released.
None of these are large in scope — they are gaps or API corrections.

| # | Item | Files |
|---|------|-------|
| 0 | Context API freeze — implement all v1 Context members | `src/http/Context.ts` |
| 0b | React application support — SPA fallback and file streaming | `src/static/StaticFileHandler.ts` |
| 1 | Middleware signature migration to `(ctx, next)` | `src/types.ts`, `src/Empire.ts`, middleware files, examples |
| 2 | `ctx.form()` body parsing not implemented | `src/http/Context.ts` |
| 3 | Static files API decision — `useStaticFiles(root)` vs `static(prefix, root)` | `src/Empire.ts`, `src/static/` |
| 4 | Router refactor — extract routing out of `Empire.ts` | New `src/routing/` package |

---

## What Is Complete

### Phase 1 — Foundation ✅
- HTTP server on configurable host and port
- Promise-based `start()` and `stop()`
- Graceful shutdown on `SIGINT`
- `ILogger` interface and `ConsoleLogger` implementation
- Logger injection via `EmpireOptions`

### Phase 2 — Middleware ✅ (signature migration pending)
- `Middleware` type definition
- `app.use()` registration
- Async middleware pipeline with `await next()`
- `LoggerMiddleware` — logs method and URL
- `AuthMiddleware` — stub, always authorized

### Phase 3 — Routing ✅ (GET and POST only)
- Route table with registration order matching
- `app.get()` and `app.post()`
- Segment-based path matching
- Route parameters via `:name` syntax → `ctx.params`
- 404 response when no route matches

### Phase 4 — Context ✅ (partial — v1 members pending)
- `Context` class wrapping `IncomingMessage` and `ServerResponse`
- `ctx.req`, `ctx.res`, `ctx.method`, `ctx.path`
- `ctx.query` — `URLSearchParams`
- `ctx.params` — route parameters
- `ctx.headers` — incoming request headers
- `ctx.ipAddress` — resolves client IP, handles proxies and IPv6
- `ctx.status()`, `ctx.header()`, `ctx.addHeaders()` — chainable
- `ctx.text()`, `ctx.html()`, `ctx.json()` — response helpers

### Phase 5 — Request Bodies ✅ (form() pending)
- `ctx.body()` — full body as string
- `ctx.jsonBody()` — JSON parse with automatic `BadRequestError` on failure

### Phase 6 — Error Handling ✅
- `HttpError(statusCode, message)` — base class
- `BadRequestError(message)` — status 400 shorthand
- Route handlers catch `HttpError` and return correct status + JSON body
- Unhandled errors return 500 with generic message
- Server survives exceptions and continues running

### Phase 7 — Static Files ✅ (streaming and fallback pending)
- `app.useStaticFiles(root)` — registers static file middleware
- `MimeTypes` — 14 extension mappings, fallback to `application/octet-stream`
- `StaticFileHandler` — resolves and serves files
- Path traversal protection — 403 on escape attempt
- Falls through to routing when file not found

### Phase 8 — Developer Experience ✅ (partial)
- Five numbered example applications (ports 8001–8005)
- `npm start` script
- `.npmignore`
- REST client test files

### Phase 9 — Project Structure ✅ (router refactor pending)
- Project renamed to `empire`
- `src/http/`, `src/errors/`, `src/middleware/`, `src/static/`, `src/logging/`
- `src/di/` and `src/routing/` placeholder directories
- `tests/unit/`, `tests/http/`, `tests/fixtures/`
- `doc/` directory with architecture and state documents

---

## What Is Incomplete

### v1.0.0 — Context API members not yet implemented

These must be added to `src/http/Context.ts` before v1:

| Member | Description |
|--------|-------------|
| `ctx.redirect(url, status?)` | Redirect response |
| `ctx.file(path)` | Serve a file from a route handler |
| `ctx.download(path, filename?)` | Force download via Content-Disposition |
| `ctx.userAgent` | User-Agent header shorthand |
| `ctx.contentType` | Content-Type of incoming request |
| `ctx.accepts(type)` | Check accepted response types |
| `ctx.cookie(name, value, options?)` | Set a response cookie |
| `ctx.clearCookie(name)` | Clear a cookie |
| `ctx.form()` | Parse `application/x-www-form-urlencoded` body |

Post-v1 only (requires DI):
- `ctx.services` — `ServiceProvider` per request

### v1.0.0 — Static file gaps

| Item | File |
|------|------|
| Stream files via `fs.createReadStream()` | `src/static/StaticFileHandler.ts` |
| Index.html fallback for directory requests | `src/static/StaticFileHandler.ts` |
| React Router fallback — serve root `index.html` for unmatched paths | `src/static/StaticFileHandler.ts` |
| Verify MIME types cover React build output (`.map`, `.ttf`, `.eot`) | `src/static/MimeTypes.ts` |

### v1.0.0 — Middleware migration

Current signature:
```ts
(req: IncomingMessage, res: ServerResponse, next: () => Promise<void>) => void
```

Target signature:
```ts
(ctx: Context, next: () => Promise<void>) => void | Promise<void>
```

Files requiring changes:
- `src/types.ts`
- `src/Empire.ts` — `handleRequest()`
- `src/middleware/LoggerMiddleware.ts`
- `src/middleware/AuthMiddleware.ts`
- `examples/03-middleware/server.ts`
- All examples using `app.use()`

### v1.0.0 — Router refactor

`Empire.ts` currently owns route matching and dispatch. This must be extracted
into `src/routing/` before v1.

Files to create:
- `src/routing/Route.ts`
- `src/routing/RouteMatch.ts`
- `src/routing/RouteMatcher.ts`
- `src/routing/Router.ts`

---

## Next Major Milestone — Phase 10: Dependency Injection

Cannot begin until all v1.0.0 blockers are resolved.

Target API:
```ts
app.services.addSingleton(ILogger, ConsoleLogger);
app.services.addTransient(IUserService, UserService);

const logger = app.services.resolve(ILogger);
```

Files to create in `src/di/`:
- `ServiceLifetime.ts` — enum: `Singleton`, `Transient`, `Scoped`
- `ServiceDescriptor.ts` — holds token, implementation, lifetime
- `ServiceCollection.ts` — `addSingleton()`, `addTransient()`, `addScoped()`
- `ServiceProvider.ts` — `resolve()`, singleton cache

---

## Planned Phases (not started)

| Phase | Name | Key Goal |
|-------|------|----------|
| 10 | Dependency Injection | `app.services` container |
| 11 | Validation | Body, query, and param validation with auto-400 |
| 12 | Authentication | JWT, bearer tokens, roles, policies |
| 13 | Configuration | appsettings.json, env vars, options pattern |
| 14 | Controllers | Decorator-based routing |
| 15 | Advanced DI | Constructor injection, circular dependency detection |
| 16 | HTTP Features | CORS, compression, file uploads |
| 17 | Testing | Vitest unit and integration tests |
| 18 | Advanced Features | WebSockets, SSE, health checks, OpenAPI |

---

## Repository Layout

```
D:/dev/ROM/
└── src/
    └── empire/          ← project root
        ├── src/         ← framework source
        ├── examples/    ← numbered example apps
        ├── tests/       ← unit, http, fixtures
        └── doc/         ← architecture and state docs
```

Git repository root: `D:/dev/ROM`
Project root: `D:/dev/ROM/src/empire`
Branch: `master`
