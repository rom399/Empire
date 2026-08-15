# Feature Build — Test Updates: Empire, StaticFileHandler

## Status

**Not started.** Created 2026-08-15.

## Scope

Two confirmed test-coverage gaps, verified by reading the actual current
test files rather than trusting `PLAN.md`'s checklist (several of its
other unchecked boxes — `HttpError.test.ts`/`BadRequestError.test.ts`/
`MimeTypes.test.ts`'s basic-coverage items — turned out to already be
done; these two are real):

1. **`Empire.test.ts`** only covers `start`/`stop`, `logger`, and the
   `put`/`patch`/`delete` routing methods added for Missing HTTP Verbs.
2. **`StaticFileHandler.test.ts`** has path-traversal, HEAD, and prefix
   coverage (8 tests) but nothing testing plain file resolution or the
   directory → `index.html` fallback.

## Correction made during research — narrower than first described

Before writing this plan, I re-checked the actual claim that "no test
exercises Empire's middleware pipeline." That's not quite right:
`tests/integration/MiddlewarePipeline.test.ts` already covers
registration order, the double-`next()` guard, and error-to-response
mapping — through a real `Empire` instance, not just at the `Router`
level. Duplicating that here would be wasted, redundant coverage.

What's genuinely still missing, confirmed by reading that file's exact
test titles:
- A middleware that simply **doesn't call `next()`** halting the chain —
  no test asserts this directly.
- A **positive-path** case: middleware completes, chain reaches a real
  route handler, successful response — `MiddlewarePipeline.test.ts`'s
  existing tests are all about errors/ordering, not the plain success case.

`useStaticFiles()` through `Empire`'s real API, by contrast, is a fully
confirmed gap — `grep`ing the whole `tests/` tree found exactly one use
of it (`StaticFileStreamingAbort.test.ts`), and that test is gated behind
`RUN_FLAKY_TESTS=true`, excluded from the normal suite entirely. Zero
coverage in what actually runs on `npm test`.

## Verified before planning, not assumed

Directory-index-fallback behavior was checked against the real
`StaticFileHandler` before writing test descriptions for it, rather than
inferring from the source: it works identically whether the request path
has a trailing slash or not (`/about/` and `/about` both resolve to
`root/about/index.html`), and correctly returns `false` (not a crash, not
a silent 200) for a directory that exists but has no `index.html` inside
it.

---

## Step 1 — `Empire.test.ts`: the middleware gap that's actually still open ✅

- [x] New `describe("middleware")` block, between `routing` and `logger`
- [x] `it('does not proceed to the next middleware when one does not call next()')`
- [x] `it('dispatches to a registered route when the middleware chain completes')`
- [x] Updated the file's header comment, which previously said middleware
  coverage was fully deferred

**Design note surfaced during implementation:** a middleware that never
calls `next()` leaves the HTTP response genuinely unsent — no timeout, no
error, the connection just hangs. A plain `await fetch(...)` would hang
the test itself, and worse, the dangling open connection would then hang
`app.stop()` in `afterEach` too (it waits for all connections to close).
Used the same abort-after-a-short-wait pattern already established in
`FileStreaming.test.ts` for this exact class of problem: fire the
request, wait 100ms for the in-process pipeline to (not) progress, assert
on the in-memory flags, then abort the still-pending request so the
connection actually closes. Verified this works — full file runs in
183ms, `app.stop()` doesn't hang.

Verified: `tsc --noEmit` clean, 11/11 tests in this file passing, full
suite 176/177 (up from 174), no regressions.

## Step 2 — `Empire.test.ts`: `useStaticFiles()` through the real API ✅

- [x] New `describe("useStaticFiles")` block
- [x] `it('useStaticFiles() serves a file from the given root')`
- [x] `it('useStaticFiles() falls through to routing when no file matches')`
- [x] `it('useStaticFiles() with spaFallback serves index.html for an unmatched GET path')`

**Real issue caught and fixed:** the first and third tests initially took
~3 seconds each (300x slower than everything else in the file) — the
whole file went from 6234ms to 210ms after the fix. Instrumented each
phase in a standalone script rather than guessing: `fetch()` and reading
the body were fast (tens of ms), but `app.stop()` alone took ~3000ms. Root
cause: `fetch()`'s client keeps the TCP socket open (HTTP keep-alive) for
possible reuse; `server.close()` (what `app.stop()` wraps) waits for every
open connection to actually close before its callback fires, so it was
waiting out the server's `keepAliveTimeout` instead of returning
immediately. Fixed by sending `Connection: close` on those two requests,
confirmed via the same standalone script before applying it to the real
tests (`app.stop()`: 3016ms → 2ms). Scoped to just the two affected
`fetch()` calls — not a change to `Empire.ts`'s server config, which
would affect real app behavior, not just test speed.

**Also surfaced (pre-existing, unrelated) while running the full suite
repeatedly to verify this fix:** `tests/integration/FileStreaming.test.ts`
— a file untouched by this work — fails intermittently (1 of 3 full-suite
runs) under full-suite parallelism. Same class of issue already
documented for the manual-only `StaticFileStreamingAbort.test.ts`: abort-
mid-stream tests competing for I/O when many test files run concurrently.
Not introduced by this step; out of scope to fix here.

Verified: `tsc --noEmit` clean, 14/14 tests in `Empire.test.ts` passing in
210ms (down from 6234ms), full suite 178-179/180 depending on the
pre-existing `FileStreaming.test.ts` flake above.

## Step 3 — `StaticFileHandler.test.ts`: basic resolution ✅

- [x] New `describe("basic resolution")` block, using the existing
  `root`/`contextFor()` fixture already in this file — no new fixture
  setup needed for most of these
- [x] `it('serves a file that exists at the request path')`
- [x] `it('sets the correct Content-Type from the file extension')` — added
  a second fixture file with a non-`.html` extension (`style.css`)
  so this genuinely proves extension-based MIME detection, not just that
  `index.html` happens to already be tested elsewhere
- [x] `it('sets Content-Length to the file size')` — asserts against
  `fs.statSync(...).size`, same pattern the existing HEAD tests already use
- [x] `it('returns false when the file does not exist, so the middleware chain continues')`

Placed as the first `describe` block in the file (before "path traversal
guard"), since it covers the handler's baseline behavior. `style.css`
fixture added alongside `index.html` in the shared `beforeAll`.

Verified: `tsc --noEmit` clean, 12/12 tests in this file passing (57ms).
Full suite: 182 passed, 1 pre-existing flake in
`tests/integration/FileStreaming.test.ts` (untouched by this step —
re-ran in isolation, passed), 1 skipped (manual-only flaky test).

## Step 4 — `StaticFileHandler.test.ts`: directory index fallback

- [ ] New `describe("directory index fallback")` block
- [ ] Extend `beforeAll` fixture setup: a subdirectory with its own
  `index.html` (e.g. `root/about/index.html`), and a separate empty
  subdirectory with no `index.html` inside it
- [ ] `it('serves index.html when the request path resolves to a directory containing one')`
  — request `/about/`, matching the `.../about/` → `.../about/index.html`
  behavior documented in `doc/ARCHITECTURE.md`
- [ ] `it('serves index.html when the request path has no trailing slash')`
  — request `/about` (no trailing slash), confirming the behavior verified
  above: identical result either way
- [ ] `it('returns false when the request path resolves to a directory with no index.html')`

## Step 5 — README documentation

`README.MD` currently has **no "Static Files" section at all** —
`useStaticFiles()`, prefix mounting, and directory-index fallback are
documented in `doc/ARCHITECTURE.md` (an internal doc) but never in the
user-facing README. This is worth fixing as part of writing tests for
the same capability, not scope creep — a developer reading the README
today wouldn't know this feature exists.

- [ ] New "Static Files" section in `README.MD`, placed after "Routing"
  and before "Middleware" (static file serving is middleware-based but
  conceptually closer to routing — it's "what handles a request" like
  routes are)
  - `app.useStaticFiles(root)` — basic usage
  - `{ prefix }` — mounting under a URL prefix, brief example
  - Directory index fallback — `/about/` serving `/about/index.html`
  - `{ spaFallback: true }` — brief mention with a pointer to
    `examples/06-react-app` for the full SPA behavior set, rather than
    re-documenting it in two places
  - Pointer to `examples/04-static-files` for a runnable version
- [ ] Strengthen the existing "Middleware" section: it currently shows
  registration and a flow diagram but never states that a middleware
  must call `next()` to continue the chain, or what happens if it
  doesn't (the exact behavior Step 1 adds a test for) — add a short
  example showing both cases (calls `next()` vs. doesn't)

## Step 6 — Final verification

- [ ] `npx tsc --noEmit` clean
- [ ] `npx vitest run` — full suite green, note new total test count
- [ ] Confirm no regressions in existing `StaticFileHandler.test.ts` and
  `Empire.test.ts` tests — both files are being extended, not rewritten
