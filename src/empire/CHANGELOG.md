# Changelog

All notable changes to `empire-ts` are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this
package does not yet commit to strict semantic versioning - see the
experimental notice in [README.MD](README.MD).

## [Unreleased]

## [0.1.4] - 2026-09-23

### Added

- A layer-7 load balancer - a learning and local-development tool, not a
  production edge. `createLoadBalancerMiddleware()` proxies requests to
  backends with streamed request and response bodies, round robin by
  default behind the new `ILoadBalancingStrategy` seam; `BackendRegistry`
  holds backends as leases that expire unless renewed, so a killed backend
  drops out of rotation on its own.
- Backends register themselves: `createBackendRegistrationEndpoint()`
  (bearer token required, loopback only by default) and the backend-side
  `LoadBalancerRegistration` client, which registers, heartbeats and
  deregisters on `stop()`.
- `createLoadBalancerDashboard()`: a live three.js dashboard - the balancer
  as a hub, backends on a ring, each request a particle - with per-backend
  drill-down into a route table, a live call tail and a route
  constellation. Fed by Server-Sent Events from `LoadBalancerMonitor`.
  three.js loads in the browser only; `empire-ts` has no runtime
  dependencies.
- `Context.route`: the route pattern `Router` matched (`/users/:id`), and
  `createRouteHeaderMiddleware()`, which reports it as `X-Empire-Route`.
- `examples/12-load-balancer`: a balancer, a configurable self-registering
  backend and a traffic generator.
- `LeastConnectionsStrategy`: sends each request to the backend with the
  fewest requests in flight, rotating through ties. It reads
  `LoadBalancerMonitor.inFlight()`, and `createLoadBalancerMiddleware` refuses
  to start unless the strategy and the balancer share one monitor. The example
  takes it as an argument: `server.ts least-connections`.
- `StandardSchemaV1` and its supporting types (`StandardSchemaProps`,
  `StandardSchemaResult`, `StandardSchemaSuccess`, `StandardSchemaFailure`,
  `StandardSchemaIssue`, `StandardSchemaPathSegment`, `StandardSchemaTypes`):
  a copy of the [Standard Schema](https://standardschema.dev) v1 interface,
  which is what `validate()` now accepts.

### Changed

- **Breaking:** `empire-ts` no longer depends on Zod, and `npm install
  empire-ts` no longer installs it. `validate()` accepts any Standard
  Schema validator - Zod 3.24 and later, Valibot, ArkType, or a hand-written
  one - and `ValidationSchemas` is typed with `StandardSchemaV1` instead of
  `ZodType`. To keep validating with Zod, install it yourself
  (`npm install zod`); the schemas and the `validate()` call sites do not
  change. `README.MD` has a "Validation with Zod" section.
- `validate()` now checks the body, the query and the params and reports every
  problem in one `400`, in that order, instead of stopping at the first
  location that fails. The `{ error, details }` response body is unchanged.
- A validation issue about a whole value, with no path, now reports its
  `field` as `body` (or `query`, `params`) rather than `body.`.
- The backend registration endpoint validates without Zod and reports every
  problem in one `400`: a bad id and a bad url are both listed in `details`.
- The examples no longer need Zod. `10-validation` validates with
  hand-written Standard Schema validators; `02-routing`, `05-error-handling`,
  `09-dependency-injection` and `full-featured.ts` check request bodies with
  `BadRequestError`.

### Removed

- The `zod` dependency, from `package.json` and `package-example/package.json`.
  `require("empire-ts")` now loads no third-party module.

## [0.1.3] - 2026-09-14

### Fixed

- `README.MD`'s links to anything not bundled with the npm package
  (Empire's own `examples/`, `README_DEVELOPMENT.MD`) were relative,
  so they worked on GitHub but would break for anyone reading this
  from npmjs.com or from inside an installed `node_modules/empire-ts`.
  Now full GitHub URLs.

### Changed

- Examples section: the bare `npx tsx examples/02-routing/server.ts`
  run-command, which showed how to run something but not how the
  package is used, replaced with the actual full source of
  `01-basic-server` and `02-routing`, each importing from `"empire-ts"`.
  No code changes.

## [0.1.2] - 2026-09-14

**Deprecated on npm** - `README.MD`'s links to anything not bundled
with the package were still relative and broken for an npm reader; use
`0.1.3` or later.

### Added

- `CHANGELOG.md` (this file), now listed in `package.json`'s `files` so
  it ships with the package - `CHANGELOG*` isn't part of npm's automatic
  README/LICENSE include list, so it had to be added explicitly.

### Changed

- `README.MD` revised: documents `package-example/`, a standalone demo
  project that mirrors all 11 of Empire's examples plus a bonus combined
  one, each one actually installed and run against a real `npm pack`
  tarball rather than the source tree. Links to `README_DEVELOPMENT.MD`
  (the full framework walkthrough, what this file used to be) for
  building or contributing to Empire itself. No code changes.

## [0.1.1] - 2026-09-13

**Deprecated on npm** - documentation was still wrong for this version;
use `0.1.3` or later.

### Changed

- Rewrote the package's `README.MD` to be consumer-facing (what someone
  sees after `npm install empire-ts`) instead of the repository's
  dev-setup-oriented one. No code changes.

## [0.1.0] - 2026-09-12

**Deprecated on npm** - documentation was still wrong for this version;
use `0.1.3` or later.

### Added

- Initial publish: `Empire` server, routing (all six HTTP methods,
  `:param` capture, automatic HEAD/OPTIONS), the `(ctx, next)`
  middleware pipeline, `Context` request/response API, static file
  serving with SPA fallback, a dependency injection container
  (singleton/scoped/transient lifetimes, disposal), schema-based request
  validation via `validate()` (Zod), CORS support via
  `createCorsMiddleware()`, centralized error handling (`HttpError`),
  configurable request body size limit, and a pluggable logging
  abstraction (`ILogger`).
