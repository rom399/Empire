# Empire Framework — Project State

## Current Version

**0.12.0 — Critical Bug Fixes (Regression Test Suite)**

---

## v1.0.0 Blockers

**None remaining.** Every Priority item in PLAN.md is resolved. What's left
before an actual v1.0.0 tag is routing/static test coverage (Phase 9.1),
the 9 open bug-hunt findings (Phase 9.3, below), and the remaining HTTP
verbs (Phase 3) — tracked as normal roadmap work, not release blockers.

---

## Bug Hunt — Regression Test Suite (FINDING 1–13)

Writing test coverage for `Context`, `Router`, `StaticFileHandler`, and
`Empire` (Phase 9.2) surfaced 13 real behavioural bugs, each pinned down
with a `FINDING N` comment in the test that catches it
(`tests/integration/`, plus new files under `tests/unit/`). Full detail —
root cause, fix, files touched — is in PLAN.md Phase 9.3. Summary:

**Fixed (4):**
- FINDING 1 — middleware and route handlers saw two different `Context`
  instances; state attached by middleware was silently lost
- FINDING 3 — a throwing middleware had no error handling, leaving the
  connection hanging instead of returning a response
- FINDING 4 — calling `next()` twice re-dispatched the router against an
  already-sent response instead of erroring
- FINDING 6 — `ctx.body()` re-read the request stream on every call
  instead of caching it, so a second read (e.g. by middleware, then the
  handler) silently returned `""`

**Open (9):** FINDING 2 (static-file path-traversal boundary — defence in
depth, not currently exploitable), 5 (built-in middleware don't
await/return `next()`), 7 (no request body size limit), 8 (`sendFile()`
hangs if the client aborts mid-stream), 9 (HEAD requests to static files
get a full body), 10 (route params not URL-decoded), 11 (no
literal-over-parameter route precedence), 12 (empty path segments like
`//users//1` incorrectly match), 13 (`HttpError` has no `code`/`retryable`
and doesn't set `.name`).

Current test status: **16 of 128 tests fail**, all against the 9 open
findings above — run `npm test` to see them.

Resolved:
- ~~0 — Context API freeze~~ — all v1 Context members implemented
- ~~1 — Middleware signature migration~~ — `(ctx, next)` signature in place across types, middleware and examples
- ~~2 — `ctx.form()` body parsing~~ — implemented
- ~~3 — Static files API decision~~ — `useStaticFiles(root)` confirmed, ASP.NET Core style
  (mirrors `app.UseStaticFiles()`) per CONTRIBUTING.md conventions. Express-style
  `static(prefix, root)` rejected — no prefix mounting requirement, and keeping
  `useStaticFiles` avoids a breaking rename. Current `Empire.ts` signature already
  matches; no code change required.
  - Follow-up: `useStaticFiles(root, options?)` now accepts an optional
    `{ prefix }` (`UseStaticFilesOptions`), letting multiple static folders
    be mounted at different URL prefixes on the same server — additive,
    existing single-argument calls are unaffected. `StaticFileHandler`
    checks and strips the prefix before resolving files; `StaticFileOptions`
    gained a matching optional `prefix` field.
- ~~4 — Router refactor~~ — routing extracted into `src/routing/` (`Route`,
  `RouteMatch`, `RouteMatcher`, `Router`). `Empire.ts` now only owns server
  lifecycle, middleware, and delegates routing to a `Router` instance.
- ~~0b — React application support~~ — `StaticFileHandler` now streams files
  via `fs.createReadStream()` instead of reading them fully into memory, and
  falls back to an `index.html` inside a matched directory. `MimeTypes` gained
  `.ttf`, `.eot`, `.map`. SPA/React Router fallback needed a `Router` change
  rather than a `StaticFileHandler` change — middleware runs before routing,
  so static middleware can't know whether a later route will match the same
  path. `Router.setFallback(handler)` runs (GET requests only, to avoid
  masking wrong-method API errors as 200s) when no route matches, and
  `useStaticFiles(root, { spaFallback: true })` wires it to serve
  `root/index.html`. See `examples/06-react-app` for the full behaviour set.

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

### Phase 3 — Routing ✅ (GET, POST, and HEAD; PUT/PATCH/DELETE/OPTIONS still open)
- Route table with registration order matching, owned by `Router` (`src/routing/`)
- `app.get()` and `app.post()` — delegate to `Router.get()`/`Router.post()`
- `RouteMatcher` — segment-based path matching, extracted from `Empire.ts`
- Route parameters via `:name` syntax → `ctx.params`
- 404 response when no route matches any registered path
- 405 response with an `Allow` header (listing the path's valid methods) when
  the path matches but the method doesn't — RFC 9110 §9.2.2 compliance fix,
  previously returned 404 for this case
- HEAD requests are auto-dispatched to the matching GET handler with the
  response body discarded before it reaches the client, while headers
  (Content-Type, Content-Length, etc.) are left exactly as GET would set
  them — RFC 9110 §9.3.2. `Allow` headers include `HEAD` alongside `GET`
  wherever a GET route exists.

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

### Phase 7 — Static Files ✅
- `app.useStaticFiles(root, options?)` — registers static file middleware.
  Optional `{ prefix }` mounts the folder under a URL prefix. Optional
  `{ spaFallback }` serves `root/index.html` for any GET request that
  matches neither a file nor a route
- Multiple `useStaticFiles()` calls with different prefixes can be mounted
  on the same server — each handler falls through if its prefix doesn't match
- `MimeTypes` — 17 extension mappings (added `.ttf`, `.eot`, `.map` for full
  React build output coverage), fallback to `application/octet-stream`
- `StaticFileHandler` — resolves and serves files, strips prefix before
  resolving, streams via `fs.createReadStream()`, falls back to an
  `index.html` inside a matched directory
- Path traversal protection — 403 on escape attempt
- Falls through to routing when file not found; `Router.setFallback()`
  (GET only) serves the SPA shell if routing also finds no match

### Phase 8 — Developer Experience ✅ (partial)
- Six numbered example applications (ports 8001–8006)
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

### Phase 9.1 — Routing Test Coverage ✅ (unit tests only — examples not yet added)
- `vitest` added as a dev dependency, `npm test` runs `vitest run`
- `tests/fixtures/services/TestLogger.ts` — in-memory `ILogger` for tests
- `tests/fixtures/http/MockHttp.ts` — minimal `http.IncomingMessage` /
  `http.ServerResponse` stand-ins for testing `Router` without a real socket
- `tests/unit/routing/RouteMatcher.test.ts` — 7 cases
- `tests/unit/routing/Router.test.ts` — 13 cases, including 4 for
  `setFallback()`
- `Route.test.ts` / `RouteMatch.test.ts` — deliberately skipped, plain
  interfaces with no behavior
- Runs directly via `npm test` / `npx vitest run` — the earlier sandbox
  restriction on `npm install` no longer applies. (These 20 cases, plus
  everything added since in Phase 9.2 and 9.3, run as part of the same
  128-test suite.)
- Still open: the Examples/Test Fixtures items in PLAN.md Phase 9.1 (a
  multi-param route example, an overlapping-route example, and
  corresponding `.http` requests) — not part of unit test coverage, not
  yet started

---

## What Is Incomplete

No v1.0.0 blockers remain. Outstanding roadmap work not gating v1.0.0:
- Phase 3 — PUT/PATCH/DELETE/OPTIONS routes (HEAD is done), route groups,
  wildcards
- Phase 9.1 — routing example additions (multi-param, overlapping routes)
  and their `.http` requests
- Phase 9.3 — 9 open bug-hunt findings; see "Bug Hunt" above and PLAN.md
  Phase 9.3 for full detail on each

---

## Next Major Milestone — Phase 10: Dependency Injection

All v1.0.0 blockers are resolved, so Phase 10 can begin. Phase 9.1 (test
coverage) is recommended first, since DI will sit on top of `Router` and
benefits from a tested foundation underneath it — but it isn't a hard
prerequisite.

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
