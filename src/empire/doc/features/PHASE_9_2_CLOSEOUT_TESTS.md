# Feature Build — Phase 9.2 Closeout: Empire and StaticFileHandler Remaining Test Coverage

## Status

**Not started.** Created 2026-08-16.

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

## Step 1 — `Empire.test.ts`: GET/POST real-server coverage

- [ ] New tests alongside the existing `put()`/`patch()`/`delete()`
  "registers a route reachable via the server" tests in the `routing`
  describe block
- [ ] `it('get() registers a route reachable via the server')`
- [ ] `it('post() registers a route reachable via the server')` — decide
  whether a real JSON body is needed to exercise a realistic case (mirroring
  the PUT/PATCH tests' style) or a bodyless POST is enough to prove routing
  alone
- [ ] Match the existing PUT/PATCH/DELETE tests' style exactly: ephemeral
  port, `TestLogger`, `afterEach` cleanup, `Connection: close` on the
  `fetch()` call if `app.stop()` timing becomes an issue (per the Step 1/2
  findings already documented in
  `doc/features/TEST_UPDATES_EMPIRE_STATICFILEHANDLER.md`)

## Step 2 — `StaticFileHandler.test.ts`: path traversal protection

- [ ] Strengthen the existing `'never serves a file from a prefix-sharing
  sibling directory'` test (or add a new one reusing the same `sibling`
  fixture) to assert `res.statusCode === 403` and the handler's return value
  is `true` — not just that the secret text is absent from the body
- [ ] `it('returns 403 when the resolved path escapes the root directory')`
  — repurpose/rename the strengthened test above to this title if it now
  matches PLAN.md's wording, rather than keeping two near-duplicate tests
- [ ] `it('does not serve files outside root even with encoded traversal
  segments')` — request a percent-encoded traversal path (e.g.
  `/%2e%2e/%2e%2e/etc/passwd`) through `contextFor()`; expect `false`
  (falls through cleanly, matching the existing plain-`..` case), confirming
  the decode-then-normalise behavior holds through the static handler too
- [ ] Note in the test file: this is defence-in-depth, consistent with the
  FINDING 2 comment already at the top of the file — not exploitable through
  Empire's own pipeline today, but still worth pinning down directly at the
  handler level

## Step 3 — `StaticFileHandler.test.ts`: prefix matching

- [ ] Extend the `beforeAll` fixture only if needed — likely reusable as-is
  (`root/index.html`, `root/style.css` already exist, and `root` has no
  `assets/` subdirectory, which is exactly what proves prefix-stripping
  below rather than a lucky coincidence)
- [ ] `it('serves a file when the request path starts with the configured
  prefix')` — `{ root, prefix: "/assets" }`, request `/assets/index.html`,
  expect `true` and the real file content
- [ ] `it('strips the prefix before resolving the file on disk')` — same
  setup, assert the served content is identical to what `/index.html`
  serves with no prefix configured, proving `/assets` was removed before
  hitting the filesystem rather than treated as a literal subdirectory (a
  stripping bug would 404 here, not silently serve the wrong file, since
  `root` has no `assets/` directory)
- [ ] `it('normalises a trailing slash on the configured prefix')` — `{
  root, prefix: "/assets/" }` (trailing slash), confirm `/assets/index.html`
  still resolves identically to the no-trailing-slash case
- [ ] `it('treats a bare "/" prefix as no prefix at all')` — `{ root,
  prefix: "/" }`, confirm requests behave exactly as if no prefix were
  configured (e.g. `/index.html` resolves)
- [ ] `it('has no prefix restriction when none is configured — every path
  is checked')` — explicit test alongside the coverage this already gets
  implicitly from every other describe block in the file, added for
  documentation parity with PLAN.md's exact item list
- [ ] Do **not** add new tests for the 2 already-covered items listed in
  Scope above — check them off in Step 4 instead, pointing at the existing
  tests that satisfy them

## Step 4 — Documentation

- [ ] `PLAN.md` Phase 9.2 — check off every item resolved by Steps 1–3: both
  `get()`/`post()` items, both "Path traversal protection" items, and all 7
  "Prefix matching" items (including the 2 that were already covered —
  annotate those two with a pointer to the pre-existing test that satisfies
  them, same pattern used for the "runs registered middleware in
  registration order" item in the previous sync)
- [ ] `PLAN.md` Phase 9.2 Verification section — if every item above is
  checked off after this work, remove the "not yet" caveat on the "mark
  Phase 9.2 complete" line and check it off; otherwise update the caveat to
  describe whatever (if anything) still remains
- [ ] `doc/PROJECT_STATE.md` — resolve or narrow the "What Is Incomplete"
  Phase 9.2 note added in the previous sync, and update the "Current test
  status" line in the Bug Hunt section to the new total test count
- [ ] Quick check of `doc/ARCHITECTURE.md`'s `StaticFileHandler` section —
  likely needs no change, since this step only adds tests for
  already-documented behavior, but worth confirming rather than assuming

## Step 5 — Final verification

- [ ] `npx tsc --noEmit` clean
- [ ] `npx vitest run` — full suite green, note new total test count
- [ ] Confirm no regressions in existing `Empire.test.ts` and
  `StaticFileHandler.test.ts` tests — both extended, not rewritten
- [ ] If `tests/integration/FileStreaming.test.ts`'s abort-mid-stream test
  is the only failure in a full-suite run, re-run it in isolation before
  assuming a regression — known pre-existing flake, untouched by this work
  (see `doc/PROJECT_STATE.md`)
