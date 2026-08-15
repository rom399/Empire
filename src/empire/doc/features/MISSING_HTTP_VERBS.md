# Feature Build — Missing HTTP Verbs

## Status

**Complete** — Steps 1–7 done (Step 8, final verification, runs as part
of closing this out). Started and finished 2026-08-15. Result folded into
PLAN.md Phase 3 and doc/PROJECT_STATE.md; kept here as the standalone
step-by-step build record, since it has detail (live-verification
findings, the OPTIONS decision process) that the more concise PLAN.md
summary doesn't repeat. Developed on `feature/missing-http-verbs`, not
directly on `main`.

## Scope

`Router`/`Empire` currently support `GET`, `POST`, and auto-dispatched
`HEAD`. This adds `PUT`, `PATCH`, `DELETE` (mechanically identical to
`POST` — "another verb, same dispatch") and `OPTIONS` (structurally
different, see the design decision below).

Explicitly out of scope: route groups, wildcards, optional params,
trailing-slash config — separate PLAN.md items, not touched here.

## Design decision — OPTIONS

`app.options(path, handler)` for explicit custom behavior (e.g. CORS
preflight later), **plus** an automatic fallback: any path with at least
one registered route but no explicit `OPTIONS` handler gets a free `204`
with an `Allow` header listing every method available there (mirrors RFC
9110 §9.3.7 and what Express/ASP.NET Core do by default). An `OPTIONS` to
a path with *no* routes at all still 404s, same as every other verb —
server-wide `OPTIONS *` semantics are deliberately out of scope.

---

## Step 1 — PUT, PATCH, DELETE: source changes ✅

- [x] `src/routing/Router.ts` — added `put(path, handler)`, `patch(path, handler)`,
  `delete(path, handler)`, each a one-line `addRoute()` call mirroring `post()`,
  with matching JSDoc
- [x] `src/Empire.ts` — added `put()`, `patch()`, `delete()` delegating to the
  matching `router.*()` call, mirroring `get()`/`post()`
- [x] Confirmed `Route.ts`/`types.ts` need no changes —
  `Route.method` is already an unconstrained `string`

## Step 2 — PUT, PATCH, DELETE: tests ✅

- [x] `tests/unit/routing/Router.test.ts` — extended the (renamed)
  `get / post / put / patch / delete / handle` describe block with dispatch
  tests for all three
- [x] Extended the existing "lists every registered method in Allow" test to
  register GET/POST/PUT and request PATCH, proving the existing Allow-header
  logic generalizes to 3+ verbs without a code change
- [x] `tests/unit/Empire.test.ts` — new `describe("routing")` block:
  `put()`/`patch()`/`delete()` each register a route reachable via the
  server. Note: `get()`/`post()` still have no equivalent test here — a
  pre-existing gap, not introduced by this work (file's header comment
  updated to say so explicitly)
- [x] `tests/integration/HttpVerbs.test.ts` (new file) — real HTTP server,
  PUT full replace, PATCH partial update (merges fields, leaves others
  untouched), DELETE + 204, DELETE-on-missing-resource + 404 via app logic

Verified: `tsc --noEmit` clean, targeted tests 36/36 passing, full suite
167/168 passing (up from 157/158, 1 unrelated manual-only skip), no
regressions.

## Step 3 — OPTIONS: source changes ✅

- [x] `src/routing/Router.ts` — added `options(path, handler)` for explicit
  registration
- [x] `handle()` — when method is OPTIONS and no explicit OPTIONS route
  matches but other methods do, short-circuits to 204 + Allow header,
  reusing the existing `allowedMethods` set built for the 405 path (added
  `allowedMethods.add("OPTIONS")` right before both the 204 and 405
  branches — same set, not a parallel implementation)
- [x] Explicit OPTIONS handler (when registered) takes priority — this came
  for free from the existing dispatch loop, no special-casing needed, the
  same way PUT/PATCH/DELETE did
- [x] OPTIONS to a path with zero matching routes still falls through to 404
- [x] Updated `handle()`'s JSDoc to describe the new dispatch path
- [x] `src/Empire.ts` — added `options()` delegating to `router.options()`

**Design decision confirmed with the user, including verifying the RFC
9110 claim before finalizing:** `Allow` now includes `OPTIONS`
automatically wherever any other method is registered for a path — RFC
9110 doesn't *require* this (confirmed via direct research, not assumed),
but does recommend it as good practice, and it's consistent with the
existing HEAD-in-Allow precedent already in this codebase. This changed 4
existing test assertions (e.g. `"GET, HEAD"` → `"GET, HEAD, OPTIONS"`) —
a deliberate spec change, not a bug workaround.

## Step 4 — OPTIONS: tests ✅

- [x] `tests/unit/routing/Router.test.ts` — new `describe("OPTIONS")` block
  mirroring `describe("HEAD")`'s structure: 204 + Allow header listing
  every registered method; HEAD included alongside GET in that list (same
  computation as 405, not a divergent copy); explicit OPTIONS handler takes
  priority when registered; 404 for OPTIONS on a fully unregistered path;
  no body by default. Updated 4 pre-existing 405 Allow-header assertions
  to include `, OPTIONS` per the design decision above.
- [x] `tests/integration/HttpVerbs.test.ts` — new `describe("OPTIONS")`
  block: real-server 204 + Allow header via `fetch()` over an actual
  socket, and an explicit `options()` handler overriding the automatic
  response with custom status/headers/body

## Step 5 — Examples ✅

- [x] `examples/02-routing/server.ts` — completed the CRUD story: `PUT`
  full replace (404 if missing), `PATCH` partial update via `Object.assign`
  (404 if missing), `DELETE` remove (204 on success, 404 if missing). Header
  JSDoc updated. `OPTIONS` stays undemonstrated in code — same reasoning
  already used for HEAD/405 in this file (shown via `.http` only)
- [x] `tests/http/routing.http` — added PUT (success + 404), PATCH,
  OPTIONS on a real path (204 + Allow), OPTIONS on a nonexistent path
  (404), DELETE (success + 404). Reordered so DELETE targets Dana
  (created by the earlier POST demo, id "4") rather than id "1", which
  earlier requests in the file still depend on.
- [x] Live verification — hit a real snag: port 8002 was still held by a
  *stale server process from an earlier verification run earlier in this
  session*, so the first verification pass silently tested old code and
  every new request wrongly showed 405. Found and killed the stale
  process (`netstat` + `Stop-Process`), reran clean, all 17 requests in
  `routing.http` now behave as documented.
- [x] Live verification also caught a real documentation bug before it
  shipped: `POST /users/me` returns `Allow: GET, HEAD, PUT, PATCH, DELETE,
  OPTIONS`, not just `GET, HEAD` as first assumed — `/users/:id`
  structurally matches the path `/users/me` too (`id="me"`), and the 405
  `Allow` computation considers every pattern that matches the *path*,
  not just whichever route would actually have been selected. Fixed the
  `.http` comment to explain this accurately instead of shipping the
  wrong assumption.

## Step 6 — README documentation ✅

- [x] Extended the existing "Routing" section in `README.MD` with the full
  verb list, a PUT/PATCH/DELETE code sample on `/users/:id`, a note that
  HEAD needs no registration, and OPTIONS's automatic 204+Allow behavior
  vs. an explicit `app.options()` override, with an example of each
- [x] Moved the `examples/02-routing` pointer to after the new content, so
  it accurately covers everything shown, not just the earlier multi-param
  example
- [x] Verified every new code sample actually runs as documented — a
  standalone script exercising the exact PUT/DELETE/auto-OPTIONS/custom-
  OPTIONS samples against a live server, confirming the Allow header order
  in the README (`GET, HEAD, PUT, PATCH, DELETE, OPTIONS`) matches reality
  exactly rather than assuming it

## Step 7 — Close out documentation (mirrors the Phase 9.1 doc-sync pattern) ✅

- [x] `PLAN.md` — moved PUT/PATCH/DELETE/OPTIONS from Phase 3's "Remaining"
  to "Completed" with the same detail level as the existing HEAD/405
  entries; documented the OPTIONS design decision (RFC 9110 §9.3.7,
  including the "confirmed via research, not assumed" note); trimmed
  "Remaining" to route groups/wildcards/optional params/trailing-slash;
  version bumped to 0.14.0
- [x] `doc/PROJECT_STATE.md` — updated the Phase 3 status line (all 7
  methods now listed), v1.0.0 Blockers and What Is Incomplete sections,
  version bumped to match
- [x] `doc/ARCHITECTURE.md` — added `put`/`patch`/`delete`/`options` to
  both the `Empire` and `Router` member tables; fixed the now-wrong
  "Method must match exactly (GET, POST — no other verbs implemented
  yet)" line in Route Matching; version bumped to match
- [x] Marked this document's Status as **Complete** — kept as a standalone
  reference rather than folded away, since it has detail (live-verification
  findings, the OPTIONS decision process) the more concise PLAN.md summary
  doesn't repeat

## Step 8 — Final verification ✅

- [x] `npx tsc --noEmit` clean
- [x] `npx vitest run` — 174/175 passing, 1 skipped (unrelated manual-only
  test), up from 157/158 before this feature started
- [x] Every new `.http` request manually exercised against a live server
  run (Step 5), plus a second standalone live check for the README's
  code samples specifically (Step 6)
- [x] No regressions in existing 405/Allow-header tests — all 4 updated to
  the new expected strings and passing; the OPTIONS auto-response's
  reuse of that same `allowedMethods` computation is exercised by both
  the 405 and 204 test paths

**Feature complete.** All 4 HTTP verbs (PUT, PATCH, DELETE, OPTIONS) plus
HEAD auto-dispatch are implemented, tested at 3 levels (Router unit,
Empire unit, real-server integration), demonstrated in
`examples/02-routing` and `tests/http/routing.http`, documented in
`README.MD`, and reflected across `PLAN.md`/`doc/PROJECT_STATE.md`/
`doc/ARCHITECTURE.md`.
