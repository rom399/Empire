# Empire Framework — Architecture

## Overview

Empire is a lightweight TypeScript HTTP web framework built from scratch on Node's
built-in `http` module. Routing, middleware, the HTTP layer, the DI container and the
load balancer are all zero-dependency, and so is `src/validation/` (Phase 11): it
accepts any Standard Schema validator (Zod, Valibot, ArkType or a hand-written one), so the
validator is the application's own dependency, never Empire's - see
`doc/features/03_Request_Validation.md` for the design.
The design is inspired by ASP.NET Core — middleware pipelines, dependency
injection, strongly-typed context, and a clean separation of concerns.

Current version: **0.17.0 — CORS (C-1 through C-11 complete)**. See
`PLAN.md` for the full phase-by-phase roadmap and this doc's "Upcoming
Features" section below for what's next. No v1.0.0 blockers remain.

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
| Constructor injection | Dependencies (e.g. `ILogger`) are passed into constructors, never reached for via a service locator. |

---

## Directory Structure

```
empire/
├── src/
│   ├── http/
│   │   ├── Context.ts              # Per-request context object — API frozen for v1
│   │   ├── CookieOptions.ts        # Options for ctx.cookie()
│   │   ├── streamFile.ts           # Shared fs.createReadStream()-to-response streaming logic
│   │   └── suppressResponseBody.ts # Discards a response body for HEAD requests
│   ├── logging/
│   │   ├── ILogger.ts              # Logger interface
│   │   └── ConsoleLogger.ts        # Default console implementation
│   ├── middleware/
│   │   ├── LoggerMiddleware.ts     # createLoggerMiddleware(logger) factory
│   │   ├── CorsOptions.ts          # CORS config interface (Phase 16) — see
│   │   │                           # doc/features/04_CORS_Compliance.md for the full design
│   │   ├── CorsPolicy.ts           # One { match, options } entry in a multi-policy CorsConfig
│   │   ├── CorsConfig.ts           # CorsOptions | { policies, fallback? }
│   │   ├── CorsMiddleware.ts       # createCorsMiddleware() — origin/preflight/credentials/Vary
│   │   └── RouteHeaderMiddleware.ts # createRouteHeaderMiddleware() — X-Empire-Route, the matched
│   │                               # route template, for a load balancer in front of this app
│   ├── errors/
│   │   ├── HttpError.ts            # Base HTTP error class
│   │   ├── HttpErrorOptions.ts     # { code?, retryable? } accepted by HttpError's constructor
│   │   ├── BadRequestError.ts      # 400 error shorthand
│   │   ├── ValidationError.ts      # BadRequestError + structured field-level details (Phase 11)
│   │   ├── ValidationIssue.ts      # { field, message } - one entry in ValidationError.details
│   │   └── sendErrorResponse.ts    # Converts a thrown error into a JSON error response
│   ├── static/
│   │   ├── MimeTypes.ts            # Extension → MIME type lookup, 17 extensions
│   │   ├── StaticFileOptions.ts    # Static file config interface (root, prefix?)
│   │   ├── UseStaticFilesOptions.ts # { prefix?, spaFallback? } accepted by Empire.useStaticFiles()
│   │   └── StaticFileHandler.ts    # File resolution, prefix matching, streaming, index.html fallback
│   ├── routing/
│   │   ├── Route.ts                # A single registered route (method, path, handler)
│   │   ├── RouteMatch.ts           # Result of matching a route against a request path
│   │   ├── RouteMatcher.ts         # Segment-based path matching, extracts :params
│   │   └── Router.ts               # Route registration and request dispatch
│   ├── di/                         # Dependency injection container (Phase 10) — see
│   │   │                           # doc/features/02_Dependency_Injection.md for the full design
│   │   ├── ServiceToken.ts         # Symbol-based token type + createToken()
│   │   ├── Lifetime.ts             # Singleton / Scoped / Transient enum
│   │   ├── Resolver.ts             # resolve<T>(token): Promise<T> contract
│   │   ├── Factory.ts              # (resolver) => T | Promise<T>
│   │   ├── ServiceDescriptor.ts    # token + lifetime + factory bundle
│   │   ├── ServiceCollection.ts    # addSingleton/addScoped/addTransient, build()
│   │   ├── ServiceProvider.ts      # Root container — resolve(), createScope(), dispose()
│   │   ├── ServiceScope.ts         # Per-request scope — resolve(), dispose()
│   │   └── Disposable.ts           # Disposable interface + isDisposable() type guard
│   ├── validation/                 # Schema-based validation (Phase 11) — see
│   │   │                           # doc/features/03_Request_Validation.md for the full design
│   │   ├── validate.ts             # Wraps a handler with body/query/params validation
│   │   ├── ValidationSchemas.ts    # { body?, query?, params? } Standard Schema validators accepted by validate()
│   │   ├── Validated.ts            # { body, query, params } passed to the wrapped handler
│   │   ├── formatIssueField.ts     # Turns a validator's issue path into "body.user.tags.0"
│   │   └── standard/               # StandardSchemaV1 and its supporting types - copied from the
│   │                               # spec (standardschema.dev), so no package dependency is needed
│   ├── loadbalancing/              # Layer-7 load balancer (Phase 23) — see
│   │   │                           # doc/features/05_Loadbalancer_Core_L7.md for the full design
│   │   ├── Backend.ts, BackendInfo.ts # What a backend is - shared by everything below
│   │   ├── isLoopbackAddress.ts    # Peer-address check shared by registration/ and dashboard/
│   │   ├── backends/               # Who is eligible
│   │   │   ├── BackendRegistry.ts  # Leases, static pins, expiry sweep (+ BackendRegistryOptions)
│   │   │   └── backendIdentity.ts  # Backend id pattern, URL normalising
│   │   ├── strategy/               # How a backend is chosen
│   │   │   ├── ILoadBalancingStrategy.ts # The seam
│   │   │   ├── RoundRobinStrategy.ts     # The default
│   │   │   └── LeastConnectionsStrategy.ts # Fewest requests in flight; ties rotate (+ IInFlightSource)
│   │   ├── proxy/                  # The request path
│   │   │   ├── LoadBalancerMiddleware.ts # createLoadBalancerMiddleware() - the terminal middleware
│   │   │   ├── forwardRequest.ts   # Streams one request to a backend; failure mapping; events
│   │   │   ├── hopByHopHeaders.ts  # stripHopByHopHeaders() - RFC 9110 §7.6.1, both directions
│   │   │   └── ...                 # ILoadBalancerMiddleware, LoadBalancerOptions,
│   │   │                           # ForwardRequestOptions, resolveRequestId
│   │   ├── registration/           # Backends announcing themselves
│   │   │   ├── BackendRegistrationEndpoint.ts # PUT/DELETE/GET, token + loopback guard (balancer side)
│   │   │   ├── validateRegistrationRequest.ts # Hand-written id/url validation; reports every problem at once
│   │   │   ├── LoadBalancerRegistration.ts    # register, heartbeat, deregister (backend side)
│   │   │   └── ...                 # their options types, LoadBalancerRegistrationError
│   │   ├── monitoring/             # Events and the numbers derived from them
│   │   │   ├── LoadBalancerMonitor.ts # Typed event source + bounded per-backend/per-route stats
│   │   │   ├── LatencyHistogram.ts, BackendStatsTracker.ts, RouteStatsTracker.ts
│   │   │   ├── normalizePath.ts    # Guesses a route template when the backend reports none
│   │   │   └── ...                 # LoadBalancerEvent and the snapshot/detail types
│   │   └── dashboard/              # Serving the visualiser
│   │       ├── LoadBalancerDashboard.ts # Page, SSE stream, backend detail JSON, local three.js
│   │       ├── DashboardSseClient.ts    # One tab's stream: drops request events, never topology ones
│   │       └── page/               # The client as one HTML string
│   │           └── dashboardPage.ts # (+ dashboardStyles, dashboardOverlayScript, dashboardSceneScript)
│   ├── types.ts                    # Middleware, RouteHandler types
│   ├── index.ts                    # Public barrel export - what "empire-ts" resolves to; omits
│   │                                # internals (Router, RouteMatcher, StaticFileHandler, MimeTypes,
│   │                                # sendErrorResponse) a consumer never touches directly
│   └── Empire.ts                   # Main framework class — server lifecycle, middleware, delegates routing to Router
│
├── tests/
│   ├── unit/                       # Vitest unit tests — run via `npm test`
│   │   ├── Empire.test.ts          # Server lifecycle, routing delegation, graceful shutdown
│   │   ├── routing/                # Router, RouteMatcher, RouterEdgeCases (FINDING 10-12)
│   │   ├── http/                   # Context, ContextBody (FINDING 6-7)
│   │   ├── errors/                 # HttpError (FINDING 13), BadRequestError, ValidationError,
│   │   │                           # sendErrorResponse
│   │   ├── static/                 # StaticFileHandler (FINDING 2, 9)
│   │   ├── logging/
│   │   ├── middleware/             # BuiltInMiddleware (FINDING 5), CorsMiddleware (Phase 16)
│   │   ├── di/                     # ServiceCollection, ServiceProvider, ServiceScope, ServiceToken
│   │   └── validation/             # validate() - body/query/params, pass and failure cases; formatIssueField;
│   │                               # type-level tests for the copied StandardSchemaV1
│   ├── integration/                # Real-server tests: ContextSharing, MiddlewarePipeline,
│   │                                # RequestBody, FileStreaming (FINDING 1, 3, 4, 6-8),
│   │                                # DependencyInjection, ExampleAuth, HttpVerbs,
│   │                                # MalformedRequestPath, RoutingPatterns, Validation — see
│   │                                # PLAN.md Phase 9.3
│   ├── http/
│   │   ├── empire.http             # REST client tests
│   │   ├── routing.http            # One request per route, plus 404/HEAD/405+Allow cases
│   │   └── invalid-json.http
│   └── fixtures/
│       ├── static/                 # Static file test assets
│       ├── services/                # TestLogger.ts — in-memory ILogger for tests
│       ├── http/                    # MockHttp.ts — IncomingMessage/ServerResponse stand-ins
│       └── validation/              # schemas.ts — hand-written Standard Schema validators (objectSchema,
│                                    # stringField, numberField, ...) standing in for a validation library
│
├── examples/                       # For developers extending Empire itself - imports the
│   │                                # source tree directly ("../../src/Empire"), so these run
│   │                                # against the code as currently written, not a published version
│   ├── 01-basic-server/            # Hello world
│   ├── 02-routing/                 # Route params (single and multi-segment), query
│   │                                # strings, overlapping literal/param routes
│   ├── 03-middleware/              # Middleware pipeline
│   ├── 04-static-files/            # Static file serving — unprefixed wwwroot/ and prefixed uploads/
│   ├── 05-error-handling/          # HttpError and BadRequestError
│   ├── 06-react-app/               # SPA support — spaFallback, streaming, index.html fallback, API routes
│   ├── 07-body-size-limit/         # Configurable request body size limit, 413 on oversized bodies
│   ├── 08-authentication/          # Writing your own auth middleware — Bearer tokens, ctx.state
│   ├── 09-dependency-injection/    # DI container wired into a real app — singleton repository,
│   │                                # scoped service calling a real HTTP endpoint via ctx.services
│   ├── 10-validation/              # validate() wired into real routes — body, query
│   │                                # (with coercion), and route param validation
│   ├── 11-cors/                    # createCorsMiddleware() — allowed vs. disallowed origin,
│   │                                # a preflight with credentials, a stricter multi-policy
│   └── 12-load-balancer/           # server.ts (balancer + dashboard), backend.ts (a self-registering
│                                    # backend), traffic.ts (request generator); not mirrored in package-example
│
├── package-example/                # For people who just want to use the empire-ts npm package -
│   │                                # imports "empire-ts", installed from a real `npm pack`
│   │                                # tarball rather than the source tree. Own package.json,
│   │                                # tsconfig.json, package-lock.json - a genuinely standalone project
│   ├── examples/                   # Mirrors examples/ above 1:1 - same behavior, same routes,
│   │   │                           # only the import changed to "empire-ts" and each port
│   │   │                           # shifted by 1000 so both sets can run side by side
│   │   ├── 01-basic-server/        # port 9001
│   │   ├── 02-routing/             # port 9002
│   │   ├── 03-middleware/          # port 9003
│   │   ├── 04-static-files/        # port 9004 - own copies of wwwroot/ and uploads/ fixtures
│   │   ├── 05-error-handling/      # port 9005
│   │   ├── 06-react-app/           # port 9006 - own copy of the dist/ fixture
│   │   ├── 07-body-size-limit/     # port 9007
│   │   ├── 08-authentication/      # port 9008
│   │   ├── 09-dependency-injection/ # port 9009
│   │   ├── 10-validation/          # port 9010
│   │   └── 11-cors/                # port 9011
│   └── full-featured.ts            # port 9012 - bonus, not a mirror: DI + logger/CORS middleware +
│                                    # request body checking + HttpError combined in one app
│
├── doc/
│   ├── ARCHITECTURE.md             # This file
│   └── features/                   # One doc per in-flight or completed feature build,
│                                    # linked from README_DEVELOPMENT.MD and README.MD rather
│                                    # than duplicated into them
│       ├── 00-template-blueprint.md   # The master template every feature doc below follows
│       ├── 01_Core_Routing_Pipeline.md # Core: request lifecycle, middleware pipeline, Router, Context,
│       │                               # errors, request bodies, static files and SPA fallback, build steps
│       ├── 02_Dependency_Injection.md # Full DI design: tokens, lifetimes, scoping, disposal,
│       │                              # graceful shutdown, build steps and tests
│       ├── 03_Request_Validation.md # Full validation design: validate() over Standard Schema, the
│       │                            # ValidationError response, dropping Zod, build steps and tests
│       ├── 04_CORS_Compliance.md   # Full CORS design: preflight vs. Router's existing OPTIONS
│       │                            # handling, credentials/wildcard guard, multi-policy, build steps and tests
│       ├── 05_Loadbalancer_Core_L7.md  # Load balancer core: leases, strategy seam, streaming proxy,
│       │                               # route templates, the 3D dashboard, round robin
│       └── 06_Loadbalancer_Least_Conn.md # Least connections: the in-flight source, the one-monitor guard
│
├── scripts/
│   └── run-examples.ts             # Smoke-tests every examples/ app — run via `npm run examples`,
│                                    # part of `npm run verify` and CI
├── .claude/skills/                 # commit-message, empire-feature, empire-npm-readme, empire-review
├── CLAUDE.md                       # Always-true facts only — loads every agent turn
├── PLAN.md                         # Full phase-by-phase roadmap
├── CONTRIBUTING.md                 # Contribution conventions
├── README.MD                       # The npm package's own README - what npm bundles for empire-ts
├── README_DEVELOPMENT.MD           # The full framework walkthrough - this repo's real front door
├── CHANGELOG.md                    # Version history, bundled with the npm package
├── LICENSE                         # MIT, bundled with the npm package (copied from the repo root)
├── package.json
├── tsconfig.json                   # Whole-repo typecheck - src/, examples/, and scripts/ together
├── tsconfig.build.json             # Scoped package build - src/ only, emits dist/
├── .npmignore                      # Predates the "files" allowlist in package.json; now redundant -
│                                    # everything it excludes is already outside "files"
├── .gitignore
└── dist/                           # Build output (git-ignored) - what npm actually ships
```

CI (`.github/workflows/ci.yml`) and Dependabot (`.github/dependabot.yml`)
config live at the git repo root (`D:/dev/ROM/.github/`), one level above
`empire/` — not shown in the tree above since it sits outside the project
root this document describes. CI runs `npm ci` then `npm run verify`
(scoped to `src/empire`) on every push to `main` and every pull request —
the same command a contributor runs locally, chaining `tsc --noEmit`,
`vitest run`, and `scripts/run-examples.ts` (smoke-tests every example in
`examples/`: starts each one, confirms it responds to a real request,
then shuts it down via the same `SIGINT` its own handler listens for).
Dependabot opens weekly update PRs for npm dependencies and for the
Actions versions the workflow pins.

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
    │   Each middleware gets its own one-shot next() to continue the
    │   chain — calling it twice throws "next() called multiple times"
    │   rather than silently re-dispatching. If a middleware does not
    │   call next(), the pipeline stops. A throwing middleware is caught
    │   by the same try/catch Router uses for route handlers, mapping
    │   HttpError to its status and anything else to 500, instead of
    │   leaving the connection hanging.
    │   useStaticFiles() registers itself here too — each mounted
    │   folder is its own middleware, falling through when its
    │   prefix (if any) doesn't match or the file isn't found.
    │
    ▼
Router.handle()
    │
    ├─ Matches method and path segments against registered routes (via RouteMatcher)
    ├─ Extracts :param values into ctx.params
    ├─ Reuses the Context Empire built for the middleware chain — the same
    │  instance middleware saw, so anything attached to it survives
    ├─ Calls route.handler(ctx)
    │
    ├─ If handler throws HttpError → returns statusCode + message as JSON
    ├─ If handler throws anything else → returns 500 Internal Server Error
    ├─ If no route matches, and a GET fallback is registered → calls it
    │  (SPA support — see "SPA / React Router Fallback" below)
    └─ If no route matches, and no fallback applies → returns 404 Route not found
```

`Empire.ts` no longer performs route matching or dispatch itself — that was
extracted into `Router` (see below). `Empire.ts`'s only responsibilities are
server lifecycle (`start()`/`stop()`), the middleware pipeline, and delegating
requests to `Router`.

---

## Key Classes

### `Empire` — `src/Empire.ts`

The main entry point. Owns the Node HTTP server, the middleware list, and a
`Router` instance.

```ts
new Empire(options: EmpireOptions)
```

| Member | Description |
|--------|-------------|
| `use(middleware)` | Registers a middleware function |
| `useStaticFiles(root, options?)` | Registers static file middleware for a directory. Optional `{ prefix }` mounts it under a URL prefix — see "Static Files API" below. Optional `{ spaFallback: true }` registers `root/index.html` as the router's fallback — see "SPA / React Router Fallback" below |
| `get(path, handler)` | Registers a GET route — delegates to `router.get()` |
| `post(path, handler)` | Registers a POST route — delegates to `router.post()` |
| `put(path, handler)` | Registers a PUT route — delegates to `router.put()` |
| `patch(path, handler)` | Registers a PATCH route — delegates to `router.patch()` |
| `delete(path, handler)` | Registers a DELETE route — delegates to `router.delete()` |
| `options(path, handler)` | Registers an explicit OPTIONS route — delegates to `router.options()`. Optional; see `Router.handle()` below for the automatic OPTIONS response when no explicit handler is registered |
| `start()` | Starts the HTTP server — returns Promise |
| `stop()` | Stops the HTTP server — returns Promise |
| `logger` | Returns the ILogger instance |

`Router` is constructed in `Empire`'s constructor and injected with the
resolved `ILogger`, per the constructor-injection convention.

---

### `Router` — `src/routing/Router.ts`

Owns route registration and request dispatch. Extracted out of `Empire.ts`
so that server lifecycle, middleware, and routing are separate concerns.
Constructor-injected with `ILogger` — never reaches back into `Empire`.

```ts
new Router(logger: ILogger)
```

| Member | Description |
|--------|-------------|
| `get(path, handler)` | Registers a handler for GET requests |
| `post(path, handler)` | Registers a handler for POST requests |
| `put(path, handler)` | Registers a handler for PUT requests |
| `patch(path, handler)` | Registers a handler for PATCH requests |
| `delete(path, handler)` | Registers a handler for DELETE requests |
| `options(path, handler)` | Registers a handler for OPTIONS requests. Optional — any path with at least one other method registered already answers OPTIONS automatically (204 + `Allow` header, RFC 9110 §9.3.7) without one; register a handler here only for custom behaviour (e.g. CORS preflight), which always takes priority over the automatic response |
| `setFallback(handler)` | Registers a handler invoked instead of the plain-text 404 when no route matches a **GET** request — see "SPA / React Router Fallback" below. Only one fallback can be registered; a later call replaces the previous one |
| `handle(req, res, ctx?)` | Matches the request against registered routes (first match wins) and invokes the handler, converting thrown errors into the correct response. HEAD dispatches to the matching GET handler; OPTIONS with no explicit handler gets the automatic 204 response described above. Falls back to the registered fallback (GET only), a 405 + `Allow` when the path matches under a different method, or 404, when nothing matches. `ctx` is optional — when `Empire` supplies the `Context` it already built for the middleware chain, `handle()` reuses that exact instance (attaching matched params to it) instead of constructing a new one, so state middleware attached to `ctx` survives into the route handler. Omitting it (as every direct test call does) preserves the old behaviour of building a fresh `Context` internally |

Uses a `RouteMatcher` internally for path/segment comparison. Route and
fallback dispatch share error handling via a private `invokeHandler()`, so
an `HttpError` (or any thrown error) thrown from the SPA fallback handler is
converted to a response the same way a thrown route handler error would be.

### `RouteMatcher` — `src/routing/RouteMatcher.ts`

Pure path-matching logic, no I/O. Compares a route's path pattern to a
request path segment by segment; segments starting with `:` bind the value
at that position into `params`.

```ts
match(routePath: string, requestPath: string): RouteMatch
```

### `Route` / `RouteMatch` — `src/routing/Route.ts`, `src/routing/RouteMatch.ts`

Plain interfaces, no behaviour.

```ts
interface Route {
    method: string;
    path: string;
    handler: RouteHandler;
}

interface RouteMatch {
    matched: boolean;
    params: Record<string, string>;
}
```

---

### `Context` — `src/http/Context.ts`

Created per request. Wraps `IncomingMessage` and `ServerResponse` with a
clean, typed API. Passed to every route handler and every middleware.

**The Context API is frozen for v1** — every member below is implemented.
Any method added after v1 must be additive only (no signature changes, no
removals). `ctx.services` was the one deliberately deferred exception,
added in Phase 10 (DI-6) as a `Resolver` backed by a per-request
`ServiceScope` — see `doc/features/02_Dependency_Injection.md`.

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
| `route` | `string` \| `undefined` | Post-v1 addition (Phase 23). The route *pattern* `Router` matched (`/users/:id`), as opposed to the concrete path (`/users/42`). Set by `Router` on dispatch; `undefined` before routing, and for a 404, 405, automatic `OPTIONS`, or the SPA fallback. Also the first piece of Phase 21's per-route statistics |
| `state` | `Record<string, unknown>` | Post-v1 addition. Per-request bag for middleware to attach data (e.g. an authenticated user) for downstream middleware and route handlers to read. Untyped by design - reading a value back requires narrowing, not casting with `as` |
| `services` | `Resolver` \| `undefined` | Post-v1 addition (Phase 10, DI-6). Resolves dependencies registered via `EmpireOptions.services`, backed by a per-request `ServiceScope` that Empire creates and disposes automatically once the response ends. `undefined` when the app was built without `EmpireOptions.services` — dependency injection is entirely opt-in |
| `ipAddress` | `string` | Client IP — handles `x-forwarded-for` and IPv6 |
| `userAgent` | `string` | User-Agent header shorthand, empty string when absent |
| `contentType` | `string` | Content-Type without parameters (strips `; charset=...`) |

**Request methods:**

| Member | Description |
|--------|-------------|
| `accepts(type)` | Checks whether the client accepts the given response type, honouring `*/*` and `text/*`-style wildcards |
| `body()` | Reads full request body as string. Memoizes the read the first time it's called — a real `IncomingMessage` stream can only be consumed once, so repeat calls (including from `jsonBody()`/`form()`) return the same cached result instead of re-reading and getting `""` |
| `jsonBody()` | Parses JSON body — throws `BadRequestError` on invalid JSON |
| `form()` | Parses `application/x-www-form-urlencoded` body into `URLSearchParams` — throws `BadRequestError` on Content-Type mismatch |

**Response methods:**

| Member | Description |
|--------|-------------|
| `status(code)` | Sets status code — chainable, returns `this` |
| `header(name, value)` | Sets a single response header — chainable |
| `addHeaders(headers)` | Sets multiple response headers — chainable |
| `text(value)` | Sends plain text response |
| `html(value)` | Sends HTML response |
| `json(value)` | Sends JSON response |
| `redirect(url, status?)` | Redirect response, defaults to 302 Found |
| `file(path)` | Serves a file from a route handler, streamed via `fs.createReadStream()`. Throws `HttpError` 404 if missing |
| `download(path, filename?)` | Like `file()` but forces download via `Content-Disposition` |
| `cookie(name, value, options?)` | Sets a response cookie — chainable. Appends to existing `Set-Cookie` headers rather than overwriting. Options via `CookieOptions` (`maxAge`, `expires`, `path`, `domain`, `secure`, `httpOnly`, `sameSite`) |
| `clearCookie(name)` | Clears a cookie by name — chainable |

---

### `ILogger` — `src/logging/ILogger.ts`

Interface for logging. Injected via `EmpireOptions.logger`. Defaults to
`ConsoleLogger` if not provided.

```ts
interface ILogger {
    info(message: string): void;
    warn(message: string): void;
    error(message: string, error?: unknown): void;
    debug(message: string): void;
}
```

`ConsoleLogger` prefixes every line with an ISO timestamp and a level tag
(`[INFO]`, `[WARN]`, `[DEBUG]`, `[ERROR]`), and formats `Error` objects
passed to `error()` using their stack trace when available.

---

### `HttpError` — `src/errors/HttpError.ts`

Base class for HTTP errors thrown from route handlers. `Router` catches
these and returns the `statusCode` and `message` as a JSON error response
automatically.

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

### `ValidationError` — `src/errors/ValidationError.ts`

Extends `BadRequestError` with a structured `details: ValidationIssue[]`
field (`{ field, message }` per failing field), thrown by `validate()` —
see "Validation" below. `message` stays a single readable string, so
`sendErrorResponse.ts`'s handling of any other `HttpError` is unaffected;
`details` is additive to the JSON response only when the thrown error is
actually a `ValidationError`.

```ts
throw new ValidationError([{ field: "body.email", message: "Required" }]);
// → { "error": "body.email: Required", "details": [{ "field": "body.email", "message": "Required" }] }
// with status 400
```

---

### `StaticFileHandler` — `src/static/StaticFileHandler.ts`

Registered internally by `Empire.useStaticFiles()`. Handles each request
before routing runs.

| Behaviour | Detail |
|-----------|--------|
| Prefix matching | If `options.prefix` is set, requests outside the prefix return `false` immediately — see "Static Files API" below |
| Path traversal | Resolves absolute paths and checks `startsWith(root)` — returns 403 if unsafe (runs after prefix-stripping) |
| Directory index fallback | `resolveTargetPath()` — if the resolved path is a directory, serves an `index.html` inside it if one exists (e.g. `/about/` serves `/about/index.html`); returns `null` (falls through) if neither exists |
| Streaming | `sendFile()` — streams via `fs.createReadStream().pipe(res)` with `Content-Length` set from a single `stat()` call, rather than reading the whole file into memory |
| MIME detection | Delegates to `MimeTypes.getType(extension)` |
| File/directory-index not found | Returns `false` — middleware chain continues to routing |

`StaticFileHandler` does **not** implement SPA/React Router fallback itself
— that's a `Router` concern, see below.

---

## Static Files API

**Decision: `useStaticFiles(root, options?)`, ASP.NET Core style, not Express's `static(prefix, root)`.**

The original roadmap specified an Express-style URL prefix parameter
(`app.static("/public", "./wwwroot")`). Empire kept the ASP.NET Core pattern
instead (`app.useStaticFiles(root)`, mirroring `app.UseStaticFiles()`), per
the coding standard of mirroring ASP.NET Core conventions rather than
Express idioms. A separate `static(prefix, root)` method was considered and
rejected in favour of one method with an optional parameter — smaller API
surface, and consistent with ASP.NET Core's `UseStaticFiles(options)`
overload, which takes an options object rather than exposing a second public
method.

Prefix mounting was later added as an **additive optional second parameter**
rather than a breaking signature change, so single-argument calls made before
the feature existed keep working unchanged:

```ts
// No prefix — every request path is checked against root directly
app.useStaticFiles("./dist");

// Prefixed — only requests under the prefix are checked against this folder.
// Multiple prefixed folders can be mounted on the same server without colliding.
app.useStaticFiles("./public/assets", { prefix: "/assets" });
app.useStaticFiles("./storage/uploads", { prefix: "/uploads" });
```

`StaticFileHandler` normalises the prefix (strips trailing slashes, treats a
bare `"/"` as no prefix) and matches on prefix boundary — `"/assets"` matches
`/assets` and `/assets/logo.png`, but not `/assets-other`, so two prefixes
that share a leading substring never collide. See `examples/04-static-files`
for both patterns side by side.

Types: `StaticFileOptions` (`src/static/StaticFileOptions.ts`) carries
`root` and the internal `prefix?`; `UseStaticFilesOptions`
(`src/static/UseStaticFilesOptions.ts`) is the public `{ prefix?, spaFallback? }`
shape accepted by `Empire.useStaticFiles()`.

---

## SPA / React Router Fallback

**Why this lives in `Router`, not `StaticFileHandler`.**

The goal: `/about` (no matching static file, no matching route) should serve
`dist/index.html` so a client-side router like React Router can render it,
while `/api/users` (also no matching static file, but a *real registered
route*) must still resolve to its own handler — never the HTML shell.

This can't be solved inside static middleware alone. Empire's pipeline runs
the middleware chain first; the chain's final `next()` call is what invokes
`Router.handle()` (see the Request Lifecycle diagram above). By the time a
static middleware has decided "no file matches this path," it has no way of
knowing whether a route registered via `app.get()` will match the same path
later in the pipeline — that check hasn't happened yet. Guessing wrong in
either direction breaks something: unconditionally serving the SPA shell
from static middleware would swallow every API route before `Router` ever
saw the request; unconditionally falling through would leave `/about`
404ing forever.

**The fix:** give `Router` itself an optional fallback handler,
`Router.setFallback(handler)`, invoked only after every registered route has
had a chance to match and none did. `Empire.useStaticFiles(root, { spaFallback: true })`
registers this fallback to serve `root/index.html` via `ctx.file()`. This
keeps routing authoritative — API routes are always checked first, because
the fallback only runs once the route loop in `Router.handle()` has
exhausted every candidate — and is purely additive to `Router`'s existing
contract (a router with no fallback registered behaves exactly as before).

**Deliberately GET-only.** A `POST`/`PUT`/`DELETE` to an unmatched path is
almost always a genuine client error — a typo'd endpoint, a wrong HTTP
method — and should 404 loudly. Falling back to the HTML shell for
non-GET requests would silently return `200` for a broken request, masking
the mistake during development. This was caught during testing: an early
version of the fallback fired for any method, and `POST /api/users` (with
no POST handler registered) incorrectly returned the SPA shell with a `200`
instead of a `404`.

Usage, the resulting request/response table, and `examples/06-react-app`
(a real React + React Router app exercising all of this) are documented in
README_DEVELOPMENT.MD's "Static Files" section rather than repeated here.

---

### `MimeTypes` — `src/static/MimeTypes.ts`

Static utility class. Maps file extensions to MIME type strings.

```ts
MimeTypes.getType(".html")  // "text/html"
MimeTypes.getType(".xyz")   // "application/octet-stream"
```

Supported extensions: `.html`, `.css`, `.js`, `.json`, `.png`, `.jpg`, `.jpeg`,
`.gif`, `.svg`, `.ico`, `.txt`, `.pdf`, `.woff`, `.woff2`, `.ttf`, `.eot`, `.map`
— full coverage for a typical React/Vite build output.

---

## Middleware

### Signature (frozen)

```ts
type Middleware = (
    ctx: Context,
    next: () => Promise<void>
) => void | Promise<void>;
```

The middleware migration from `(req, res, next)` to `(ctx, next)` is
complete — every built-in middleware, example, and the `Empire.ts` pipeline
itself use this signature.

### Built-in Middleware

| File | Export | Behaviour |
|------|--------|-----------|
| `src/middleware/LoggerMiddleware.ts` | `createLoggerMiddleware(logger)` | Returns a middleware that logs `METHOD /path` through the given `ILogger` |
| `src/middleware/RouteHeaderMiddleware.ts` | `createRouteHeaderMiddleware()` | Opt-in, backend-side. Adds `X-Empire-Route: <template>` to responses whose request matched a route, by wrapping `res.writeHead` (the route is only known after `Router` runs, i.e. after `next()`). Exposes route structure, so only enable it on backends a load balancer alone talks to |
| `src/middleware/CorsMiddleware.ts` | `createCorsMiddleware(config)` | Returns a middleware handling CORS: origin allowlisting, preflight short-circuit, credentials, `allowedHeaders`/`exposedHeaders`, `Vary: Origin`, and optional per-path policies — full design in `doc/features/04_CORS_Compliance.md` |

---

## Load Balancer

A small layer-7 reverse proxy - a learning and local-development tool,
not a production edge. Everything is a plain middleware or class
registered through the existing `app.use()`; `Empire.ts` did not change.
Full design: `doc/features/05_Loadbalancer_Core_L7.md` (core slice) and
`doc/features/06_Loadbalancer_Least_Conn.md` (least connections).

```
client -> [ dashboard | registration endpoint | load balancer ] -> backend
                              |                     |
                        BackendRegistry  <-- select() --  ILoadBalancingStrategy
                              |
                        LoadBalancerMonitor --> DashboardSseClient --> browser (three.js)
```

| Piece | File | Role |
|---|---|---|
| `createLoadBalancerMiddleware` | `src/loadbalancing/proxy/LoadBalancerMiddleware.ts` | Terminal middleware: picks a backend via the strategy, calls `forwardRequest`, answers `503` when none is eligible. `dispose()` closes the keep-alive agent |
| `forwardRequest` | `src/loadbalancing/proxy/forwardRequest.ts` | Streams a request to a backend and the response back, never buffering. Strips hop-by-hop headers both ways, adds `X-Forwarded-*`, maps failures to `502`/`504`, and emits exactly one terminal monitor event per request |
| `ILoadBalancingStrategy`, `RoundRobinStrategy`, `LeastConnectionsStrategy` | `src/loadbalancing/strategy/` | The seam for choosing a backend, handed the eligible list on every call since it changes at runtime. Least connections reads in-flight counts through the narrow `IInFlightSource`, which `LoadBalancerMonitor` satisfies structurally, and declares it as `inFlightSource` so the middleware can insist it is the balancer's own monitor |
| `BackendRegistry` | `src/loadbalancing/backends/BackendRegistry.ts` | The eligible set. Registered backends hold a **lease** that expires unless renewed; static backends are pinned. An unref'd sweep timer removes lapsed leases |
| `createBackendRegistrationEndpoint` | `src/loadbalancing/registration/BackendRegistrationEndpoint.ts` | `PUT`/`DELETE {path}/{id}` and `GET {path}`. Bearer token required, loopback only by default, body validated with `validate()` |
| `LoadBalancerRegistration` | `src/loadbalancing/registration/LoadBalancerRegistration.ts` | The backend-side client: register, heartbeat at TTL/3, deregister on `stop()` |
| `LoadBalancerMonitor` | `src/loadbalancing/monitoring/LoadBalancerMonitor.ts` | Typed event source. Keeps bounded per-backend counters, per-route latency histograms and a ring buffer of recent calls |
| `createLoadBalancerDashboard` | `src/loadbalancing/dashboard/LoadBalancerDashboard.ts` | Serves the page, the SSE stream, per-backend JSON detail, and optionally a local three.js |
| `DashboardSseClient` | `src/loadbalancing/dashboard/DashboardSseClient.ts` | One tab's end of the stream. Lossy for request events under backpressure, lossless for topology events |
| `renderDashboardPage` | `src/loadbalancing/dashboard/page/dashboardPage.ts` | The whole client as one HTML string - overlay script, three.js scene script, styles |
| `createRouteHeaderMiddleware` | `src/middleware/RouteHeaderMiddleware.ts` | Backend-side: reports the matched route template as `X-Empire-Route` |

The folders under `src/loadbalancing/` follow the concerns above and import one way only:
`backends`, `proxy`, `registration` and `dashboard` sit on top of `monitoring` and `strategy`,
and everything sits on the shared `Backend`/`BackendInfo` types at the folder root. `proxy` and
`dashboard` never import each other, and `monitoring` imports nothing from its siblings.

Two decisions worth knowing about. **A registration is a lease, not a
membership**: registering and renewing are the same `PUT`, so a balancer
that restarts and forgets everything is repopulated by the next heartbeat,
and a crashed backend needs no health probe to be noticed. **The bounds are
load-bearing**: the monitor keeps at most 50 route keys per backend (the
rest fold into `(other)`), fixed-size histograms, and a 200-entry call
buffer, so memory is constant however much traffic flows.

---

## Types — `src/types.ts`

```ts
type Middleware = (ctx: Context, next: () => Promise<void>) => void | Promise<void>
type RouteHandler = (ctx: Context) => void | Promise<void>
```

`Route` used to live here but was moved to `src/routing/Route.ts` as part of
the router refactor, since it's a routing-specific concept.

---

## Route Matching

Routes are matched in registration order by `RouteMatcher`. The first match
wins.

- Path segments are split on `/` and compared one by one
- Segments starting with `:` are treated as parameters — the value is captured
  into `ctx.params`
- Query strings are stripped before matching (`/users?page=1` matches `/users`)
- Method must match exactly — GET, POST, PUT, PATCH, DELETE, and OPTIONS
  are all implemented; HEAD dispatches to a matching GET route instead of
  needing its own registration

Example:

```
Route:   /users/:id/posts
Request: /users/42/posts
Result:  ctx.params.id === "42"
```

---

## Validation

`validate()` — `src/validation/validate.ts` — wraps a `RouteHandler` with
schema-based validation of the request body, query string, and/or route
params, the same way `createLoggerMiddleware(logger)` wraps a middleware
around a dependency. It needs zero changes to `Router`'s registration
methods or `Context`'s frozen API — a route registers a `validate(...)`-wrapped
handler exactly like any other. Usage examples (Zod and hand-written) are in
README_DEVELOPMENT.MD's and README.MD's "Validation" sections rather than
repeated here.

A failing schema throws `ValidationError`, which `Router` already catches
through the same pipeline as any other `HttpError` — no separate error
mechanism. Body, query and params are all checked (in that order) and every
problem is reported in one `ValidationError`, so a client sees everything wrong
with a request at once.

**Any [Standard Schema](https://standardschema.dev) validator works.** `validate()` calls each
schema through the spec's one entry point (`schema["~standard"].validate(value)`, awaited, so
sync and async validators alike) and turns any returned `issues` into the `ValidationError`'s
`details`. Zod, Valibot and ArkType implement the spec; so can a few hand-written lines. Empire
copies the spec's types into `src/validation/standard/` rather than importing them, which is what
keeps it dependency-free. A validator that *throws* instead of returning issues is a bug in the
validator and propagates as a 500. The repository itself contains no validation library - not
even as a dev dependency - so `examples/10-validation` and the tests use small hand-written
validators, and the READMEs explain how a user brings Zod.
**`ctx.query` and `ctx.params` are always strings.** Both come off the raw
URL, so a query param intended as a number (`?page=2`) arrives as the
string `"2"` — schemas validating them need `z.coerce.number()` rather
than `z.number()`, or a well-formed request fails validation.

Full design, including the move from Zod to Standard Schema, is in
`doc/features/03_Request_Validation.md`.

---

## Configuration

`EmpireOptions`:

```ts
interface EmpireOptions {
    host: string;                  // e.g. "localhost"
    port: number;                  // e.g. 8001
    logger?: ILogger;              // defaults to ConsoleLogger
    maxBodySize?: number;          // in bytes, defaults to 1 MB
    services?: ServiceProvider;    // root DI container - opt-in, see Phase 10
    shutdownTimeoutMs?: number;    // graceful stop() timeout, defaults to 10s
}
```

---

## Known Architectural Issues

This table previously listed nine items; eight turned out to already be
resolved (verified directly against the source below, not assumed) and
have been moved into the Resolved list. Two genuinely open items remain:

| Issue | Impact | Plan |
|-------|--------|------|
| Only one SPA fallback per server | Can't serve two different single-page apps from one `Empire` instance | Not currently needed; `Router.setFallback()` would need to become a list with its own matching logic if this comes up |
| No route-scoped/path-scoped middleware - every registered middleware runs for every request, unconditionally, before routing | Can't restrict a middleware to e.g. `/admin/*` without hand-rolling path checks inside it. `examples/08-authentication` already does this by hand; `doc/features/04_CORS_Compliance.md` §2.3 (rule 8) does the same thing again, specifically for per-path CORS policies, rather than wait for a real fix | Tracked in `PLAN.md` Phase 3 ("Route-level middleware", remaining, unstarted). A real fix changes `Empire.handleRequest()`'s core dispatch model - the middleware loop would need to become path-aware, not just another addition wrapped around the existing pipeline the way DI, Validation, and CORS all were |

**Resolved** (kept here for history — see `PLAN.md` for current status):
- ~~Routing lived in `Empire.ts`~~ — extracted to `src/routing/Router.ts`
- ~~Middleware took `(req, res, next)` not `(ctx, next)`~~ — migrated
- ~~Static files API undecided~~ — kept `useStaticFiles(root, options?)`, added prefix mounting
- ~~Static files read fully into memory~~ — `StaticFileHandler.sendFile()` streams via `fs.createReadStream()`
- ~~No index.html or React Router fallback~~ — directory index fallback in `StaticFileHandler`, SPA fallback via `Router.setFallback()`, see "SPA / React Router Fallback" above
- ~~`MimeTypes` missing `.map`, `.ttf`, `.eot`~~ — added, full React/Vite build output coverage
- ~~No automated tests for `src/routing/` or the static file features~~ — `tests/unit/routing/`, `tests/unit/static/`, and `tests/integration/` all exist and run via `npm test`
- ~~Context identity split between middleware and route handlers (FINDING 1)~~ — `Router.handle()` now reuses the shared `Context`, see PLAN.md Phase 9.3
- ~~No error handling around the middleware pipeline (FINDING 3)~~ — `Empire.handleRequest()` now catches and maps errors, see PLAN.md Phase 9.3
- ~~`next()` not guarded against double invocation (FINDING 4)~~ — recursive `dispatch()` with a one-shot `next()`, see PLAN.md Phase 9.3
- ~~`ctx.body()` not cached (FINDING 6)~~ — memoized as a promise, see PLAN.md Phase 9.3
- ~~Only `GET` and `POST` implemented~~ - `PUT`, `PATCH`, `DELETE`, and `OPTIONS` all added, see `doc/features/01_Core_Routing_Pipeline.md` (rule 8)
- ~~`ctx.body()` has no size cap (FINDING 7)~~ - configurable `maxBodySize`, rejects with 413 as the limit is crossed, see PLAN.md Phase 9.3
- ~~`sendFile()` only resolved on the response's `"finish"` event (FINDING 8)~~ - now also settles on `"close"`, so a client aborting mid-download no longer leaks the read stream, see PLAN.md Phase 9.3
- ~~Static files never checked `req.method` (FINDING 9)~~ - `StaticFileHandler` now checks for `HEAD` and skips opening a read stream entirely, see PLAN.md Phase 9.3
- ~~Route params were never URL-decoded (FINDING 10)~~ - `RouteMatcher` and `Context.path` both decode consistently, see PLAN.md Phase 9.3
- ~~No literal-over-parameter route precedence (FINDING 11)~~ - decided this stays as first-registered-wins by design, not a bug; documented in README's "Routing" section, see PLAN.md Phase 9.3
- ~~`RouteMatcher` filtered empty path segments (FINDING 12)~~ - doubled slashes are now rejected rather than silently collapsed, see PLAN.md Phase 9.3
- ~~`HttpError` had no `code`/`retryable`, and `.name` wasn't set (FINDING 13)~~ - both added, see PLAN.md Phase 9.3
- ~~Static file path-traversal guard was a bare `startsWith(root)` (FINDING 2)~~ - now requires a path-separator boundary, see PLAN.md Phase 9.3

---

## Upcoming Features

Planned build order after CORS (version 0.17.0 above), tracked as
`PLAN.md` Phases 19-23:

1. **CSP/XSS protection** (`useSecurityHeaders()`) - Phase 19, design doc
   `doc/features/csp-xss-protection.md`
2. **Response compression** (`useCompression()`) - Phase 20, Gzip and
   Brotli, buffer-then-compress for v1, design doc
   `doc/features/response-compression.md`
3. **Usage/statistics tracking middleware** - Phase 21, request counts
   per route, response time distributions, status code breakdowns; not
   yet designed
4. **MVC pattern** (controllers, actions, model binding) - Phase 22,
   expands the existing Phase 14 Controllers stub; open question on
   server-rendered views vs. API-only; not yet designed
5. **Simple load balancer** - Phase 23, explicitly a learning/local-dev
   feature, not production-grade. The v1 slice is built (round robin,
   self-registering backends, the 3D dashboard - see the Load Balancer
   section above) and so is least connections; weighted round robin and
   Layer 7 header-based routing follow as new strategies against the same seam

Both design docs referenced above (items 1 and 2) do not exist in this
repository as of this writing - the paths shown here use
`doc/features/`, matching this project's own convention (`CLAUDE.md`);
`PLAN.md` records the original `doc/design/` path they were requested
at, since that's what was asked for, but that folder doesn't exist and
doesn't match convention. Add the actual files (at whichever path is
correct) before treating either as a real, followable design.
