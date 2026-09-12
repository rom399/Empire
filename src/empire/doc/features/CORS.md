# Empire — CORS: Design & Build Doc

**Status:** Implemented
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
  This includes the specific case of **no `Origin` header at all** -
  same-origin requests and non-browser clients (curl, server-to-server
  calls) never send one. There's nothing for the middleware to check
  against, so it does nothing and calls `next()` immediately, exactly as
  if this middleware weren't registered.

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

**A preflight requesting a method outside `CorsOptions.methods`** still
gets a `204` - the middleware doesn't reject the preflight itself with an
error status. `Access-Control-Allow-Methods` simply never lists the
disallowed method, so the browser makes the enforcement decision itself
and refuses to send the actual request. This is the standard,
spec-conformant behavior most CORS implementations use - a preflight
answering "here's what's actually allowed" rather than the server trying
to detect and specially reject an unrecognized method up front.

### 2.3 Configuration Example

```ts
export interface CorsOptions {
    /** Which origins may read the response. */
    origin: string | string[] | ((origin: string) => boolean);
    /** Defaults to a standard set: GET, POST, PUT, PATCH, DELETE, OPTIONS. */
    methods?: string[];
    /**
     * No default - an unconfigured allowedHeaders means no headers beyond
     * CORS's own safelisted "simple" set are permitted on the actual
     * request, regardless of what the browser's preflight claims it wants
     * to send. Must be explicitly listed to allow anything else (e.g.
     * ["Content-Type", "Authorization"]) - strict by default, not a
     * reflect-back-whatever-was-asked convenience.
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
    /**
     * Access-Control-Max-Age, in seconds - how long a browser may cache
     * one preflight result. No default - when unset, the header is
     * omitted entirely, and the browser falls back to its own default
     * preflight-cache duration rather than Empire imposing one.
     */
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
real response, not the preflight). Both now share the same strict
philosophy - neither permits anything beyond the browser's own CORS
safelist unless explicitly configured, nothing implicitly opened up.

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

### 2.6 Multiple policies for different endpoint groups (the cheap option)

Resolves what had been the "single global policy only" limitation in §7,
without Empire gaining real route-scoped middleware - see
`PLAN.md` Phase 3's "Route-level middleware" (remaining, unstarted) and
`doc/ARCHITECTURE.md`'s Known Architectural Issues for that larger,
separate effort. This is a narrower, CORS-specific workaround: since
`createCorsMiddleware()` already sees `ctx.path` on every request, it can
pick a different policy based on the path entirely within its own
function body, without `Router` or `Empire.ts` involvement at all - the
same "middleware needs only its own config" precedent held throughout
this design.

```ts
export interface CorsPolicy {
    /** Matches the request path this policy applies to. */
    match: (path: string) => boolean;
    options: CorsOptions;
}

export type CorsConfig = CorsOptions | { policies: CorsPolicy[]; fallback?: CorsOptions };

export function createCorsMiddleware(config: CorsConfig): Middleware { /* ... */ }
```

```ts
app.use(createCorsMiddleware({
    policies: [
        { match: (path) => path.startsWith("/api/admin"), options: { origin: ["https://admin.example.com"], credentials: true } },
        { match: (path) => path.startsWith("/api/public"), options: { origin: "*" } },
    ],
    // No fallback here - a path matching neither policy gets no CORS
    // headers at all, same as if this middleware weren't registered.
}));
```

- **First match wins** - the same precedence rule Empire's own routing
  already uses (documented in `README.MD`'s Routing section), not a new
  convention to learn.
- **No matching policy and no `fallback`** - the request passes through
  with no CORS headers touched, exactly as if the middleware weren't
  there for that path. Not an error, not a default-deny - CORS being
  absent for a path is a legitimate, common case (e.g. same-origin-only
  endpoints mixed with public ones on the same server).
- **The credentials + wildcard-origin guard (§2.4) applies per policy**,
  not once globally - `createCorsMiddleware()` validates every policy's
  `options` (and `fallback`'s, if present) at creation time, so a mistake
  in any one policy still crashes loudly before the server starts,
  exactly as a single flat `CorsOptions` misconfiguration would.
- A plain `CorsOptions` (today's structure) keeps working unchanged -
  `policies` is an alternative form `createCorsMiddleware()`'s argument
  can take, not a breaking change to the existing one.

## 3. Build order / milestones

- [x] **C-1: `CorsOptions` + `createCorsMiddleware()` skeleton** - origin matching (string/array/function), sets `Access-Control-Allow-Origin` on non-preflight responses for an allowed origin
- [x] **C-2: Preflight detection & short-circuit** - `Origin` + `Access-Control-Request-Method` both present → `204` with `Access-Control-Allow-Methods`/`-Headers`/`-Max-Age`, no `next()` call. No `Origin` header at all → `next()` immediately, no-op (§2.2). A requested method outside `CorsOptions.methods` → still `204`, just omitted from `Access-Control-Allow-Methods` rather than rejected (§2.2)
- [x] **C-3: `Allow` on the preflight response** - sourced from `CorsOptions.methods`, same list as `Access-Control-Allow-Methods` (§2.2); not `Router`-derived, see §2.2 for why
- [x] **C-4: Credentials + wildcard-origin guard** - throws at creation time for the invalid combination (2.4); per-request specific-origin echo when `credentials: true`
- [x] **C-5: `allowedHeaders`** - sets `Access-Control-Allow-Headers` on the preflight response from the configured list only; strict by default, no reflection of `Access-Control-Request-Headers`
- [x] **C-6: `exposedHeaders`** - sets `Access-Control-Expose-Headers` on the actual (non-preflight) response when configured
- [x] **C-7: `Vary: Origin`** - set (appended, not overwritten) on both preflight and actual responses whenever `origin` isn't the literal `"*"`; omitted when it is (§2.5)
- [x] **C-8: Multi-policy support** - `CorsConfig` accepting either a plain `CorsOptions` or `{ policies, fallback? }`, first-match-wins path matching, per-policy credentials+wildcard validation at creation time (§2.6)
- [x] **C-9: Example** - `examples/11-cors/server.ts`, a real cross-origin request that only succeeds because of the middleware
- [x] **C-10: Tests** - see §5
- [x] **C-11: Docs** - README CORS section, `doc/ARCHITECTURE.md`, `PLAN.md` Phase 16 checkbox

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

**`allowedHeaders`, showing the strict-by-default behavior from §2.3/§8:**
a frontend sending a Bearer token needs to send `Authorization` and
`Content-Type: application/json` - neither is on CORS's "simple header"
safelist, so both trigger a preflight, and both need to be explicitly
permitted:

```ts
app.use(createCorsMiddleware({
    origin: ["http://localhost:5173"],
    allowedHeaders: ["Content-Type", "Authorization"],
}));

app.post("/api/orders", validate({ body: createOrderSchema })(async (ctx, { body }) => {
    // ctx.headers.authorization is readable here because the preflight
    // below already approved it - if allowedHeaders hadn't listed it,
    // the browser would have refused to send this request at all.
    ctx.status(201).json(body);
}));
```

The preflight this produces:

```
OPTIONS /api/orders HTTP/1.1
Origin: http://localhost:5173
Access-Control-Request-Method: POST
Access-Control-Request-Headers: authorization, content-type

HTTP/1.1 204 No Content
Access-Control-Allow-Origin: http://localhost:5173
Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
```

Note that `Access-Control-Allow-Headers` in the response is exactly the
*configured* `allowedHeaders` list - not a reflection of the preflight's
own `Access-Control-Request-Headers`, even though the two happen to
match here. **What actually demonstrates the strict default** is the
frontend trying to send a header nobody configured, e.g. adding a custom
`X-Client-Version` header without updating `allowedHeaders`:

```
Access-Control-Request-Headers: authorization, content-type, x-client-version
```

still gets back the same `Access-Control-Allow-Headers: Content-Type, Authorization`
- `x-client-version` is silently absent, so the browser refuses to send
that header on the real request. No server-side error, no rejected
preflight - the browser enforces it, and the fix is adding
`"X-Client-Version"` to `allowedHeaders`, not debugging a server response.

## 5. Tests

Minimum coverage, pass and failure cases both:

- [x] An actual (non-preflight) request from an allowed origin gets `Access-Control-Allow-Origin` set to that origin
- [x] An actual request from a disallowed origin does **not** get the header set - the server doesn't need to reject the request itself, the browser blocks reading the response client-side once the header is absent
- [x] A genuine preflight (`Origin` + `Access-Control-Request-Method` both present) is intercepted and answered directly by the middleware, and never reaches `Router`
- [x] A non-preflight `OPTIONS` request (no `Access-Control-Request-Method`) still gets `Router`'s existing automatic `OPTIONS`/`Allow` behavior, completely unaffected by this middleware being registered
- [x] `credentials: true` always echoes the specific request's `Origin`, never `*`, even when `origin` is configured as `"*"` or an array containing multiple entries
- [x] `createCorsMiddleware({ credentials: true, origin: "*" })` throws synchronously at creation time, not per-request
- [x] `origin` as a function receives the request's actual `Origin` value, and its boolean return determines whether the allow header is set
- [x] `maxAge` sets `Access-Control-Max-Age` on preflight responses only, never on actual-request responses
- [x] `exposedHeaders` sets `Access-Control-Expose-Headers` on the actual response, not the preflight response
- [x] With no `exposedHeaders` configured, `Access-Control-Expose-Headers` is never set at all - not an empty header, absent entirely
- [x] `Vary: Origin` is set on an actual response when `origin` is a string, `string[]`, or function
- [x] `Vary: Origin` is set on a preflight response too, not just actual responses
- [x] `Vary: Origin` is **not** set when `origin` is configured as the literal `"*"`
- [x] `Vary: Origin` is appended to an existing `Vary` header value (e.g. one already set by another middleware) rather than overwriting it
- [x] A preflight response includes a plain `Allow` header, with the same method list as `Access-Control-Allow-Methods`
- [x] `Allow` and `Access-Control-Allow-Methods` both reflect `CorsOptions.methods` - not the actual routes registered for the requested path, confirming the deliberate non-`Router`-derived behavior from §2.2
- [x] With `policies` configured, a request matching the first policy's `match()` uses that policy's `CorsOptions`, not a later policy's, even if the later one would also match
- [x] A request matching no policy and no `fallback` is configured gets no CORS headers touched at all - not an error, not a default-deny response
- [x] A request matching no policy but a `fallback` is configured uses the `fallback` options
- [x] A misconfigured policy (`credentials: true` + `origin: "*"`) crashes at `createCorsMiddleware()` creation time the same way a single flat `CorsOptions` misconfiguration does - confirmed for a policy other than the first one in the list, not just the first
- [x] With no `maxAge` configured, `Access-Control-Max-Age` is never set at all - not a default value, absent entirely
- [x] A request with no `Origin` header at all reaches the wrapped handler untouched, with no CORS headers added and no preflight short-circuit, regardless of method
- [x] A preflight requesting a method outside `CorsOptions.methods` still gets `204`, with that method simply absent from `Access-Control-Allow-Methods` rather than the preflight being rejected
- [x] With no `allowedHeaders` configured, `Access-Control-Allow-Headers` is never set at all - not a reflection of `Access-Control-Request-Headers`, absent entirely
- [x] With `allowedHeaders` configured, `Access-Control-Allow-Headers` reflects exactly that list, regardless of what `Access-Control-Request-Headers` on the preflight actually asked for

## 6. Guardrails (over-engineering risk)

- No CSP/security-headers framework - CORS only, per Phase 16's scope
- No pattern-matching DSL for origins (e.g. built-in `*.example.com` wildcard matching) - the `origin` function option already covers this without Empire inventing and maintaining a matcher
- Don't reimplement or duplicate `Router`'s `OPTIONS`/`Allow` logic - this middleware owns true preflights only, defers to `Router` for everything else, per §2.2
- No new `Empire.ts` method - plain middleware via the existing `app.use()`, per §2.1

## 7. Open questions / parking lot

None currently - every question this doc raised has been resolved, see §8.

## 8. Decisions log

- **2026-08-29** — Spec created. Two headline decisions made up front rather than left open: (1) plain middleware via the existing `app.use()`, no new `Empire.ts` method, matching the precedent `validate()` set in Phase 11; (2) zero new dependency - CORS is pure header logic, doesn't need a library the way schema validation needed Zod. The preflight-vs-`Router`'s-existing-`OPTIONS`-handling interaction (§2.2) is the one genuinely hard part of this design and is fully specified, not left open.
- **2026-08-29** — `exposedHeaders` added to `CorsOptions` (§2.3), resolving what had briefly been an open question in §7. Sets `Access-Control-Expose-Headers` on the actual response (not the preflight) - without it, cross-origin JS can only read the small browser-safelisted set of response headers, and any app exposing custom headers (pagination info, a request-id, rate-limit headers) would have no way to make them readable cross-origin. No default - unset means nothing extra is exposed. Deliberately more conservative than `methods`, which defaults permissively (a standard method list) since it only affects what a browser is allowed to *send*, while `exposedHeaders` controls what internal header names get revealed to cross-origin JS at all, which is a more consequential default to get wrong. *(At the time, `allowedHeaders` was also permissive-by-default and part of this same contrast - see the 2026-09-08 entry below, where that changed.)*
- **2026-08-29** — `Vary: Origin` resolved and added as §2.5, closing the open question in §7. Set (appended, not overwritten) on both preflight and actual responses whenever `origin` isn't the literal `"*"`; never set when it is. Reasoning: our design only echoes back `Access-Control-Allow-Origin` when the incoming request's `Origin` matches the configured allowlist, so for any non-wildcard `origin` config the response genuinely varies by request - without `Vary: Origin`, a cache in front of the app (browser cache, CDN, reverse proxy) could serve a response meant for one origin to a different one.
- **2026-08-29** — The preflight-`Allow`-header question resolved (§2.2), closing the open question in §7: yes, include `Allow` on the preflight response, sourced from `CorsOptions.methods` - the same source as `Access-Control-Allow-Methods`. A `Router`-coupled alternative (a public `getAllowedMethodsForPath()`, `cors(router: Router)` taking a live `Router` reference for a path-exact `Allow` value) was considered and explicitly rejected: the underlying method-lookup logic already exists internally in `Router.findRoute()`, so it wasn't a matching-logic cost, but adopting it would have required a new public `Empire.router` getter and broken the "middleware needs only its own config, never a live framework object" precedent every other middleware (`createLoggerMiddleware`, `validate()`) has held to. It would also have removed the ability to deliberately expose a narrower `Access-Control-Allow-Methods` surface than what's actually implemented (a route that exists for same-origin use only, never meant to be cross-origin-callable) - keeping that an explicit, independent allowlist is a real capability worth keeping, not an oversight to fix. The resulting `Allow` header is therefore a global-config approximation, not path-exact the way `Router`'s own `Allow` is - stated explicitly in §2.2 rather than silently assumed.
- **2026-08-29** — "Single global policy only" resolved as §2.6, closing the open question in §7 - but deliberately with the cheap option, not the complete fix. `CorsConfig` now accepts either a plain `CorsOptions` or `{ policies, fallback? }`, matched by path entirely inside `createCorsMiddleware()`'s own function body - no `Router`/`Empire.ts` involvement, consistent with every other decision in this doc. The actual underlying gap (Empire has no real route-scoped middleware at all - `examples/08-authentication` already hand-rolls the same path-checking this design now does for CORS specifically) is a separate, much larger effort, now tracked in `PLAN.md` Phase 3's "Route-level middleware" (remaining, unstarted) and named in `doc/ARCHITECTURE.md`'s Known Architectural Issues - not something this doc attempts to solve. If real route-scoped middleware is ever built, `policies`/`fallback` here becomes redundant and should collapse away in favor of it.
- **2026-08-29** — Three remaining §7 items resolved together, closing all but the `allowedHeaders` default (left for a deliberate policy call, not derived here): (1) `maxAge` unset omits `Access-Control-Max-Age` entirely rather than defaulting to a value, letting the browser use its own default preflight-cache duration - stated in `CorsOptions`'s JSDoc (§2.3) rather than left implicit; (2) a request with no `Origin` header at all is a no-op - `next()` immediately, nothing to check against, folded into §2.2's existing "Otherwise" branch rather than treated as a separate case; (3) a preflight requesting a method outside `CorsOptions.methods` still gets `204`, with that method simply absent from `Access-Control-Allow-Methods` rather than the preflight itself being rejected - the standard, spec-conformant behavior, letting the browser make the actual enforcement decision.
- **2026-09-08** — `allowedHeaders` default resolved, closing the last item in §7 - the user's own call, not derived from a technical fact the way every other resolution in this doc was. **Strict by default**, reversing the original permissive draft: an unconfigured `allowedHeaders` means `Access-Control-Allow-Headers` is never set at all, regardless of what the preflight's `Access-Control-Request-Headers` asked for - explicit configuration required to permit anything beyond CORS's own safelisted "simple" headers. `allowedHeaders` and `exposedHeaders` now share the same conservative philosophy (see the 2026-08-29 `exposedHeaders` entry above, written when they still differed). This closes every open question this doc has raised - §7 is empty as of this entry.
- **2026-09-12** — Full implementation landed: C-1 through C-11 all complete. `src/middleware/CorsOptions.ts`, `CorsPolicy.ts`, `CorsConfig.ts`, `CorsMiddleware.ts` (`createCorsMiddleware()`); `examples/11-cors/server.ts`; `tests/unit/middleware/CorsMiddleware.test.ts` (36 cases, covering all of §5); README, `doc/ARCHITECTURE.md`, and `PLAN.md` Phase 16 updated. Status moves from Draft to Implemented. Two implementation notes worth recording:
  - **Disallowed-origin preflight still short-circuits.** §2.2 splits "genuine preflight" from "everything else" purely by header presence (`Origin` + `Access-Control-Request-Method`), before any origin-allowlist check - read literally, a preflight from an origin *not* on the allowlist is still answered directly by this middleware (`204`, `Router` never sees it), just with every `Access-Control-Allow-*` header omitted rather than populated. This wasn't spelled out as its own case in §2.2 or tested for explicitly in §5, but follows from the ordering the doc already specifies, avoids leaking the configured methods/headers list to a disallowed origin, and still leaves the browser blocking the follow-up real request either way.
  - **§5's `credentials` test bullet conflicts with §2.4's guard** - one bullet says `credentials: true` should echo the specific `Origin` "even when `origin` is configured as `\"*\"`", the very next bullet says that exact combination throws at creation time. The guard (§2.4) is what's actually implemented and tested; the credentials-echo test instead uses an array-form `origin` to demonstrate the same echo behavior without the wildcard conflict. §5 itself is left as originally written rather than silently edited, since it predates this build and the discrepancy is now recorded here.
