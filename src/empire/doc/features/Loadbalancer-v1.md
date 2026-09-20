# Empire — Load Balancer, Auto-Registration & 3D Visualizer: Design & Build Doc

**Status:** Implemented
**Scope:** Empire (native TypeScript webserver). Phase 23 in `PLAN.md`, v1 slice:
round robin, backend self-registration, and a live three.js visualizer with
per-backend drill-down.
Weighted round robin, least connections and header-based routing follow in
later slices against the same strategy seam.

## 1. Context & Goals

Phase 23 describes a "simple load balancer" and explicitly frames it as a
learning/local-dev feature, not production-grade. Nothing about it is designed
yet. `PLAN.md` also lists it as depending on Phase 21 (Usage/Statistics
Tracking) - but that dependency is really only true for **least connections**,
which needs live in-flight counts per backend. Round robin needs no metrics at
all.

**Goals:**

1. Empire can act as a small L7 reverse proxy that spreads incoming requests
   across backend HTTP servers - round robin first, behind a strategy
   interface so further algorithms slot in without touching the proxy.
2. **Backends register themselves.** A backend Empire app announces itself
   to the balancer on startup, keeps a lease alive with heartbeats, and
   deregisters on shutdown. Start a fourth backend and traffic starts
   reaching it with no balancer restart and no config edit; kill one and it
   drops out on its own when its lease expires.
3. **A live 3D visualizer** (three.js): the balancer as a hub, backends
   arranged around it, each request a particle travelling from hub to the
   backend that received it. Backends appear and disappear in the scene as
   they register and expire.
4. **Drill into any backend.** Click a node in the 3D view and it expands:
   the calls hitting that backend, grouped by route (`GET /users/:id`),
   with counts, error rates and latency, plus a live tail of individual
   requests as they arrive.

The visualizer is the point, not an extra. The value of building a load
balancer as a learning feature is *seeing* it work - round robin sweeping
around the ring, a slow backend accumulating particles, a new backend
spawning in and immediately picking up its share.

**Non-goals (v1):**

- Production use. No TLS termination, no HTTP/2, no WebSocket/`Upgrade`
  proxying, no clustering of the balancer itself.
- Active health checks (the balancer probing backends). Liveness comes from
  lease heartbeats instead - see 2.3.
- External discovery (DNS SRV, Consul, Docker labels, Kubernetes).
- Sticky sessions / session affinity.
- Rate limiting. Still an edge concern, still out of scope - see
  Consequences for why a load balancer doesn't contradict that stance.

**Dependency stance:** zero new **npm** dependencies. Proxying is `node:http`
plus stream piping; registration uses `fetch` (built into Node 18+) on the
backend side and `validate()` + `zod` (already the one accepted dependency)
on the balancer side; the visualizer streams over Server-Sent Events.

three.js is the one deliberate exception, and it's **browser-side only**: the
dashboard page loads it in the browser; the `empire-ts` package never
imports it and `package.json` doesn't change. See 2.9 and Open Question 1 for
how it gets to the browser.

## 2. Design

### 2.1 The public API

Balancer app:

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
    registry,                          // or `backends: [...]` as shorthand for a static-only registry
    strategy: new RoundRobinStrategy(), // default if omitted
    monitor,
    timeoutMs: 30_000,
}));
```

Backend app:

```ts
const app = new Empire({ port: 5001 });
// ...routes...
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

Everything is still a plain middleware or a plain class, registered through
the existing `app.use()`. `Empire.ts` doesn't change.

The load balancer middleware is **terminal**: it never calls `next()`.
Anything the balancer app answers itself - dashboard, registration endpoint,
a health route - must be registered *before* it.

**Considered and rejected: `app.useLoadBalancer(options)`.** Same reasoning as
`app.useCors()` in the CORS doc - grows `Empire.ts`'s public surface for no
capability `app.use()` lacks.

**Considered and rejected: a separate `EmpireGateway` class.** Duplicates
`start()`/`stop()`/logging/dispatch, and the middleware pipeline is exactly
what makes the balancer composable - request logging, request IDs and the
future `app.onError` hook work in front of it for free.

**Considered and rejected: `LoadBalancerRegistration` hooking `app.start()`
automatically** (e.g. `app.registerWith(...)`). Empire has no lifecycle-hook
mechanism today, and adding one just for this is core-surface growth. An
explicit `start()`/`stop()` pair the caller sequences is two extra lines and
makes the ordering (serve first, *then* announce; deregister first, *then*
stop serving) visible rather than hidden. If Empire later grows
`onStarted`/`onStopping` hooks, the class can plug into them unchanged.

### 2.2 The strategy seam

```ts
interface ILoadBalancingStrategy {
    readonly name: string;
    select(backends: readonly Backend[], ctx: Context): Backend | undefined;
}
```

`select()` is synchronous and returns `undefined` only when there's nothing
eligible. It receives `ctx` so header-based routing can inspect the request
later without a signature change, and `name` so the dashboard can label the
hub.

**The strategy receives the list on every call rather than owning it.** With
auto-registration that stops being a nicety and becomes essential: the list
changes at runtime, and the registry - not the strategy - decides who's
eligible. The middleware asks `registry.eligible()` for a fresh snapshot
array per request.

**`RoundRobinStrategy`** keeps a private counter and returns
`backends[counter++ % backends.length]`. Because the list can grow or shrink
between calls, the modulo is taken against the current length every time -
no stored index into a stale array, no out-of-bounds. A backend joining
mid-rotation just shifts where the sweep lands next; fairness over any
window of N requests is still ±1 per backend, which is all round robin
promises anyway.

No concurrency hazard: `select()` is synchronous, so two requests can never
interleave inside it on Node's single thread. (The opposite of the DI
resolver's situation, which needed in-flight-promise caching precisely
because it awaits between check and set.)

**How later slices fit:** weighted RR (`Backend.weight`, nginx's smooth
weighted algorithm) as a new class; least connections reading `inFlight`
from `LoadBalancerMonitor` (2.6); header routing as a strategy that
delegates to inner strategies per backend group. Weight can also arrive via
registration (Open Question 6).

### 2.3 Auto-registration: `BackendRegistry` + leases

**The model is a lease, not a registration.** A backend doesn't "join"; it
holds a lease that expires unless renewed. This is the Consul/Eureka pattern,
and it's what makes the system self-healing without the balancer ever
probing anything: a backend that crashes, hangs, or loses its network simply
stops renewing, and falls out after one TTL.

**Protocol** (on the registration endpoint, under `path`):

| Request | Meaning | Response |
|---|---|---|
| `PUT {path}/{id}` body `{ url }` | Register **or** renew | `201` new / `200` renewed, body `{ leaseTtlMs }` |
| `DELETE {path}/{id}` | Deregister | `204` (also `204` if already gone - idempotent) |
| `GET {path}` | List registered backends | `200` JSON, for debugging |

**Registration and heartbeat are the same call.** `PUT` is create-or-renew,
which gives two properties for free:

- **Balancer restarts heal themselves.** The balancer loses all
  registrations on restart; each backend's next heartbeat `PUT` re-creates
  its entry. No "re-register on 404" logic in the client.
- **Idempotency.** A retried heartbeat can never create a duplicate.

The response carries `leaseTtlMs`, so the balancer owns the timing: the
client heartbeats at `leaseTtlMs / 3`, tolerating two missed beats before
expiry.

**Registry rules:**

- `id` is the identity. Same `id` + same `url` = renewal. Same `id` +
  **different** `url` while the lease is live → `409 Conflict` (protects
  against two backends misconfigured with the same id silently stealing each
  other's traffic). After expiry the id is free again.
- Static backends (`addStatic`, or the `backends:` shorthand) are pinned:
  no lease, never expire, and `PUT`/`DELETE` against their id → `409`.
- Body validated with `validate()` + a zod schema: `url` must be an
  absolute `http:` URL; `id` matches the same safe character set as request
  IDs (alphanumeric, `-`, `_`, `:`, ≤128 chars) since it ends up in logs and
  the dashboard.
- **Expiry sweep:** an `unref()`'d interval every `leaseTtlMs / 2` removes
  expired leases and emits `backendRemoved { reason: "expired" }`. A sweep
  timer rather than lazy expiry-on-select, so the dashboard shows a dead
  backend disappearing even when no traffic is flowing. `eligible()` also
  filters by expiry, so a stale entry can't be selected in the window
  between sweeps.
- **Removal doesn't touch in-flight requests.** Deregistration or expiry only
  removes a backend from *future* selection; requests already proxied to it
  run to completion. That's graceful draining for free, provided the backend
  deregisters *before* it stops serving - which is the order 2.1's example
  uses and the README must spell out.

**Security - this is the sharp edge of the whole feature.** An open
registration endpoint means anyone who can reach it can register
`http://evil:80` and receive a share of all traffic. So:

- **Token required by default.** `token` is mandatory on
  `createBackendRegistrationEndpoint`; requests must send
  `Authorization: Bearer <token>`, compared with `crypto.timingSafeEqual`.
  Missing/wrong → `401`, no detail. Omitting the option throws at startup
  unless `allowUnauthenticated: true` is passed explicitly - making the
  unsafe choice loud rather than the default.
- **Loopback-only by default.** Non-loopback clients get `403` unless
  `allowRemote: true`. Matches the learning/local-dev framing and the
  dashboard's guard (2.8).

**Considered and rejected: the balancer polling a backend list** (config
file watch, or a list of candidate ports it probes). File-watching is a
different feature ("config hot-reload") and probing is active health
checking - both explicitly out of scope. Self-registration is the one model
where the backend is the source of truth about its own existence, which is
what "auto-register" actually asks for.

**Considered and rejected: the balancer inferring the backend's host from the
registering socket's address** (backend sends only a port). It would prevent
a registrant from pointing traffic at a third host - but the token already
gates who can register at all, and inference breaks as soon as a backend
registers through a proxy or advertises a different interface than it
dialled out on. Open Question 5 keeps it on the table.

### 2.4 `LoadBalancerRegistration` - the backend-side client

A small class, zero dependencies (`fetch`, `setTimeout`).

- `start()`: first `PUT`. **Rejects if the first registration fails** - a
  backend that's misconfigured (wrong URL, wrong token) should find out at
  startup, not silently run unregistered.
- Then heartbeats every `leaseTtlMs / 3` via a chained, `unref()`'d
  `setTimeout` (not `setInterval` - a slow heartbeat must not overlap the
  next one).
- Heartbeat failure: logged at warn via `ILogger`, retried on the next tick.
  No exponential backoff in v1 - the interval is already a few seconds, and
  a local balancer restarting is the common case. `401`/`409` are logged at
  error since retrying won't fix them.
- `stop()`: cancels the timer, sends `DELETE` with a short timeout, and
  resolves even if the `DELETE` fails - the lease will expire anyway, so
  shutdown must never hang on the balancer being unreachable.

### 2.5 Proxying a request

A single function, `forwardRequest(ctx, backend, options)`, in the spirit of
`streamFile.ts`. It **streams** in both directions and never buffers - a
buffering proxy would distort the latencies the visualizer shows.

**Request headers sent upstream:**

- Hop-by-hop headers stripped per RFC 9110 §7.6.1 (`Connection`,
  `Keep-Alive`, `Proxy-Connection`, `TE`, `Trailer`, `Transfer-Encoding`,
  `Upgrade`, plus anything named inside `Connection`), both directions.
- `Host` set to the backend's host; original in `X-Forwarded-Host` (YARP's
  default behaviour).
- Client address **appended** to `X-Forwarded-For`; `X-Forwarded-Proto: http`.
- Request ID forwarded as `X-Request-Id` (2.7).

**Failure mapping:**

| Situation | Response | Monitor event |
|---|---|---|
| No eligible backend | `503 Service Unavailable` | `failed`, phase `select` |
| Connect error before headers | `502 Bad Gateway` | `failed`, phase `connect` |
| No response headers within `timeoutMs` | `504 Gateway Timeout`, upstream destroyed | `failed`, phase `timeout` |
| Upstream dies mid-body | Client socket destroyed | `failed`, phase `stream` |
| Client disconnects first | Upstream destroyed | `aborted` |

502/503/504 throw `HttpError` so they flow through the normal error path
(and `app.onError` once it lands). `timeoutMs` bounds **time to upstream
response headers**, not total duration, so long streamed responses aren't
killed. **No retries in v1** (Open Question 3). One shared
`http.Agent({ keepAlive: true })`, destroyed on dispose.

With auto-registration, 503 becomes a normal state rather than a
misconfiguration: a balancer started before any backend has registered
correctly answers 503 until the first one arrives.

**Ordering gotcha:** because the body is streamed, the balancer must run
**before** any middleware that reads the request body - otherwise there's
nothing left to pipe. README + a debug log if `ctx.req` has already ended.

### 2.6 `LoadBalancerMonitor` - the event source

The proxy and registry report to an optional monitor, which keeps running
counters and fans events out to subscribers. It doesn't know the dashboard
exists.

```ts
type LoadBalancerEvent =
    | { type: "backendAdded";   backend: BackendInfo; expiresAt?: number; at: number }   // BackendInfo: id, url, source: "static" | "registered"; expiresAt only for registered
    | { type: "backendRemoved"; backendId: string; reason: "deregistered" | "expired"; at: number }
    | { type: "leaseRenewed";   backendId: string; expiresAt: number; at: number }
    | { type: "dispatched";     requestId: string; backendId: string; method: string; path: string; at: number }
    | { type: "completed";      requestId: string; backendId: string; status: number; durationMs: number; route?: string; at: number }
    | { type: "failed";         requestId: string; backendId?: string; phase: "select" | "connect" | "timeout" | "stream"; at: number }
    | { type: "aborted";        requestId: string; backendId: string; at: number };
```

`subscribe(listener)` returns an unsubscribe function; `snapshot()` returns
the live backend list with per-backend total, in-flight, status-class
counts, latencies, source and lease expiry. A **removed** backend keeps its
counters in the snapshot for a short grace window so the dashboard can
animate it out with its final numbers, then it's dropped.

**Per-backend call detail** (for the drill-down, 2.10). Alongside the
headline counters, the monitor keeps, per backend:

- **Route stats**, keyed by `METHOD route` (e.g. `GET /users/:id`): count,
  status-class counts, and a fixed-bucket latency histogram (log-spaced
  buckets, ~20 of them) from which avg/p50/p95/p99 are read. A histogram
  rather than stored samples, so memory per route is constant no matter how
  much traffic flows.
- **Recent calls**: a ring buffer of the last 200 requests (id, method,
  path, route, status, duration, timestamp, phase if failed).

Both are **bounded**: at most 50 distinct route keys per backend; beyond
that, new keys fold into a single `(other)` bucket. Without this cap, a
backend receiving `/files/<random>` paths with no route template would grow
the map without limit. `detail(backendId)` returns both for one backend.

The server-side snapshot is the source of truth; events are live deltas. A
throwing listener is caught and logged, never breaking a request or a
registration.

**Considered and rejected: extending `EventEmitter`** - loses the typed
union, and an unhandled `"error"` event crashes the process. A typed
`Set<listener>` is ten lines.

### 2.7 Request IDs

Each request event needs a `requestId` so the page can match `completed` to
the particle `dispatched` created. If the request-identity middleware
(`X-Request-Id` design doc) has run, its ID is reused from `ctx.state` - so
the ID in the visualizer matches the backend's logs. Otherwise a local
monotonic counter. No hard dependency between the features.

### 2.7a Route templates: knowing `/users/:id`, not `/users/42`

Grouping calls by raw path is useless - `/users/1`, `/users/2`, ... are one
endpoint as far as anyone reading the dashboard is concerned. The balancer
only sees raw paths. The **backend's `Router` knows the template**, so the
backend tells the balancer.

**Core change (small, and wanted anyway):** `Router.handle()` already
assigns `requestCtx.params = params` from the matched route. Alongside it,
it records the matched pattern: `requestCtx.route = route.path` (a new
`route?: string` on `Context`, `undefined` for 404s and the SPA fallback).
**Phase 21's "request counts per route" task needs exactly this field**, so
it isn't a load-balancer-only change - it's the first piece of Phase 21
landing early.

**Backend-side, opt-in:** `createRouteHeaderMiddleware()` adds
`X-Empire-Route: <template>` to the response. It has to wrap
`res.writeHead` to do it, because the route is only known once `Router`
runs - after this middleware has called `next()` - and by the time `next()`
returns the headers may already be on the wire. Wrapping `writeHead` is the
standard pre-header hook in Node (it's what the `on-headers` package does);
~15 lines. `LoadBalancerRegistration` doesn't register it for you - it has
no app reference - but the README pairs them.

**Balancer-side:** `forwardRequest` reads `X-Empire-Route` from the upstream
response, puts it on the `completed` event, and **strips it** before the
response goes to the client - internal route structure is between the
backend and the balancer, not something to leak to callers.

**Fallback for backends that don't send it** (non-Empire servers, or the
middleware not registered): a path normalizer replaces segments that look
like IDs - all digits, UUIDs, 16+ char hex, ULIDs - with `:id`. Imperfect
by design, and the dashboard marks routes derived this way with a `~` so
it's clear they're guessed, not reported.

**Query strings are dropped** from paths before they reach the monitor.
They commonly carry tokens, emails and search terms, and the dashboard is a
page you might screen-share. Opt-in `includeQueryString: true` for when
you're debugging something that needs it.

**Considered and rejected: the backend reporting its route table on
registration** (`PUT` body includes all registered routes). The balancer
would then match paths itself - duplicating `RouteMatcher`'s logic and
precedence rules on the other side of a network hop, and silently diverging
the moment they differ. Per-response headers report what the backend
*actually* matched, which is the only answer that can't be wrong.

### 2.8 The dashboard: SSE transport

`createLoadBalancerDashboard(monitor, { path })` answers:

- `GET {path}` - the self-contained HTML page (a string exported from a
  `.ts` file; no build step, nothing added to the npm package's deps).
- `GET {path}/events` - a Server-Sent Events stream.
- `GET {path}/backends/{id}` - JSON `detail(id)` for the drill-down:
  route stats and the recent-calls buffer. `404` for an unknown id.

Everything else → `next()`.

**No separate per-backend stream.** The main SSE stream already carries
every `dispatched`/`completed` event with method, path, route and backend
id. When the page drills into a backend it fetches `detail` once for the
history, then keeps it live by filtering the stream it already has. One
stream, one subscription per tab, and nothing to set up or tear down
server-side when the user clicks around.

**SSE over WebSockets:** data only flows server → browser, SSE is just a
long-lived `text/event-stream` response, and `EventSource` reconnects on its
own. WebSockets would mean a hand-written `Upgrade` handshake and framing, or
`ws` as a dependency.

**Stream protocol:** one `snapshot` event on connect, then one message per
monitor event, a `: heartbeat` comment every 15s, unsubscribe on disconnect.

**Backpressure - the visualizer is allowed to be lossy.** If `res.write()`
returns `false`, that client's request events are dropped until `drain`,
then a fresh `snapshot` resyncs it. **Topology events (`backendAdded` /
`backendRemoved`) are never dropped** - they're rare and a missed one would
leave a ghost or missing node in the scene; they're queued (bounded) instead.
A slow tab must never apply memory pressure to the balancer.

**Guard:** same as the registration endpoint - loopback-only unless
`allowRemote: true`. The page exposes backend URLs and request paths.

### 2.9 The 3D visualizer (three.js)

**Plain three.js, not React Three Fiber.** R3F needs React and a JSX
compile step; the page is a string served with no build. The flight
tracker's techniques - instanced meshes, lerped motion - carry straight
over, just in imperative three.js.

**Getting three.js to the browser** (the dependency question): the page uses
an **import map** pointing `three` and `three/addons/` at a pinned exact
version on a CDN (jsDelivr), with the version in one constant. An option
lets it be overridden:

```ts
createLoadBalancerDashboard(monitor, {
    path: "/_lb",
    three: { baseUrl: "https://mirror.example/three/" },  // default: pinned jsDelivr URL
    threeLocalPath: path.dirname(require.resolve("three/package.json")), // optional: serve your own node_modules/three
});
```

If `threeLocalPath` is set, the dashboard serves that directory under
`{path}/vendor/three/` using the existing `streamFile`, so an offline machine
works with `three` installed as the *user's* devDependency - never
Empire's. Default stays CDN, because it's zero-install. (Open Question 1.)

**Scene:**

- **Hub:** the balancer at the origin - an emissive icosahedron, labelled
  with the strategy name. It pulses on each dispatch.
- **Backends on a ring** around the hub, evenly spaced, re-spaced with an
  eased animation when one joins or leaves. In 2D I'd argued for lanes over
  a radial layout; in 3D the ring is the better choice, because **round
  robin becomes a visible sweep around the circle** - which is exactly the
  behaviour worth seeing.
- **Backend node:** a short cylinder whose **height** grows with total
  requests (log-scaled so one busy node doesn't dwarf the rest), a **halo
  ring** whose brightness tracks in-flight count, and a colour that shifts
  toward red with the recent failure rate. Static backends get a distinct
  base (pinned); registered ones show a thin **lease arc** that drains
  between heartbeats and refills on `leaseRenewed` - so you can watch a
  heartbeat land, and watch a killed backend's arc run out before it
  collapses.
- **Requests:** one `InstancedMesh` of small spheres with a fixed pool
  (e.g. 2,048). On `dispatched`, a particle leaves the hub along a quadratic
  Bézier arc (lifted in Y so arcs don't overlap the ring plane) to its
  backend. It **orbits the node while in flight**, then flashes on
  completion - green 2xx, blue 3xx, amber 4xx, red 5xx/failed - and fades.
  A slow endpoint shows up as a crowd orbiting one node. If the pool is
  exhausted, new particles are skipped (lossy, consistent with 2.8); the
  counters stay exact.
- **Lifecycle:** `backendAdded` → node scales up from zero with a brief
  flare; `backendRemoved` → node desaturates, its remaining in-flight
  particles finish, then it sinks and the ring re-spaces. `expired` and
  `deregistered` look different (collapse vs. graceful fade), since
  telling "crashed" apart from "shut down cleanly" is the lesson.
- **Camera:** `OrbitControls` (from `three/addons`), default angled view
  roughly like Tower of Midnight's isometric camera, slow auto-rotate when
  idle, stops on interaction.
- **Labels:** `CSS2DRenderer` from addons for backend id + port above each
  node - DOM text stays crisp and selectable, unlike sprite text.

**2D overlay (plain DOM, on top of the canvas):** a counters panel (per
backend: total, in-flight, status classes, avg/last latency, lease
remaining), a rolling log of the last ~50 requests, and a registration log
(joined / renewed / expired / deregistered). The 3D scene is for
*seeing*; exact numbers stay in the overlay where they're readable.

**Degradation:** no WebGL → the overlay alone still works fully.
`prefers-reduced-motion` → auto-rotate off and particles replaced by a brief
flash on the target node. Theme follows `prefers-color-scheme`.
`devicePixelRatio` capped at 2.

**Frame loop discipline:** SSE events are pushed into a queue and applied
at the start of each `requestAnimationFrame`, never mutating the scene
directly from the `EventSource` callback. Backgrounded tabs throttle rAF;
on return, the queue is collapsed (request events older than a couple of
seconds are dropped; topology events applied) so the scene doesn't replay a
minute of particles at once.

### 2.10 Drill-down: expanding a backend

**Entering:** clicking a backend node (a `Raycaster` against the node
meshes only - particles and labels aren't pickable) or its row in the
overlay focuses it. Also reachable by URL hash, `#backend=alpha`, so a
reload or a shared link reopens the same view.

**What happens in 3D:**

- The camera tweens (≈600 ms, eased) to frame the focused node;
  `OrbitControls` retargets to it so orbiting now circles that backend.
- The hub and other backends stay in the scene but **dim and desaturate**,
  and their particles thin out - context stays visible, attention moves.
  Traffic keeps flowing to them; nothing pauses.
- **The node expands into a route constellation.** Around the focused
  backend, each route becomes a small **satellite** on its own inner ring:
  size by request count (log-scaled), colour by error rate (green → amber →
  red), and a short latency "stalk" whose length is the p95. The top 12
  routes by count get satellites; the rest collapse into one `(other)`
  satellite so the ring stays readable.
- **Particles route through.** A request to the focused backend flies
  hub → backend as before and orbits it while in flight - the route isn't
  known until the response headers return. Once `completed` names the
  route, the particle hops to that route's satellite and flashes its status
  colour there. A route seen for the first time mid-session spawns its
  satellite with the same scale-up animation backends use.
- Satellites get `CSS2DRenderer` labels (`GET /users/:id`), shown only for
  the focused backend to avoid label soup.

**What happens in the overlay** - a side panel for the focused backend:

- **Header:** id, URL, source (static/registered), lease remaining, totals.
- **Route table:** method, route (`~` if guessed), count, req/s over the
  last 10s, error %, avg / p95 / p99 latency. Sortable. Hovering a row
  highlights its satellite in 3D and vice versa - the table and the
  constellation are two views of the same data. Clicking a row filters the
  call tail to that route.
- **Live call tail:** newest first, last ~100 calls - time, method, path,
  status, duration, request id. **Pause** freezes the list so you can read
  it (counters and 3D keep updating), and a filter box matches
  method/path/status (`5xx`, `POST`, `/cart`).
- **Call detail:** clicking a call shows its full record - request id,
  timestamps, backend, route, status, duration, failure phase if any. With
  the request-identity middleware in place, the id is the one to grep for
  in the backend's own logs.

**Leaving:** Esc, clicking empty space, or a "← all backends" breadcrumb.
The constellation folds back into the node, the camera returns to the
overview, the others re-saturate.

**If the focused backend is removed** while you're looking at it: the
panel stays open with a banner ("expired 14:02:31 - final stats"), the node
plays its removal animation, and the detail freezes at its final state
rather than vanishing under you. The monitor's grace window keeps `detail`
available long enough to drill in right after a removal too.

**Explicitly not in v1:** request/response headers or bodies. They'd need
capture in the proxy path, carry credentials and PII, and turn a traffic
visualizer into an inspection proxy - a different tool (Open Question 10).

## 3. Build Steps

Each step lands with its unit tests before the next starts.

1. **Types.** `src/loadbalancing/`: `Backend.ts`, `BackendInfo.ts`,
   `LoadBalancerOptions.ts`, `ILoadBalancingStrategy.ts`,
   `LoadBalancerEvent.ts`, `LoadBalancerSnapshot.ts`. Options validated at
   construction (fail fast at startup). As built these live in sub-folders -
   see section 7.
2. **`RoundRobinStrategy`.** Tests: cycles in order; wraps; single backend;
   empty → `undefined`; list growing and shrinking between calls stays in
   bounds and stays ±1 fair over a window.
3. **`BackendRegistry`.** Tests with fake timers: register/renew/deregister;
   409 on id reuse with a different URL; static backends pinned; expiry after
   TTL; `eligible()` excludes expired-but-not-yet-swept; sweep emits
   `backendRemoved { expired }`; sweep timer is unref'd and cleared on
   dispose.
4. **`createBackendRegistrationEndpoint`.** Tests: 201/200/204 per table;
   401 missing/wrong token; startup throws without `token` unless
   `allowUnauthenticated`; 403 from non-loopback unless `allowRemote`;
   invalid id/url → 400 via `validate()`; unrelated paths call `next()`.
5. **`LoadBalancerRegistration`** (backend side). Tests against a real
   in-process registry: `start()` rejects on bad token; heartbeats at
   TTL/3; re-registers after balancer restart; `stop()` resolves even with
   the balancer down.
6. **`hopByHopHeaders.ts` + `forwardRequest.ts`.** Tests against real
   `http.createServer` backends on port `0`: streaming body intact;
   hop-by-hop stripped both ways; `X-Forwarded-*`; `Host` rewrite; 502 / 504;
   client abort destroys upstream; `X-Empire-Route` read onto the event and
   stripped from the client response; query string dropped unless opted in.
6a. **Route templates.** `Context.route` set by `Router` (tests: matched
   route sets it; 404 and SPA fallback leave it `undefined`; HEAD-via-GET
   reports the GET template); `createRouteHeaderMiddleware` (header present
   on matched routes, absent otherwise, works whether or not the handler
   calls `writeHead` directly); `normalizePath` fallback (digits, UUID, hex,
   ULID → `:id`; ordinary words untouched).
7. **`createLoadBalancerMiddleware`.** Tests: never calls `next()`; 503 with
   an empty registry; backend registered mid-run starts receiving traffic;
   deregistered backend's in-flight request still completes.
8. **`LoadBalancerMonitor`.** Tests: counters for every event type;
   `inFlight` returns to zero; removed-backend grace window; unsubscribe;
   throwing listener isolated; route stats keyed by method + route;
   histogram percentiles within one bucket of true values; 51st route key
   folds into `(other)`; recent-calls buffer caps at 200.
9. **`createLoadBalancerDashboard`** (SSE + vendor serving). Tests: HTML at
   `path`; `snapshot` first on `events`; topology events never dropped under
   backpressure; `threeLocalPath` served under `vendor/`; loopback guard;
   `backends/{id}` returns detail, 404 for unknown ids, still serves a
   removed backend during its grace window.
10. **`dashboardPage.ts`** - HTML + import map + three.js scene + overlay.
    Manual testing only. Build it in layers, each runnable: overlay only →
    static ring of nodes from `snapshot` → particles → lifecycle
    animations → **drill-down panel (DOM only)** → camera focus + dimming →
    route constellation → particle hop to satellites → polish. The panel
    comes before the 3D expansion deliberately: it carries the actual
    information, and the constellation is the part to cut if time runs
    short.
11. **Example `12-load-balancer/`.** `server.ts` (the balancer - named that
    because `scripts/run-examples.ts` discovers examples by it; port 8012,
    dashboard at `/_lb`), `backend.ts` taking id/port/latency from argv with a handful of
    routes (a parameterized one, a slow one, one that 500s sometimes) and
    the route header middleware registered, and a
    `traffic.ts` generator. Scripted walkthrough in the example's comments:
    start balancer (empty ring, 503s) → start three backends one by one
    (nodes spawn, sweep widens) → drill into one and watch its routes
    fill in → hammer the slow route and watch its p95 stalk grow →
    Ctrl-C one (graceful fade) → `kill -9`
    one (lease arc drains, collapse) → restart the balancer (backends
    re-register within one heartbeat).
12. **Docs.** `README.MD` (ordering rules, deregister-before-stop, security
    defaults, "local dev only"), `README_DEVELOPMENT.MD`,
    `doc/ARCHITECTURE.md`, `CHANGELOG.md`, `PLAN.md` Phase 23, `src/index.ts`
    exports.

## 4. Open Questions

1. **three.js delivery.** CDN import map by default with the
   `threeLocalPath` override (current proposal), or require the local copy
   and have no network fetch at all? CDN means the dashboard needs internet
   and trusts a third-party host; local means an extra install step for
   every user of the dashboard. Either way the npm package stays
   zero-dependency.
2. **Passive ejection on top of leases?** Leases catch crashed backends
   within one TTL; a backend that heartbeats fine but 502s every request
   (process up, app broken) stays in rotation. "N consecutive connect
   failures → skip for M seconds" would cover it. Separate slice, so the
   before/after is visible?
3. **Retries.** Never, or idempotent methods only on connect failures (no
   body byte sent)? Leases make a window of 502s to a dead-but-not-expired
   backend more likely, which strengthens the case - but add a `retried`
   event so the visualizer still shows it.
4. **Default `leaseTtlMs`.** 15s means a `kill -9`'d backend keeps getting
   traffic for up to 15s. Shorter looks better in a demo; longer is more
   forgiving of a paused debugger - relevant, since you step through
   examples. Perhaps 15s default and 5s in the example?
5. **Trust the advertised URL, or infer the host?** Current proposal trusts
   the registrant's `url` because the token gates registration. Inferring
   host from the socket is safer against a leaked token but fragile.
6. **Registration metadata.** Accept optional `weight` (for weighted RR)
   and `tags` (for header routing) in the `PUT` body now, ignored until
   those slices land - or keep the body minimal and extend later?
7. **Re-order Phase 21 vs 23?** `LoadBalancerMonitor` is already a narrow
   stats tracker. Either Phase 21 generalizes it to per-route stats, or
   Phase 21 lands first and the monitor adapts to it.
8. **`X-Forwarded-For` trust.** Backends' `trustedProxies` config (separate
   doc) should decide how much of the chain to believe; confirm the example
   configures backends to trust `127.0.0.1`.
9. **Where the route header gets emitted.** Proposed: `Context.route` in
   core + an opt-in `createRouteHeaderMiddleware` that wraps `writeHead`.
   Alternative: an `EmpireOptions.exposeRouteHeader` flag with `Router`
   setting the header itself - no `writeHead` wrapping, but a
   load-balancer concern living in core options. Also: land `Context.route`
   as its own small change first, since Phase 21 wants it too?
10. **Header capture in call detail.** Out of v1. If wanted later:
    allowlist only (never `Authorization`, `Cookie`, `Set-Cookie`), off by
    default, and its own slice with its own doc.
11. **Satellite and route caps.** 12 satellites, 50 tracked routes per
    backend - comfortably above your real projects, or does `(other)` need
    to be expandable in the panel?

## 5. Consequences

**Easier:**
- Answering "what is this backend actually doing right now?" per route,
  without adding logging to the backend.
- Scaling a local setup up and down with zero balancer config - start or
  kill backends and the system adjusts, visibly.
- New strategies are one class; proxy, registry, monitor and dashboard
  don't change.
- Least connections is unblocked by the monitor's `inFlight` counts.
- The SSE + monitor plumbing is reusable for a future Phase 21 dashboard.

**Harder / to watch:**
- **Registration is a traffic-hijack surface.** Mitigated by token-required
  and loopback-only defaults, but any user who flips `allowRemote` +
  `allowUnauthenticated` has built an open relay. The README has to say this
  bluntly.
- **The visualizer is now the largest single piece of code in the
  feature**, and it's untestable by Vitest. Keeping it layered (step 10)
  and keeping all logic that *can* be tested (event → counter state) on the
  server side is the mitigation. Worth watching for the over-engineering
  pull flagged in Tower of Midnight's doc - the scene description above is
  the ceiling for v1, not the floor.
- **A browser-side third-party library** in a zero-dependency framework.
  It's defensible (package deps unchanged, opt-in page, overridable), but
  it's a real nuance in the zero-dependency story and should be stated as
  such, not glossed.
- Ordering rules multiply: dashboard and registration endpoint before the
  balancer; balancer before body readers; backends deregister before they
  stop.
- **This is an edge component**, in a framework whose stance is that edge
  concerns don't belong per-server. It holds: rate limiting was excluded
  from *inside each app server*; the balancer is a separate Empire process
  *acting as* the edge. But nginx/Envoy/YARP do this properly, which is why
  the non-goals stay loud.
- Future `useCompression()` in front of the balancer must skip responses
  already carrying `Content-Encoding`.

- **Drill-down raises monitor memory from O(backends) to O(backends ×
  routes)** - bounded by the route cap, fixed histograms and the 200-call
  buffer, so a busy backend costs tens of KB. The bounds are load-bearing
  and must have tests.
- `Context` gains a `route` field that `Router` sets - a one-line core
  change, justified by Phase 21 needing it too.

**Revisit later:** active health checks, external discovery (Docker/DNS),
WebSocket proxying, HTTPS backends, sticky sessions, `onStarted`/
`onStopping` lifecycle hooks on `Empire` (would let registration wire
itself up).

## 6. Action Checklist

- [x] Resolve Open Questions 1, 4, 5, 6, 7 and 9 before step 1
- [x] Step 1 - types + options validation
- [x] Step 2 - `RoundRobinStrategy`
- [x] Step 3 - `BackendRegistry` (leases, sweep)
- [x] Step 4 - registration endpoint (auth, loopback guard, validation)
- [x] Step 5 - `LoadBalancerRegistration` client
- [x] Step 6 - `forwardRequest` + hop-by-hop handling + route header read/strip
- [x] Step 6a - `Context.route`, `createRouteHeaderMiddleware`, `normalizePath`
- [x] Step 7 - `createLoadBalancerMiddleware`
- [x] Step 8 - `LoadBalancerMonitor`
- [x] Step 9 - dashboard SSE + vendor serving
- [x] Step 10 - three.js page, in layers (drill-down panel before constellation)
- [x] Step 11 - `examples/12-load-balancer` + scripted walkthrough
- [x] Step 12 - README, ARCHITECTURE, CHANGELOG, PLAN, exports
- [ ] Follow-up slices: passive ejection → weighted RR → least connections → header routing

## 7. Decisions & Deviations

Recorded as built, so this doc stays true to the code.

**Open questions, as resolved.** Where the proposal already held a current
position, that position was taken.

1. **three.js delivery** - CDN import map by default, pinned to `0.170.0`
   (`THREE_VERSION` in `LoadBalancerDashboard.ts`), with `threeLocalPath` to
   serve a local install instead. The npm package is unchanged.
4. **Default `leaseTtlMs`** - 15 seconds in the library, 5 seconds in the
   example, so a killed backend leaves the ring quickly enough to watch.
5. **Advertised URL** - trusted, since the token gates registration. It must
   be a bare `http:` origin (no path, query or credentials): forwarding uses
   the client's own request target, so anything more would be silently
   ignored, and rejecting it is better than dropping it quietly.
6. **Registration metadata** - the `PUT` body stays `{ url }`. `weight` and
   `tags` arrive with the slices that use them.
7. **Phase 21 vs 23** - the monitor stays narrow, and Phase 21 adapts to it
   later. Phase 23's v1 slice turned out not to depend on Phase 21 at all.
9. **Route header** - `Context.route` in core plus the opt-in
   `createRouteHeaderMiddleware()` wrapping `writeHead`.
2, 3, 10, 11 stay as proposed: out of v1.

**Deviations from the text above.**

- `backendAdded` carries an optional `expiresAt`, so the dashboard can draw a
  new backend's lease arc without waiting for a `leaseRenewed`.
- `threeLocalPath` is the *directory* of the `three` package rather than the
  module file: the addons (`OrbitControls`, `CSS2DRenderer`) live under
  `examples/jsm/`, outside `build/`, and the import map needs both.
- The example's balancer is `server.ts`, on port 8012, backends from 8021 -
  `scripts/run-examples.ts` discovers examples by that filename and the
  `8000 + N` convention.
- The example is **not** mirrored in `package-example/`. That project installs
  a packed tarball built before these exports existed, and port 9012 is
  already taken by `full-featured.ts`. Do it as part of the next publish.
- `createLoadBalancerMiddleware()` and `createLoadBalancerDashboard()` return
  callable objects with a `dispose()`, still plain middleware for `app.use()`.
  The first closes its keep-alive agent; the second ends open event streams,
  which would otherwise hold `Empire.stop()` until its timeout.
- The proxy also strips `Proxy-Authenticate` / `Proxy-Authorization` (RFC 7235
  hop-by-hop) and drops `Expect`, since Node has already answered
  `100 Continue`. An outer proxy's `X-Forwarded-Host` / `-Proto` are preserved
  rather than overwritten.
- A request id stored in `ctx.state.requestId` is reused only if it matches the
  same safe character set as backend ids, since it lands in headers, logs and
  a web page.
- The registry starts its sweep timer on the first registration, so a
  registry of only static backends never schedules anything.
- `LoadBalancerRegistrationError` carries the HTTP status, so a heartbeat can
  tell a 401/409 (retrying will not help) from a 5xx.
- 502, 503 and 504 flow through the normal error path, which logs each one as
  an error with a stack trace. That is noisy while no backend is registered -
  a normal state here - and is the thing `app.onError` should quiet when it
  lands; the balancer does not special-case it.
- `BackendRegistrationEndpoint.ts` imports `zod` directly for its `validate()`
  schemas, as this doc's design specifies. That extends Zod beyond
  `src/validation/`, where CLAUDE.md scopes it; still one runtime dependency.
- **Layout.** `src/loadbalancing/` is split by concern rather than left flat:
  `backends/` (registry), `strategy/`, `proxy/` (middleware, `forwardRequest`),
  `registration/` (endpoint and the backend-side client), `monitoring/` (events,
  stats), `dashboard/` (server, SSE) and `dashboard/page/` (the three.js client),
  with `Backend`, `BackendInfo` and `isLoopbackAddress` at the root because
  several folders share them. Imports run one way - `backends`, `proxy`,
  `registration` and `dashboard` depend on `monitoring`, `strategy` and the root
  types, never the reverse - so `monitoring` needed `BackendInfo` at the root
  instead of inside `backends/`, which would have made the two folders import
  each other. `tests/unit/loadbalancing/` mirrors the same sub-folders.
- Verification: the client script cannot run under Vitest, so
  `dashboardPage.test.ts` syntax-checks it (`node --check`) and asserts every
  element id it looks up exists. The page itself was exercised by hand against
  a real balancer, three backends and a traffic generator: ring and particles,
  drill-down, filter, pause and route filter, `Esc`, a remote `DELETE`
  (graceful fade), a killed backend (lease drain then collapse), a balancer
  restart (backends re-registered by themselves), dark mode and a phone-width
  viewport.
