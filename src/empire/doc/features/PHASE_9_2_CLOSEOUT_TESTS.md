# Feature Build — Phase 9.2 Closeout: Empire and StaticFileHandler Remaining Test Coverage

## Status

**Complete.** Created 2026-08-16. All four content steps and final
verification are done — see Step 5 below.

## Scope

`PLAN.md`'s Phase 9.2 (Core Class Test Coverage) checklist was synced against
actual test file contents in a previous session — see `PLAN.md`'s Phase 9.2
section and `doc/PROJECT_STATE.md`'s "What Is Incomplete". Three groups of
checklist items remain unchecked. Verified here by reading the actual current
test files rather than assuming PLAN.md's item list is still accurate:

### 1. `Empire.test.ts` — `get()`/`post()` real-server coverage

`PUT`/`PATCH`/`DELETE` each have a dedicated `'...() registers a route
reachable via the server'` test through a real `http.Server`. `GET` and
`POST` don't:

- `GET` is exercised incidentally by several other tests (the middleware
  describe block, the `useStaticFiles()` tests) but none is titled or scoped
  to prove GET routing itself works end-to-end the way the other four verbs
  are.
- `POST` has **zero** real-server coverage anywhere in the suite — confirmed
  by grepping the whole `tests/` tree for `app.post(`, which returns no
  matches at all.

### 2. `StaticFileHandler.test.ts` — "Path traversal protection"

Two PLAN.md items, neither actually tested:

- `it('returns 403 when the resolved path escapes the root directory')` —
  the existing `'never serves a file from a prefix-sharing sibling
  directory'` test exercises the exact same escape scenario (the `sibling`
  fixture, a directory whose name shares the root's prefix) but only asserts
  the response body doesn't contain the secret text. It never checks
  `res.statusCode` or the handler's return value, so the 403 status code
  itself is unverified — a bug that silently changed the status to, say, 404
  while still omitting the secret text would pass this test today.
- `it('does not serve files outside root even with encoded traversal
  segments')` — no test sends a percent-encoded traversal path (`%2e%2e`)
  through the handler directly. `Context.path`'s own decode-then-normalise
  behavior is tested elsewhere (`RouterEdgeCases.test.ts`,
  `MalformedRequestPath.test.ts`), but never through `StaticFileHandler`
  specifically.

### 3. `StaticFileHandler.test.ts` — "Prefix matching"

Of PLAN.md's 7 listed items, **2 are already covered** by the existing
`prefix handling` describe block — just never checked off, worth fixing as
part of this work rather than duplicating:

- ✅ already covered: `'returns false when the request path does not start
  with the prefix'` ≈ existing `'ignores requests outside the mounted
  prefix'`
- ✅ already covered: `'treats a prefix followed by another segment as
  non-matching...'` ≈ existing `'does not treat /assets-other as being
  under /assets'`

**5 are genuinely untested:**

- `it('serves a file when the request path starts with the configured
  prefix')` — no positive-path prefix test exists; both current prefix
  tests assert `false`/fall-through only
- `it('strips the prefix before resolving the file on disk')`
- `it('normalises a trailing slash on the configured prefix')`
- `it('treats a bare "/" prefix as no prefix at all')`
- `it('has no prefix restriction when none is configured — every path is
  checked')`

---

## Step 1 — `Empire.test.ts`: GET/POST real-server coverage ✅

- [x] New tests alongside the existing `put()`/`patch()`/`delete()`
  "registers a route reachable via the server" tests in the `routing`
  describe block (added as the first two entries in that block)
- [x] `it('get() registers a route reachable via the server')`
- [x] `it('post() registers a route reachable via the server')` — matched
  the existing PUT/PATCH tests' minimal style (no body reading) rather than
  reading a JSON body — neither PUT nor PATCH read the body in their
  versions either, and `ctx.jsonBody()` already has its own dedicated
  coverage in `Context.test.ts`, so adding it here would test the same
  thing twice instead of adding value
- [x] Matched the existing PUT/PATCH/DELETE tests' style exactly: ephemeral
  port (47015, 47016), `createApp()` helper, `afterEach` cleanup via
  `instances`. `Connection: close` wasn't needed — these two follow the
  exact PUT/PATCH/DELETE pattern, which never needed it either (only the
  `useStaticFiles()` tests do, per Step 2's findings in
  `doc/features/TEST_UPDATES_EMPIRE_STATICFILEHANDLER.md`)
- [x] Updated the file's header comment, which previously said "GET/POST
  have no equivalent test here yet"

Verified: `tsc --noEmit` clean, 16/16 tests in `Empire.test.ts` passing.
Full suite: 187 passed, 1 skipped, 1 failed — the 1 failure is the known
pre-existing `tests/integration/FileStreaming.test.ts` flake (see
`doc/PROJECT_STATE.md`), confirmed by re-running that file in isolation
(3/3 passed), not caused by this step.

## Step 2 — `StaticFileHandler.test.ts`: path traversal protection ✅

**Real finding while implementing this step, not just adding coverage:**
the existing `'never serves a file from a prefix-sharing sibling
directory'` test was vacuous. `ctx.path` always goes through URL-based
normalisation, which resolves `..` before the handler ever sees it — so the
test's request (`/../wwwsecret/secrets.txt`) was already collapsed to
`/wwwsecret/secrets.txt` by the time `handle()` ran, resolving to a
non-existent path *inside* root, not the sibling at all. `handle()` returned
`false` without ever touching `res.body`, so `expect(res.body).not.toContain(
"TOP SECRET")` passed regardless of whether the 403 guard worked. Confirmed
by temporarily breaking the guard (`isSafe = true`) and re-running: the old
test still passed. This is exactly what the file's own FINDING 2 comment
already says ("This is NOT currently exploitable through Empire's own
pipeline... if the handler is constructed directly") — it just hadn't been
translated into a test that actually exercises the branch.

- [x] Replaced the vacuous test with `it('returns 403 when the resolved
  path escapes the root directory')`, using `Object.defineProperty(ctx,
  "path", { value: "/../wwwsecret/secrets.txt", configurable: true })` to
  bypass `ctx.path`'s normal URL-based normalisation and feed the handler
  the raw, unnormalised string directly — the only way to reach this guard
  through `handle()` itself rather than re-testing the boundary math in
  isolation like the test above it already does. Asserts `res.statusCode
  === 403`, `res.body === "Forbidden"`, and the return value is `true`.
  Verified this actually catches a regression: temporarily set `isSafe =
  true` in `StaticFileHandler.ts`, re-ran the file, confirmed exactly this
  one test failed (200 instead of 403), then reverted
- [x] `it('does not serve files outside root even with encoded traversal
  segments')` — requests `/%2e%2e/%2e%2e/etc/passwd` through the normal
  `contextFor()` path (no override needed); confirmed via a quick Node
  check that this normalises to `/etc/passwd` before the handler runs, same
  as the plain-`..` case, so it falls through with `false`
- [x] Both new tests' comments note this is defence-in-depth, consistent
  with the FINDING 2 comment already at the top of the file

Verified: `tsc --noEmit` clean, 21/21 tests in `StaticFileHandler.test.ts`
passing.

## Step 3 — `StaticFileHandler.test.ts`: prefix matching ✅

- [x] Fixture reused as-is, no extension needed — `root/index.html`,
  `root/style.css` already existed, and `root` having no `assets/`
  subdirectory is exactly what makes the stripping test below meaningful
  rather than a coincidence
- [x] `it('serves a file when the request path starts with the configured
  prefix')` — `{ root, prefix: "/assets" }`, requests `/assets/index.html`,
  asserts `true` and the real file content
- [x] `it('strips the prefix before resolving the file on disk')` — same
  setup, requests `/assets/style.css`, asserts the body equals the known
  `root/style.css` fixture content exactly — since `root` has no `assets/`
  directory, a stripping bug would 404 here rather than silently serve the
  wrong file
- [x] `it('normalises a trailing slash on the configured prefix')` — `{
  root, prefix: "/assets/" }` (trailing slash), confirms
  `/assets/index.html` still resolves
- [x] `it('treats a bare "/" prefix as no prefix at all')` — `{ root,
  prefix: "/" }`, confirms `/index.html` resolves exactly as if no prefix
  were configured
- [x] `it('has no prefix restriction when none is configured, so every path
  is checked')` — phrased with a comma rather than PLAN.md's em dash, to
  match this file's own `it()`-title style; explicit test alongside the
  coverage this already gets implicitly from every other describe block in
  the file, added for documentation parity with PLAN.md's exact item list
- [x] No new tests added for the 2 already-covered items from Scope above —
  checked off in Step 4 instead, pointing at the existing tests that
  satisfy them

Verified: `tsc --noEmit` clean, 21/21 tests in `StaticFileHandler.test.ts`
passing (same run as Step 2 above — both steps landed in one edit pass).

## Step 4 — Documentation ✅

- [x] `PLAN.md` Phase 9.2 — checked off both `get()`/`post()` items, both
  "Path traversal protection" items, and all 7 "Prefix matching" items,
  including the 2 already covered by pre-existing tests (annotated with a
  pointer to those tests, same pattern used for the "runs registered
  middleware in registration order" item in the previous sync)
- [x] `PLAN.md` Phase 9.2 Verification section — **not** marked complete.
  While updating this I found `HttpError.test.ts`, `BadRequestError.test.ts`,
  and `MimeTypes.test.ts` checklist items still unchecked despite those
  test files visibly existing and passing in every full-suite run — out of
  this feature's scope (Empire GET/POST and StaticFileHandler traversal/
  prefix matching only, per this doc's own Scope section), so left as a
  named caveat rather than silently fixed or silently ignored
- [x] `doc/PROJECT_STATE.md` — narrowed the "What Is Incomplete" Phase 9.2
  note to point at the same remaining `HttpError`/`BadRequestError`/
  `MimeTypes` items, and updated "Current test status" to 195 tests, 193
  passing, 1 skipped
- [x] Checked `doc/ARCHITECTURE.md`'s `StaticFileHandler` section — no
  change needed; it already correctly documents the 403 and prefix-matching
  behavior this step only added test coverage for, not new behavior

## Step 5 — Final verification ✅

- [x] `npx tsc --noEmit` clean
- [x] `npx vitest run` — full suite green (test count has moved on since
  Step 4's snapshot due to unrelated later work; see
  `doc/PROJECT_STATE.md` for the current total, not this doc)
- [x] Confirmed no regressions in `Empire.test.ts` and
  `StaticFileHandler.test.ts` — both extended, not rewritten; re-verified
  directly (39/39 passing across the two files)
- [x] `tests/integration/FileStreaming.test.ts`'s abort-mid-stream test is
  no longer a live concern for this checklist item - it's since been
  gated behind `RUN_FLAKY_TESTS` and excluded from `npm test` entirely
  (unrelated later work), so it can no longer show up as a failure in a
  normal full-suite run at all
