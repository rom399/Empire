# Empire — CORS Compliance: Design & Build Doc

**Status:** Implemented
**Scope:** Native TypeScript architecture. Part of Phase 16 (HTTP Features) in `PLAN.md`.
**Timeline:** Designed by Opus ➡️ Executed by Sonnet

---

## 1. Context & Architectural Goals

### 1.1 The Problem

A frontend served from one origin that calls an Empire API on another is blocked by the browser's
same-origin policy from reading the response. For anything beyond a "simple" request it is blocked
earlier still, at a **preflight** `OPTIONS` request that Empire had no way to answer correctly.

There is also a trap already in the codebase. `Router.handle()` auto-answers *every* `OPTIONS` request
with `204` and a generic `Allow` header, for RFC 9110 §9.3.7 method discovery (see
`01_Core_Routing_Pipeline.md`). A CORS preflight is *also* an `OPTIONS` request, but needs a
fundamentally different response - `Access-Control-Allow-*` headers, not a plain `Allow` list. The
design problem is not writing CORS headers; it is making CORS coexist with that existing behaviour
instead of colliding with it.

### 1.2 System Goals

* **Goal 1 - Middleware-based CORS** with configurable allowed origins, methods, headers, exposed
  headers, credentials and preflight cache time.
* **Goal 2 - Coexist with `Router`'s automatic `OPTIONS`.** The CORS middleware intercepts *only* true
  preflights; every other request, including a same-origin `OPTIONS` probe, reaches `Router`
  untouched.
* **Goal 3 - Strict by default.** Nothing beyond the browser's own CORS safelist is permitted or
  exposed unless explicitly configured: no reflected request headers, no implicit exposed headers.
* **Goal 4 - Configuration mistakes fail at startup,** not per request: the combination browsers
  always reject (`credentials: true` with `origin: "*"`) never reaches a running server.
* **Goal 5 - Correct caching.** Responses that vary by requesting origin say so with `Vary: Origin`.
* **Goal 6 - Per-path policies** for the common case of a public API and a locked-down admin surface on
  one server, without waiting for route-scoped middleware.
* **Goal 7 - Plain middleware, no core growth.** `createCorsMiddleware(config)` registered through the
  existing `app.use()`; `Empire.ts` and `Router.ts` do not change.

### 1.3 Non-Goals (Scope Guardrails)

* **Non-Goal 1 - A general security-headers framework.** CORS only. CSP, HSTS and friends are Phases
  19 onward and not part of this design.
* **Non-Goal 2 - A pattern-matching DSL for origins** (built-in `*.example.com` wildcards). The
  `origin` function option already covers dynamic checks (subdomain patterns, a database-backed
  allowlist) without Empire inventing and maintaining a matcher.
* **Non-Goal 3 - Reimplementing `Router`'s `OPTIONS` / `Allow` logic.** This middleware owns true
  preflights only and defers to `Router` for everything else.
* **Non-Goal 4 - A new `Empire.ts` method** (`app.useCors()`). Rejected in 2.1.
* **Non-Goal 5 - A `Router`-derived, path-exact `Allow` on the preflight.** Rejected in 2.3.
* **Non-Goal 6 - Real route-scoped middleware.** The multi-policy form (rule 8) is a narrow,
  CORS-specific workaround. The underlying gap - every middleware runs for every request - is a
  separate, larger effort tracked in `PLAN.md` Phase 3 ("Route-level middleware"); if it is built,
  `policies` and `fallback` become redundant and should collapse into it.
* **Non-Goal 7 - Rejecting a disallowed origin or method itself.** The server withholds the CORS
  headers and the browser enforces the decision (rules 4 and 5).

### 1.4 Dependency Stance

**Zero runtime dependencies. Native Node.js modules only.**

CORS is pure header logic: read `Origin` and `Access-Control-Request-*`, write `Access-Control-Allow-*`.
There is nothing to parse or validate that a library would do better, so none earns a place here. It
stays dependency-free, consistent with routing, middleware, dependency injection and validation.

---

## 2. Design & API Contracts (The Opus Blueprint)

### 2.1 Public User API

`createCorsMiddleware(options)` returns a `Middleware`, registered through the **existing** `app.use()`:

```ts
app.use(createCorsMiddleware({
    origin: ["http://localhost:5173"],   // e.g. a Vite dev server on another port
    credentials: true,
    maxAge: 600,
}));
```

**Multiple policies** on one server, matched by request path:

```ts
app.use(createCorsMiddleware({
    policies: [
        { match: (path) => path.startsWith("/api/admin"),  options: { origin: ["https://admin.example.com"], credentials: true } },
        { match: (path) => path.startsWith("/api/public"), options: { origin: "*" } },
    ],
    // no fallback: a path matching neither policy gets no CORS headers at all
}));
```

**A frontend sending a Bearer token** needs `Authorization` and `Content-Type: application/json`.
Neither is on CORS's "simple header" safelist, so both trigger a preflight and both must be permitted
explicitly:

```ts
app.use(createCorsMiddleware({
    origin: ["http://localhost:5173"],
    allowedHeaders: ["Content-Type", "Authorization"],
}));
```

**A preflight exchange** this produces (with `credentials: true`, `maxAge: 600`):

```
OPTIONS /api/data HTTP/1.1
Origin: http://localhost:5173
Access-Control-Request-Method: GET

HTTP/1.1 204 No Content
Access-Control-Allow-Origin: http://localhost:5173
Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS
Allow: GET, POST, PUT, PATCH, DELETE, OPTIONS
Access-Control-Allow-Credentials: true
Access-Control-Max-Age: 600
Vary: Origin
```

The actual request that follows needs `Access-Control-Allow-Origin` (and `-Credentials`) on its *own*
response too. A preflight approval does not imply the real response carries them.

**What "strict" looks like.** Asking for a header nobody configured:

```
Access-Control-Request-Headers: authorization, content-type, x-client-version
```

still gets back exactly `Access-Control-Allow-Headers: Content-Type, Authorization`. `x-client-version`
is silently absent, so the browser refuses to send it. There is no server-side error and no rejected
preflight; the fix is adding `"X-Client-Version"` to `allowedHeaders`, not debugging a response.

**Considered and rejected: `app.useCors(options)`**, mirroring `app.useStaticFiles()`. ASP.NET Core has
a first-class `UseCors`, but a new `Empire.ts` method touches the framework's core surface for no real
benefit: `validate()` had already shown that a plain wrapping function needs zero `Router` or `Context`
changes and stays just as usable.

### 2.2 Core Interfaces & Data Models

```ts
// src/middleware/CorsOptions.ts
interface CorsOptions {
    /** Which origins may read the response. */
    origin: string | string[] | ((origin: string) => boolean);
    /** Defaults to GET, POST, PUT, PATCH, DELETE, OPTIONS. */
    methods?: string[];
    /** No default. Unset means no header beyond CORS's safelisted "simple" set is permitted. */
    allowedHeaders?: string[];
    /** Sets Access-Control-Expose-Headers on the actual response. No default: nothing extra exposed. */
    exposedHeaders?: string[];
    /** Sets Access-Control-Allow-Credentials. With origin "*" this is a startup error (rule 6). */
    credentials?: boolean;
    /** Access-Control-Max-Age in seconds. Unset omits the header; the browser uses its own default. */
    maxAge?: number;
}

// src/middleware/CorsPolicy.ts
interface CorsPolicy { match: (path: string) => boolean; options: CorsOptions }

// src/middleware/CorsConfig.ts - a plain CorsOptions still works unchanged
type CorsConfig = CorsOptions | { policies: CorsPolicy[]; fallback?: CorsOptions };

// src/middleware/CorsMiddleware.ts
function createCorsMiddleware(config: CorsConfig): Middleware;
```

`origin` accepting a function is deliberate, not just a string or array: it is the low-cost,
high-value escape hatch for dynamic checks. `allowedHeaders` and `exposedHeaders` control **opposite
directions** and must not be confused: `allowedHeaders` is what the *browser* may *send* (answered on
the preflight only); `exposedHeaders` is what *JavaScript* may *read* off the actual response (set on the
real response, not the preflight). They share the same conservative default; only `methods` defaults
permissively, because it only affects what a browser may send.

### 2.3 Internal Processing Logic Rules

1. **A genuine preflight is identified by the Fetch spec's own definition:** an `OPTIONS` request
   carrying **both** `Origin` and `Access-Control-Request-Method`. Neither alone is enough - a plain
   cross-origin `GET` also carries `Origin`, and a same-origin `OPTIONS` probe carries neither.
2. **A genuine preflight is answered by the middleware and never reaches `Router`.** It responds `204`
   and does **not** call `next()`, so `Router`'s own `OPTIONS` handling never fires for it. When the
   requesting origin is allowed, the response carries `Access-Control-Allow-Origin`,
   `Access-Control-Allow-Methods`, a plain `Allow` header (the same list), `Access-Control-Allow-Credentials`
   when configured, `Access-Control-Allow-Headers` when `allowedHeaders` is configured, and
   `Access-Control-Max-Age` when `maxAge` is configured.
3. **Everything else reaches `Router` unchanged.** A normal request, cross-origin or not, including a
   same-origin `OPTIONS` probe with neither header, gets `Access-Control-Allow-Origin` (when its `Origin`
   is allowed) and calls `next()`. `Router`'s automatic `OPTIONS` / `Allow` behaviour is completely
   untouched, so same-origin method discovery keeps working exactly as before.
   * **No `Origin` header at all** (same-origin requests, `curl`, server-to-server calls) is a no-op:
     there is nothing to check against, so the middleware adds no CORS headers and calls `next()` at once.
4. **A preflight from a disallowed origin still short-circuits.** Preflight detection is by header
   presence, *before* the allowlist check, so a preflight from an origin not on the list is still
   answered by the middleware: `204`, with every `Access-Control-Allow-*` header (and `Allow`) omitted.
   This avoids leaking the configured methods and headers to a disallowed origin, and the browser blocks
   the follow-up request either way.
5. **A preflight requesting a method outside `methods` still gets `204`.** The method is simply absent
   from `Access-Control-Allow-Methods`, and the browser makes the enforcement decision. This is the
   standard, spec-conformant behaviour: the preflight answers "here is what is allowed" rather than the
   server trying to detect and reject an unrecognised method.
6. **Credentials and wildcard origin never combine.** Per the Fetch spec,
   `Access-Control-Allow-Origin: *` with `Access-Control-Allow-Credentials: true` makes a browser reject
   the response outright and silently. Two consequences:
   * With `credentials: true` the middleware always echoes the **specific requesting `Origin`**, never
     `*`. The response header is per-request, not a static echo of the configuration.
   * `credentials: true` combined with the literal `origin: "*"` can never produce a working response,
     so it is a **startup-time configuration mistake**, not a runtime condition to work around. It
     follows the dependency-injection container's "crash loud on misconfiguration" precedent
     (`02_Dependency_Injection.md` §2.3, rule 2): `createCorsMiddleware()` logs a `FATAL` message
     explaining the conflict and calls **`process.exit(1)`**, before the server ever starts. It is *not*
     a catchable `throw`, so a `try/catch` cannot swallow it. The check applies to a flat `CorsOptions`,
     to **every** policy, and to the `fallback`.
7. **`Vary: Origin`.** Whenever the middleware handles a request and `origin` is anything other than the
   literal `"*"` (a string, an array or a function), the response depends on the incoming `Origin`, so
   `Vary: Origin` is set - on preflight and actual responses alike, and even for a request with no
   `Origin` or from a disallowed one. It is **appended** to any existing `Vary` value rather than
   overwriting it (something else, a future compression middleware for instance, may have set one), and
   not added twice. With `origin: "*"` the response never varies, so no `Vary` is set.
8. **Multiple policies.** `createCorsMiddleware()` can take `{ policies, fallback? }`, matched by
   `ctx.path` entirely inside the middleware's own function body - no `Router` or `Empire.ts`
   involvement.
   * **First match wins**, the same precedence Empire's own routing uses.
   * **No matching policy and no `fallback`:** the request passes through with no CORS headers touched,
     exactly as if the middleware were not registered. That is not an error and not a default-deny:
     CORS being absent for a path is a legitimate, common case (same-origin-only endpoints mixed with
     public ones on one server).
   * **A matching `fallback`** is used when no policy matches.
   * The rule 6 guard runs per policy at creation time, so a mistake in any one policy still stops the
     server from starting.
9. **The preflight's `Allow` header comes from `methods`, not from `Router`.** `Router.findRoute()`
   computes path-accurate allowed methods privately, and a public `getAllowedMethodsForPath()` was
   considered. It was **rejected**: it would need a `Router` reference to reach the middleware (`Empire`
   does not expose `router` publicly), breaking the precedent that a middleware needs only its own
   configuration and never a live framework object, and it would remove the ability to deliberately
   expose a *narrower* CORS surface than what is implemented (a `DELETE` route that exists for
   same-origin use only). `Access-Control-Allow-Methods` staying an explicit, independent allowlist is a
   capability, not an oversight. The consequence: the `Allow` this produces is an approximation of the
   global CORS policy, not a path-exact value the way `Router`'s own `Allow` is. It can list more than a
   specific path implements if `methods` is configured broadly.

### 2.4 Security & Performance Defaults

**Security**

* **Strict by default:** an unconfigured `allowedHeaders` never sets `Access-Control-Allow-Headers` (no
  reflection of `Access-Control-Request-Headers`), and an unconfigured `exposedHeaders` never sets
  `Access-Control-Expose-Headers`. The `allowedHeaders` default was the project owner's own policy call,
  reversing an earlier permissive draft.
* **No cross-origin information leak on a disallowed origin:** its preflight gets no methods or headers
  list (rule 4).
* **`credentials` is never paired with `*`** (rule 6), which would be silently rejected by every browser.
* **Caches cannot serve one origin's response to another** (rule 7).
* **CORS is not access control.** It tells a *browser* what it may let a page read; `curl` and other
  servers ignore it. Authentication and authorisation stay the application's job
  (`examples/08-authentication` shows the shape).

**Performance**

* Header logic only: a constant number of string operations per request, no I/O, no allocation beyond the
  header values.
* A request that matches no policy costs one `find` over the policy list and then behaves as if the
  middleware were absent.

**Known limits**

* **The preflight `Allow` header is global-config, not path-exact** (rule 9).
* **The middleware runs for every request,** since Empire has no route-scoped middleware. The multi-policy
  form and `examples/08-authentication` each re-implement path checks for that reason (Non-Goal 6).
* **The misconfiguration guard exits the process,** so a test must stub `process.exit` and
  `console.error` to observe it.

---

## 3. Iterative Build Steps & Test Strategy (The Sonnet Instructions)

Each step lands with its tests before the next starts.

### Step 1: Types & Structural Definitions

* **Description:** Define `CorsOptions`, `CorsPolicy` and `CorsConfig` in their own files under
  `src/middleware/`, one type per file, each option documented with its default and its direction
  (`allowedHeaders` versus `exposedHeaders`).
* **Sonnet Check:** `npx tsc --noEmit` clean; a plain `CorsOptions` is still a valid `CorsConfig`.
* [x] Types defined

### Step 2: Component Logic & Isolated Unit Tests

* **Description:** Implement `createCorsMiddleware()` in `src/middleware/CorsMiddleware.ts`, in the order
  the design's build plan gave it. Tests are in `tests/unit/middleware/CorsMiddleware.test.ts`
  (36 cases), driven with mock contexts.
* [x] C-1 - origin matching (string, array, function); `Access-Control-Allow-Origin` on non-preflight responses
* [x] C-2 - preflight detection and short-circuit (`204`, no `next()`); no `Origin` is a no-op; a method
  outside `methods` still gets `204` (rules 1, 2, 3, 5)
* [x] C-3 - `Allow` on the preflight, sourced from `methods` (rule 9)
* [x] C-4 - the credentials and wildcard guard, and the per-request specific-origin echo (rule 6)
* [x] C-5 - `allowedHeaders`, strict by default
* [x] C-6 - `exposedHeaders` on the actual response only
* [x] C-7 - `Vary: Origin`, appended (rule 7)
* [x] C-8 - multi-policy support with per-policy validation (rule 8)
* **Vitest Assertions** (pass and failure cases both):
  * [x] An allowed origin gets `Access-Control-Allow-Origin` set to that origin on an actual request; a
    disallowed origin does not; `origin` as an array matches; `origin` as a function receives the request's
    actual `Origin` and its boolean decides.
  * [x] A genuine preflight is intercepted, answered directly and never calls `next()`; a non-preflight
    `OPTIONS` (no `Access-Control-Request-Method`) still reaches `Router`; an `OPTIONS` carrying
    `Access-Control-Request-Method` but no `Origin` calls `next()`.
  * [x] A preflight from a disallowed origin still answers `204` but omits the CORS headers.
  * [x] A preflight requesting a method outside `methods` still gets `204`, with that method absent.
  * [x] `Allow` matches `Access-Control-Allow-Methods`, both sourced from `methods`; `methods` defaults to
    GET, POST, PUT, PATCH, DELETE, OPTIONS.
  * [x] `credentials: true` echoes the specific `Origin` (tested with an array origin, since `"*"` is
    rejected) and sets `Access-Control-Allow-Credentials` on the preflight too; it is absent when
    unconfigured.
  * [x] `Access-Control-Allow-Headers` reflects exactly the configured list regardless of what was
    requested, and is never set when unconfigured.
  * [x] `Access-Control-Expose-Headers` is set on the actual response, never on the preflight, and never
    set when unconfigured.
  * [x] `Access-Control-Max-Age` is set on the preflight only, and never when unconfigured.
  * [x] `Vary: Origin` is set for a string, array or function origin, on the preflight too, is **not** set
    for `"*"`, and is appended to an existing `Vary` rather than overwritten.
  * [x] First match wins when several policies match; no match and no `fallback` passes through untouched;
    a `fallback` is used when nothing matches.
  * [x] **Crash paths** (with `process.exit` and `console.error` stubbed): `credentials: true` with
    `origin: "*"` exits with code `1` and a message naming the conflict at creation time; it does not fire
    for `credentials: true` with a specific origin; it also fires for a misconfigured policy that is *not
    the first*, and for a misconfigured `fallback`.

### Step 3: Network Pipeline Integration & Live Sockets

* **Description:** Prove the interaction that motivated the design - the middleware sitting in front of
  `Router`'s own `OPTIONS` handling - end to end, through a real server and the existing `app.use()`.
* [x] C-9 - **`examples/11-cors/server.ts`** (port 8011) wires the middleware through `app.use()` with two
  policies (`/admin` for `https://admin.example.com` only; `/api` for `http://localhost:5173` with
  credentials, `allowedHeaders`, `exposedHeaders` and `maxAge`) and no `fallback`, so `/` gets no CORS
  headers at all. Its routes: `GET /`, `GET /api/data` (sets `X-Request-Id`), `POST /api/orders` (reads a
  JSON body) and `GET /admin/stats`.
* **Verification by request** (run against the real example, header comment scripts them): an allowed
  origin gets `Access-Control-Allow-Origin` echoed; `http://evil.example` gets `200` with no
  `Access-Control-Allow-Origin`; a preflight for `POST /api/orders` with
  `Access-Control-Request-Headers: authorization, content-type` gets `204` with `Allow-Headers` listing
  both; `/admin/stats` from the `/api` origin gets no `Allow-Origin`. `scripts/run-examples.ts` also
  starts the example on every `npm run verify`.
* **A gap, stated plainly:** there is no integration test for CORS; the interaction with `Router` is
  covered by the unit tests' `next()` assertions and by the example, not by a test over a real socket.

### Step 4: Verification, Benchmarking, & Example App

* **Description:** Run the full gate and document the feature.
* [x] C-10 - tests (Step 2)
* [x] C-11 - docs: the "CORS" section of `README_DEVELOPMENT.MD` (`README.MD` lists the example),
  `doc/ARCHITECTURE.md` (built-in middleware table), and the `PLAN.md` Phase 16 checkbox
* [x] **Gate:** `npm run verify` and `npm run lint`.
* **As built - notes worth keeping:**
  * **The design's test list conflicted with its own guard.** One bullet said `credentials: true` should
    echo the specific `Origin` "even when `origin` is `*`"; the next said that exact combination is a
    startup error. The guard is what is implemented and tested, and the echo test uses an array origin to
    show the same behaviour without the wildcard.
  * **The guard is a hard crash, not a throw,** matching the dependency-injection container. The
    earlier draft of this design said it would "throw synchronously"; the implementation deliberately
    calls `process.exit(1)` so a `try/catch` cannot swallow a startup mistake.
  * **Two decisions were the project owner's call rather than derived from a fact:** the strict default
    for `allowedHeaders` (reversing an earlier permissive draft), and taking the cheap multi-policy option
    now instead of waiting for route-scoped middleware.
* [ ] **Follow-ups, not built:** an integration test over a real socket; folding `policies` into real
  route-scoped middleware if that ever lands.
