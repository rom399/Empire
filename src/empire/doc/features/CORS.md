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

## 3. Build order / milestones

- [ ] **C-1: `CorsOptions` + `createCorsMiddleware()` skeleton** - origin matching (string/array/function), sets `Access-Control-Allow-Origin` on non-preflight responses for an allowed origin
- [ ] **C-2: Preflight detection & short-circuit** - `Origin` + `Access-Control-Request-Method` both present → `204` with `Access-Control-Allow-Methods`/`-Headers`/`-Max-Age`, no `next()` call
- [ ] **C-3: Credentials + wildcard-origin guard** - throws at creation time for the invalid combination (2.4); per-request specific-origin echo when `credentials: true`
- [ ] **C-4: `allowedHeaders` reflection default**
- [ ] **C-5: Example** - `examples/11-cors/server.ts`, a real cross-origin request that only succeeds because of the middleware
- [ ] **C-6: Tests** - see §5
- [ ] **C-7: Docs** - README CORS section, `doc/ARCHITECTURE.md`, `PLAN.md` Phase 16 checkbox

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

## 6. Guardrails (over-engineering risk)

- No CSP/security-headers framework - CORS only, per Phase 16's scope
- No pattern-matching DSL for origins (e.g. built-in `*.example.com` wildcard matching) - the `origin` function option already covers this without Empire inventing and maintaining a matcher
- Don't reimplement or duplicate `Router`'s `OPTIONS`/`Allow` logic - this middleware owns true preflights only, defers to `Router` for everything else, per §2.2
- No new `Empire.ts` method - plain middleware via the existing `app.use()`, per §2.1

## 7. Open questions / parking lot

- Should a preflight response the middleware answers directly also include an `Allow` header, for consistency with `Router`'s own convention? Not required by the CORS spec either way - low priority, worth a quick decision before C-2, not a blocker for the design.
- Default `allowedHeaders` behavior (§2.3) - reflecting back whatever the browser's preflight requested is the permissive default most CORS libraries ship with, but it is a default worth a deliberate yes/no rather than assuming, the same way Validation's dependency packaging was left open rather than silently decided.

## 8. Decisions log

- **2026-08-29** — Spec created. Two headline decisions made up front rather than left open: (1) plain middleware via the existing `app.use()`, no new `Empire.ts` method, matching the precedent `validate()` set in Phase 11; (2) zero new dependency - CORS is pure header logic, doesn't need a library the way schema validation needed Zod. The preflight-vs-`Router`'s-existing-`OPTIONS`-handling interaction (§2.2) is the one genuinely hard part of this design and is fully specified, not left open.
