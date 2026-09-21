# Empire — Load Balancer, Core L7: Design & Build Doc

**Status:** Implemented
**Scope:** Native TypeScript architecture. Phase 23 in `PLAN.md`.
**Timeline:** Designed by Opus ➡️ Executed by Sonnet

---

## 1. Context & Architectural Goals

### 1.1 The Problem

Empire serves one application per process. Running several copies of an app - to compare
behaviour, to spread load, or to learn how a front door works - needs something in front of
them that accepts a request, picks a backend, and relays the response. `PLAN.md` Phase 23
frames this as a *simple load balancer*, explicitly a learning and local-development feature
rather than a production edge.

Three things make the naive version (a fixed list of backend URLs and a proxy loop)
unsatisfying:

* **The backend list is not fixed.** Start a fourth backend and it should receive traffic with
  no balancer restart and no config edit; kill one and it should stop receiving traffic on its
  own. That needs backends that announce themselves and a balancer that forgets the ones that
  go quiet.
* **A balancer is invisible.** Its value as a learning feature is *seeing* it work: round robin
  sweeping around a ring, a slow backend accumulating in-flight requests, a new backend
  picking up its share. So the visualizer is the point of the feature, not an extra.
* **"What is this backend doing?" has no answer without adding logging to the backend.** A
  per-backend, per-route view (`GET /users/:id`, with counts, error rates and latency) answers
  it from the balancer's side.

`PLAN.md` also lists Phase 21 (usage statistics) as a prerequisite. That is only true for
*least connections*, which needs live in-flight counts (see `06_Loadbalancer_Least_Conn.md`).
Round robin needs no metrics at all, so this slice does not depend on Phase 21.

This document is the **core slice**: the proxy, round robin behind a strategy seam,
self-registration with leases, the monitor, the live 3D dashboard and its drill-down.

### 1.2 System Goals

* **Goal 1 - A small L7 reverse proxy.** Empire spreads incoming requests across backend HTTP
  servers, streaming both directions, with round robin first behind an `ILoadBalancingStrategy`
  seam so further algorithms slot in without touching the proxy.
* **Goal 2 - Backends register themselves.** A backend announces itself on startup, keeps a
  *lease* alive with heartbeats, and deregisters on shutdown. A killed backend drops out when
  its lease expires, with no active probing by the balancer.
* **Goal 3 - A live 3D visualizer.** three.js: the balancer as a hub, backends on a ring, each
  request a particle from hub to the backend that received it. Backends appear and disappear
  as they register and expire.
* **Goal 4 - Drill into any backend.** Click a node and see the calls hitting it grouped by
  route, with counts, error rates and latency, plus a live tail of individual requests.
* **Goal 5 - Plain middleware, no core growth.** Everything is a plain middleware or a plain
  class registered through the existing `app.use()`. `Empire.ts` does not change.
* **Goal 6 - Safe by default.** Registration is the sharp edge (whoever can register can steer
  traffic), so the endpoint requires a token and serves loopback clients only unless both are
  knowingly relaxed.
* **Goal 7 - Bounded memory.** Nothing the monitor keeps grows with traffic volume or with the
  variety of request paths.

### 1.3 Non-Goals (Scope Guardrails)

* **Non-Goal 1 - Production use.** No TLS termination, no HTTP/2, no WebSocket or `Upgrade`
  proxying, no clustering of the balancer itself.
* **Non-Goal 2 - Active health checks.** The balancer never probes a backend. Liveness comes
  from lease heartbeats (rule 3).
* **Non-Goal 3 - External discovery.** No DNS SRV, Consul, Docker labels or Kubernetes.
* **Non-Goal 4 - Sticky sessions / session affinity.**
* **Non-Goal 5 - Rate limiting.** Still an edge concern; see 2.4 for why a balancer does not
  contradict that stance.
* **Non-Goal 6 - Passive ejection.** A backend that heartbeats but answers 502 to everything
  stays in rotation. "N consecutive connect failures, skip for M seconds" is a separate slice.
* **Non-Goal 7 - Retries.** None. If added, only idempotent methods on connect failures, with
  a `retried` event so the visualizer still shows them.
* **Non-Goal 8 - Registration metadata.** The `PUT` body stays `{ url }`. `weight` and `tags`
  arrive with the slices that use them.
* **Non-Goal 9 - Header or body capture in call detail.** They would carry credentials and PII
  and turn a traffic visualizer into an inspection proxy. If ever wanted: an allowlist (never
  `Authorization`, `Cookie`, `Set-Cookie`), off by default, in its own slice.
* **Non-Goal 10 - A build step or a UI framework for the dashboard.** Plain three.js and plain
  DOM in a string served by the balancer. React Three Fiber would need React and a JSX compile.
* **Non-Goal 11 - New core surface.** No `app.useLoadBalancer()`, no `EmpireGateway` class, no
  automatic hooking of `app.start()` (see 2.1 for each rejection).
* **Deferred, revisit later:** active health checks, external discovery, WebSocket proxying,
  HTTPS backends, sticky sessions, `onStarted` / `onStopping` lifecycle hooks on `Empire`
  (which would let registration wire itself up), passive ejection, weighted round robin,
  header-based routing. The strategy seam already accommodates the last two.

### 1.4 Dependency Stance

**Zero runtime dependencies. Native Node.js modules only. This rule has no exceptions in the
package.**

* `package.json` has no `dependencies` block, and `require("empire-ts")` loads no third-party
  module (measured: 0 files from `node_modules`).
* **Proxying** is `node:http` plus stream piping. There is no proxy library.
* **Registration client** uses `fetch`, built into Node 18+. **Registration endpoint**
  validates ids and urls with hand-written checks (`validateRegistrationRequest`); no
  validation library is involved. (This slice originally used Zod for that; Zod has since been
  removed from the whole repository - see `03_Request_Validation.md`.)
* **Dashboard transport** is Server-Sent Events over a plain `text/event-stream` response.
  There is no WebSocket library.
* **The dashboard page** is a string exported from a `.ts` file - no build step and nothing
  added to the package.

**The one third-party thing in the feature is not a Node dependency.** The dashboard page runs
in the *browser* and needs three.js. The page loads it through an **import map** pointing at a
pinned exact version on a CDN (`THREE_VERSION = "0.170.0"`, jsDelivr). The `empire-ts` package
never imports it, it appears in no `package.json`, and nothing on the Node side loads it.

* **Default:** CDN, because it is zero-install. It means the dashboard needs internet access
  and trusts a third-party host.
* **Offline or self-hosted:** `three: { baseUrl }` points at a mirror, or `threeLocalPath`
  serves a directory from the *user's own* `node_modules/three` under `{path}/vendor/three/`.
  `three` is then the user's dev dependency, never Empire's.
* **Without WebGL** the 2D overlay still works fully.

State this nuance plainly wherever the dashboard is documented: a browser-side library
inside a framework whose package has none is defensible (package unchanged, opt-in page,
overridable), but it is a real nuance and should not be glossed.

---

## 2. Design & API Contracts (The Opus Blueprint)

### 2.1 Public User API

**Balancer app:**

```ts
const monitor = new LoadBalancerMonitor();
const registry = new BackendRegistry({ leaseTtlMs: 15_000, monitor });

// Optional: pinned backends that never expire and can't be deregistered remotely.
registry.addStatic({ id: "legacy", url: "http://127.0.0.1:5009" });

app.use(createLoadBalancerDashboard(monitor, { path: "/_lb" }));
app.use(createBackendRegistrationEndpoint(registry, {
    path: "/_lb/registry",
    token: process.env.EMPIRE_LB_TOKEN,
}));
app.use(createLoadBalancerMiddleware({
    registry,                           // or `backends: [...]` as shorthand for a static-only registry
    strategy: new RoundRobinStrategy(), // default if omitted
    monitor,
    timeoutMs: 30_000,
}));
```

**Backend app:**

```ts
const app = new Empire({ port: 5001 });
// ...routes...
app.use(createRouteHeaderMiddleware());   // optional: lets the balancer see "/users/:id", not "/users/42"
await app.start();

const registration = new LoadBalancerRegistration({
    registryUrl: "http://127.0.0.1:5000/_lb/registry",
    id: "alpha",
    url: "http://127.0.0.1:5001",
    token: process.env.EMPIRE_LB_TOKEN,
});
await registration.start();   // registers, then heartbeats in the background

// on shutdown
await registration.stop();    // deregisters (best effort)
await app.stop();
```

**Dashboard options** (`LoadBalancerDashboardOptions`):

```ts
createLoadBalancerDashboard(monitor, {
    path: "/_lb",
    allowRemote: false,                                                  // loopback-only unless true
    three: { baseUrl: "https://mirror.example/three/" },                 // default: pinned jsDelivr URL
    threeLocalPath: path.dirname(require.resolve("three/package.json")), // optional: serve a local install
    heartbeatIntervalMs: 15_000,
});
```

**Registration protocol** (served by `createBackendRegistrationEndpoint`, under `path`):

| Request | Meaning | Response |
|---|---|---|
| `PUT {path}/{id}` body `{ url }` | Register **or** renew | `201` new / `200` renewed, body `{ leaseTtlMs }` |
| `DELETE {path}/{id}` | Deregister | `204` (also `204` if already gone - idempotent) |
| `GET {path}` | List registered backends | `200` JSON, for debugging |

**Ordering rules** (they multiply, so the README states them bluntly):

1. `createLoadBalancerMiddleware` is **terminal**: it never calls `next()`. Anything the balancer
   app answers itself - the dashboard, the registration endpoint, a health route - must be
   registered *before* it.
2. The balancer must run **before** any middleware that reads the request body, or there is
   nothing left to pipe.
3. A backend must **deregister before it stops serving** (`registration.stop()` then
   `app.stop()`), which is what gives graceful draining (rule 5).

`createLoadBalancerMiddleware()` and `createLoadBalancerDashboard()` return callable objects
with a `dispose()` - still plain middleware for `app.use()`. The first closes its keep-alive
agent; the second ends open event streams, which would otherwise hold `Empire.stop()` until its
timeout.

**Considered and rejected:**

* **`app.useLoadBalancer(options)`.** Grows `Empire.ts`'s public surface for no capability
  `app.use()` lacks (the same reasoning as `app.useCors()` in `04_CORS_Compliance.md`).
* **A separate `EmpireGateway` class.** Duplicates `start()` / `stop()` / logging / dispatch,
  and the middleware pipeline is exactly what makes the balancer composable: request logging,
  request ids and a future `app.onError` hook work in front of it for free.
* **`LoadBalancerRegistration` hooking `app.start()` automatically.** Empire has no lifecycle
  hook mechanism, and adding one only for this is core growth. An explicit `start()` / `stop()`
  pair the caller sequences makes the ordering (serve first, *then* announce; deregister first,
  *then* stop serving) visible rather than hidden.
* **The balancer polling a backend list** (config-file watch, or probing candidate ports).
  File-watching is "config hot-reload" and probing is active health checking - both out of
  scope. Self-registration is the one model where the backend is the source of truth about its
  own existence.
* **Inferring the backend's host from the registering socket.** It would stop a registrant
  pointing traffic at a third host, but the token already gates who can register, and
  inference breaks when a backend registers through a proxy or advertises a different
  interface than it dialled out on. The advertised `url` is trusted.

### 2.2 Core Interfaces & Data Models

**Module layout.** `src/loadbalancing/` is split by concern rather than left flat:

```
src/loadbalancing/
├── Backend.ts, BackendInfo.ts, isLoopbackAddress.ts   # shared by several folders, so at the root
├── backends/        # BackendRegistry, BackendRegistryOptions, backendIdentity
├── strategy/        # ILoadBalancingStrategy, RoundRobinStrategy
├── proxy/           # LoadBalancerMiddleware, forwardRequest, hopByHopHeaders, resolveRequestId, options
├── registration/    # BackendRegistrationEndpoint, LoadBalancerRegistration, validateRegistrationRequest
├── monitoring/      # LoadBalancerMonitor, event and snapshot types, trackers, LatencyHistogram, normalizePath
└── dashboard/       # LoadBalancerDashboard, DashboardSseClient, and page/ (the three.js client)
```

Imports run one way: `backends`, `proxy`, `registration` and `dashboard` depend on `monitoring`,
`strategy` and the root types, never the reverse. That is why `BackendInfo` lives at the root
rather than in `backends/` - `monitoring` needs it, and putting it in `backends/` would make
the two folders import each other. `tests/unit/loadbalancing/` mirrors the same sub-folders.

**Backends:**

```ts
interface BackendInfo { id: string; url: string; source: "static" | "registered" }
interface Backend extends BackendInfo { expiresAt?: number }   // expiresAt only for registered leases
```

**The strategy seam:**

```ts
interface ILoadBalancingStrategy {
    readonly name: string;                     // the dashboard labels the hub with it
    readonly inFlightSource?: IInFlightSource; // set only by strategies that read live load (see 06)
    select(backends: readonly Backend[], ctx: Context): Backend | undefined;
}
```

`select()` is synchronous and returns `undefined` only when nothing is eligible. It receives
`ctx` so header-based routing can inspect the request later without a signature change.
`RoundRobinStrategy` is the default; further strategies are new classes against this seam.

**Events** (what the proxy and registry report to the monitor):

```ts
type LoadBalancerEvent =
    | { type: "backendAdded";   backend: BackendInfo; expiresAt?: number; at: number }
    | { type: "backendRemoved"; backendId: string; reason: "deregistered" | "expired"; at: number }
    | { type: "leaseRenewed";   backendId: string; expiresAt: number; at: number }
    | { type: "dispatched";     requestId: string; backendId: string; method: string; path: string; at: number }
    | { type: "completed";      requestId: string; backendId: string; status: number; durationMs: number; route?: string; at: number }
    | { type: "failed";         requestId: string; backendId?: string; phase: "select" | "connect" | "timeout" | "stream"; at: number }
    | { type: "aborted";        requestId: string; backendId: string; at: number };
```

`backendAdded` carries an optional `expiresAt` so the dashboard can draw a new backend's lease
arc without waiting for a `leaseRenewed`.

**The monitor's surface** (`LoadBalancerMonitor`):

* `subscribe(listener)` returns an unsubscribe function.
* `snapshot()` returns the live backend list with per-backend total, in-flight, status-class
  counts, latencies, source and lease expiry.
* `detail(backendId)` returns the route stats and the recent-calls buffer for one backend.
* `inFlight(backendId)` returns the in-flight count (0 for an unknown backend); this is what
  least connections reads.

**Per-backend call detail**, kept for the drill-down:

* **Route stats**, keyed by `METHOD route` (e.g. `GET /users/:id`): count, status-class counts,
  and a fixed-bucket latency histogram (~20 log-spaced buckets) from which avg / p50 / p95 / p99
  are read. A histogram rather than stored samples, so memory per route is constant.
* **Recent calls**: a ring buffer of the last 200 requests (id, method, path, route, status,
  duration, timestamp, failure phase if any).

**Route on the request context.** `Context` gains `route?: string`, the pattern `Router`
matched (`/users/:id`); it is `undefined` for 404s and the SPA fallback. This is a one-line core
change, and it is the first piece of Phase 21's "request counts per route" landing early.

**Options** (all optional unless marked):

| Type | Fields |
|---|---|
| `LoadBalancerOptions` | `registry` or `backends` (shorthand), `strategy`, `monitor`, `timeoutMs` (default 30 s), `includeQueryString`, `logger` |
| `BackendRegistryOptions` | `leaseTtlMs` (default 15 s), `monitor`, `now` (test clock) |
| `BackendRegistrationEndpointOptions` | `path` (required), `token`, `allowUnauthenticated`, `allowRemote` |
| `LoadBalancerRegistrationOptions` | `registryUrl`, `id`, `url` (required), `token`, `logger`, `requestTimeoutMs` |
| `LoadBalancerDashboardOptions` | `path` (required), `allowRemote`, `three`, `threeLocalPath`, `heartbeatIntervalMs` |
| `LoadBalancerMonitorOptions` | `logger`, `removedGraceMs`, `now` |

`LoadBalancerRegistrationError` carries the HTTP status, so a heartbeat can tell a 401 or 409
(retrying will not help) from a 5xx.

### 2.3 Internal Processing Logic Rules

**Selection**

1. **The strategy receives the list on every call rather than owning it.** With
   auto-registration the list changes at runtime and the registry - not the strategy - decides
   who is eligible. The middleware asks `registry.eligible()` for a fresh snapshot per request.
2. **`RoundRobinStrategy` keeps a private counter** and returns
   `backends[counter++ % backends.length]`, with the modulo taken against the *current* length
   every call - no stored index into a stale array, so no out-of-bounds when the list grows or
   shrinks. A backend joining mid-rotation only shifts where the sweep lands next; fairness over
   any window of N requests is within one request per backend. `select()` is synchronous, so two
   requests can never interleave inside it: there is no concurrency hazard.

**Registration and leases**

3. **The model is a lease, not a registration.** A backend holds a lease that expires unless
   renewed (the Consul / Eureka pattern). A backend that crashes, hangs or loses its network
   simply stops renewing and falls out after one TTL, without the balancer ever probing it.
4. **Registering and renewing are the same call.** `PUT` is create-or-renew, which gives two
   properties for free: a **balancer restart heals itself** (each backend's next heartbeat
   re-creates its entry, so the client needs no "re-register on 404" logic) and **idempotency**
   (a retried heartbeat can never create a duplicate). The response carries `leaseTtlMs`, so the
   balancer owns the timing; the client heartbeats at `leaseTtlMs / 3`, tolerating two missed
   beats.
5. **Registry rules:**
   * `id` is the identity. Same `id` and same `url` is a renewal. Same `id` with a **different**
     `url` while the lease is live is `409 Conflict`, which stops two misconfigured backends
     silently stealing each other's traffic. After expiry the id is free again.
   * **Static backends** (`addStatic`, or the `backends:` shorthand) are pinned: no lease, never
     expire, and `PUT` / `DELETE` against their id is `409`.
   * **Validation is hand-written** (`validateRegistrationRequest`) and reports **every**
     problem in one `400`. `id` matches the safe set `[A-Za-z0-9_:-]`, 1-128 characters (it ends
     up in logs and on the dashboard). `url` must be a bare absolute `http:` origin - no path,
     query or credentials - because forwarding uses the client's own request target, so anything
     more would be silently ignored and rejecting it is better than dropping it quietly. The
     body must be a JSON object; unknown keys are ignored.
   * **Expiry sweep:** an `unref()`'d interval every `leaseTtlMs / 2` removes expired leases and
     emits `backendRemoved { reason: "expired" }`. It is a timer rather than lazy
     expiry-on-select so the dashboard shows a dead backend disappearing even with no traffic;
     `eligible()` also filters by expiry, so a stale entry cannot be selected between sweeps. The
     timer starts on the first registration, so a registry of only static backends never
     schedules anything.
   * **Removal does not touch in-flight requests.** Deregistration or expiry only removes a
     backend from *future* selection; requests already proxied to it run to completion. That is
     graceful draining for free, provided the backend deregisters *before* it stops serving.
6. **`LoadBalancerRegistration` (the backend-side client)** is a small class using only `fetch`
   and `setTimeout`:
   * `start()` makes the first `PUT` and **rejects if it fails**, so a misconfigured backend
     (wrong URL, wrong token) finds out at startup instead of running unregistered.
   * Heartbeats every `leaseTtlMs / 3` via a chained, `unref()`'d `setTimeout` - not
     `setInterval`, so a slow heartbeat never overlaps the next one.
   * A heartbeat failure is logged at warn and retried on the next tick, with no backoff (the
     interval is already a few seconds, and a local balancer restarting is the common case).
     `401` and `409` are logged at error, since retrying will not fix them.
   * `stop()` cancels the timer and sends `DELETE` with a short timeout, and **resolves even if
     the `DELETE` fails**: the lease expires anyway, so shutdown must never hang on an
     unreachable balancer.

**Proxying**

7. **`forwardRequest(ctx, backend, options)` streams in both directions and never buffers.** A
   buffering proxy would distort the latencies the visualizer shows. Request headers sent
   upstream:
   * Hop-by-hop headers are stripped in both directions per RFC 9110 §7.6.1 (`Connection`,
     `Keep-Alive`, `Proxy-Connection`, `TE`, `Trailer`, `Transfer-Encoding`, `Upgrade`, plus
     anything named inside `Connection`), and also `Proxy-Authenticate` / `Proxy-Authorization`.
     `Expect` is dropped, since Node has already answered `100 Continue`.
   * `Host` is set to the backend's host, and the original goes in `X-Forwarded-Host`. An outer
     proxy's `X-Forwarded-Host` and `-Proto` are preserved rather than overwritten.
   * The client address is **appended** to `X-Forwarded-For`; `X-Forwarded-Proto: http`.
   * The request id is forwarded as `X-Request-Id` (rule 11).
8. **Failure mapping.** 502, 503 and 504 throw `HttpError`, so they flow through the normal
   error path (and `app.onError` once it lands).

   | Situation | Response | Monitor event |
   |---|---|---|
   | No eligible backend | `503 Service Unavailable` | `failed`, phase `select` |
   | Connect error before headers | `502 Bad Gateway` | `failed`, phase `connect` |
   | No response headers within `timeoutMs` | `504 Gateway Timeout`, upstream destroyed | `failed`, phase `timeout` |
   | Upstream dies mid-body | Client socket destroyed | `failed`, phase `stream` |
   | Client disconnects first | Upstream destroyed | `aborted` |

   `timeoutMs` bounds **time to upstream response headers**, not total duration, so long
   streamed responses are not killed. There are **no retries**. One shared
   `http.Agent({ keepAlive: true })` serves all backends and is destroyed on `dispose()`. With
   auto-registration a `503` is a normal state, not a misconfiguration: a balancer started
   before any backend has registered correctly answers `503` until the first arrives. Each of
   these is logged as an error with a stack trace, which is noisy in that state and is what
   `app.onError` should quiet when it lands; the balancer does not special-case it. Exactly one
   terminal event (`completed`, `failed` or `aborted`) is emitted per request.
9. **The balancer middleware is terminal** and validates its configuration before creating
   anything, so a refused configuration leaks no keep-alive agent. `forwardRequest` logs a debug
   hint (through the `logger` option) if the request body has already been consumed, the sign of
   a body reader running ahead of the balancer.

**Observation**

10. **`LoadBalancerMonitor` is the event source.** The proxy and registry report to an optional
    monitor, which keeps running counters and fans events out to subscribers; it does not know
    the dashboard exists.
    * The server-side snapshot is the source of truth and events are live deltas.
    * A **removed** backend keeps its counters in the snapshot for a short grace window
      (`removedGraceMs`) so the dashboard can animate it out with its final numbers, then it is
      dropped. `detail()` stays available through that window.
    * A **throwing listener** is caught and logged, never breaking a request or a registration.
    * **Bounds are load-bearing:** at most **50** distinct route keys per backend, beyond which
      new keys fold into a single `(other)` bucket (otherwise `/files/<random>` with no route
      template would grow the map without limit); a fixed 20-bucket histogram per route; a
      200-call ring buffer per backend.
    * **Rejected: extending `EventEmitter`** - it loses the typed union, and an unhandled
      `"error"` event crashes the process. A typed `Set<listener>` is ten lines.
11. **Request ids.** Each request event needs a `requestId` so the page can match `completed` to
    the particle `dispatched` created. If the request-identity middleware has run, its id is
    reused from `ctx.state.requestId` - but only if it matches the same safe character set as
    backend ids, since it lands in headers, logs and a web page - so the id in the visualizer
    matches the backend's own logs. Otherwise a local monotonic counter. There is no hard
    dependency between the two features.
12. **Route templates: knowing `/users/:id`, not `/users/42`.** Grouping calls by raw path is
    useless, and the balancer only sees raw paths. The **backend's `Router` knows the template**,
    so the backend reports it.
    * `Router.handle()` records the matched pattern as `ctx.route` (next to `ctx.params`).
    * **Backend-side, opt-in:** `createRouteHeaderMiddleware()` adds `X-Empire-Route: <template>`
      to the response. It wraps `res.writeHead`, because the route is only known once `Router`
      runs - after this middleware has called `next()` - and by then headers may already be on the
      wire. Wrapping `writeHead` is the standard pre-header hook in Node (it is what `on-headers`
      does), about 15 lines. `LoadBalancerRegistration` cannot register it for you (it has no app
      reference); the README pairs them.
    * **Balancer-side:** `forwardRequest` reads `X-Empire-Route` from the upstream response, puts
      it on the `completed` event, and **strips it** before the response reaches the client -
      internal route structure is between backend and balancer.
    * **Fallback** for backends that do not send it: `normalizePath` replaces segments that look
      like ids (all digits, UUIDs, 16+ character hex, ULIDs) with `:id`. It is imperfect by
      design, and the dashboard marks routes derived this way with a `~` so they read as guessed,
      not reported.
    * **Rejected: the backend reporting its route table at registration.** The balancer would
      then match paths itself, duplicating `RouteMatcher`'s logic and precedence on the far side
      of a network hop and diverging silently. Per-response headers report what the backend
      *actually* matched, which is the only answer that cannot be wrong.
    * **Query strings are dropped** from paths before they reach the monitor (opt in with
      `includeQueryString: true`); see 2.4.

**Dashboard**

13. **SSE transport.** `createLoadBalancerDashboard(monitor, { path })` answers
    `GET {path}` (the self-contained HTML page), `GET {path}/events` (the event stream) and
    `GET {path}/backends/{id}` (JSON `detail(id)`, `404` for an unknown id, still served for a
    removed backend during its grace window). Everything else goes to `next()`.
    * **SSE, not WebSockets:** data flows only server to browser, SSE is one long-lived
      `text/event-stream` response, and `EventSource` reconnects on its own. WebSockets would
      mean a hand-written `Upgrade` handshake and framing, or `ws` as a dependency.
    * **Stream protocol:** one `snapshot` event on connect, then one message per monitor event,
      a `: heartbeat` comment every 15 s, and unsubscribe on disconnect.
    * **No separate per-backend stream.** The main stream already carries every `dispatched` /
      `completed` event with method, path, route and backend id. Drilling into a backend fetches
      `detail` once for history, then keeps it live by filtering the stream the page already has:
      one subscription per tab, and nothing to set up or tear down server-side.
    * **Backpressure - the visualizer is allowed to be lossy.** If `res.write()` returns `false`,
      that client's request events are dropped until `drain`, then a fresh `snapshot` resyncs it.
      Topology events (`backendAdded` / `backendRemoved`) are **never dropped**: they are rare and
      a missed one would leave a ghost or a missing node, so they are queued (bounded) instead.
14. **The 3D scene** (plain three.js, imperative; instanced meshes and lerped motion):
    * **Hub:** the balancer at the origin, an emissive icosahedron labelled with the strategy
      name, pulsing on each dispatch.
    * **Backends on a ring**, evenly spaced and re-spaced with an eased animation on join or
      leave. The ring makes **round robin a visible sweep around the circle**, which is exactly
      the behaviour worth seeing.
    * **Backend node:** a short cylinder whose height grows with total requests (log-scaled), a
      **halo ring** whose brightness tracks in-flight count, and a colour that shifts toward red
      with the recent failure rate. Static backends have a distinct pinned base; registered ones
      show a thin **lease arc** that drains between heartbeats and refills on `leaseRenewed`, so a
      heartbeat can be watched landing and a killed backend's arc watched running out.
    * **Requests:** one `InstancedMesh` of small spheres with a fixed pool (2,048). On
      `dispatched`, a particle leaves the hub along a quadratic Bézier arc to its backend, orbits
      the node while in flight, then flashes on completion (green 2xx, blue 3xx, amber 4xx, red
      5xx or failed) and fades. A slow endpoint shows as a crowd orbiting one node. If the pool is
      exhausted new particles are skipped; the counters stay exact.
    * **Lifecycle:** `backendAdded` scales the node up from zero with a flare; `backendRemoved`
      desaturates it, lets its in-flight particles finish, then sinks it and re-spaces the ring.
      `expired` (collapse) and `deregistered` (graceful fade) look different, because telling
      "crashed" from "shut down cleanly" is the lesson.
    * **Camera and labels:** `OrbitControls` with slow auto-rotate when idle; `CSS2DRenderer`
      labels (id and port) so text stays crisp and selectable.
    * **2D overlay (plain DOM):** per-backend counters, a rolling log of the last ~50 requests
      and a registration log. The 3D scene is for *seeing*; exact numbers stay in the overlay.
    * **Frame-loop discipline:** SSE events go into a queue applied at the start of each
      `requestAnimationFrame`, never mutating the scene from the `EventSource` callback. After a
      backgrounded tab returns, request events older than a couple of seconds are dropped and
      topology events applied, so the scene does not replay a minute of particles at once.
    * **Degradation:** no WebGL leaves the overlay fully working; `prefers-reduced-motion` turns
      auto-rotate off and replaces particles with a brief flash; the theme follows
      `prefers-color-scheme`; `devicePixelRatio` is capped at 2.
15. **Drill-down into a backend.**
    * **Entering:** click a node (a `Raycaster` against node meshes only) or its overlay row. It
      is also reachable by URL hash (`#backend=alpha`), so a reload or shared link reopens it.
    * **In 3D:** the camera tweens (~600 ms) to the node and `OrbitControls` retargets to it; the
      hub and other backends dim and thin their particles but keep flowing. The node expands into
      a **route constellation**: each route is a satellite on an inner ring, sized by count
      (log-scaled), coloured by error rate, with a stalk whose length is the p95. The top 12
      routes get satellites; the rest fold into one `(other)` satellite. A request to the
      focused backend orbits it in flight (the route is unknown until the response headers
      return), then hops to its route's satellite on `completed`.
    * **In the overlay:** a side panel with a header (id, URL, source, lease remaining, totals),
      a sortable **route table** (method, route with `~` if guessed, count, req/s over 10 s,
      error %, avg / p95 / p99) whose rows and satellites highlight each other, and a **live call
      tail** (newest first, last ~100) with Pause and a filter (`5xx`, `POST`, `/cart`). Clicking
      a call shows its full record; with the request-identity middleware in place its id is the
      one to grep for in the backend's logs.
    * **Leaving:** `Esc`, clicking empty space, or the "all backends" breadcrumb.
    * **If the focused backend is removed** while open, the panel stays with a banner ("expired
      14:02:31 - final stats"), the node plays its removal animation, and the detail freezes at
      its final state rather than vanishing.

### 2.4 Security & Performance Defaults

**Security**

* **Registration is a traffic-hijack surface.** An open endpoint means anyone who can reach it
  can register `http://evil:80` and receive a share of all traffic. So:
  * **A token is required by default.** Requests must send `Authorization: Bearer <token>`,
    compared with `crypto.timingSafeEqual` (both sides hashed to a fixed length first, so the
    comparison leaks nothing about the token's length). Missing or wrong is `401` with no
    detail. Omitting `token` **throws at startup** unless `allowUnauthenticated: true` is passed
    explicitly, so the unsafe choice is loud, not the default.
  * **Loopback-only by default.** Non-loopback clients get `403` unless `allowRemote: true`. The
    check reads the **socket address**, never `X-Forwarded-For`, which any remote caller could
    forge to claim to be `127.0.0.1`. Both checks run before anything about the registry is
    revealed.
  * A user who sets both `allowRemote` and `allowUnauthenticated` has built an open relay, and
    the README says so bluntly.
* **The dashboard has the same loopback guard** (unless `allowRemote: true`), because the page
  exposes backend URLs and request paths.
* **Query strings never reach the monitor by default.** They commonly carry tokens, emails and
  search terms, and the dashboard is a page someone might screen-share.
* **No header or body capture** anywhere in call detail (Non-Goal 9).
* **Ids and urls are constrained** to safe forms (rule 5), and a request id reused from
  `ctx.state` must match the same character set.
* **Trust in `X-Forwarded-For`:** backends' `trustedProxies` configuration (a separate design)
  decides how much of the chain to believe; the example configures its backends to trust
  `127.0.0.1`.
* **The advertised backend `url` is trusted**, on the strength of the token (see 2.1).

**Performance and resource bounds**

* **Streaming, not buffering**, in both directions; one shared keep-alive agent.
* **Monitor memory is O(backends x routes), and bounded:** 50 route keys per backend, fixed
  20-bucket histograms and a 200-call buffer, so a busy backend costs tens of KB. These bounds
  are load-bearing and have tests.
* **A slow dashboard tab never pressures the balancer:** request events are dropped under
  backpressure, topology events are queued with a bound (rule 13).
* **Timers never keep the process alive:** the sweep and heartbeat timers are `unref()`'d and
  cleared on dispose.
* **The scene is lossy by design** (a fixed particle pool of 2,048) while the counters stay exact.

**Trade-offs and watch-outs**

* **The visualizer is the largest single piece of code in the feature and is not testable by
  Vitest.** The mitigation is to build it in layers and keep everything that *can* be tested
  (event to counter state) on the server side. The scene described here is the ceiling for the
  slice, not the floor.
* **This is an edge component in a framework whose stance is that edge concerns do not belong per
  server.** It holds: rate limiting was excluded from *inside each app server*; the balancer is a
  separate Empire process *acting as* the edge. But nginx, Envoy and YARP do this properly, which
  is why the non-goals stay loud.
* **A future `useCompression()` in front of the balancer must skip responses already carrying
  `Content-Encoding`.**
* **A killed backend keeps receiving traffic until its lease expires.** The library default TTL
  is 15 s; the example uses 5 s so a killed backend leaves the ring quickly enough to watch.
* **`Context.route` is core growth**, justified because Phase 21 needs it too.

---

## 3. Iterative Build Steps & Test Strategy (The Sonnet Instructions)

Each step lands with its tests before the next starts, and `npm run verify` plus `npm run lint`
must pass at the end of every step.

### Step 1: Types & Structural Definitions

* **Description:** Create the types under `src/loadbalancing/` (in the sub-folders of 2.2):
  `Backend`, `BackendInfo`, the options interfaces, `ILoadBalancingStrategy`,
  `LoadBalancerEvent`, and the snapshot and detail types. Add `route?: string` to `Context`.
  Options are validated at construction, so configuration mistakes fail at startup.
* **Sonnet Check:** `npx tsc --noEmit` clean across existing imports; no folder import cycle.
* [x] Types and options validation
* [x] `Context.route`

### Step 2: Component Logic & Isolated Unit Tests

* **Description:** Implement each component that can be tested without a socket.
* **Vitest Assertions:**
  * [x] **`RoundRobinStrategy`** - cycles in order; wraps; a single backend; an empty list returns
    `undefined`; a list that grows and shrinks between calls stays in bounds and stays within one
    request per backend over a window.
  * [x] **`BackendRegistry`** (fake timers) - register, renew and deregister; `409` on id reuse
    with a different url; static backends pinned; expiry after the TTL; `eligible()` excludes
    expired-but-unswept entries; the sweep emits `backendRemoved { expired }`; the timer is
    `unref()`'d and cleared on dispose; a static-only registry schedules no timer.
  * [x] **`validateRegistrationRequest`** - id boundaries (1 and 128 characters accepted, 0 and 129
    rejected, bad characters rejected); url cases (`ftp://`, a path, credentials, `""`, not a
    url); a missing or non-string `url`; a body that is not a JSON object; a bad id and a bad url
    reported together; unknown keys ignored and `Object.prototype` untouched.
  * [x] **`hopByHopHeaders`** - the RFC 9110 set plus anything named in `Connection`.
  * [x] **`normalizePath`** - digits, UUID, long hex and ULID become `:id`; ordinary words are
    untouched.
  * [x] **`LoadBalancerMonitor`** - counters for every event type; `inFlight` returns to zero;
    the removed-backend grace window; unsubscribe; a throwing listener is isolated; route stats
    keyed by method and route; histogram percentiles within one bucket of the true values; the
    51st route key folds into `(other)`; the recent-calls buffer caps at 200.
  * [x] **Route templates** - `Router` sets `ctx.route` for a matched route; a 404 and the SPA
    fallback leave it `undefined`; HEAD-via-GET reports the GET template;
    `createRouteHeaderMiddleware` sets the header on matched routes, omits it otherwise, and
    works whether or not the handler calls `writeHead` directly.

### Step 3: Network Pipeline Integration & Live Sockets

* **Description:** Wire the components together and exercise them over real sockets on
  OS-assigned ports (`startHttpServer` and `startEmpire` in `tests/fixtures/http/TestServers.ts`,
  which retry on `EADDRINUSE`).
* **Integration Tests:**
  * [x] **`createBackendRegistrationEndpoint`** - `201` / `200` / `204` per the protocol table;
    `401` for a missing or wrong token; startup throws without `token` unless
    `allowUnauthenticated`; `403` from a non-loopback client unless `allowRemote`; invalid id or
    url is a `400` `ValidationError` listing every problem; malformed JSON is a plain `400`;
    unrelated paths reach `next()`.
  * [x] **`LoadBalancerRegistration`** against a real in-process registry - `start()` rejects on a
    bad token; heartbeats at TTL / 3; re-registers after a balancer restart; `stop()` resolves
    even with the balancer down.
  * [x] **`forwardRequest`** against real `http.createServer` backends - the streamed body arrives
    intact; hop-by-hop headers stripped both ways; `X-Forwarded-*` set; `Host` rewritten; `502`
    and `504`; a client abort destroys the upstream; `X-Empire-Route` read onto the event and
    stripped from the client response; the query string dropped unless opted in.
  * [x] **`createLoadBalancerMiddleware`** - never calls `next()`; `503` with an empty registry; a
    backend registered mid-run starts receiving traffic; a deregistered backend's in-flight
    request still completes.
  * [x] **`createLoadBalancerDashboard`** - the page at `path`; a `snapshot` first on `events`;
    topology events never dropped under backpressure; `threeLocalPath` served under `vendor/`;
    the loopback guard; `backends/{id}` returns detail, `404` for an unknown id, and still serves
    a removed backend inside its grace window.

### Step 4: Verification, Benchmarking, & Example App

* **Description:** Build the dashboard page, add the runnable example, run the full gate, and
  update the docs.
* [x] **`dashboardPage.ts`** - HTML, import map, the three.js scene and the overlay. It cannot run
  under Vitest, so it was built in runnable layers: overlay only, then a static ring from
  `snapshot`, particles, lifecycle animations, the drill-down panel (DOM only), camera focus and
  dimming, the route constellation, the particle hop to satellites, then polish. The panel comes
  before the 3D expansion deliberately: it carries the actual information, and the constellation
  is the part to cut if time runs short.
* [x] **Automated check of the page** - `dashboardPage.test.ts` syntax-checks the client script
  (`node --check`) and asserts that every element id it looks up exists in the page.
* [x] **Manual verification** against a real balancer, three backends and a traffic generator: the
  ring and particles, drill-down, filter, pause and route filter, `Esc`, a remote `DELETE`
  (graceful fade), a killed backend (lease drain then collapse), a balancer restart (backends
  re-registered by themselves), dark mode, and a phone-width viewport.
* [x] **Example `examples/12-load-balancer/`** - `server.ts` (the balancer; named that because
  `scripts/run-examples.ts` discovers examples by it; port 8012, dashboard at `/_lb`, lease TTL
  5 s, backends from 8021), `backend.ts` (id, port and latency from argv, with a parameterised
  route, a slow route and one that sometimes returns 500, and the route header middleware
  registered) and `traffic.ts`. The scripted walkthrough in its comments: start the balancer (empty
  ring, `503`s), start three backends one by one, drill into one and watch its routes fill in,
  hammer the slow route and watch its p95 stalk grow, Ctrl-C one (graceful fade), `kill -9` one
  (lease arc drains, collapse), restart the balancer (backends re-register within one heartbeat).
  The example is **not** mirrored in `package-example/`: that project installs a packed tarball
  built before these exports existed, and port 9012 is taken by `full-featured.ts`. Do it as part
  of the next publish.
* [x] **Docs and exports** - `README.MD` (ordering rules, deregister-before-stop, security
  defaults, "local dev only"), `README_DEVELOPMENT.MD`, `doc/ARCHITECTURE.md`, `CHANGELOG.md`,
  `PLAN.md` Phase 23, and the `src/index.ts` exports.
* [x] **Gate** - `npm run verify` (type-check, all tests, every example started and probed) and
  `npm run lint`.
* [ ] **Follow-up slices, each against the same seam:** passive ejection, weighted round robin,
  header-based routing. (Least connections is done: `06_Loadbalancer_Least_Conn.md`.)
