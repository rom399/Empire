# Changelog

All notable changes to `empire-ts` are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this
package does not yet commit to strict semantic versioning - see the
experimental notice in [README.MD](README.MD).

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

### Changed

- Rewrote the package's `README.MD` to be consumer-facing (what someone
  sees after `npm install empire-ts`) instead of the repository's
  dev-setup-oriented one. No code changes.

## [0.1.0] - 2026-09-12

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
