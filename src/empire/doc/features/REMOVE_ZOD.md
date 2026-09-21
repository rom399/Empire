# Empire — Remove Zod: Design & Build Doc

**Status:** Implemented - see §7 for what was built and where it departed from this design
**Scope:** Native TypeScript architecture. A follow-up to Phase 11 (Schema Validation) in `PLAN.md`, and it also touches the Phase 23 registration endpoint.
**Timeline:** Designed by Claude Sonnet 5 ➡️ Executed by Sonnet

---

## 1. Context & Architectural Goals

### 1.1 The Problem

Empire advertises "zero runtime dependencies", with one carved-out exception:
Zod, which `CLAUDE.md`, both READMEs, `VALIDATION.md` §2.1 and the review
skill all describe as "the one deliberate exception, scoped to
`src/validation/`". An audit of what Empire actually does with Zod shows the
exception is much smaller than it sounds, and partly self-inflicted:

| Where | What it uses |
|---|---|
| `src/validation/validate.ts`, `ValidationSchemas.ts` | The `ZodType<T>` **type**, plus calling `schema.safeParse(value)` and reading `error.issues[].path` / `.message` on a schema the *caller* supplied. Empire never constructs a schema here. |
| `src/loadbalancing/registration/BackendRegistrationEndpoint.ts` | **Real runtime use**: `z.object`, `z.string().regex()`, `.refine()` |
| `examples/` (4 files), `package-example/` (4 examples + `full-featured.ts`) | Writing schemas for `validate()` |
| `tests/unit/validation/validate.test.ts`, `tests/integration/Validation.test.ts` | Schemas for `validate()`'s own tests (317 lines) |
| `package.json`, `package-example/package.json` | The dependency entries |

Two consequences follow, both confirmed by compiling `src/` to a temporary
folder:

1. **Before the load balancer, `require("empire-ts")` never loaded Zod.**
   `validate.ts` only imported Zod *types* (erased at compile time) and called
   a method on a schema object it was handed. The "runtime dependency" was
   really a type-only one. The registration endpoint made it real: it is now
   the only compiled file that `require("zod")`, and because the package
   barrel re-exports it, importing `empire-ts` loads Zod for everyone.
2. **`dist/validation/ValidationSchemas.d.ts` references `zod`**, so a
   consumer's type-check needs Zod installed and resolvable even if they never
   validate anything.

The surface Empire needs from a validator is tiny: "given an unknown value,
give me either a typed value or a list of `{ path, message }` issues". That
is exactly what the **Standard Schema** specification (https://standardschema.dev)
standardises - Zod (since 3.24), Valibot and ArkType all implement it - and
the spec is explicitly designed to be copied into a library as types, with no
package dependency.

**The project owner's direction: no Zod anywhere in the repository** - not as a
runtime dependency, not as a dev dependency, not in the examples or tests. Zod
becomes something a *user* installs if they want it, and the READMEs explain how.

### 1.2 System Goals

* **Goal 1 - No Zod in the project at all.** Neither `package.json` (nor
  `package-example/package.json`) mentions `zod`; `package.json` has no
  `dependencies` block; no file under `src/`, `examples/`, `tests/` or
  `package-example/` imports it; `require("empire-ts")` loads no third-party
  module; nothing emitted under `dist/` (`.js` or `.d.ts`) imports or requires `zod` (doc comments
  may still name it as a compatible validator).
* **Goal 2 - `validate()` accepts any Standard Schema v1 validator.** A Zod
  schema a user brings keeps working with no change at the call site, and its
  inferred types (`z.coerce.number()` -> `number`, `.optional()` -> `T | undefined`)
  survive. Valibot and ArkType work as a side effect.
* **Goal 3 - The registration endpoint validates without Zod**, still answering
  `400` with a `ValidationError` and per-field `details`, and reporting every
  problem in one response.
* **Goal 4 - Behavioural parity for `validate()`, with two deliberate changes.** Same `ValidationError`
  shape and same `field` path format (`body.user.tags.0`). The changes: a root-level issue now
  reports `body`, not `body.` (Rule 2), and body, query and params are all checked and reported
  together instead of stopping at the first failing location (Rule 1, Decision 2).
* **Goal 5 - Everything runs without Zod.** The examples, the `package-example`
  mirrors, the embedded example in `README.MD` and the test suite all work with
  no validation library installed.
* **Goal 6 - The READMEs explain how to bring Zod.** A section shows how to
  install it, import it and pass a schema to `validate()`, with the query-string
  coercion gotcha, and names Valibot and ArkType as other compatible options.
* **Goal 7 - Regression guardrails. Dropped.** The design planned tests that fail if `zod`
  reappears in code or either `package.json`, if `dependencies` reappears, or if loading the
  package pulls in a third-party module. The project owner decided against them after the build
  (see §7); the rule in Rule 8 now rests on review and the checks run once at the end of Step 4.
* **Goal 8 - The policy text matches reality.** `CLAUDE.md`, the two skills,
  the READMEs, `VALIDATION.md`, `ARCHITECTURE.md`, `PLAN.md`, `CHANGELOG.md`
  and `Loadbalancer-v1.md` stop describing Zod as an exception.

### 1.3 Non-Goals (Scope Guardrails)

* **Non-Goal 1:** Not writing a schema library or a schema DSL *inside Empire*.
  `VALIDATION.md`'s original argument (string formats, coercion, unions, nested
  arrays are edge-case-heavy) still holds - Empire consumes validators, it does
  not become one. The small helpers in `tests/fixtures/` and in
  `examples/10-validation` are test and demo code, not part of the package.
* **Non-Goal 2:** Not vendoring, forking or re-exporting Zod, and not adding a
  Zod compatibility shim.
* **Non-Goal 3:** No change to `ValidationError`, `ValidationIssue`,
  `sendErrorResponse` or the JSON error body a client sees.
* **Non-Goal 4:** No support for validators that are not Standard Schema
  (a bare function, or an object with only `safeParse`). Zod, Valibot and
  ArkType all qualify; anything else can be wrapped in a few lines.
* **Non-Goal 5:** No version bump, publish or tarball rebuild, and no deprecation
  period or compatibility shim for Zod users - Empire is not a production build yet.
* **Non-Goal 6:** No change to `ctx.jsonBody()`, `ctx.query` or `ctx.params`.
* **Non-Goal 7:** Not adding CI coverage that installs Zod just to test
  compatibility - that would put Zod back in the project (see §5 for the cost).

### 1.4 Dependency Stance

**Zero runtime dependencies. Zero validation-library dependencies of any kind.
Native Node.js modules only.**

The Standard Schema types are *copied into* `src/validation/standard/`, as the
spec intends - it publishes a copy-paste interface precisely so libraries do
not have to depend on `@standard-schema/spec`. No package is added, and the one
existing entry (`zod`) is removed outright, from `dependencies` **and** from
`devDependencies`. `package-example` no longer lists it either.

**Consumer impact (breaking, and accepted - not a production build yet):**
`npm install empire-ts` no longer installs Zod for you. An app that validates
with Zod must `npm install zod` itself. This gets a `CHANGELOG.md` entry and a
README section (Goal 6).

---

## 2. Design & API Contracts (The Opus Blueprint)

### 2.1 Public User API

Usage does not change for a user who validates with Zod - they install it themselves
(this is exactly what the new README section documents):

```bash
npm install empire-ts zod
```

```typescript
import { z } from "zod";
import { Empire, validate } from "empire-ts";

app.post("/users", validate({
    body: z.object({ name: z.string().min(1), age: z.coerce.number().int() }),
    query: z.object({ page: z.coerce.number().int().min(1).default(1) }),
})(async (ctx, { body, query }) => {
    // body.name: string, body.age: number, query.page: number - inferred, as today
    ctx.status(201).json({ ...body, page: query.page });
}));
```

Any Standard Schema validator works, including one with no library at all - this is how
Empire's own examples validate:

```typescript
import { validate, StandardSchemaV1 } from "empire-ts";

// A hand-written validator - no dependency required.
const pageQuery: StandardSchemaV1<unknown, { page: number }> = {
    "~standard": {
        version: 1,
        vendor: "my-app",
        validate(value) {
            const raw = (value as Record<string, unknown>).page;
            const page = Number(raw ?? 1);

            return Number.isInteger(page) && page >= 1
                ? { value: { page } }
                : { issues: [{ message: "must be a whole number of 1 or more", path: ["page"] }] };
        },
    },
};

app.get("/things", validate({ query: pageQuery })((ctx, { query }) => ctx.json({ page: query.page })));
```

### 2.2 Core Interfaces & Data Models

**New - `src/validation/standard/`** (one type per file, per `CONTRIBUTING.md`; a
faithful copy of Standard Schema v1, https://standardschema.dev):

```typescript
// StandardSchemaV1.ts
export interface StandardSchemaV1<Input = unknown, Output = Input> {
    readonly "~standard": StandardSchemaProps<Input, Output>;
}

// StandardSchemaProps.ts
export interface StandardSchemaProps<Input = unknown, Output = Input> {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => StandardSchemaResult<Output> | Promise<StandardSchemaResult<Output>>;
    readonly types?: StandardSchemaTypes<Input, Output> | undefined;
}

// StandardSchemaResult.ts
export type StandardSchemaResult<Output> = StandardSchemaSuccess<Output> | StandardSchemaFailure;

// StandardSchemaSuccess.ts
export interface StandardSchemaSuccess<Output> { readonly value: Output; readonly issues?: undefined }

// StandardSchemaFailure.ts
export interface StandardSchemaFailure { readonly issues: ReadonlyArray<StandardSchemaIssue> }

// StandardSchemaIssue.ts
export interface StandardSchemaIssue {
    readonly message: string;
    readonly path?: ReadonlyArray<PropertyKey | StandardSchemaPathSegment> | undefined;
}

// StandardSchemaPathSegment.ts
export interface StandardSchemaPathSegment { readonly key: PropertyKey }

// StandardSchemaTypes.ts
export interface StandardSchemaTypes<Input, Output> { readonly input: Input; readonly output: Output }
```

**Changed - `src/validation/ValidationSchemas.ts`:**

```typescript
export interface ValidationSchemas<TBody, TQuery, TParams> {
    body?: StandardSchemaV1<unknown, TBody>;
    query?: StandardSchemaV1<unknown, TQuery>;
    params?: StandardSchemaV1<unknown, TParams>;
}
```

`validate<TBody, TQuery, TParams>()`'s generics and return type are untouched, so no
call site needs a type change. (Verified once, manually, before this doc was written - see
§5: with Zod 4.5.4 a schema assigns to `StandardSchemaV1<unknown, T>`, `T` is inferred
correctly, and `~standard.validate` yields the same messages and paths as `safeParse`.)

**New - `src/validation/formatIssueField.ts`:**

```typescript
export function formatIssueField(location: "body" | "query" | "params", path: StandardSchemaIssue["path"]): string;
```

**New - `src/loadbalancing/registration/validateRegistrationRequest.ts`:**

```typescript
/** Validates a registration request; throws ValidationError listing every problem, else returns the clean values. */
export function validateRegistrationRequest(id: string, body: unknown): { id: string; url: string };
export function validateBackendId(id: string): { id: string };   // DELETE: id only
```

**New - test fixture `tests/fixtures/validation/schemas.ts`** (test-only; replaces the Zod
schemas the validation tests used):

```typescript
export function objectSchema<T>(fields: { [K in keyof T]: FieldRule<T[K]> }): StandardSchemaV1<unknown, T>;
export function stringField(options?: { required?: string; min?: [number, string]; email?: string; optional?: boolean; default?: string; trim?: boolean }): FieldRule<string>;
export function numberField(options?: { coerce?: boolean; int?: string; min?: [number, string]; positive?: string; optional?: boolean; default?: number }): FieldRule<number>;
```

**Exports added to `src/index.ts`:** `StandardSchemaV1` and its seven supporting types.

### 2.3 Internal Processing Logic Rules

1. **`validate()` runs each supplied schema through the standard entry point.**
   Order is unchanged - body, then query, then params - but there is no longer a
   short-circuit: every supplied schema is checked, the problems from all of them are
   concatenated in that order, and one `ValidationError` is thrown if there are any. (Added
   after the first build, at the project owner's request; see Decision 2.) A validator that
   *throws* still propagates at once, whichever location it is for. For each: `const result = await schema["~standard"].validate(value)`. The
   `await` handles synchronous and asynchronous validators alike.
2. **Failure vs. success is decided by `result.issues !== undefined`**, per the
   spec. On failure, throw `ValidationError` with
   `details = issues.map(i => ({ field: formatIssueField(location, i.path), message: i.message }))`.
   **`formatIssueField`:** each path segment is unwrapped if it is `{ key }`;
   numbers and strings via `String()`; symbols via `String(symbol)` (a bare
   `Array.join` throws on a symbol); segments joined with `.`. A missing or empty
   path yields the location alone - `body`, **not** `body.` (today's trailing dot
   is a cosmetic bug, and this is the only intended behavioural change).
3. **An empty `issues` array is still a failure.** If `details` would be empty,
   substitute one issue `{ field: location, message: "Invalid value" }` so the
   client never receives a 400 with an empty message.
4. **A validator that throws (rather than returning issues) is not converted.**
   It propagates to the existing error pipeline as a 500 - a bug in a validator is
   a server fault, not a client mistake.
5. **On success the returned `value` replaces the input**, exactly as
   `safeParse().data` does today (this is how coercion and defaults take effect).
6. **The registration endpoint's rules, without any library.** `PUT` collects *every*
   problem into one `ValidationError`:
   * `params.id` - must match `BACKEND_ID_PATTERN`.
   * `body` - must be a non-null, non-array object, else one issue `{ field: "body", message: "must be a JSON object" }`.
   * `body.url` - must be a string, else `"must be a string"`; then
     `normalizeBackendUrl(url) !== undefined`, else the existing
     "absolute http: origin" message.
   * Unknown body keys are ignored. `DELETE` checks only the id.
   * `ctx.jsonBody()` still runs first, so invalid JSON is still a plain `400 BadRequestError`.
7. **Examples validate without a library** (Step 4): `examples/10-validation` is the
   `validate()` showcase, using hand-written Standard Schema validators; `examples/02-routing`,
   `05-error-handling` and `09-dependency-injection` check their request bodies with plain
   `ctx.jsonBody()` and `BadRequestError`, as they did before Phase 11. Their `curl` output
   in the header comments therefore changes (no `details` array) and is re-verified by running them.
8. **The rule to keep (Step 4):** nothing in `src/`, `examples/`, `tests/` or `package-example/` may
   import `"zod"`; neither `package.json` may mention `zod`; `package.json` may have no
   `dependencies`; and `require`-ing the package entry must load no module from `node_modules`.
   No test enforces this (Goal 7 was dropped) - it is checked by hand in Step 4 and by review.

### 2.4 Security & Performance Defaults

* **No new attack surface.** Validation still runs after `ctx.jsonBody()` and
  therefore after the body size limit. The hand-written endpoint validator reads
  fields by plain property access on `JSON.parse` output and never spreads,
  merges or assigns from it, so a `__proto__` key in a body (which `JSON.parse`
  creates as an ordinary own property) cannot pollute anything.
* **Async validators are the caller's responsibility.** Standard Schema permits
  them; `validate()` awaits them. A validator that never settles hangs its own
  request - Empire adds no timeout, matching how any slow handler behaves today.
* **Performance:** the change removes a module graph from `require("empire-ts")`
  and ~7 MB from a consumer's install (the unpacked size of Zod 4.5.4). Step 4
  measures the load-time difference rather than assuming it.
* **Error information:** issue `message`s come from the validator, as they do now.
  The registration endpoint's own messages contain no secrets (no token, no URL of
  another backend).

---

## 3. Iterative Build Steps & Test Strategy (The Sonnet Instructions)

Each step lands with its tests before the next starts, and `npm run verify` plus
`npm run lint` must pass at the end of every step. Unlike the first version of this
plan, the existing Zod-based tests **cannot** stay as they are - there is no Zod
left to import - so they are ported (Step 2) rather than kept.

### Step 1: Types & Structural Definitions

* **Description:** Create the eight files under `src/validation/standard/` exactly as in
  §2.2. Change `ValidationSchemas.ts` to `StandardSchemaV1<unknown, T>`. Export the types
  from `src/index.ts`. Do **not** touch `validate.ts` yet - it will not compile until
  Step 2, so do Steps 1 and 2 in one working tree and run the checks after Step 2.
* **Sonnet Check:** `npx tsc --noEmit` clean once Step 2 is in.
* **Vitest Assertions** - `tests/unit/validation/standard/StandardSchemaV1.test.ts`
  (type-level, using `expectTypeOf`, plus one runtime check each; **no Zod import**):
  * A hand-written object literal with a `~standard` property is assignable to `StandardSchemaV1<unknown, { page: number }>`.
  * A schema built with the Step 2 fixture helpers infers its output type from its field rules.
  * A schema whose output is `{ a: string }` is **not** assignable to `StandardSchemaV1<unknown, { a: number }>` (`@ts-expect-error`).
  * An object missing `~standard`, or with `version: 2`, is not assignable (`@ts-expect-error`).
  * A stand-in for a *foreign* validator - an object literal shaped exactly like Zod 4's
    `~standard` (`vendor: "zod"`, `validate` returning `{ value }` / `{ issues: [{ message, path: [...] }] }`,
    `types: { input, output }`) - is assignable, proving the interface accepts the shape real
    vendors produce without importing one.
  * `ValidationSchemas<{a: string}, undefined, undefined>` accepts a hand-written schema for `body`.

### Step 2: Component Logic, Test Fixtures & Isolated Unit Tests

* **Description:**
  1. Rewrite `validate.ts`'s `parseOrThrow` to Rules 1-5; add `formatIssueField.ts`; remove the
     `zod` import from `src/validation/`.
  2. Create `tests/fixtures/validation/schemas.ts` (§2.2) - the small hand-written builders
     (`objectSchema`, `stringField`, `numberField`) that stand in for the Zod schemas the tests used.
     Each rule takes an optional custom message, matching how the old schemas were written
     (`z.string().min(1, "name is required")`).
  3. **Port** `tests/unit/validation/validate.test.ts` (180 lines) from Zod schemas to the fixtures.
     Every existing assertion is kept - same inputs, same expected `details` - so the ported file
     proves parity by construction.
* **Vitest Assertions** - `tests/unit/fixtures/schemas.test.ts` (the fixture is shared by two test
  files, so it gets its own tests): required / optional / default / trim / min / email / int /
  positive / coerce each pass and fail correctly; nested paths are reported (`["user", "name"]`);
  an object schema reports *every* failing field, not just the first.
* **Vitest Assertions** - `tests/unit/validation/formatIssueField.test.ts`:
  * `["user", "tags", 2]` under `body` -> `"body.user.tags.2"`.
  * `[{ key: "name" }]` -> `"body.name"` (path segment object unwrapped); mixed `["a", { key: 1 }]` -> `"body.a.1"`.
  * `undefined` path and `[]` path -> `"body"` (no trailing dot).
  * A `Symbol("s")` segment -> `"body.Symbol(s)"` and **does not throw**.
  * Each of `body`, `query`, `params` is used verbatim as the prefix.
* **Vitest Assertions** - additions to the ported `validate.test.ts`:
  * A hand-written **synchronous** validator: success returns its `value` to the handler.
  * A hand-written **asynchronous** validator (returns a Promise) is awaited on both success and failure.
  * Failure -> `ValidationError` whose `details` are `{ field, message }` built from the issues, with multiple issues preserved in order.
  * An empty `issues: []` array still throws `ValidationError`, with the single fallback detail `{ field: "body", message: "Invalid value" }`.
  * A validator that **throws** an `Error` propagates that error unchanged (not a `ValidationError`).
  * The returned `value` (not the raw input) is what the handler receives - a validator that upper-cases a field proves it.
  * Body, query and params are all checked, and their problems are reported together in that order: a failing body with a failing query reports both.
  * A schema is skipped, and its field stays `undefined`, when not supplied (existing behaviour, re-asserted).
  * A root-level issue reports `body`, not `body.` - asserted explicitly as the one intended change.
  * A second vendor stub (`vendor: "valibot-like"`) is accepted - `validate()` does not check the vendor string.

### Step 3: Network Pipeline Integration & Live Sockets

* **Description:** Replace the Zod schemas in `BackendRegistrationEndpoint.ts` with
  `validateRegistrationRequest` / `validateBackendId` (Rule 6); add the new file; remove the
  `zod` import and the two schema constants. Port `tests/integration/Validation.test.ts`
  (137 lines) to the fixtures, keeping every assertion. No `Empire.ts` / `Router.ts` change.
* **Vitest Assertions** - `tests/unit/loadbalancing/registration/validateRegistrationRequest.test.ts`:
  * Valid id and `{ url: "http://127.0.0.1:5001" }` -> returns `{ id, url: "http://127.0.0.1:5001" }` (URL normalised, trailing slash dropped).
  * Id boundaries: 1 char and 128 chars accepted; 0 and 129 rejected; each of ` `, `/`, `;`, `<` rejected with field `params.id`.
  * `url` cases: `ftp://x`, `http://h:1/api`, `http://user:pw@h:1`, `""`, `"not a url"` -> field `body.url`, "absolute http: origin" message.
  * `url` missing, `null`, `42`, `["a"]` -> field `body.url`, message `"must be a string"`.
  * Body `null`, `[]`, `"text"`, `42` -> a single issue with field `body` and message `"must be a JSON object"`.
  * **Collects everything:** a bad id *and* a bad url produce one `ValidationError` with both details, in id-then-url order.
  * Extra keys (`{ url, weight: 3, "__proto__": { x: 1 } }`) are ignored and `Object.prototype` is untouched afterwards.
  * `validateBackendId` accepts/rejects the same ids and never looks at a body.
* **Integration Tests - dropped.** The design planned `RegistrationWithoutZod.test.ts` and
  `ValidationWithoutZod.test.ts` (real-socket versions of the registration and `validate()` cases).
  They were built and then removed at the project owner's request; the unit tests and the ported
  `Validation.test.ts` remain, and the existing `BackendRegistrationEndpoint.test.ts` and
  `LoadBalancerRegistration` integration test pass **unchanged**.

### Step 4: Examples, Packaging, Verification & Documentation

* **Description:** Remove Zod from every remaining place and run the full gate.
  1. **Examples** (`examples/` and their `package-example/examples/` mirrors, per the `empire-example-edit`
     skill; the mirror imports from `"empire-ts"` with the port +1000):
     * `10-validation` - rewrite around hand-written Standard Schema validators: a small local helper
       wraps a plain checking function into a Standard Schema, then one validator each for the body,
       a query (with string-to-number coercion) and route params. Its header comment keeps the
       `curl` cases for passing and failing requests and points to the README's Zod section.
     * `02-routing`, `05-error-handling`, `09-dependency-injection` - replace their `validate()`
       routes with plain checks (`await ctx.jsonBody()`, then `throw new BadRequestError(...)`), and
       update each header comment (05 no longer claims `validate()` throws `ValidationError`; it
       points to `10-validation`).
     * `package-example/full-featured.ts` - the same treatment.
     * `README.MD`'s embedded `02-routing` block is regenerated from the new `package-example` file
       and diffed byte-for-byte, per the `empire-npm-readme` skill.
     * **Actually run every changed example** and `curl` each case its comment claims.
  2. **Packaging:** delete the `dependencies` block from `package.json`; delete `zod` from
     `package-example/package.json`; refresh both lockfiles (`npm install` in each) and confirm `zod`
     is gone from them.
  3. **README section** (Goal 6) in `README.MD` and `README_DEVELOPMENT.MD`, and a pointer in the root
     `README.md`: install Zod (`npm install zod`), import it, pass a schema to `validate()`, use
     `z.coerce.number()` for query and params, and note Valibot and ArkType as other Standard Schema
     validators. State plainly that Empire neither installs nor tests against them.
* **Vitest Assertions - guardrails: dropped.** The design planned `noZodInProject.test.ts` (scan for
  imports of `zod`, both `package.json` files, no `dependencies`) and `noThirdPartyAtRuntime.test.ts`
  (a child process hooking `Module._load`). Both were built and then removed at the project owner's
  request, along with the fixture script behind the second.
* **Verification checklist:**
  * `npx tsc --noEmit` (root) and `cd package-example && npx tsc --noEmit`.
  * `npm run lint`, `npm run verify` - all green, test count reported before and after.
  * `grep -ri zod` over `src/ examples/ tests/ package-example/ package.json` returns only comments
    and strings - no import, no dependency entry.
  * Build (`npm run build`) and search `dist/` for an import or `require` of `zod`: none. The only
    matches for the word are doc comments naming Zod as a compatible validator.
  * `npm pack --dry-run`: the listed `package.json` has no `dependencies`.
  * Benchmark, reported not asserted: median of 20 runs of
    `node -e "require('<tmp>/index.js')"` before and after, so the "removes load-time cost" claim is measured.
* **Docs & policy (same step, last):** update `CLAUDE.md` (no dependencies of any kind),
  `.claude/skills/empire-feature/SKILL.md` and `empire-review/SKILL.md` (drop the Zod exception),
  `doc/features/VALIDATION.md` (§2.1 gets a superseding note and a decisions-log entry),
  `PLAN.md` (Phase 11), a `CHANGELOG.md` entry marked **breaking** with the `npm install zod`
  migration line, and `Loadbalancer-v1.md` §7, whose "Zod scope" bullet becomes obsolete. The README,
  `README_DEVELOPMENT.MD`, root `README.md` and `ARCHITECTURE.md` edits already made for this design
  are re-checked against what was actually built.

---

## 4. Decisions

All questions are settled. Where the answer is a default, the project owner confirmed "keep defaults".

1. **Root-level field name - settled: change it.** Report `body` rather than `body.` - a cosmetic change to a
   rare case, accepted because a trailing dot is never what a client wants. Asserted in a test.
2. **Collect all endpoint problems, or stop at the first location? - settled: return all errors.**
   Zod-based `validate()` stops at the first failing location, so a bad id hid a bad url. The
   hand-written registration validator collects every problem (id and url) into one
   `ValidationError`, so a single 400 lists everything wrong - more useful to whoever is fixing their
   backend's registration. Decided by the project owner. **Extended to `validate()` itself after the
   first build** (project owner, 2026-09-21): it now checks body, query and params and reports every
   problem in one `ValidationError`, in that order. Fields already carry their `body.`, `query.` or
   `params.` prefix, so nothing is ambiguous, and the response body keeps its `{ error, details }`
   form (Non-Goal 3). The cost: a later location's validator still runs when an earlier one has
   failed, which wastes the work of an async validator. Invalid JSON is still a plain 400 before any
   validator runs.
3. **Convert a throwing validator to a 400? - settled: no (Rule 4).** A validator that throws has a bug;
   a 500 is the honest answer and the error is logged.
4. **Accept `safeParse`-only objects too? - settled: no (Non-Goal 4).** One rule ("Standard Schema")
   is easier to document and test than two.
5. **`@standard-schema/spec` as a devDependency for the types instead of a copy? - settled: copy.** It
   keeps the "no dependency of any kind" claim true and the spec is designed to be copied. Revisit only
   if the spec's version changes.
6. **Version - settled, not a concern.** Empire is not a production build yet, so the removal being
   breaking for anyone who relied on Empire installing Zod needs no version or migration handling
   beyond a `CHANGELOG.md` entry and the README section. Resolved by the project owner.
7. **Zod nowhere in the project - settled (project owner).** Not a runtime dependency, not a dev
   dependency, not in examples, tests or `package-example`. Users install Zod themselves, and the
   READMEs show how. This supersedes the first version of this design, which kept Zod as a
   devDependency for the examples and tests.
8. **How the examples validate without Zod - settled: the default.** `10-validation` is the `validate()`
   showcase with hand-written validators; `02`, `05` and `09` use plain `BadRequestError` checks rather
   than repeating a validator in every example. Keeps each example focused on its own topic.
9. **No automated Zod compatibility test - settled, accepted as the cost of #7.** See §5.

---

## 5. Consequences

**Easier:** the "zero runtime dependencies" claim becomes unconditional and the repository contains no
validation library at all; a consumer picks (and upgrades) their own validator without Empire pinning a
Zod major; Valibot/ArkType users are supported for free; `require("empire-ts")` does less; `dist/`
type-checks without Zod installed; the test suite no longer needs a dependency it did not own.

**Harder / to watch:**
* **Zod compatibility is no longer machine-checked.** With Zod out of the repository nothing in CI can
  import a real Zod schema, so "Zod schemas work with `validate()`" rests on the Standard Schema spec
  plus one manual check. That check *was* done, with Zod 4.5.4, before this design was written, using a
  throwaway script (since deleted): a schema with `z.coerce.number().int().min(1)`, `.optional()` and
  `.email()` passed through a copy of the `StandardSchemaV1` interface; the inferred output types
  survived (`number`, `string | undefined`) and the failure messages and paths were identical to
  `safeParse`'s. **To re-verify** after a Zod upgrade, install Zod in a scratch directory outside the
  repository and repeat that check - do not add it to the project. The Step 1 stand-in test (an object
  shaped like Zod 4's `~standard`) guards the *interface*, not Zod itself.
* **Breaking for Zod users** who assumed Empire installs it. Mitigated by the changelog and the README
  section; accepted (Decision 6).
* **The Standard Schema types are now ours to keep in step** with the spec. They are tiny and the spec is
  versioned (`version: 1`), so drift is unlikely - but a spec v2 would need a deliberate update.
* **`validate()` no longer knows it is talking to Zod**, so vendor-specific niceties (Zod's error
  formatting helpers) are unavailable to it. It never used them.
* **A large mechanical change.** Fourteen code files, two `package.json` files, two lockfiles and two
  test files (317 lines) change, plus the embedded example in `README.MD`. The example rewrites alter
  what three examples demonstrate (Decision 8) and their `curl` output, so each must be run, not just compiled.
* **Documentation surface is wide** - Step 4 lists every file. A missed one leaves the docs contradicting
  the code, which is why the doc pass is part of the same step and not a follow-up.

## 6. Action Checklist

- [x] Step 1 - Standard Schema types, `ValidationSchemas`, exports; type-level tests (no Zod import)
- [x] Step 2 - `validate()`, `formatIssueField`, the `tests/fixtures/validation` helpers, and the ported `validate.test.ts`
- [x] Step 3 - registration endpoint without Zod; unit tests and the ported `Validation.test.ts` (the two planned integration test files were dropped)
- [x] Step 4 - examples and mirrors rewritten and run, `README.MD` embedded block regenerated, both `package.json` files and lockfiles cleaned, README Zod section, verify, lint, pack check, benchmark (guardrail tests dropped)
- [x] Docs & policy - `CLAUDE.md`, both skills, `VALIDATION.md`, `PLAN.md`, `CHANGELOG.md` (breaking), `Loadbalancer-v1.md` §7

---

## 7. As Built

**Result.** `npm run verify` and `npm run lint` are green. Tests went from 795 passed / 2 skipped
(54 files) to **876 passed / 2 skipped (58 files)** - 81 new tests in 4 new files. All 12 examples
pass the smoke test, and the four changed examples, their `package-example` mirrors and
`full-featured.ts` were each run and sent every request their header comments describe (66
requests, all as expected).

**Measured, not assumed** (Step 4's benchmark, 20 interleaved runs of
`node -e "require('<dist>/index.js')"`, process start-up included):

| | median | range | `node_modules` files loaded |
|---|---|---|---|
| Before (this repository at `93c1c24`, built with Zod) | 130.6 ms | 123.4 - 140.0 | 94 |
| After | 69.2 ms | 65.3 - 74.6 | 0 |

`npm pack` lists 200 files, and the packed `package.json` has no `dependencies` key.

**Where the build departed from the design:**

1. **`dist/` still says "Zod" in comments.** Goal 1 said nothing emitted mentions `zod`. The doc comments
   on `validate()`, `ValidationSchemas` and `StandardSchemaV1` name Zod as a compatible validator (an
   editor hover is where a user learns `z.coerce.number()` is needed), and those comments are emitted.
   What matters - no `import`, `require` or dependency - holds, so Goal 1 and the checklist were reworded
   rather than the comments scrubbed.
2. **Eight type files, not seven.** `StandardSchemaV1` plus seven supporting types
   (`Props`, `Result`, `Success`, `Failure`, `Issue`, `PathSegment`, `Types`); the design miscounted.
3. **The fixture grew.** `tests/fixtures/validation/schemas.ts` also has `booleanField` (the ported
   `validate` test coerces `?verbose=true`), `objectField` (a nested object, for the path tests) and a
   `pattern` option on `stringField` (the ported params test used a regex). Optional fields are typed
   `T | undefined`, which the Step 1 type test asserts.
4. **The endpoint no longer sets `ctx.params`.** It only did so to feed `validate()`; the handlers now
   take the id directly.
5. **The type-level tests are not checked by `npm run typecheck`.** `tsconfig.json` includes `src/`,
   `examples/` and `scripts/` but not `tests/`, so the `@ts-expect-error` and `expectTypeOf` lines in
   `StandardSchemaV1.test.ts` only run at type level under a config that includes them. They were checked
   with a temporary `tsconfig` (clean), and `tsc` flagged a typing mistake in a helper in
   `validate.test.ts` that way, now fixed. This is a gap in the repository's checks, not something this change introduced.
6. **`package-example` was repacked locally** to verify the mirrors. Its lockfile pinned the old tarball
   (which depended on Zod), and the mirrors import `StandardSchemaV1`, which the old package lacks.
   `npm pack` produced a new, gitignored `empire-ts-0.1.3.tgz` (no version bump, nothing published) and
   `npm install file:../empire-ts-0.1.3.tgz` refreshed `package-example/package-lock.json`, dropping
   `zod` and the old tarball's `dependencies` entry. Anyone else running `package-example` still packs
   their own tarball first, as before.
7. **The guardrail tests and the two integration test files were dropped.** They were built and passing
   (a scanner for imports of `zod`, a child-process check that loading the package requires only
   built-ins, and real-socket tests for registration and `validate()`), then removed at the project
   owner's request. What that leaves uncovered: nothing fails if `zod` or a `dependencies` entry
   returns, and the registration endpoint is no longer driven over a real socket by a test written
   for this change (the existing endpoint and registration tests are unchanged and still pass).
   `validate()` is still driven over a real request by the ported `Validation.test.ts`, and the unit
   tests cover the merged-errors behaviour. The Step 4 checks were run once by hand instead: no
   import of `zod` in any code folder, none in either `package.json` or lockfile, and
   `require("empire-ts")` loading 0 files from `node_modules` (down from 94).
8. **`validate()` reports every location's problems** rather than stopping at the first. Added after the
   first build, at the project owner's request (Decision 2, Rule 1); it has its own unit tests.

**Still open:** nothing in this design. Not done, by design: an automated check that a real Zod schema
works (Non-Goal 7); re-verify by hand in a scratch directory after a Zod upgrade (§5).
