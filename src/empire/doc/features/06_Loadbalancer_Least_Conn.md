# Empire — Load Balancer, Least Connections: Design & Build Doc

**Status:** Implemented
**Scope:** Native TypeScript architecture. Phase 23 in `PLAN.md`.
**Timeline:** Designed by Opus ➡️ Executed by Sonnet

---

## 1. Context & Architectural Goals

### 1.1 The Problem

Round robin (see `05_Loadbalancer_Core_L7.md`) hands out requests in turn and never looks at how
busy a backend is. That is fine while backends are alike. When they differ - one is slower, or
is holding long-running requests - round robin keeps sending it an equal share, so its queue
grows while its faster neighbours sit idle. The example's backends have different latencies on
purpose, and the dashboard shows exactly this: under round robin the slow backend visibly piles
up requests.

**Least connections** fixes it by sending each request to the eligible backend with the fewest
requests in flight, so slow backends receive less work without anyone configuring weights.

It is the next easiest slice because everything it needs already exists:
`LoadBalancerMonitor` tracks an accurate in-flight count per backend, and no registration
protocol change is involved. It also has the clearest payoff on the dashboard.

"Connections" here means **requests in flight**, not TCP connections. This is a layer-7 proxy
with a keep-alive pool to each backend, so sockets and requests are not the same thing, and
requests are what a backend is actually busy with.

### 1.2 System Goals

* **Goal 1 - Route to the least-loaded backend.** Each request goes to the eligible backend with
  the fewest requests in flight.
* **Goal 2 - Ties rotate.** With equal counts the strategy hands out backends in order, so an
  idle balancer behaves exactly like round robin and only diverges once backends actually
  differ in how long they hold work.
* **Goal 3 - Counts are always current.** Two requests arriving in the same tick can never both
  see one backend as idle.
* **Goal 4 - One class against the existing seam.** The proxy, registry, monitor and dashboard
  do not change to make room for it (rule 3 explains the one small addition to the seam).
* **Goal 5 - A misconfiguration is refused, not survived.** A strategy reading a different
  monitor than the balancer reports to must fail at construction rather than quietly degrade to
  round robin.
* **Goal 6 - Comparable on the dashboard.** The example takes the strategy as an argument, so
  the two can be compared against the same backends.

### 1.3 Non-Goals (Scope Guardrails)

* **Non-Goal 1 - Weights.** Weighted least connections is a later slice, alongside weighted
  round robin.
* **Non-Goal 2 - An error-rate penalty.** See the known limits in 2.4; it belongs with passive
  ejection (`05_Loadbalancer_Core_L7.md`, Non-Goal 6).
* **Non-Goal 3 - Slow start.** A new backend starts at zero and gets everything until it catches
  up. Ramping it in is a later refinement.
* **Non-Goal 4 - Counting TCP connections.** Requests in flight is the measure.
* **Non-Goal 5 - Changing the registration protocol or the dashboard.** The hub simply shows the
  strategy's name.
* **Non-Goal 6 - A stats argument on `select()`.** Widening the seam is the right move once a
  strategy needs more than one signal; for one number it would be more machinery (see the
  rejected alternatives in 2.3).

### 1.4 Dependency Stance

**Zero runtime dependencies. Native Node.js modules only.**

This slice adds no package, no browser asset and no third-party code of any kind. It is one
class, one small interface and a getter on an existing class, all plain TypeScript. The stance
for the whole load balancer, including the single browser-side note about three.js in the
dashboard, is in `05_Loadbalancer_Core_L7.md` §1.4 and is unchanged here.

---

## 2. Design & API Contracts (The Opus Blueprint)

### 2.1 Public User API

```ts
const monitor = new LoadBalancerMonitor();
const registry = new BackendRegistry({ leaseTtlMs: 15_000, monitor });

app.use(createLoadBalancerMiddleware({
    registry,
    strategy: new LeastConnectionsStrategy(monitor),   // the very monitor passed below
    monitor,
}));
```

The strategy must be built from **the same monitor** the balancer reports to; construction
throws otherwise (rule 4). The registry must publish to that monitor too, so the strategy sees
backends the registry knows about (a registry the middleware builds itself for `backends:`
already does).

**In the example**, the strategy is a command-line argument, `round-robin` by default:

```bash
npx tsx examples/12-load-balancer/server.ts                     # round robin
npx tsx examples/12-load-balancer/server.ts least-connections   # choosing by requests in flight
```

An unknown name exits with a message naming the two valid choices.

### 2.2 Core Interfaces & Data Models

```ts
// strategy/IInFlightSource.ts
interface IInFlightSource {
    inFlight(backendId: string): number;   // 0 for a backend the source has never heard of
}

// strategy/LeastConnectionsStrategy.ts
class LeastConnectionsStrategy implements ILoadBalancingStrategy {
    readonly name = "least-connections";
    readonly inFlightSource: IInFlightSource;
    constructor(inFlightSource: IInFlightSource);
    select(backends: readonly Backend[]): Backend | undefined;
}

// strategy/ILoadBalancingStrategy.ts - one optional member added to the seam from doc 05
interface ILoadBalancingStrategy {
    readonly name: string;
    readonly inFlightSource?: IInFlightSource;   // set only by a strategy that reads live load
    select(backends: readonly Backend[], ctx: Context): Backend | undefined;
}

// monitoring/LoadBalancerMonitor.ts - satisfies IInFlightSource structurally
inFlight(backendId: string): number;             // a single map lookup, backed by
                                                 // BackendStatsTracker.inFlightCount
```

`IInFlightSource`, `LeastConnectionsStrategy` and `inFlight()` are exported from `src/index.ts`.

### 2.3 Internal Processing Logic Rules

1. **Selection.** Scan the list once, starting from a rotating position, and keep the first
   backend with the lowest in-flight count; then move the position to just past the choice.
   Starting the scan at a rotating position is the tie-break: with equal counts the first backend
   scanned wins and the position advances, which is round robin. `select()` stays synchronous, and
   returns `undefined` only for an empty list.
2. **Why the counts are always current.** `forwardRequest` publishes `dispatched` synchronously,
   before its first `await`, and the middleware calls `select()` and `forwardRequest()` back to
   back with no `await` between them. By the time the next request runs `select()`, the previous
   one is already counted, so two requests in the same tick cannot both see a backend as idle.
   Counts are read fresh on every call, never cached.
3. **The source is the monitor, structurally.** `IInFlightSource` lives in `strategy/`, and
   `LoadBalancerMonitor` satisfies it without importing it, so `strategy/` still depends on
   nothing and `monitoring/` on nothing beside the root types (no folder import cycle - see
   `05_Loadbalancer_Core_L7.md` §2.2). `inFlight(id)` returns `0` for an unknown backend rather
   than throwing, since a strategy is handed a list the monitor may not have seen yet.
4. **One monitor, enforced.** The counts only move if the strategy reads the same monitor the
   balancer reports to. Passing two different ones would not fail; it would quietly degrade to
   round robin, which is the worst kind of bug. So `createLoadBalancerMiddleware` throws at
   construction unless a strategy's `inFlightSource` (when it has one) is the very monitor in the
   middleware's own options. A strategy that sets no `inFlightSource` is unaffected. The check
   runs **before** anything is created, so a refused configuration leaks no keep-alive agent.
5. **What "in flight" means.** A request is in flight from `dispatched` until it settles as
   `completed`, `failed` or `aborted`, so exactly one of those decrements it. The count never goes
   below zero, and a backend removed from the registry keeps reporting its remaining in-flight
   requests for the length of the monitor's removed-backend grace window.
6. **The hub label.** The middleware tells the monitor the strategy's `name`, so the dashboard's
   hub reads `least-connections` (or `round-robin`).

**Considered and rejected:**

* **A counter inside the strategy, incremented in `select()`.** It would need a completion hook
  the seam does not have, and it would count requests the proxy later fails before dispatching.
* **Reading `monitor.snapshot()` per request.** It builds every backend's full snapshot to read
  one number.
* **Widening `select()` to take a stats argument.** That becomes right once a strategy needs more
  than one signal (a "fastest" strategy would). For one number a narrow injected source is less
  machinery, and nothing about it blocks the wider seam later.

### 2.4 Security & Performance Defaults

**Performance**

* `select()` is one pass over the eligible list with one map lookup per backend, and allocates
  nothing. It adds no timer, no lock and no state beyond a single integer.
* Everything is synchronous on Node's single thread, so there is no race between reading a count
  and dispatching the request.

**Security**

* No new endpoint, no new input and no new data on the wire; the strategy reads a number the
  monitor already keeps. The registration and dashboard security defaults in
  `05_Loadbalancer_Core_L7.md` §2.4 are unchanged.

**Known limits** (they are what the strategy costs, not bugs to fix in this slice):

* **A backend that fails fast looks like the best one.** A refused connection settles instantly,
  so a dead-but-not-yet-expired backend has the fewest requests in flight and attracts *more*
  traffic, not less. Fixing that needs an error-rate penalty, which belongs with passive ejection.
* **A new backend gets everything until it catches up.** It starts at zero while the others hold
  work. Slow start is a later refinement.
* **Long-lived responses count.** A backend holding streamed responses open looks busy for as
  long as they last, which is the right answer for a strategy whose whole point is "who is busy".
* **A burst has no fixed split between unequal backends.** The fast one is idle again as soon as
  it replies, so how many requests it takes depends on how the arrivals interleave with its
  replies. A burst only splits evenly between backends that hold requests longer than the burst
  takes to arrive, since only then does every backend's count climb together.

---

## 3. Iterative Build Steps & Test Strategy (The Sonnet Instructions)

Each step lands with its tests before the next starts, and `npm run verify` plus `npm run lint`
must pass at the end of every step.

### Step 1: Types & Structural Definitions

* **Description:** Add `IInFlightSource` under `src/loadbalancing/strategy/`; add the optional
  `inFlightSource` member to `ILoadBalancingStrategy`; add `LoadBalancerMonitor.inFlight(id)`,
  backed by an `inFlightCount` getter on `BackendStatsTracker`.
* **Sonnet Check:** `npx tsc --noEmit` clean; `LoadBalancerMonitor` is passed where an
  `IInFlightSource` is expected with no explicit implements clause.
* **Vitest Assertions** (`LoadBalancerMonitor`):
  * [x] `inFlight` is `0` for an unknown id.
  * [x] It rises on `dispatched`, and falls on each of `completed`, `failed` and `aborted`.
  * [x] It never goes negative, and returns to zero after a mix of every terminal outcome.
  * [x] A removed backend inside its grace window still reports its remaining in-flight requests.

### Step 2: Component Logic & Isolated Unit Tests

* **Description:** Implement `LeastConnectionsStrategy` (rule 1) and test it against a fake
  in-flight source, so every case is deterministic.
* **Vitest Assertions** (`tests/unit/loadbalancing/strategy/LeastConnectionsStrategy.test.ts`):
  * [x] It is named `least-connections`, and exposes the source it reads.
  * [x] It picks the backend with the fewest requests in flight, wherever that sits in the list.
  * [x] It keeps choosing the same backend while it stays the least loaded, and moves off it as
    soon as it stops being so.
  * [x] It rotates through ties instead of always taking the first backend, and rotates only among
    the tied backends when some are busier.
  * [x] With every backend equally loaded it matches `RoundRobinStrategy` exactly.
  * [x] An unknown backend counts as zero.
  * [x] An empty list returns `undefined`; a single backend is returned however busy.
  * [x] A list that grows or shrinks between calls stays in bounds.
  * [x] It reads counts fresh on every call rather than caching them.
  * [x] Work counted as it is dispatched, and never finishing, is spread evenly; work is steered
    away from a backend that holds requests longer.

### Step 3: Network Pipeline Integration & Live Sockets

* **Description:** Add the seam guard to `createLoadBalancerMiddleware` (rule 4), then measure the
  behaviour through a real balancer and real backends rather than assuming it.
* **Unit Tests** (`LoadBalancerMiddleware.test.ts`):
  * [x] A strategy reading the very monitor the balancer reports to is accepted.
  * [x] A strategy reading a different monitor is refused, naming the strategy and the
    "same monitor" requirement.
  * [x] It is also refused when the balancer has no monitor at all.
  * [x] A strategy with no `inFlightSource` is unaffected, with or without a monitor.
  * [x] The monitor is told the strategy's name.
* **Integration Tests** (`tests/integration/LeastConnections.test.ts`, ephemeral ports via
  `startEmpire` and `startHttpServer`): one fast backend and one that holds each request 1500 ms
  (`SLOW_HOLD_MS`), a steady stream of 30 requests 20 ms apart:
  * [x] Under least connections the slow backend receives far less than half.
  * [x] Under round robin the same stream splits exactly in half.
  * [x] Nothing is counted as in flight once the stream has finished.
  * [x] A burst of 20 sent at two **equally slow** backends splits evenly (within 2 either way).

### Step 4: Verification, Benchmarking, & Example App

* **Description:** Let the example choose the strategy, measure the effect on the real example,
  and update the docs.
* [x] **Example.** `examples/12-load-balancer/server.ts` reads the strategy from `process.argv[2]`
  (`round-robin` by default, or `least-connections`); its header comment scripts the comparison:
  run round robin with traffic, restart as `least-connections` with the traffic generator still
  running, and watch the hub label change and the slowest backend's share fall.
* [x] **Measured against the example's three backends** (alpha 0 ms, beta 40, gamma 120 base
  latency): at 30 requests a second, least connections sent gamma about a quarter of the requests
  (103 of 436) where round robin sends a third. At 12 a second the effect is real but modest (75
  against 88 of about 260). The difference grows with load, which is when a strategy like this
  earns its keep.
* [x] **Demo.** `doc/images/load-balancer-example.gif` shows the example under least connections:
  the ring under traffic, a drill-down into gamma, and alpha deregistering and rejoining.
* [x] **Docs and exports.** `README_DEVELOPMENT.MD`, `doc/ARCHITECTURE.md`, `CHANGELOG.md`,
  `PLAN.md`, and `src/index.ts`.
* [x] **Gate.** `npm run verify` and `npm run lint`.

**As built - lessons kept so they are not relearned:**

* **The first version of the burst test was wrong, and CI found it.** It asserted an even 10 / 10
  split for a burst sent at one fast and one slow backend. That passed locally on timing luck and
  failed on CI with 2 to the slow backend, because the fast backend is idle again as soon as it
  replies (see the last known limit in 2.4). The test now bursts at two equally slow backends,
  and the steady-stream tests hold the slow backend for 1500 ms so that none of them depends on
  timer precision.
* **The whole-stream premise is what makes the assertions safe.** `SLOW_HOLD_MS` is deliberately
  much longer than the stream takes to arrive (30 x 20 ms = 600 ms), so even a loaded machine that
  stretches every gap several times over leaves the slow backend busy with its first request for
  most of the stream.
* **Config validation runs before construction of anything else** in
  `createLoadBalancerMiddleware`, so a refused strategy leaks no keep-alive agent.
* **Follow-up slices, each against the same seam:** weighted round robin and weighted least
  connections, header-based routing, an error-rate penalty with passive ejection, and slow start.
