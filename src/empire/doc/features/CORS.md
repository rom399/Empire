# Empire — CORS: Design & Build Doc

**Status:** Draft
**Scope:** Empire (native TypeScript webserver). Part of Phase 16 in `PLAN.md`.

## 1. Context & Goals

Empire has no CORS support today. A frontend on a different origin calling
an Empire API is blocked by the browser's same-origin policy from reading
the response — or, for anything beyond a "simple" request, blocked
outright at a preflight `OPTIONS` request Empire has no way to answer
correctly.

**Goal:** middleware-based CORS support - configurable allowed origins,
methods, headers, and credentials - that correctly coexists with
`Router`'s existing automatic `OPTIONS` response (built for RFC 9110
method-discovery, not CORS) rather than conflicting with it.

**Non-goal:** a general security-headers framework. This is CORS only,
per Phase 16's task list - Content-Security-Policy, HSTS, etc. aren't
part of this doc and aren't currently on the roadmap at all.

**Dependency stance:** unlike Validation, this needs none. CORS is pure
header logic - reading `Origin`/`Access-Control-Request-*`, writing
`Access-Control-Allow-*` - no parsing or validation library earns its
place here. Stays zero-dependency, consistent with routing, middleware,
and DI.

## 2. Design

### 2.1 Where this lives: a plain middleware, not a new `Empire.ts` method

Same pattern as `LoggerMiddleware.ts` - `createCorsMiddleware(options)`
returns a `Middleware`, registered via the *existing* `app.use()`:

```ts
app.use(createCorsMiddleware({
    origin: ["http://localhost:5173"],
    credentials: true,
}));
```

**Considered and rejected: `app.useCors(options)`**, mirroring
`app.useStaticFiles()`. ASP.NET Core does have a first-class
`app.UseCors(...)`, but adding a new `Empire.ts` method touches the
framework's core surface for no real benefit - `validate()` (Phase 11)
proved a plain handler/middleware-wrapping function needs zero `Router`
or `Context` changes and stays just as usable. Same reasoning applies
here: `createCorsMiddleware()` + the existing `app.use()` is enough, and
keeps `Empire.ts`'s public surface exactly as small as it is today.

### 2.2 The real design problem: preflight vs. `Router`'s existing `OPTIONS` handling

`Router.handle()` already auto-responds to any `OPTIONS` request with
`204` + a generic `Allow` header, for RFC 9110 §9.3.7 method-discovery -
built and tested well before CORS was ever a consideration (see
`doc/ARCHITECTURE.md`'s Router section). A CORS **preflight** is also an
`OPTIONS` request, but needs a fundamentally different response: CORS
headers (`Access-Control-Allow-Origin`, `-Methods`, `-Headers`,
`-Max-Age`), not a plain `Allow` list.

**The fix: precisely distinguish a real preflight from every other
`OPTIONS` request**, per the Fetch spec's own definition - a preflight is
an `OPTIONS` request carrying **both** `Origin` and
`Access-Control-Request-Method`. Neither header alone is sufficient (a
plain cross-origin `GET` also carries `Origin`; a same-origin `OPTIONS`
probe carries neither).

- **If both headers are present** (a genuine preflight): the CORS
  middleware answers directly - `204`, the appropriate
  `Access-Control-Allow-*` headers - and does **not** call `next()`.
  `Router` never sees this request; its own `OPTIONS` handling never
  fires for it.
- **Otherwise** (a normal request, cross-origin or not, including a
  same-origin `OPTIONS` probe with neither header): the middleware
  attaches `Access-Control-Allow-Origin` (if the request's `Origin` is
  allowed) to the response and calls `next()` as normal. `Router`'s
  existing `OPTIONS`/`Allow` behavior is completely untouched for these -
  same-origin method-discovery keeps working exactly as it does today.

This cleanly splits ownership: the CORS middleware only ever intercepts
*true* preflights; everything else, including `Router`'s pre-existing
behavior, is unaffected.

**The short-circuited preflight response also includes a plain `Allow`
header**, alongside `Access-Control-Allow-Methods`, sourced from the same
`CorsOptions.methods` - not from inspecting `Router`'s actual registered
routes for the path. `Router.findRoute()` (private) already computes
path-accurate allowed methods internally for its own 405/`OPTIONS`
handling, and a `getAllowedMethodsForPath()` public method exposing that
was considered here. Rejected: it would require a `Router` reference to
reach the CORS middleware (`Empire` doesn't expose `router` publicly
today - only `logger` and `services` are public getters), breaking the
"middleware needs only its own config, never a live framework object"
precedent `createLoggerMiddleware()`/`validate()` both established, and
it would remove the ability to deliberately expose a *narrower* CORS
surface than what's actually implemented (e.g. a `DELETE` route that
exists for same-origin use only, never meant to be cross-origin-callable)
- `Access-Control-Allow-Methods` staying an explicit, independent
allowlist is a real capability, not an oversight. The `Allow` header this
produces is therefore an approximation of the global CORS policy, not a
path-exact value the way `Router`'s own `Allow` is - worth knowing if
`methods` is configured broader than what a specific path actually
implements.

### 2.3 Configuration Example

```ts
export interface CorsOptions {
    /** Which origins may read the response. */
    origin: string | string[] | ((origin: string) => boolean);
    /** Defaults to a standard set: GET, POST, PUT, PATCH, DELETE, OPTIONS. */
    methods?: string[];
    /**
     * Defaults to reflecting back whatever the browser's preflight asked
     * for (Access-Control-Request-Headers) - the common permissive
     * default most CORS libraries use, since headers aren't the
     * sensitive part of a CORS policy the way origin/credentials are.
     * Pass an explicit array to restrict instead.
     */
    allowedHeaders?: string[];
    /**
     * Sets Access-Control-Expose-Headers on the actual response (not the
     * preflight). Without this, cross-origin JS can only read a small
     * safelisted set of response headers (Content-Type, Content-Length,
     * a few others) - anything custom (pagination info, a request-id
     * header, rate-limit headers) is invisible to it unless listed here.
     * No default - unset means nothing extra is exposed.
     */
    exposedHeaders?: string[];
    /** Sets Access-Control-Allow-Credentials - see 2.4 for the wildcard interaction. */
    credentials?: boolean;
    /** Access-Control-Max-Age, in seconds - how long a browser may cache one preflight result. */
    maxAge?: number;
}
```

`origin` accepting a function (`(origin: string) => boolean`) is
deliberately included, not just a string/array - it's the low-cost,
high-value escape hatch for dynamic origin checks (subdomain patterns, a
database-backed allowlist) without Empire having to build a pattern-matching
DSL itself (see Guardrails).

`allowedHeaders` and `exposedHeaders` control opposite directions and
must not be confused: `allowedHeaders` is what the *browser* is permitted
to *send* (answered on the preflight only); `exposedHeaders` is what
*JavaScript* is permitted to *read* off the actual response (set on the
real response, not the preflight).

### 2.4 The credentials + wildcard-origin conflict

Per the Fetch spec, `Access-Control-Allow-Origin: *` cannot be combined
with `Access-Control-Allow-Credentials: true` - a browser rejects the
response outright, silently, if a server sends both. Two consequences:

- Whenever `credentials: true` is configured, the middleware must always
  echo back the **specific requesting `Origin` header value**, never
  `*`, even if `origin` is configured as `"*"` or a list - the response
  header is per-request, not a static echo of the config.
- If `credentials: true` is combined with the literal `origin: "*"` in
  config, that combination can never produce a working response - this
  is a startup-time configuration mistake, not a runtime condition to
  quietly work around. Consistent with the DI container's "crash loud on
  misconfiguration" precedent (`ServiceCollection`'s duplicate-registration
  crash, `doc/features/DEPENDENCY_INJECTION.md` §2.4), `createCorsMiddleware()`
  should throw synchronously at creation time - immediately, before the
  server ever starts - rather than silently producing CORS responses
  that browsers will always reject.

### 2.5 `Vary: Origin`

Whenever the response's `Access-Control-Allow-Origin` value depends on
which origin is asking - true for `origin` configured as a string,
`string[]`, or function, since the middleware only echoes back an origin
that actually matched the allowlist - a cache sitting in front of the app
(browser cache, CDN, reverse proxy) needs to know the response varies by
`Origin`, or it can serve a response meant for origin A to a request from
origin B. The rule, applied uniformly on both preflight and actual
responses:

- **`origin: "*"`** - the response is unconditionally `Access-Control-Allow-Origin: *` for every request, never varies - no `Vary: Origin` needed.
- **Anything else** (string, `string[]`, function) - the response depends on the incoming `Origin`, so set `Vary: Origin` whenever this middleware runs. Append to any existing `Vary` value rather than overwriting it, in case something else (a future compression middleware, for instance) already set one.

## 3. Build order / milestones

- [ ] **C-1: `CorsOptions` + `createCorsMiddleware()` skeleton** - origin matching (string/array/function), sets `Access-Control-Allow-Origin` on non-preflight responses for an allowed origin
- [ ] **C-2: Preflight detection & short-circuit** - `Origin` + `Access-Control-Request-Method` both present → `204` with `Access-Control-Allow-Methods`/`-Headers`/`-Max-Age`, no `next()` call
- [ ] **C-3: `Allow` on the preflight response** - sourced from `CorsOptions.methods`, same list as `Access-Control-Allow-Methods` (§2.2); not `Router`-derived, see §2.2 for why
- [ ] **C-4: Credentials + wildcard-origin guard** - throws at creation time for the invalid combination (2.4); per-request specific-origin echo when `credentials: true`
- [ ] **C-5: `allowedHeaders` reflection default**
- [ ] **C-6: `exposedHeaders`** - sets `Access-Control-Expose-Headers` on the actual (non-preflight) response when configured
- [ ] **C-7: `Vary: Origin`** - set (appended, not overwritten) on both preflight and actual responses whenever `origin` isn't the literal `"*"`; omitted when it is (§2.5)
- [ ] **C-8: Example** - `examples/11-cors/server.ts`, a real cross-origin request that only succeeds because of the middleware
- [ ] **C-9: Tests** - see §5
- [ ] **C-10: Docs** - README CORS section, `doc/ARCHITECTURE.md`, `PLAN.md` Phase 16 checkbox

## 4. Examples

```ts
import { createCorsMiddleware } from "../../src/middleware/CorsMiddleware";

app.use(createCorsMiddleware({
    origin: ["http://localhost:5173"], // e.g. a Vite dev server on another port
    credentials: true,
    maxAge: 600,
}));

app.get("/api/data", (ctx) => {
    ctx.json({ hello: "world" });
});
```

A real preflight exchange this would produce:

```
OPTIONS /api/data HTTP/1.1
Origin: http://localhost:5173
Access-Control-Request-Method: GET

HTTP/1.1 204 No Content
Access-Control-Allow-Origin: http://localhost:5173
Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS
Access-Control-Allow-Credentials: true
Access-Control-Max-Age: 600
```

Followed by the actual request, with `Access-Control-Allow-Origin` and
`-Credentials` on the real response too - both are needed independently;
a preflight approval doesn't imply the real response carries the headers
automatically.

## 5. Tests

Minimum coverage, pass and failure cases both:

- [ ] An actual (non-preflight) request from an allowed origin gets `Access-Control-Allow-Origin` set to that origin
- [ ] An actual request from a disallowed origin does **not** get the header set - the server doesn't need to reject the request itself, the browser blocks reading the response client-side once the header is absent
- [ ] A genuine preflight (`Origin` + `Access-Control-Request-Method` both present) is intercepted and answered directly by the middleware, and never reaches `Router`
- [ ] A non-preflight `OPTIONS` request (no `Access-Control-Request-Method`) still gets `Router`'s existing automatic `OPTIONS`/`Allow` behavior, completely unaffected by this middleware being registered
- [ ] `credentials: true` always echoes the specific request's `Origin`, never `*`, even when `origin` is configured as `"*"` or an array containing multiple entries
- [ ] `createCorsMiddleware({ credentials: true, origin: "*" })` throws synchronously at creation time, not per-request
- [ ] `origin` as a function receives the request's actual `Origin` value, and its boolean return determines whether the allow header is set
- [ ] `maxAge` sets `Access-Control-Max-Age` on preflight responses only, never on actual-request responses
- [ ] `exposedHeaders` sets `Access-Control-Expose-Headers` on the actual response, not the preflight response
- [ ] With no `exposedHeaders` configured, `Access-Control-Expose-Headers` is never set at all - not an empty header, absent entirely
- [ ] `Vary: Origin` is set on an actual response when `origin` is a string, `string[]`, or function
- [ ] `Vary: Origin` is set on a preflight response too, not just actual responses
- [ ] `Vary: Origin` is **not** set when `origin` is configured as the literal `"*"`
- [ ] `Vary: Origin` is appended to an existing `Vary` header value (e.g. one already set by another middleware) rather than overwriting it
- [ ] A preflight response includes a plain `Allow` header, with the same method list as `Access-Control-Allow-Methods`
- [ ] `Allow` and `Access-Control-Allow-Methods` both reflect `CorsOptions.methods` - not the actual routes registered for the requested path, confirming the deliberate non-`Router`-derived behavior from §2.2

## 6. Guardrails (over-engineering risk)

- No CSP/security-headers framework - CORS only, per Phase 16's scope
- No pattern-matching DSL for origins (e.g. built-in `*.example.com` wildcard matching) - the `origin` function option already covers this without Empire inventing and maintaining a matcher
- Don't reimplement or duplicate `Router`'s `OPTIONS`/`Allow` logic - this middleware owns true preflights only, defers to `Router` for everything else, per §2.2
- No new `Empire.ts` method - plain middleware via the existing `app.use()`, per §2.1

## 7. Open questions / parking lot

- Default `allowedHeaders` behavior (§2.3) - reflecting back whatever the browser's preflight requested is the permissive default most CORS libraries ship with, but it is a default worth a deliberate yes/no rather than assuming, the same way Validation's dependency packaging was left open rather than silently decided.
- **Preflight requesting a disallowed method** - if `Access-Control-Request-Method` isn't in the configured `methods` list, what should the middleware do? Still respond `204` and simply omit that method from `Access-Control-Allow-Methods` (letting the browser itself reject the follow-up request), or answer differently? Not decided.
- **No `Origin` header at all** - same-origin requests and non-browser clients (curl, server-to-server calls) never send `Origin`. The design implies the middleware should do nothing and pass these through untouched, but this has never been stated outright, and §5's test list has no case for it.
- **Single global policy only.** This design supports exactly one CORS policy via one `app.use(createCorsMiddleware(...))` call. A real app sometimes wants different rules per route group (e.g. a public API vs. an admin API). That isn't possible without route-scoped middleware, which Empire doesn't have yet - worth naming as a known limitation of this design rather than assuming one global policy is always sufficient. Not something this doc resolves.
- **`maxAge` default when unset** - not stated what happens if `maxAge` isn't configured. Presumably `Access-Control-Max-Age` is simply omitted, letting the browser fall back to its own default preflight-cache duration, but this should be said explicitly rather than left to guesswork.

## 8. Decisions log

- **2026-08-29** — Spec created. Two headline decisions made up front rather than left open: (1) plain middleware via the existing `app.use()`, no new `Empire.ts` method, matching the precedent `validate()` set in Phase 11; (2) zero new dependency - CORS is pure header logic, doesn't need a library the way schema validation needed Zod. The preflight-vs-`Router`'s-existing-`OPTIONS`-handling interaction (§2.2) is the one genuinely hard part of this design and is fully specified, not left open.
- **2026-08-29** — `exposedHeaders` added to `CorsOptions` (§2.3), resolving what had briefly been an open question in §7. Sets `Access-Control-Expose-Headers` on the actual response (not the preflight) - without it, cross-origin JS can only read the small browser-safelisted set of response headers, and any app exposing custom headers (pagination info, a request-id, rate-limit headers) would have no way to make them readable cross-origin. No default - unset means nothing extra is exposed. Deliberately more conservative than `allowedHeaders`/`methods`, which both default permissively (reflecting back what was asked, or a standard method list) - those two only affect what a browser is allowed to *send*, while `exposedHeaders` controls what internal header names get revealed to cross-origin JS at all, which is a more consequential default to get wrong.
- **2026-08-29** — `Vary: Origin` resolved and added as §2.5, closing the open question in §7. Set (appended, not overwritten) on both preflight and actual responses whenever `origin` isn't the literal `"*"`; never set when it is. Reasoning: our design only echoes back `Access-Control-Allow-Origin` when the incoming request's `Origin` matches the configured allowlist, so for any non-wildcard `origin` config the response genuinely varies by request - without `Vary: Origin`, a cache in front of the app (browser cache, CDN, reverse proxy) could serve a response meant for one origin to a different one.
- **2026-08-29** — The preflight-`Allow`-header question resolved (§2.2), closing the open question in §7: yes, include `Allow` on the preflight response, sourced from `CorsOptions.methods` - the same source as `Access-Control-Allow-Methods`. A `Router`-coupled alternative (a public `getAllowedMethodsForPath()`, `cors(router: Router)` taking a live `Router` reference for a path-exact `Allow` value) was considered and explicitly rejected: the underlying method-lookup logic already exists internally in `Router.findRoute()`, so it wasn't a matching-logic cost, but adopting it would have required a new public `Empire.router` getter and broken the "middleware needs only its own config, never a live framework object" precedent every other middleware (`createLoggerMiddleware`, `validate()`) has held to. It would also have removed the ability to deliberately expose a narrower `Access-Control-Allow-Methods` surface than what's actually implemented (a route that exists for same-origin use only, never meant to be cross-origin-callable) - keeping that an explicit, independent allowlist is a real capability worth keeping, not an oversight to fix. The resulting `Allow` header is therefore a global-config approximation, not path-exact the way `Router`'s own `Allow` is - stated explicitly in §2.2 rather than silently assumed.
