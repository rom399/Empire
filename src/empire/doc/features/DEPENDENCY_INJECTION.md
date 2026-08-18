# Empire — Dependency Injection: Design & Build Doc

**Status:** Draft
**Scope:** Empire (native TypeScript webserver, zero external dependencies)

## 1. Context & Goals

Route handlers currently reach for dependencies (logger, config, proxy targets) directly. DI decouples wiring from usage, makes handlers testable in isolation, and gives per-request lifetime control — the same value ASP.NET Core's `IServiceCollection`/`IServiceProvider` gives you.

**Goal:** an ASP.NET Core-shaped API (`addSingleton`, `addScoped`, `addTransient`, `resolve`) reimplemented with zero runtime dependencies. No `reflect-metadata`, no decorators, no auto-wiring by reflection — TypeScript types don't exist at runtime, and decorator-based metadata requires an external package, which is off the table here.

**Non-goal:** full IoC container feature parity. No property injection, no multi-constructor resolution, no assembly scanning.

## 2. Design

### 2.1 Core concepts

| ASP.NET Core | Empire equivalent |
|---|---|
| `IServiceCollection` | `ServiceCollection` |
| `IServiceProvider` | `ServiceProvider` |
| `AddSingleton<T>()` | `collection.addSingleton(token, factory)` |
| `AddScoped<T>()` | `collection.addScoped(token, factory)` |
| `AddTransient<T>()` | `collection.addTransient(token, factory)` |
| `IServiceScope` / `CreateScope()` | `provider.createScope()` |
| Constructor injection | Factory function receiving a resolver |

**Divergence from ASP.NET Core:** `IServiceProvider.GetService<T>()` is synchronous — .NET typically does async setup (secrets, config, DB connections) *before* `builder.Build()`, not inside the container. Node leans async by default for exactly that kind of I/O, so Empire's `resolve()` returns `Promise<T>` uniformly — for every token, whether or not that particular factory actually needs to await anything.

### 2.2 Tokens

TS types vanish at runtime, so services are identified by `Symbol` tokens typed via a generic wrapper:

```ts
export type ServiceToken<T> = symbol & { __type?: T };

export function createToken<T>(name: string): ServiceToken<T> {
  return Symbol(name) as ServiceToken<T>;
}
```

### 2.3 Lifetimes

```ts
export enum Lifetime {
  Singleton, // one instance for the life of the process
  Scoped,    // one instance per request (or per created scope)
  Transient, // new instance every resolve() call
}
```

### 2.4 Registration

```ts
type Factory<T> = (resolver: Resolver) => T | Promise<T>;

interface ServiceDescriptor<T = unknown> {
  token: ServiceToken<T>;
  lifetime: Lifetime;
  factory: Factory<T>;
}

interface Resolver {
  resolve<T>(token: ServiceToken<T>): Promise<T>;
}
```

`resolve()` always returns a `Promise<T>`, even when the factory behind it is perfectly synchronous. Callers never need to know or check whether a given token happens to need `await` internally — they just always `await resolver.resolve(token)`. One method, no parallel `resolve()`/`resolveAsync()` surface to keep in sync.

Registering the same token twice is not a recoverable condition — it means two implementations are competing for the same dependency, which is a startup-time programming mistake, not something calling code should be able to catch and continue past. So it does **not** throw a normal `Error`: it prints a message identifying both registrations and hard-crashes the process (`process.exit(1)`), the same way a failed assertion would. A `try/catch` wrapped around a registration call has no way to swallow this — the process is gone before `catch` would ever run.

The collection also **seals itself once `build()` is called.** Without this, nothing stops code somewhere from calling `addSingleton()` after the provider is already live — a registration that either silently does nothing (if the provider copied the map) or, worse, mutates a container that's already resolving requests. Any registration attempt after sealing hits the same hard-crash path as a duplicate — it's the same category of bug (config happening somewhere other than the composition root).

`ServiceCollection` just accumulates descriptors:

```ts
class ServiceCollection {
  private descriptors = new Map<ServiceToken<any>, ServiceDescriptor>();
  private sealed = false;

  addSingleton<T>(token: ServiceToken<T>, factory: Factory<T>) {
    this.register(token, Lifetime.Singleton, factory);
  }

  addScoped<T>(token: ServiceToken<T>, factory: Factory<T>) {
    this.register(token, Lifetime.Scoped, factory);
  }

  addTransient<T>(token: ServiceToken<T>, factory: Factory<T>) {
    this.register(token, Lifetime.Transient, factory);
  }

  private register<T>(token: ServiceToken<T>, lifetime: Lifetime, factory: Factory<T>) {
    if (this.sealed) {
      // Not `throw` — same reasoning as duplicate registration below:
      // registering outside the composition root is a startup-time bug.
      console.error(
        `FATAL: attempted to register "${token.description}" after build() was already called.\n` +
        `  ServiceCollection is sealed once a ServiceProvider is built from it — ` +
        `all registrations must happen up front, in the composition root.`
      );
      process.exit(1);
    }

    const existing = this.descriptors.get(token);
    if (existing) {
      // Not `throw` — a duplicate registration is a startup-time bug, not a
      // runtime condition to recover from. Crash loudly instead of letting
      // some try/catch upstream swallow it and run with a broken container.
      console.error(
        `FATAL: duplicate service registration for "${token.description}".\n` +
        `  First registered as: ${Lifetime[existing.lifetime]}\n` +
        `  Registered again as: ${Lifetime[lifetime]}`
      );
      process.exit(1);
    }

    this.descriptors.set(token, { token, lifetime, factory });
  }

  build(): ServiceProvider {
    this.sealed = true;
    // Copy the map — belt-and-suspenders alongside the seal check, so the
    // provider never shares a live, mutable reference back to the collection.
    return new ServiceProvider(new Map(this.descriptors));
  }
}
```

### 2.5 Resolution & scoping

- Root `ServiceProvider` holds singleton instances, built lazily and cached forever.
- **Cache the promise, not just the value.** For singleton and scoped lifetimes, the cache stores the `Promise<T>` returned by calling the factory — not the awaited result. If two `resolve()` calls hit an unbuilt singleton before the first construction finishes, both get *the same in-flight promise* rather than racing to invoke the factory twice. Without this, an async singleton (e.g. one that opens a DB connection) could get constructed multiple times under concurrent requests.
- `provider.createScope()` returns a `ServiceScope` with its own scoped-instance cache (same promise-caching rule). Transient always bypasses caching — a fresh factory call (and fresh promise) every time; singleton delegates up to root.
- Resolving a scoped token from the *root* provider (no active scope) rejects — matches ASP.NET Core's "cannot resolve scoped service from root provider" behavior, just as a rejected promise instead of a thrown exception. This is the guard against a **captive dependency**: a singleton (which lives for the whole process) grabbing hold of a scoped instance (which should only live for one request). The way this actually shows up in practice is a singleton factory stashing the `Resolver` it was given and calling `resolve()` on it later, outside its own construction, expecting to fetch a scoped service on demand — that call rejects, by design.
- **Circular dependency detection, made async-safe.** A single shared mutable stack on the provider would misfire here: since `resolve()` is async, unrelated resolutions from different requests interleave on the event loop, and a shared stack could see request A's tokens while request B is mid-resolution and falsely report a cycle. Instead, each *top-level* `resolve()` call creates its own resolution-path `Set<ServiceToken<any>>`, threaded as a hidden argument through any nested `resolver.resolve()` calls made *within that one chain*. If a token reappears in that specific path, throw with the cycle listed. Two concurrent, unrelated `resolve()` calls each get their own path and never see each other's tokens.

### 2.6 Request-scoped lifetime

Attach a scope per incoming HTTP request, mirroring ASP.NET Core's per-request scope:

```ts
server.on('request', (req, res) => {
  const scope = rootProvider.createScope();
  (req as RequestWithServices).services = scope;
  res.on('finish', () => scope.dispose());
  router.handle(req, res);
});
```

Route handlers pull dependencies from `req.services.resolve(...)` instead of importing singletons directly. `createScope()` itself stays synchronous — only `resolve()` is async — so attaching a scope per request doesn't change this handler at all.

### 2.7 Disposal

Anything registered as scoped/transient that implements a `dispose(): void` method gets tracked by the scope and disposed when the scope ends (request finishes). Singleton disposal happens during graceful shutdown — see §2.8.

### 2.8 Graceful shutdown

On `SIGTERM` (and `SIGINT` for local dev):

1. Immediately close idle keep-alive sockets — they aren't serving anything, no reason to wait on them.
2. Stop accepting new connections; let in-flight requests finish naturally.
3. Force-close anything still open after a timeout, so one stuck request can't hang the process forever.
4. Dispose singleton services (anything with a `dispose()` method) in **reverse construction order** — the same reason C++ destructors run in reverse of constructors: a later singleton may hold a reference to an earlier one, so tear down in the opposite order they were built. This is safe by construction, not just convention: a singleton's dependencies are always resolved *before* the singleton itself finishes constructing (its factory `await`s them), so "reverse of construction order" can never dispose a dependency before something that depends on it. The one way to break this guarantee is the same captive-resolver misuse flagged in §2.5 — a singleton that stashes the resolver and reaches for another singleton later, outside its declared factory dependencies, isn't tracked as a real dependency and isn't protected by this ordering.
5. Exit.

```ts
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

async function shutdown(signal: string) {
  console.log(`${signal} received, shutting down gracefully`);

  server.closeIdleConnections(); // Node 18.2+: kill idle keep-alive sockets now

  // Root provider resolves singletons directly — no scope needed here.
  const config = await rootProvider.resolve(ConfigToken);
  const timeoutMs = config.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;

  const closed = new Promise<void>((resolve) => server.close(() => resolve()));
  const timedOut = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));

  const outcome = await Promise.race([
    closed.then(() => 'closed' as const),
    timedOut.then(() => 'timeout' as const),
  ]);

  if (outcome === 'timeout') {
    console.error(`Shutdown timed out after ${timeoutMs}ms — forcing remaining connections closed`);
    server.closeAllConnections();
  }

  await rootProvider.dispose();
  process.exit(outcome === 'timeout' ? 1 : 0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

`shutdownTimeoutMs` is an optional field on `Config` (e.g. sourced from a `SHUTDOWN_TIMEOUT_MS` env var in `loadConfig()`). The `??` fallback means shutdown works with a sane default even if Config never sets it — the override is opt-in, not required.

`ServiceProvider.dispose()` walks constructed singletons in reverse order, awaiting each instance's promise (since singletons are cached as promises — see §2.5) before checking whether it has a `dispose()` method:

```ts
class ServiceProvider {
  private singletons = new Map<ServiceToken<any>, Promise<unknown>>();
  private constructionOrder: ServiceToken<any>[] = []; // pushed on first resolve of each singleton

  // ...resolve() logic omitted, see §2.5...

  async dispose(): Promise<void> {
    for (const token of [...this.constructionOrder].reverse()) {
      const instance = await this.singletons.get(token);
      if (isDisposable(instance)) {
        try {
          await instance.dispose();
        } catch (err) {
          // One broken dispose() shouldn't stop the rest from cleaning up.
          console.error(`Error disposing singleton "${token.description}":`, err);
        }
      }
    }
  }
}

function isDisposable(x: unknown): x is { dispose(): void | Promise<void> } {
  return typeof x === 'object' && x !== null && typeof (x as any).dispose === 'function';
}
```

Note `closeIdleConnections()` and `closeAllConnections()` are native `http.Server` methods (Node 18.2+) — no library needed, but worth confirming your Node version supports them.

## 3. Build order / milestones

- [x] **DI-1: Tokens & types** — `ServiceToken`, `createToken`, `Lifetime`, `ServiceDescriptor`, `Resolver` (`resolve` returns `Promise<T>`; `Factory<T>` accepts sync or async)
- [x] **DI-2: ServiceCollection** — `addSingleton` / `addScoped` / `addTransient`; hard-crash (`process.exit(1)`, not a throw) on duplicate token registration; seal on `build()` and hard-crash on any registration attempted afterward
- [x] **DI-3: Root ServiceProvider** — singleton caching **of the in-flight promise** (not the settled value), transient resolution, "missing registration" error, per-call circular dependency detection
- [x] **DI-4: ServiceScope** — scoped caching (same promise-caching rule as DI-3), `createScope()`, root-provider guard against resolving scoped tokens
- [x] **DI-5: Disposal** — track disposables per scope, `scope.dispose()`
- [x] **DI-6: HTTP integration** — attach a scope per request, wire into the existing router
- [x] **DI-7a: Proof of concept — API client.** Build `IHttpClient` / `NodeHttpClient`, wire `UpstreamApiService` through the container (§4.2) — `examples/09-dependency-injection/server.ts`
- [x] **DI-7b: Proof of concept — exposed endpoints.** Build the sample repository, expose the three record endpoints off one shared singleton (§4.3) — same example file
- [x] **DI-8: Graceful shutdown** — idle-connection close, timeout-forced close, `ServiceProvider.dispose()` in reverse construction order, all wired into `Empire.stop()`. No auto-registered `SIGTERM`/`SIGINT` handler — that stays application-level, see §8's 2026-08-18 decisions
- [ ] **DI-9: Tests** — see §5 (this final review pass)

## 4. Examples

### 4.1 Proxy route

```ts
// tokens.ts
export const LoggerToken = createToken<Logger>('Logger');
export const ConfigToken = createToken<Config>('Config');
export const ProxyServiceToken = createToken<ProxyService>('ProxyService');

// composition-root.ts
const services = new ServiceCollection();

// Genuinely async: reads a secret off disk before config exists.
services.addSingleton(ConfigToken, async () => {
  const secret = await readSecretFile('./secret.txt');
  return loadConfig(secret);
});

// Not async on its own — async only because it awaits resolve().
services.addSingleton(LoggerToken, async (r) => new Logger(await r.resolve(ConfigToken)));

services.addScoped(ProxyServiceToken, async (r) =>
  new ProxyService(await r.resolve(ConfigToken), await r.resolve(LoggerToken))
);

export const rootProvider = services.build();

// route handler
async function handleProxyRequest(req: RequestWithServices, res: ServerResponse) {
  const proxyService = await req.services.resolve(ProxyServiceToken);
  proxyService.forward(req, res);
}
```

`Config` and `Logger` are process-wide singletons; `ProxyService` is scoped so each request gets its own instance — useful once it starts holding per-request state like timing or correlation IDs.

### 4.2 API service — calling an upstream JSON API

The bigger payoff of DI shows up here: services that hit an external API are exactly the ones you want to fake out in tests. This mirrors the OpenSky token-and-fetch pattern from Flight Tracker, but built for constructor injection from day one instead of module-level state.

**Step 1 — an `IHttpClient` interface, not a concrete `https` call.** Nothing about `UpstreamApiService` should know it's using Node's `https` module — that's what gets swapped for a fake in tests.

```ts
// http-client.ts
export interface IHttpClient {
  getJson<T>(url: string, headers?: Record<string, string>): Promise<T>;
}

export class NodeHttpClient implements IHttpClient {
  getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
    return new Promise((resolve, reject) => {
      const target = new URL(url);
      const client = target.protocol === 'https:' ? https : http;
      const req = client.request(target, { method: 'GET', headers }, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
          }
          try {
            resolve(JSON.parse(body) as T);
          } catch (err) {
            reject(err);
          }
        });
      });
      req.on('error', reject);
      req.end();
    });
  }
}
```

**Step 2 — the API service itself**, depending on the interface (not the concrete client), plus `Config` for the base URL and `Logger` for visibility:

```ts
// upstream-api-service.ts
export interface UpstreamRecord {
  id: string;
  value: number;
}

export class UpstreamApiService {
  constructor(
    private http: IHttpClient,
    private config: Config,
    private logger: Logger
  ) {}

  async fetchRecords(): Promise<UpstreamRecord[]> {
    this.logger.info('Fetching records from upstream');
    return this.http.getJson<UpstreamRecord[]>(`${this.config.upstreamBaseUrl}/records`);
  }
}
```

**Step 3 — tokens and registration**, same shape as everything else:

```ts
// tokens.ts (additions)
export const HttpClientToken = createToken<IHttpClient>('HttpClient');
export const UpstreamApiServiceToken = createToken<UpstreamApiService>('UpstreamApiService');

// composition-root.ts (additions)
services.addSingleton(HttpClientToken, () => new NodeHttpClient());

services.addScoped(UpstreamApiServiceToken, async (r) =>
  new UpstreamApiService(
    await r.resolve(HttpClientToken),
    await r.resolve(ConfigToken),
    await r.resolve(LoggerToken)
  )
);
```

`NodeHttpClient` is a singleton — it's stateless, no reason to rebuild it per request. `UpstreamApiService` is scoped, matching `ProxyService` — same reasoning: room to hold per-request state later without a redesign.

**Step 4 — the actual payoff: testing without a network call.** Because `UpstreamApiService` depends on `IHttpClient` (an interface) rather than `NodeHttpClient` (a concrete class using real sockets), a test can hand it a fake directly — no container involved at all:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';

class FakeHttpClient implements IHttpClient {
  constructor(private responses: Record<string, unknown>) {}
  async getJson<T>(url: string): Promise<T> {
    if (!(url in this.responses)) throw new Error(`Unexpected URL: ${url}`);
    return this.responses[url] as T;
  }
}

test('fetchRecords returns records from the upstream API', async () => {
  const fakeHttp = new FakeHttpClient({
    'https://api.example.com/records': [{ id: 'a1', value: 42 }],
  });
  const config = { upstreamBaseUrl: 'https://api.example.com' } as Config;
  const logger = { info: () => {} } as Logger;

  const service = new UpstreamApiService(fakeHttp, config, logger);
  const records = await service.fetchRecords();

  assert.deepEqual(records, [{ id: 'a1', value: 42 }]);
});
```

No `ServiceCollection`, no `ServiceProvider`, no network — just the constructor called directly with fakes. The container exists to wire real dependencies together at runtime; it was never required to get this testability. That's the actual argument for constructor injection over reaching for singletons/imports directly: even without DI-1 through DI-9 built yet, writing `UpstreamApiService` to take its dependencies as constructor arguments (instead of importing a module-level `https` call) is what makes this test possible at all.

**Extending this pattern:** token caching (OpenSky's OAuth2 client-credentials flow) and response caching (the 25s cache from Flight Tracker) both fit as additional state inside a service built this way — a `TokenService` singleton with an internal `cachedToken`/`expiresAt` pair, following the exact same shape as `UpstreamApiService` above. Not built out here to keep this example focused, but the pattern doesn't change.

### 4.3 Sample DB — exposing several endpoints off one repository

§4.2 covers Empire *calling out* to an upstream API. This one covers Empire *exposing* its own endpoints, backed by a shared data store — closer to what "a number of APIs" off one DI-managed dependency actually looks like.

For the sample, an in-memory store stands in for a real database — no external dependency, and trivial to seed/reset in tests. (If you want an actual embedded database later without adding a package, `node:sqlite` — built into Node since 22.5, still experimental — is the one real option that doesn't violate the no-deps constraint. Worth checking your installed Node version before relying on it.)

**Step 1 — a repository interface + in-memory implementation:**

```ts
// record-repository.ts
export interface Record {
  id: string;
  name: string;
  value: number;
}

export interface IRecordRepository {
  getAll(): Promise<Record[]>;
  getById(id: string): Promise<Record | undefined>;
  create(data: Omit<Record, 'id'>): Promise<Record>;
}

export class InMemoryRecordRepository implements IRecordRepository {
  private records = new Map<string, Record>();
  private nextId = 1;

  constructor(seed: Record[] = []) {
    for (const record of seed) this.records.set(record.id, record);
  }

  async getAll(): Promise<Record[]> {
    return [...this.records.values()];
  }

  async getById(id: string): Promise<Record | undefined> {
    return this.records.get(id);
  }

  async create(data: Omit<Record, 'id'>): Promise<Record> {
    const record: Record = { id: String(this.nextId++), ...data };
    this.records.set(record.id, record);
    return record;
  }
}
```

**Step 2 — register it as a singleton.** It *is* the database — its state has to persist across requests, same reasoning a real connection pool would be a singleton:

```ts
// tokens.ts (additions)
export const RecordRepositoryToken = createToken<IRecordRepository>('RecordRepository');

// composition-root.ts (additions)
services.addSingleton(RecordRepositoryToken, () =>
  new InMemoryRecordRepository([
    { id: '1', name: 'First sample', value: 10 },
    { id: '2', name: 'Second sample', value: 20 },
  ])
);
```

**Step 3 — three route handlers, one shared dependency:**

```ts
// routes.ts
router.get('/records', async (req: RequestWithServices, res) => {
  const repo = await req.services.resolve(RecordRepositoryToken);
  const records = await repo.getAll();
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(records));
});

router.get('/records/:id', async (req: RequestWithServices, res, params) => {
  const repo = await req.services.resolve(RecordRepositoryToken);
  const record = await repo.getById(params.id);
  if (!record) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Not found' }));
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(record));
});

router.post('/records', async (req: RequestWithServices, res) => {
  const repo = await req.services.resolve(RecordRepositoryToken);
  const body = await readJsonBody(req); // existing body-parsing helper, not shown
  const record = await repo.create(body);
  res.writeHead(201, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(record));
});
```

Three separate handlers, one token, no manual imports of a shared module-level `Map` anywhere. Each request resolves the *same* singleton repository instance through its own scope — that's the point of the pattern: consumers don't know or care that it's a singleton underneath, they just `resolve()` and use it.

**Step 4 — testing, same story as §4.2:** the repository is directly constructible with seed data, so tests never need the container:

```ts
test('getAll returns seeded records', async () => {
  const repo = new InMemoryRecordRepository([{ id: '1', name: 'Test', value: 5 }]);
  const records = await repo.getAll();
  assert.deepEqual(records, [{ id: '1', name: 'Test', value: 5 }]);
});

test('create adds a new record and assigns an id', async () => {
  const repo = new InMemoryRecordRepository();
  const created = await repo.create({ name: 'New', value: 99 });
  assert.equal(created.name, 'New');
  assert.ok(created.id);
  assert.deepEqual(await repo.getById(created.id), created);
});
```

**Where this connects back to the rest of the doc:** a *real* database connection (SQLite, Postgres, whatever) would implement `dispose(): Promise<void>` to close its connection pool — and because it's registered as a singleton, `provider.dispose()` (§2.8) picks it up automatically during graceful shutdown. Nothing about the shutdown flow needs to change; a disposable repository singleton is exactly the case §2.7/§2.8 were built for. The in-memory sample here has nothing to dispose, so it just doesn't implement the method.

## 5. Tests

No external test runner needed — Node's built-in `node:test` + `node:assert/strict` cover this without adding a dependency.

Minimum coverage:

- [ ] Singleton: two `resolve()` calls (including across different scopes) return the same instance
- [ ] Concurrent `resolve()` calls on an unbuilt async singleton construct it exactly once — the in-flight promise is cached, not just the settled value
- [ ] Transient: two `resolve()` calls return different instances
- [ ] Scoped: same instance within one scope, different instance across two separate scopes
- [ ] Resolving an unregistered token throws a clear error naming the token
- [ ] Registering the same token twice crashes the process (`process.exit(1)`) with a message naming the token and both lifetimes — not a catchable throw
- [ ] Registering a token after `build()` has been called crashes the process the same way
- [ ] Resolving a scoped token from the root provider (no active scope) throws
- [ ] Circular dependency (A → B → A) throws with the cycle path in the error message
- [ ] `scope.dispose()` calls `dispose()` on every scoped instance that has one, and only once
- [ ] `provider.dispose()` disposes constructed singletons in reverse construction order
- [ ] `provider.dispose()` continues disposing remaining singletons even if one instance's `dispose()` throws

```ts
import test from 'node:test';
import assert from 'node:assert/strict';

test('singleton returns same instance across scopes', async () => {
  const services = new ServiceCollection();
  const token = createToken<{ id: number }>('Thing');
  let calls = 0;
  services.addSingleton(token, () => ({ id: ++calls }));
  const provider = services.build();

  const a = await provider.createScope().resolve(token);
  const b = await provider.createScope().resolve(token);

  assert.equal(a, b);
  assert.equal(calls, 1);
});

test('concurrent resolve() calls do not construct an async singleton twice', async () => {
  const services = new ServiceCollection();
  const token = createToken<{ id: number }>('Thing');
  let calls = 0;
  services.addSingleton(token, async () => {
    await new Promise((r) => setTimeout(r, 10)); // simulate slow async setup
    return { id: ++calls };
  });
  const provider = services.build();
  const scope = provider.createScope();

  // Both resolves fire before the first construction has finished.
  const [a, b] = await Promise.all([scope.resolve(token), scope.resolve(token)]);

  assert.equal(a, b);
  assert.equal(calls, 1);
});

test('provider.dispose() tears down singletons in reverse construction order', async () => {
  const services = new ServiceCollection();
  const order: string[] = [];
  const firstToken = createToken<{ dispose(): void }>('First');
  const secondToken = createToken<{ dispose(): void }>('Second');
  services.addSingleton(firstToken, () => ({ dispose: () => order.push('first') }));
  services.addSingleton(secondToken, () => ({ dispose: () => order.push('second') }));
  const provider = services.build();
  const scope = provider.createScope();

  // Construct both — order they're first resolved is the construction order.
  await scope.resolve(firstToken);
  await scope.resolve(secondToken);

  await provider.dispose();

  assert.deepEqual(order, ['second', 'first']); // reverse of construction
});
```

Testing the crash path means stubbing `process.exit` for the duration of one test — normal application code never gets this option, but tests can reach in:

```ts
test('duplicate registration crashes the process, not throws', () => {
  const originalExit = process.exit;
  const originalError = console.error;
  let exitCode: number | undefined;
  let loggedMessage = '';

  // Stub exit to throw a sentinel instead of actually killing the test
  // runner — this is a test-only escape hatch, not something app code has.
  process.exit = ((code?: number) => {
    exitCode = code;
    throw new Error('__process_exit_stub__');
  }) as typeof process.exit;
  console.error = (msg: string) => { loggedMessage = msg; };

  try {
    const services = new ServiceCollection();
    const token = createToken<{}>('Thing');
    services.addSingleton(token, () => ({}));

    assert.throws(
      () => services.addSingleton(token, () => ({})),
      /__process_exit_stub__/
    );
    assert.equal(exitCode, 1);
    assert.match(loggedMessage, /duplicate service registration/i);
  } finally {
    process.exit = originalExit;
    console.error = originalError;
  }
});

test('registering after build() crashes the process', () => {
  const originalExit = process.exit;
  const originalError = console.error;
  let exitCode: number | undefined;
  let loggedMessage = '';

  process.exit = ((code?: number) => {
    exitCode = code;
    throw new Error('__process_exit_stub__');
  }) as typeof process.exit;
  console.error = (msg: string) => { loggedMessage = msg; };

  try {
    const services = new ServiceCollection();
    services.build(); // seals the collection

    assert.throws(
      () => services.addSingleton(createToken<{}>('TooLate'), () => ({})),
      /__process_exit_stub__/
    );
    assert.equal(exitCode, 1);
    assert.match(loggedMessage, /after build\(\) was already called/i);
  } finally {
    process.exit = originalExit;
    console.error = originalError;
  }
});
```

## 6. Guardrails (over-engineering risk)

DI containers are a classic place for enterprise habits to sprawl. For v1:

- No decorator/attribute-based auto-wiring — needs `reflect-metadata`, which violates the no-deps constraint anyway
- No property injection — constructor/factory injection only
- No child-scope hierarchies beyond root → single request scope
- No lazy circular-dependency resolution (proxies, `Lazy<T>`-style wrappers) — detect and throw instead
- If you catch yourself designing a plugin system for the container, stop and re-read this section
- One `resolve()`, always async — resist adding a separate synchronous fast path "for the common case." A dual API means every caller has to know which one a given token needs.
- Graceful shutdown is a signal handler, a timeout, and reverse-order disposal — nothing more. No health-check/readiness endpoints, no configurable shutdown phases, no draining strategy beyond "wait, then force." If it starts looking like a state machine, it's grown past what v1 needs.

## 7. Open questions / parking lot

None currently — add new questions here as they come up.

## 8. Decisions log

- **2026-08-17** — DI style: hand-rolled container modeled on ASP.NET Core's `ServiceCollection` / `ServiceProvider`, factory-based registration (no reflection) to preserve the zero-dependency constraint.
- **2026-08-17** — Duplicate registration: hard-crash the process (`process.exit(1)` with a message naming both registrations), not a catchable `throw` and not a silent overwrite. Applies to `addSingleton` / `addScoped` / `addTransient` alike. Reasoning: this is a startup-time configuration bug, and a normal `throw` could be swallowed by a `try/catch` upstream, letting the server boot with a broken container.
- **2026-08-17** — No graceful shutdown in v1: no `SIGTERM` handler, no singleton disposal, no draining in-flight requests before exit. *(Superseded below.)*
- **2026-08-17** — Async factories: supported from v1, not deferred. `resolve()` returns `Promise<T>` uniformly for every token — no separate `resolveAsync()`. `Factory<T>` accepts `T | Promise<T>`. Singleton/scoped caches store the in-flight promise, not the settled value, so concurrent resolutions never double-construct. Circular dependency detection uses a resolution-path `Set` scoped to each top-level `resolve()` call rather than one shared stack, so concurrent unrelated resolutions on the event loop can't falsely trip each other's cycle check. Reasoning: Node's I/O (secrets, config, DB connections) is pervasively async in a way .NET's typically-synchronous DI graph isn't, so forcing all async setup to happen before `build()` — the .NET pattern — would be more awkward here than resolving it directly in the container.
- **2026-08-17** — Graceful shutdown (supersedes the "no graceful shutdown" entry above): on `SIGTERM`/`SIGINT`, close idle keep-alive sockets immediately (`server.closeIdleConnections()`), stop accepting new connections (`server.close()`), force-close anything still open after a timeout (`server.closeAllConnections()`), then dispose singletons via `provider.dispose()` in reverse construction order before exiting. Request-scoped disposal (§2.7) is unaffected — that already happens per-request regardless of process shutdown.
- **2026-08-17** — Shutdown timeout: default (`DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000`) with an optional override via `Config.shutdownTimeoutMs`. The default lives in code, not Config, so shutdown still works correctly if Config never sets it.
- **2026-08-17** — Container sealing: `ServiceCollection` seals itself in `build()`; any `addSingleton`/`addScoped`/`addTransient` call afterward hard-crashes the same way a duplicate registration does. `build()` also hands the provider a copied `Map`, not a live reference to the collection's own map. Reasoning: without this, nothing stops registration from happening somewhere other than the composition root, including after the provider is already resolving requests.
- **2026-08-18** — Shutdown timeout source: section 2.8's pseudocode reads `Config.shutdownTimeoutMs` off a DI-resolved `Config` service. Empire has no such service - `Config` there was illustrative, not a real Empire type. Implemented instead as `EmpireOptions.shutdownTimeoutMs?: number` (default 10,000ms), following the same options-object pattern as the existing `maxBodySize?`. No DI resolution needed at shutdown time as a result.
- **2026-08-18** — Signal handling: section 2.8's pseudocode calls `process.on('SIGTERM'/'SIGINT', shutdown)` itself. Empire does not register these - `Empire.stop()` contains all the graceful-shutdown mechanics (idle-connection close, timeout race, forced close, service disposal), but deciding when to call it stays the application's job, exactly matching the pattern every example in `examples/` already used before DI-8 existed. Reasoning: a library registering process-wide signal handlers as a side effect of construction is a surprising global side effect, and would be actively harmful here - many short-lived `Empire` instances (this project's own test suite constructs dozens) would each leak a listener and risk interfering with, e.g., a test runner's own `Ctrl+C` handling. Documented in README.MD's new "Server Lifecycle" section.

## 9. README structure (for the DI section)

Section list for the Dependency Injection part of the project README, once DI-1 through DI-9 are built.

1. Overview — one-paragraph pitch: ASP.NET Core-shaped container (`ServiceCollection`/`ServiceProvider`), zero external dependencies, why it exists
2. Core Concepts — tokens (`createToken`), lifetimes (Singleton/Scoped/Transient), factories
3. Quick Start — smallest possible register-and-resolve snippet
4. API Reference — `ServiceCollection` (`addSingleton`/`addScoped`/`addTransient`), `ServiceProvider` (`resolve`/`createScope`/`dispose`), `ServiceScope` (`resolve`/`dispose`)
5. Async Resolution — why `resolve()` always returns `Promise<T>`, even for sync factories
6. Registration Rules — duplicate registration hard-crashes (`process.exit(1)`), container seals itself on `build()`
7. Scoping & Request Lifecycle — how a scope attaches to each incoming HTTP request
8. Disposal — per-request disposal vs. singleton disposal
9. Graceful Shutdown — `SIGTERM`/`SIGINT` flow, timeout, `Config.shutdownTimeoutMs` override
10. Circular Dependency Detection
11. Testing Services Registered via DI — constructor injection means services test without touching the container at all
12. Non-Goals — no decorators/reflection metadata, no property injection, no scope hierarchies beyond root→request
13. Examples — one subsection per example, each explaining what it demonstrates, the tokens/registrations involved, and a link to the runnable file:
    - 13.1 Proxy Route — singleton `Config`/`Logger`, scoped `ProxyService`; the baseline wiring pattern everything else follows
    - 13.2 API Client — `IHttpClient` interface hiding `NodeHttpClient`; demonstrates swapping a fake client into `UpstreamApiService` for tests with zero container involvement
    - 13.3 Sample DB & Exposed Endpoints — in-memory `IRecordRepository` singleton backing three separate route handlers (`GET /records`, `GET /records/:id`, `POST /records`); demonstrates multiple consumers sharing one dependency, plus where a real DB's `dispose()` would hook into graceful shutdown
