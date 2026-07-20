# Empire Framework — Project State

## Current Version

**0.9.0 — Router Refactor Complete**

---

## v1.0.0 Blockers

These items must be complete before v1.0.0 is released.
None of these are large in scope — they are gaps or API corrections.

| # | Item | Files |
|---|------|-------|
| 0b | React application support — SPA fallback and file streaming | `src/static/StaticFileHandler.ts` |

Resolved:
- ~~0 — Context API freeze~~ — all v1 Context members implemented
- ~~1 — Middleware signature migration~~ — `(ctx, next)` signature in place across types, middleware and examples
- ~~2 — `ctx.form()` body parsing~~ — implemented
- ~~3 — Static files API decision~~ — `useStaticFiles(root)` confirmed, ASP.NET Core style
  (mirrors `app.UseStaticFiles()`) per CONTRIBUTING.md conventions. Express-style
  `static(prefix, root)` rejected — no prefix mounting requirement, and keeping
  `useStaticFiles` avoids a breaking rename. Current `Empire.ts` signature already
  matches; no code change required.
- ~~4 — Router refactor~~ — routing extracted into `src/routing/` (`Route`,
  `RouteMatch`, `RouteMatcher`, `Router`). `Empire.ts` now only owns server
  lifecycle, middleware, and delegates routing to a `Router` instance.

---

## What Is Complete

### Phase 1 — Foundation ✅
- HTTP server on configurable host and port
- Promise-based `start()` and `stop()`
- Graceful shutdown on `SIGINT`
- `ILogger` interface and `ConsoleLogger` implementation
- Logger injection via `EmpireOptions`

### Phase 2 — Middleware ✅
- `(ctx, next)` Context-based signature
- `Middleware` type definition
- `app.use()` registration
- Async middleware pipeline with `await next()`
- `LoggerMiddleware` — logs method and URL
- `AuthMiddleware` — stub, always authorized

### Phase 3 — Routing ✅ (GET and POST only)
- Route table with registration order matching, owned by `Router` (`src/routing/`)
- `app.get()` and `app.post()` — delegate to `Router.get()`/`Router.post()`
- `RouteMatcher` — segment-based path matching, extracted from `Empire.ts`
- Route parameters via `:name` syntax → `ctx.params`
- 404 response when no route matches

### Phase 4 — Context ✅ (API frozen for v1)
- `Context` class wrapping `IncomingMessage` and `ServerResponse`
- `ctx.req`, `ctx.res`, `ctx.method`, `ctx.path`
- `ctx.query` — `URLSearchParams`
- `ctx.params` — route parameters
- `ctx.headers` — incoming request headers
- `ctx.ipAddress` — resolves client IP, handles proxies and IPv6
- `ctx.userAgent`, `ctx.contentType` — request header shorthands
- `ctx.accepts(type)` — Accept header check with wildcard support
- `ctx.status()`, `ctx.header()`, `ctx.addHeaders()` — chainable
- `ctx.text()`, `ctx.html()`, `ctx.json()` — response helpers
- `ctx.redirect(url, status?)` — redirect response, defaults to 302
- `ctx.file(path)` — serve a file from a route handler (streamed)
- `ctx.download(path, filename?)` — force download via Content-Disposition
- `ctx.cookie(name, value, options?)`, `ctx.clearCookie(name)` — cookies via `CookieOptions`

Post-v1 only (requires DI):
- `ctx.services` — `ServiceProvider` per request

### Phase 5 — Request Bodies ✅
- `ctx.body()` — full body as string
- `ctx.jsonBody()` — JSON parse with automatic `BadRequestError` on failure
- `ctx.form()` — `application/x-www-form-urlencoded` parse with Content-Type check

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

### Phase 9 — Project Structure ✅
- Project renamed to `empire`
- `src/http/`, `src/errors/`, `src/middleware/`, `src/static/`, `src/logging/`
- `src/routing/` — `Route`, `RouteMatch`, `RouteMatcher`, `Router`
- `src/di/` placeholder directory, ready for Phase 10
- `tests/unit/`, `tests/http/`, `tests/fixtures/`
- `doc/` directory with architecture and state documents

---

## What Is Incomplete

### v1.0.0 — Static file gaps

Note: `ctx.file()` and `ctx.download()` already stream via `fs.createReadStream()`;
the gaps below apply to `StaticFileHandler` middleware only.

| Item | File |
|------|------|
| Stream files via `fs.createReadStream()` | `src/static/StaticFileHandler.ts` |
| Index.html fallback for directory requests | `src/static/StaticFileHandler.ts` |
| React Router fallback — serve root `index.html` for unmatched paths | `src/static/StaticFileHandler.ts` |
| Verify MIME types cover React build output (`.map`, `.ttf`, `.eot`) | `src/static/MimeTypes.ts` |

This is now the only remaining v1.0.0 blocker.

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
