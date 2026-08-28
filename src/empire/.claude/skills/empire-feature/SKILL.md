---
name: "empire-feature"
description: "Add a new feature to Empire following the project's standard build procedure - implementation, mirrored unit tests covering golden path and failure cases, a runnable numbered example, then a full verify pass. Use when the user asks to add a feature, implement a new capability, extend the framework, or build out a new phase from PLAN.md."
---

Follow this procedure when adding a new feature to Empire (a new class, a new phase from `PLAN.md`, a new subsystem). It mirrors how DI (Phase 10) and Validation (Phase 11) were actually built in this repo.

## 1. Implement in `src/`

- One class, interface, or enum per file - filename matches the type name exactly.
- `I`-prefixed interfaces, PascalCase types, camelCase methods.
- JSDoc on every public class, method, and property - explain *why*, not what.
- No magic numbers or strings - name them as constants.
- Constructor injection for dependencies - never a service locator.
- Do not add a new npm dependency without the user explicitly agreeing to it first. Empire's zero-dependency stance (Zod is the one deliberate, already-agreed exception, scoped to `src/validation/` only) is a real design decision, not an oversight to work around.

## 2. Write unit tests in `tests/unit/`, mirroring `src/`'s structure

- One test file per class: `tests/unit/<same-path-as-src>/ClassName.test.ts`.
- Cover the golden path *and* failure cases - not just the happy path. Real bugs in this repo (a factory throwing synchronously escaping `resolve()`'s Promise contract, Zod's empty-vs-missing-field message difference) were caught specifically by writing failure-case tests, not by assuming the happy path was the only thing worth verifying.
- Test names describe behavior in plain English (`it('throws when resolving an unregistered service')`), not vague labels like `it('works')`.
- Use `tests/fixtures/` for shared mocks/helpers rather than duplicating them per test file.

## 3. Build a runnable example: `examples/NN-name/server.ts`

- `NN` is the next sequential number - check the existing `examples/` directory for the current highest.
- A single `server.ts`, following the existing examples' shape: a header comment describing what it demonstrates, `Run:`/`Open:` lines, and `curl` examples covering both success and failure cases where relevant.
- **Actually run it.** Start the server, `curl` every case the header comment claims, confirm the real output before considering the example done. A compiling example that was never executed is not verified.

## 4. Run `npm run verify`

Chains `tsc --noEmit`, `vitest run`, and the example smoke-test (`scripts/run-examples.ts`) - the same gate CI runs. Fix anything it surfaces before considering the feature done.

## 5. Update docs

Substantial features get a design doc under `doc/features/` - see `DEPENDENCY_INJECTION.md` and `VALIDATION.md` for the template (Context & Goals, Design, Build order/milestones, Examples, Tests, Guardrails, Decisions log). Also update `doc/ARCHITECTURE.md`'s directory tree and relevant section, `PLAN.md`'s phase checklist, and `README.MD`'s feature list / Examples table if the feature is user-facing. This repo has a history of docs going stale the moment nobody deliberately updates them after the code ships - don't let that happen here too.
