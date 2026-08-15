# Feature Build — Missing HTTP Verbs

## Status

**In progress** — Steps 1–4 complete (PUT/PATCH/DELETE/OPTIONS, source +
tests). Started 2026-08-15. Tracks PLAN.md Phase 3's "Remaining" items
through to completion. Developed on `feature/missing-http-verbs`, not
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

## Step 5 — Examples

- [ ] `examples/02-routing/server.ts` — complete the CRUD story already
  started there: `app.put("/users/:id", ...)` full replace (404 if missing),
  `app.patch("/users/:id", ...)` partial update (404 if missing),
  `app.delete("/users/:id", ...)` remove (204 on success, 404 if missing).
  Update header JSDoc. OPTIONS stays undemonstrated in code — same reasoning
  already used for HEAD/405 in this file (shown via `.http` only)
- [ ] `tests/http/routing.http` — add PUT, PATCH, DELETE (success + 404),
  OPTIONS on a real path (204 + Allow), OPTIONS on a nonexistent path (404)
- [ ] Live verification — boot the actual example server, curl/exercise
  every new request in `routing.http`, confirm output matches docs before
  marking this step done

## Step 6 — README documentation

- [ ] Extend the existing "Routing" section in `README.MD` (don't create a
  new section) with the full verb list, a PUT/PATCH/DELETE code sample on
  `/users/:id` matching the existing example style, and a dedicated
  explanation of OPTIONS's automatic behavior vs. explicit `app.options()`
- [ ] Pointer to `examples/02-routing` for the runnable version

## Step 7 — Close out documentation (mirrors the Phase 9.1 doc-sync pattern)

- [ ] `PLAN.md` — move PUT/PATCH/DELETE/OPTIONS from Phase 3's "Remaining"
  to "Completed" with the same detail level as the existing HEAD/405
  entries (RFC 9110 §9.3.7 for OPTIONS); document the OPTIONS design
  decision the same way FINDING 11's route-precedence decision was written
  up; trim "Remaining" to route groups/wildcards/optional params/trailing-slash;
  version bump
- [ ] `doc/PROJECT_STATE.md` — update the Phase 3 status line, version bump
- [ ] `doc/ARCHITECTURE.md` — update the `Router` member table with the new
  methods; fix the now-wrong "Method must match exactly (GET, POST — no
  other verbs implemented yet)" line in Route Matching; version bump
- [ ] Mark this document's Status as **Complete**, or fold its content into
  PLAN.md and remove it — decide at the time based on whether it's still
  useful as a standalone reference

## Step 8 — Final verification

- [ ] `npx tsc --noEmit` clean
- [ ] `npx vitest run` — full suite green, note new total test count
- [ ] Every new `.http` request manually exercised against a live server run
- [ ] Confirm no regressions in existing 405/Allow-header tests — the
  OPTIONS auto-response reuses that computation, so a bug there could
  silently break existing coverage
