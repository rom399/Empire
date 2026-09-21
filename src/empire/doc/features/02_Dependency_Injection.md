# Empire — Dependency Injection: Design & Build Doc

**Status:** Implemented
**Scope:** Native TypeScript architecture. Phase 10 in `PLAN.md`.
**Timeline:** Designed by Opus ➡️ Executed by Sonnet

---

## 1. Context & Architectural Goals

### 1.1 The Problem

Route handlers reach for their dependencies directly: a logger, configuration, an upstream API
client, a data store. That couples wiring to usage, makes a handler impossible to test without the
real thing behind it, and gives no control over how long a dependency lives - a database pool
should live as long as the process, per-request state should live for one request.

ASP.NET Core solves this with `IServiceCollection` and `IServiceProvider`: register services once,
in one place, with a lifetime; resolve them where needed; let the framework create a scope per
request and dispose it afterwards. Empire wants the same value without importing a container.

Two facts about Node shape the design:

* **TypeScript types do not exist at runtime**, so nothing can be resolved *by type*. Services are
  identified by explicit tokens, and dependencies are wired by hand-written factories.
* **Node's setup work is asynchronous.** Reading a secret, loading configuration or opening a
  connection are all `await`s. In .NET that happens *before* `builder.Build()`, and
  `GetService<T>()` is synchronous. Forcing the same split here would be awkward, so the container
  itself is asynchronous.

### 1.2 System Goals

* **Goal 1 - An ASP.NET Core-shaped API.** `ServiceCollection` (`addSingleton`, `addScoped`,
  `addTransient`), `ServiceProvider` (`resolve`, `createScope`, `dispose`) and `ServiceScope`.
* **Goal 2 - Three lifetimes.** Singleton (one per process), scoped (one per request or created
  scope), transient (a new instance on every resolve).
* **Goal 3 - One asynchronous `resolve()`.** It returns `Promise<T>` for every token, whether or
  not that particular factory awaits anything, so callers never need to know.
* **Goal 4 - A scope per HTTP request**, exposed to handlers as `ctx.services`, disposed when the
  response ends.
* **Goal 5 - Deterministic disposal.** A scope disposes what it built; the provider disposes its
  singletons in reverse construction order.
* **Goal 6 - Graceful shutdown.** `Empire.stop()` drains in-flight requests, force-closes after a
  timeout, then disposes singletons.
* **Goal 7 - Startup mistakes fail loudly.** A duplicate registration, a registration after the
  container is built, a scoped service resolved from the root, and a circular dependency are all
  programming errors that must not be silently survived.
* **Goal 8 - Services are testable without the container.** Constructor injection means a test
  builds a service directly with fakes. The container wires real dependencies at runtime; it was
  never required for testability.

### 1.3 Non-Goals (Scope Guardrails)

* **Non-Goal 1 - Full IoC container parity.** No property injection, no multi-constructor
  resolution, no assembly scanning.
* **Non-Goal 2 - Decorator or reflection-based auto-wiring.** It needs `reflect-metadata`, which is
  an external package and off the table (see 1.4).
* **Non-Goal 3 - Scope hierarchies** beyond root then a single request scope.
* **Non-Goal 4 - Lazy circular resolution** (proxies, `Lazy<T>`-style wrappers). A cycle is detected
  and rejected, not accommodated.
* **Non-Goal 5 - A synchronous `resolve()` fast path** "for the common case". A dual API means every
  caller has to know which one a token needs.
* **Non-Goal 6 - A shutdown state machine.** Shutdown is a timeout, a forced close and reverse-order
  disposal. No health-check or readiness endpoints, no configurable phases, no draining strategy
  beyond "wait, then force".
* **Non-Goal 7 - Process-wide signal handlers registered by the library.** `Empire.stop()` holds the
  mechanics; deciding when to call it stays the application's job (see rule 11).
* **Non-Goal 8 - A `Config` service in Empire.** The design's `Config` was illustrative; Empire has
  no such type (see 2.3, rule 11, for where the shutdown timeout lives instead).
* **Non-Goal 9 - A plugin system for the container.** If it starts to look like one, stop.
* **Deferred:** Phase 15, Advanced Dependency Injection.

### 1.4 Dependency Stance

**Zero runtime dependencies. Native Node.js modules only.**

The container is hand-rolled. There is no `reflect-metadata`, no decorators, and no reflection-based
wiring, because TypeScript erases the constructor parameter types that auto-wiring needs; the only
way to get them back is `experimentalDecorators` plus the `reflect-metadata` polyfill as a runtime
dependency, directly against the constraint. Explicit tokens and factories keep it dependency-free.

Graceful shutdown uses `http.Server.closeIdleConnections()` and `closeAllConnections()` (Node 18.2+),
which are native. If a real embedded database is ever wanted in an example, `node:sqlite` (built into
Node since 22.5, still experimental) is the only option that adds no package; check the Node version
before relying on it.

---

## 2. Design & API Contracts (The Opus Blueprint)

### 2.1 Public User API

**Concept mapping:**

| ASP.NET Core | Empire equivalent |
|---|---|
| `IServiceCollection` | `ServiceCollection` |
| `IServiceProvider` | `ServiceProvider` |
| `AddSingleton<T>()` / `AddScoped<T>()` / `AddTransient<T>()` | `addSingleton(token, factory)` / `addScoped(...)` / `addTransient(...)` |
| `IServiceScope` / `CreateScope()` | `provider.createScope()` |
| Constructor injection | A factory function receiving a `Resolver` |
| `GetService<T>()` (synchronous) | `resolve(token)` - **asynchronous**, by design |

**The composition root and a handler** (this is what `examples/09-dependency-injection` does):

```ts
const RecordRepositoryToken = createToken<IRecordRepository>("RecordRepository");
const HttpClientToken       = createToken<IHttpClient>("HttpClient");
const UpstreamApiToken      = createToken<UpstreamApiService>("UpstreamApiService");

const services = new ServiceCollection();

// Singleton: this *is* the database, so its state must persist across requests.
services.addSingleton(RecordRepositoryToken, () => new InMemoryRecordRepository(seed));

// Singleton: stateless, no reason to rebuild it per request.
services.addSingleton(HttpClientToken, () => new NodeHttpClient());

// Scoped: async only because it awaits resolve(); room for per-request state later.
services.addScoped(UpstreamApiToken, async (resolver) =>
    new UpstreamApiService(await resolver.resolve(HttpClientToken), baseUrl, logger));

const app = new Empire({
    host: "localhost", port: 8009, logger,
    services: services.build(),        // seals the collection
    shutdownTimeoutMs: 10_000,         // optional; this is the default
});

app.get("/records/:id", async (ctx) => {
    const repository = await ctx.services!.resolve(RecordRepositoryToken);
    const record = await repository.getById(ctx.params.id);
    // ...
});

process.on("SIGINT", async () => { await app.stop(); process.exit(0); });   // the app's job, not Empire's
```

`ctx.services` is `undefined` when the app was built without a provider, so real code narrows it
once (the example's `requireServices(ctx)` helper throws a clear 500 if it is missing).

**Testing without the container.** A service depends on an interface, not on a concrete client that
uses real sockets, so a test builds it directly:

```ts
class FakeHttpClient implements IHttpClient { /* returns canned responses */ }

const service = new UpstreamApiService(new FakeHttpClient(responses), "https://api.example.com", logger);
```

No `ServiceCollection`, no `ServiceProvider`, no network. Writing `UpstreamApiService` to take its
dependencies as constructor arguments, instead of importing a module-level `https` call, is what makes
this possible at all - the container is not part of the argument.

### 2.2 Core Interfaces & Data Models

One type per file under `src/di/`:

```ts
// ServiceToken.ts - types vanish at runtime, so a service is identified by a typed Symbol
type ServiceToken<T> = symbol & { __type?: T };
function createToken<T>(name: string): ServiceToken<T> { return Symbol(name) as ServiceToken<T>; }

// Lifetime.ts
enum Lifetime { Singleton, Scoped, Transient }

// Resolver.ts, Factory.ts, ServiceDescriptor.ts
interface Resolver { resolve<T>(token: ServiceToken<T>): Promise<T>; }
type Factory<T> = (resolver: Resolver) => T | Promise<T>;   // sync or async, both accepted
interface ServiceDescriptor<T = unknown> { token: ServiceToken<T>; lifetime: Lifetime; factory: Factory<T>; }

// Disposable.ts
interface Disposable { dispose(): void | Promise<void>; }
function isDisposable(instance: unknown): instance is Disposable;
```

```ts
class ServiceCollection {
    addSingleton<T>(token: ServiceToken<T>, factory: Factory<T>): void;
    addScoped<T>(token: ServiceToken<T>, factory: Factory<T>): void;
    addTransient<T>(token: ServiceToken<T>, factory: Factory<T>): void;
    build(): ServiceProvider;                       // seals the collection
}

class ServiceProvider implements Resolver {          // the root: holds the singletons
    resolve<T>(token: ServiceToken<T>): Promise<T>;
    createScope(): ServiceScope;                     // synchronous; only resolve() is async
    dispose(): Promise<void>;                        // idempotent
}

class ServiceScope implements Resolver {             // holds the scoped instances
    resolve<T>(token: ServiceToken<T>): Promise<T>;
    dispose(): Promise<void>;                        // idempotent
}
```

**Framework integration:**

```ts
// EmpireOptions
services?: ServiceProvider;        // the root provider
shutdownTimeoutMs?: number;        // default 10_000

// Empire
get services(): ServiceProvider | undefined;
stop(): Promise<void>;             // drains, force-closes after the timeout, disposes singletons

// Context
readonly services?: Resolver;      // the request's scope, typed as the narrower Resolver
```

`ctx.services` is a `Resolver`, not a `ServiceScope`: a handler can `resolve()` but has no way to
reach `dispose()`.

### 2.3 Internal Processing Logic Rules

**Registration**

1. **`resolve()` always returns a `Promise<T>`**, even when the factory behind it is synchronous.
   There is no parallel `resolveAsync()`. A factory that throws *synchronously* still comes back as a
   rejection, never as a raw throw out of `resolve()`, because the "always a Promise" contract is what
   every caller relies on.
2. **A duplicate registration hard-crashes the process.** `addSingleton`, `addScoped` and
   `addTransient` alike print `FATAL: duplicate service registration for "<name>"`, naming both
   lifetimes, and call `process.exit(1)`. It is deliberately *not* a catchable `throw`: it is a
   startup-time programming mistake (two implementations competing for one dependency), and a
   `try/catch` upstream could swallow a throw and let the server boot with a broken container.
3. **The collection seals itself in `build()`.** Any registration afterwards hits the same hard-crash
   path, since it is the same category of bug (configuration somewhere other than the composition
   root). `build()` also hands the provider a *copy* of the descriptor map, so the provider never
   shares a live reference back to the collection.

**Resolution**

4. **Singletons** live in the root provider, are built lazily on first resolve, and cached for the
   life of the process. **Scoped** services live in a `ServiceScope`, one instance per scope.
   **Transient** services bypass caching: a new factory call and a new promise every time. A scope
   resolving a singleton delegates to the root, so every scope shares one instance.
5. **Cache the promise, not the settled value.** For singleton and scoped lifetimes the cache holds
   the `Promise<T>` returned by the factory. Two `resolve()` calls that both reach an unbuilt
   singleton before the first construction finishes share the *same in-flight promise* instead of
   racing to invoke the factory twice - otherwise an async singleton such as one opening a database
   connection could be constructed several times under concurrent requests.
6. **Errors on resolve are rejections:**
   * An unregistered token rejects with `Service not registered: "<name>"`.
   * **A scoped token resolved from the root provider rejects** (`Cannot resolve scoped service ...
     from the root provider`), matching ASP.NET Core. This is the guard against a **captive
     dependency**: a singleton, which lives for the whole process, holding a scoped instance that
     should live for one request. In practice it shows up as a singleton factory stashing the
     `Resolver` it was given and calling `resolve()` later, outside its own construction; that call
     rejects, by design.
7. **Circular dependency detection is async-safe.** A single shared mutable stack would misfire:
   `resolve()` is asynchronous, so unrelated resolutions from different requests interleave on the
   event loop, and a shared stack could see request A's tokens while request B is mid-resolution and
   report a false cycle. Instead every *top-level* `resolve()` creates its own resolution path (a
   `Set` of tokens), threaded through the nested `resolver.resolve()` calls of that one chain. A token
   reappearing in its own path rejects with the cycle listed (`A -> B -> A`). Two concurrent,
   unrelated resolutions never see each other's tokens. A cycle that passes *through* a singleton is
   caught by the root's own detection, since a scope delegates singletons to the root rather than
   threading its path further.

**Scoping and disposal**

8. **A scope per HTTP request.** `Empire.handleRequest()` calls `provider.createScope()` (synchronous)
   and hands the scope to `Context` as `ctx.services`. Disposal is registered on **both**
   `res.once("finish")` and `res.once("close")`, because `close` covers a client that disconnects
   before the response finishes and `dispose()` is idempotent, so registering both costs nothing. A
   disposal error is logged through the app's logger and never breaks the response. Without a provider
   there is no scope and `ctx.services` is `undefined`.
9. **A scope disposes what it built.** It tracks every scoped and transient instance it constructed,
   and `dispose()` calls `dispose()` on each one that has it - once, in reverse construction order.
   `dispose()` is idempotent. An instance whose own construction *failed* is skipped (there is nothing
   to dispose), and one instance's `dispose()` throwing is logged and does not stop the rest.
10. **The provider disposes singletons in reverse construction order.** `Map` iteration follows
    insertion order and a singleton is inserted only once (behind its own cache check), so reversing
    the map's entries *is* reverse construction order, with no parallel array to keep in sync. It is
    safe by construction: a singleton's dependencies are resolved before it finishes constructing (its
    factory awaits them), so a dependency can never be disposed before something that depends on it.
    The one way to break this is the captive-resolver misuse in rule 6: a singleton that stashes the
    resolver and reaches for another singleton later is not tracked as a real dependency. Each tracked
    promise is awaited before checking whether the instance is disposable; a failed construction is
    skipped, and a throwing `dispose()` is logged and the rest still run.
11. **Graceful shutdown lives in `Empire.stop()`:**
    1. `closeIdleConnections()` - idle keep-alive sockets are serving nothing, so close them now.
    2. `server.close()` - stop accepting new connections and let in-flight requests finish.
    3. Race the close against `shutdownTimeoutMs` (default 10 s, an `unref()`'d timer). On timeout,
       log an error and `closeAllConnections()`, so one stuck request cannot hang the process.
    4. `await provider.dispose()` - attempted either way.
    5. If the server itself reported a close error, throw it **after** disposal, since a close error
       must not skip cleanup.

    `shutdownTimeoutMs` is an `EmpireOptions` field, following the pattern of `maxBodySize`, rather
    than a value read from a DI-resolved `Config`: Empire has no such service, and this needs no
    resolution at shutdown time. **Empire registers no `SIGTERM` / `SIGINT` handler.** A library
    installing process-wide listeners as a side effect of construction is a surprising global effect,
    and harmful here - many short-lived `Empire` instances (this project's own test suite builds
    dozens) would each leak a listener and could interfere with a test runner's own `Ctrl+C`
    handling. Calling `stop()` from a signal handler is application code, as every example shows.

### 2.4 Security & Performance Defaults

**Robustness and failure behaviour**

* **Startup mistakes crash; runtime resolution rejects.** Registration errors (rules 2 and 3) are
  `process.exit(1)` because a swallowed throw would leave a running server with a broken container.
  Everything that can happen once requests are flowing (unregistered token, scoped-from-root, cycle,
  a failing factory) is a rejected promise the caller can handle and the request pipeline turns into
  an error response.
* **No captive dependencies** (rule 6): a scoped service cannot leak into a singleton through the
  root provider.
* **No silent cleanup failures.** A throwing `dispose()` is logged with the service name and the
  remaining disposals still run.
* **A stuck request cannot hang shutdown** (rule 11): a forced close follows the timeout, and the
  timer is `unref()`'d so it never holds the process open by itself.

**Concurrency and performance**

* **No double construction** under concurrent requests (rule 5), and **no false cycles** between
  concurrent unrelated resolutions (rule 7).
* Resolution is `Map` lookups. A scope is created per request and is cheap; it tracks only the
  scoped and transient instances it actually built.
* **Nothing accumulates per request:** the scope is released with the request, and disposal fires on
  whichever of `finish` or `close` comes first.

**Known limits and watch-outs**

* **The captive-resolver misuse is guarded, not impossible.** A singleton that stashes its `Resolver`
  and resolves scoped services later is rejected, but one that stashes it to resolve *other
  singletons* later escapes the disposal-ordering guarantee (rule 10).
* **A transient resolved directly from the root provider is not tracked for disposal**, because only
  scopes track what they build. Give a disposable service a scoped or singleton lifetime.
* **Disposal errors are written to the console**, not the app's logger, because the provider has no
  logger of its own.
* **An in-memory sample store has nothing to dispose.** A real database connection would implement
  `dispose(): Promise<void>` to close its pool; registered as a singleton, `provider.dispose()` picks
  it up during shutdown with no change to the shutdown flow.

---

## 3. Iterative Build Steps & Test Strategy (The Sonnet Instructions)

Each step lands with its tests before the next starts.

### Step 1: Types & Structural Definitions

* **Description:** Create the types of 2.2 under `src/di/`: `ServiceToken` and `createToken`,
  `Lifetime`, `Factory`, `ServiceDescriptor`, `Resolver`, and `Disposable` with `isDisposable`. One
  type per file.
* **Sonnet Check:** `npx tsc --noEmit` clean; `createToken<T>()` returns a token typed to `T`.
* [x] DI-1 - tokens and types (`resolve` returns `Promise<T>`; `Factory<T>` accepts sync or async)

### Step 2: Component Logic & Isolated Unit Tests

* **Description:** Implement `ServiceCollection`, the root `ServiceProvider`, `ServiceScope` and
  disposal (rules 1-7, 9 and 10).
* [x] DI-2 - `ServiceCollection`: the three `add*` methods, hard-crash on a duplicate, seal on `build()`
* [x] DI-3 - root `ServiceProvider`: singleton caching of the in-flight promise, transient resolution,
  the missing-registration error, per-call cycle detection
* [x] DI-4 - `ServiceScope`: scoped caching, `createScope()`, the root-provider guard
* [x] DI-5 - disposal: per-scope tracking, `scope.dispose()`, `provider.dispose()`
* **Vitest Assertions** (`tests/unit/di/`: `ServiceCollection`, `ServiceProvider`, `ServiceScope`,
  `ServiceToken`):
  * [x] **Singleton:** two `resolve()` calls, including across different scopes, return the same instance.
  * [x] **Concurrent async singleton:** two `resolve()` calls fired before the first construction
    finishes build it exactly once.
  * [x] **Transient:** two `resolve()` calls return different instances.
  * [x] **Scoped:** the same instance within one scope, a different instance across two scopes.
  * [x] An unregistered token rejects with a message naming the token.
  * [x] **Duplicate registration** crashes the process (`process.exit(1)`) with a message naming the
    token and both lifetimes - not a catchable throw.
  * [x] **Registration after `build()`** crashes the process the same way.
  * [x] A scoped token resolved from the root provider (no scope) rejects.
  * [x] A circular dependency (A -> B -> A) rejects with the cycle path in the message.
  * [x] `scope.dispose()` calls `dispose()` on every scoped instance that has one, and only once.
  * [x] `provider.dispose()` disposes singletons in reverse construction order.
  * [x] `provider.dispose()` continues past an instance whose `dispose()` throws.
  * [x] **A factory that throws synchronously** rejects `resolve()` instead of throwing, in both the
    provider and the scope.
  * [x] **An instance that failed to construct** is skipped by `dispose()` rather than re-throwing its
    original construction error, in both the provider and the scope.
* **Testing the crash path:** normal application code cannot intercept `process.exit`, but a test can
  stub it for one test (throwing a sentinel, and restoring `process.exit` and `console.error` in a
  `finally`), then assert the exit code was `1` and the logged message matched.

### Step 3: Network Pipeline Integration & Live Sockets

* **Description:** Wire the container into the request pipeline and the shutdown path (rules 8 and 11).
* [x] DI-6 - HTTP integration: `EmpireOptions.services`, a scope per request in `handleRequest()`,
  `Context.services` typed as `Resolver`, disposal on `finish` and `close`
* [x] DI-8 - graceful shutdown: idle-connection close, the timeout race, forced close,
  `provider.dispose()`, all inside `Empire.stop()`. No signal handler is registered.
* **Integration Tests** (`tests/integration/DependencyInjection.test.ts`, real requests on an ephemeral
  port):
  * [x] A registered service resolves inside a route handler.
  * [x] A singleton is the same instance across two separate requests.
  * [x] A scoped service is a different instance per request.
  * [x] A scoped service is the same instance for two resolutions within one request.
  * [x] The request's scoped service is disposed once the response finishes.
  * [x] `ctx.services` is `undefined` when the app was built without a provider.
* **Shutdown Tests** (the graceful-shutdown block in `tests/unit/Empire.test.ts`):
  * [x] Services registered through `EmpireOptions.services` are disposed when the server stops.
  * [x] Remaining connections are force-closed once `shutdownTimeoutMs` elapses, instead of hanging.

### Step 4: Verification, Benchmarking, & Example App

* **Description:** Prove the design with a runnable example, then document it.
* [x] DI-7a - **API client.** `IHttpClient` and `NodeHttpClient`, with `UpstreamApiService` (scoped)
  wired through the container. To stay runnable with no external network, the "upstream" it calls is
  the same server's own `/records` endpoint, over a real socket with real JSON parsing.
* [x] DI-7b - **Exposed endpoints.** An in-memory `IRecordRepository` singleton backing three
  handlers (`GET /records`, `GET /records/:id`, `POST /records`), all resolving the *same* instance,
  plus `GET /upstream-summary` for the API client. This is `examples/09-dependency-injection/server.ts`
  (port 8009), one composition root for both. It uses Empire's real `ILogger` and a plain `baseUrl`
  string rather than the design's illustrative `Config`/`Logger`, and names its record type
  `DataRecord` so it does not shadow TypeScript's built-in `Record<K, V>`.
* [x] DI-9 - **Tests.** Every item under Steps 2 and 3, plus two real bugs the extra tests caught while
  the suite was written (both fixed with a dedicated regression test):
  * A factory that threw *synchronously* escaped `resolve()` as a raw throw instead of a rejection,
    breaking the "always a Promise" contract. `construct()` in both the provider and the scope now
    converts it to `Promise.reject(err)`.
  * `dispose()` awaited each tracked instance directly, so an instance that had *failed to construct*
    made `dispose()` re-throw that construction error. Both `dispose()` methods now `continue` past a
    failed instance.
* [x] **Docs as they stand.** `README_DEVELOPMENT.MD` lists the container in its feature list, has a
  "Server Lifecycle" section (`stop()`, `shutdownTimeoutMs`, singleton disposal in reverse construction
  order), and describes `09-dependency-injection` in its examples table; `README.MD` lists the example.
* [ ] **A full DI section in the READMEs is not written.** The original plan for one - overview, tokens
  and lifetimes, a quick start, the API, why `resolve()` is always a promise, the registration rules,
  scoping, disposal, shutdown, cycle detection, testing without the container, the non-goals, and one
  subsection per example - did not get built. This document is the reference until it is.
* [x] **Gate.** `npm run verify` and `npm run lint`.
* **A note on the test runner:** the design originally illustrated its tests with `node:test`; the
  project's suite runs on Vitest, which adds no dependency of Empire's own.
