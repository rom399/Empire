# Handover

**Date:** 2026-08-15

This file exists to let a fresh chat session pick up exactly where this one
left off. It's a snapshot, not a permanent doc — safe to delete once the
work below is finished and merged, or update it again if you hand off a
second time.

---

## Where things stand right now

**Branch:** `feature/test-updates-empire-staticfilehandler`, branched from
`main` (which already has `feature/missing-http-verbs` merged via PR #1 —
`main` is fully up to date, all 4 HTTP verbs + OPTIONS are done and merged).

**Last commit on this branch:** `3ce01a8` — "Add Empire middleware and
useStaticFiles tests (Steps 1-2)"

**Working tree:** clean, nothing uncommitted.

**Tests:** 179 passing, 1 skipped (a manual-only flaky test, see below),
out of 180 total. `npx tsc --noEmit` clean.

**GitHub repo:** `rom399/Empire`. This local repo's git root is
`D:/dev/ROM`; the actual project (package.json, src/, etc.) lives at
`D:/dev/ROM/src/empire` — a nested project root, not the repo root itself.

---

## What's actively in progress

**Feature build doc (the real source of truth for this work):**
[`doc/features/TEST_UPDATES_EMPIRE_STATICFILEHANDLER.md`](doc/features/TEST_UPDATES_EMPIRE_STATICFILEHANDLER.md)

It's a step-by-step checklist. **Steps 1–2 are done and committed. Steps
3–6 are not started.** Read that file first — it has full detail on what
was done, why, and what's left, including two real findings from Steps
1–2 worth knowing about before continuing:

1. A middleware that never calls `next()` leaves the HTTP response
   genuinely unsent (no timeout, no error) — this affects how you write
   tests around it (see Step 1's notes on the abort-after-a-short-wait
   pattern used to avoid hanging `app.stop()` in test cleanup).
2. `fetch()`'s keep-alive socket can make `app.stop()` take ~3 seconds
   per test unless you send `Connection: close` on the request — this bit
   two of the new tests before being caught and fixed (Step 2's notes).

**Next action:** Step 3 — add a `describe("basic resolution")` block to
`tests/unit/static/StaticFileHandler.test.ts` (serves an existing file,
correct Content-Type, correct Content-Length, returns `false` for a
missing file). Full detail, including which existing fixtures to reuse,
is in the feature doc.

---

## Known pre-existing issue, not part of this work

`tests/integration/FileStreaming.test.ts`'s abort-mid-stream test flakes
intermittently (roughly 1 in 3 runs) under full-suite parallel load —
same root cause already documented for the manual-only
`tests/integration/StaticFileStreamingAbort.test.ts` (abort tests
competing for I/O when many test files run concurrently). Not caused by
this branch's work, not yet fixed. If a `npx vitest run` shows this one
test failing, re-run before assuming something broke.

---

## Standing preferences for this user (also in Claude's memory, but stated here for visibility)

- **Never commit without explicit per-turn permission.** Always show the
  diff or the drafted commit message first and wait for a yes.
- **Commit messages:** detail is fine, but only about the change itself —
  what changed, file by file. No narration of the debugging journey,
  dead ends, or how something was discovered; that belongs in the chat
  response, not the commit body. See
  `.claude/capabilities/commit-message/SKILL.md` for the full rule.
- **Feature work happens on branches, not directly on `main`.** This
  pattern started after `feature/missing-http-verbs` was (belatedly)
  moved to its own branch mid-session.
- **Verify before asserting.** This whole session leaned heavily on
  actually running things (live server checks, standalone repro scripts,
  reverting a fix to confirm a test really catches the regression it
  claims to) rather than trusting assumptions — several real bugs and
  doc inaccuracies were only caught this way. Keep doing that.
- Long sessions can show quality drift (typos, verbosity creeping back
  in) — if you're several hours into a session, double-check anything
  meant to persist (commit messages, docs) before finalizing it.

---

## How to verify state in a fresh session

```bash
cd /d/dev/rom/src/empire
git status
git log --oneline -5
npx tsc --noEmit
npx vitest run
```

## Where the full project context lives (read these, don't ask to have them re-explained)

- `PLAN.md` — full phase-by-phase roadmap and history
- `doc/PROJECT_STATE.md` — current status summary
- `doc/ARCHITECTURE.md` — how everything fits together
- `doc/features/` — one file per in-flight or completed feature build,
  each a step-by-step checklist with findings noted inline
- `README.MD` — user-facing usage docs
- `CONTRIBUTING.md` — the project's actual coding conventions (source of
  truth — don't invent new conventions without checking here first)
