# Changelog

All notable changes to `empire-ts` are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this
package does not yet commit to strict semantic versioning - see the
experimental notice in [README.MD](README.MD).

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
