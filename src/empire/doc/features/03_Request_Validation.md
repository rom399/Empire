# Empire — Request Validation: Design & Build Doc

**Status:** Implemented
**Scope:** Native TypeScript architecture. Phase 11 in `PLAN.md`; it also touches the Phase 23 registration endpoint (`05_Loadbalancer_Core_L7.md`).
**Timeline:** Designed by Opus ➡️ Executed by Sonnet

---

## 1. Context & Architectural Goals

### 1.1 The Problem

Every route handler that accepts a body, a query string or route params used to validate it by hand:
read it through `ctx.jsonBody()`, `ctx.query` or `ctx.params`, check the fields, throw
`BadRequestError` on failure. That is repetitive, easy to get wrong (check some fields and forget
others), and produces inconsistent messages because nothing standardises the wording.

Phase 11 added schema-based validation with automatic `400` responses, reusing Empire's existing
error pipeline instead of inventing a parallel one: `Router` already turns a thrown `HttpError` into a
JSON response, so a validation failure is just another `HttpError`.

**How the dependency question changed.** The first build used **Zod** and made it Empire's one
deliberate exception to the zero-dependency rule. A later audit showed the exception was much smaller
than it sounded, and partly self-inflicted:

| Where | What it used |
|---|---|
| `validate()` and `ValidationSchemas` | The `ZodType<T>` **type**, plus `schema.safeParse(value)` and reading `error.issues[].path` / `.message` from a schema the *caller* supplied. Empire never constructed a schema. |
| The registration endpoint (added later for the load balancer) | **Real runtime use**: `z.object`, `z.string().regex()`, `.refine()`. |
| Examples, `package-example`, two test files | Writing schemas. |
| `package.json` files | The dependency entries. |

Two consequences followed:

1. **Before the load balancer, `require("empire-ts")` never loaded Zod** - `validate()` only imported
   Zod *types* (erased at compile time). The registration endpoint made it a real runtime dependency
   for everyone, because the package barrel re-exports it.
2. **`dist/validation/ValidationSchemas.d.ts` referenced `zod`**, so a consumer's type-check needed Zod
   installed even if they never validated anything.

What Empire actually needs from a validator is tiny: "given an unknown value, give me a typed value or
a list of `{ path, message }` issues". That is exactly what the **Standard Schema** specification
(https://standardschema.dev) standardises. Zod (3.24 and later), Valibot and ArkType all implement it,
and the spec is designed to be *copied* into a library as types with no package dependency.

**The project owner's direction: no Zod anywhere in the repository** - not a runtime dependency, not a
dev dependency, not in examples or tests. Zod becomes something a *user* installs if they want it, and
the READMEs show how.

### 1.2 System Goals

* **Goal 1 - Schema-based validation of the body, the query string and the route params**, with
  automatic `400` responses on failure, through the existing error pipeline.
* **Goal 2 - Inferred types.** The handler receives each validated value with its schema's output
  type (`z.coerce.number()` gives `number`, `.optional()` gives `T | undefined`), with no casts.
* **Goal 3 - Any Standard Schema validator works.** Zod, Valibot, ArkType, or a hand-written one, with
  no change at the call site.
* **Goal 4 - No validation library anywhere in the repository.** Neither `package.json` (nor
  `package-example/package.json`) mentions `zod`; `package.json` has no `dependencies` block; no file
  under `src/`, `examples/`, `tests/` or `package-example/` imports it; `require("empire-ts")` loads no
  third-party module; nothing under `dist/` imports or requires it (doc comments may still name Zod as
  a compatible validator).
* **Goal 5 - Every problem in one response.** Body, query and params are all checked and their
  problems reported together, so a client fixing a request sees everything wrong with it at once.
* **Goal 6 - The registration endpoint validates without a library**, still answering `400` with a
  `ValidationError` and per-field `details`, and reporting every problem in one response.
* **Goal 7 - Everything runs without Zod.** The examples, the `package-example` mirrors, the embedded
  example in `README.MD` and the test suite all work with no validation library installed.
* **Goal 8 - The READMEs explain how to bring Zod:** install it, import it, pass a schema to
  `validate()`, the query-string coercion gotcha, and Valibot and ArkType as other options.
* **Goal 9 - The policy text matches reality.** `CLAUDE.md`, the skills, the READMEs, `ARCHITECTURE.md`,
  `PLAN.md` and `CHANGELOG.md` no longer describe Zod as an exception.

### 1.3 Non-Goals (Scope Guardrails)

* **Non-Goal 1 - A schema library or DSL inside Empire.** The original argument still holds: string
  formats, coercion, unions and nested arrays are edge-case-heavy, and a mature library has hardened
  them. Empire *consumes* validators; it does not become one. The small helpers in `tests/fixtures/`
  and `examples/10-validation` are test and demo code, not part of the package.
* **Non-Goal 2 - Vendoring, forking or re-exporting Zod**, and no Zod compatibility shim.
* **Non-Goal 3 - Validators that are not Standard Schema.** A bare function, or an object with only
  `safeParse`, is not accepted; one rule is easier to document and test than two, and anything else can
  be wrapped in a few lines.
* **Non-Goal 4 - Converting a throwing validator into a `400`.** A validator that throws has a bug, so
  a `500` is the honest answer (rule 3).
* **Non-Goal 5 - A deprecation period or version handling for Zod users.** Empire is not a production
  build yet; the removal is breaking for anyone who relied on Empire installing Zod, and it is covered
  by a `CHANGELOG.md` entry and the README section.
* **Non-Goal 6 - Changing `ctx.jsonBody()`, `ctx.query` or `ctx.params`.**
* **Non-Goal 7 - Automatic schema documentation.** No OpenAPI generation from schemas (Phase 18, much
  later), and no decorator-based validation (`@IsEmail()` and similar): Phase 14 has not started and it
  would reopen the `reflect-metadata` question settled against for DI.
* **Non-Goal 8 - Validating headers or cookies.** Scope is what Phase 11 lists: body, query, route params.
* **Non-Goal 9 - CI that installs Zod just to test compatibility.** That would put Zod back in the
  project (see the trade-offs in 2.4).
* **Non-Goal 10 - Automated guardrail tests for the dependency rule.** They were built and then dropped
  at the project owner's request; see Step 4.

### 1.4 Dependency Stance

**Zero runtime dependencies. Zero validation-library dependencies of any kind. Native Node.js modules
only.**

* The Standard Schema types are **copied into** `src/validation/standard/`, as the spec intends. No
  package is added, including `@standard-schema/spec` as a dev dependency: a copy keeps the "no
  dependency of any kind" claim true, and is worth revisiting only if the spec's version changes.
* `zod` is removed outright from `dependencies` **and** `devDependencies`, and `package-example` no
  longer lists it. `package.json` has no `dependencies` block.
* **Consumer impact (breaking, accepted):** `npm install empire-ts` no longer installs Zod. An app that
  validates with Zod runs `npm install zod` itself.
* **Measured:** loading the package (`node -e "require('.../dist/index.js')"`, 20 interleaved runs,
  process start-up included) went from a median of **130.6 ms to 69.2 ms**, and the `node_modules`
  files loaded from **94 to 0**.
* **History:** Zod was added as a regular `dependency` (not a `peerDependency`) on 2026-08-19, on the
  reasoning that Empire was not published to npm and so had no downstream consumers to protect. It was
  removed entirely on 2026-09-21.

---

## 2. Design & API Contracts (The Opus Blueprint)

### 2.1 Public User API

**With Zod** - which the user installs (`npm install empire-ts zod`); Empire neither installs, pins nor
tests against it:

```ts
import { z } from "zod";
import { Empire, validate } from "empire-ts";

app.post("/users", validate({
    body:  z.object({ name: z.string().min(1, "name is required"), age: z.coerce.number().int() }),
    query: z.object({ page: z.coerce.number().int().min(1).default(1) }),
})(async (ctx, { body, query }) => {
    // body.name: string, body.age: number, query.page: number - inferred, no casts
    ctx.status(201).json({ ...body, page: query.page });
}));
```

**With a hand-written validator** - no library at all; this is how Empire's own `examples/10-validation`
validates:

```ts
import { validate, StandardSchemaV1 } from "empire-ts";

const pageQuery: StandardSchemaV1<unknown, { page: number }> = {
    "~standard": {
        version: 1,
        vendor: "my-app",
        validate(value) {
            const page = Number((value as Record<string, unknown>).page ?? 1);

            return Number.isInteger(page) && page >= 1
                ? { value: { page } }
                : { issues: [{ message: "must be a whole number of 1 or more", path: ["page"] }] };
        },
    },
};

app.get("/things", validate({ query: pageQuery })((ctx, { query }) => ctx.json({ page: query.page })));
```

A validator returns `{ value }` or `{ issues }` and may be asynchronous. Valibot and ArkType work the
same way as Zod.

**Query strings and route params are always text.** Both come off the raw URL, so `?page=2` arrives as
the string `"2"`. A validator expecting a number must convert it: with Zod that is `z.coerce.number()`
rather than `z.number()`; hand-written, it is `Number(...)`.

**What a client sees** on failure - a `400` with the readable `error` string and a structured `details`
array, across every location that failed:

```json
{
    "error": "body.name: name is required; query.page: page must be whole; params.id: id must be positive",
    "details": [
        { "field": "body.name",  "message": "name is required" },
        { "field": "query.page", "message": "page must be whole" },
        { "field": "params.id",  "message": "id must be positive" }
    ]
}
```

### 2.2 Core Interfaces & Data Models

**Standard Schema v1** - a faithful copy of the spec, one type per file under
`src/validation/standard/`:

```ts
interface StandardSchemaV1<Input = unknown, Output = Input> {
    readonly "~standard": StandardSchemaProps<Input, Output>;
}
interface StandardSchemaProps<Input = unknown, Output = Input> {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => StandardSchemaResult<Output> | Promise<StandardSchemaResult<Output>>;
    readonly types?: StandardSchemaTypes<Input, Output> | undefined;
}
type StandardSchemaResult<Output> = StandardSchemaSuccess<Output> | StandardSchemaFailure;
interface StandardSchemaSuccess<Output> { readonly value: Output; readonly issues?: undefined }
interface StandardSchemaFailure { readonly issues: ReadonlyArray<StandardSchemaIssue> }
interface StandardSchemaIssue { readonly message: string; readonly path?: ReadonlyArray<PropertyKey | StandardSchemaPathSegment> | undefined }
interface StandardSchemaPathSegment { readonly key: PropertyKey }
interface StandardSchemaTypes<Input, Output> { readonly input: Input; readonly output: Output }
```

`StandardSchemaV1` and its seven supporting types are exported from `src/index.ts`.

**The wrapper:**

```ts
// ValidationSchemas.ts
interface ValidationSchemas<TBody, TQuery, TParams> {
    body?: StandardSchemaV1<unknown, TBody>;
    query?: StandardSchemaV1<unknown, TQuery>;
    params?: StandardSchemaV1<unknown, TParams>;
}

// Validated.ts - each field is the schema's output type, or undefined when no schema was given
interface Validated<TBody, TQuery, TParams> { body: TBody; query: TQuery; params: TParams }

// validate.ts
function validate<TBody = undefined, TQuery = undefined, TParams = undefined>(
    schemas: ValidationSchemas<TBody, TQuery, TParams>
): (handler: (ctx: Context, data: Validated<TBody, TQuery, TParams>) => void | Promise<void>) => RouteHandler;

// formatIssueField.ts
function formatIssueField(location: "body" | "query" | "params", path: StandardSchemaIssue["path"]): string;
```

**The error:**

```ts
// src/errors/ValidationIssue.ts
interface ValidationIssue { field: string; message: string }

// src/errors/ValidationError.ts - extends BadRequestError: it already *is* a 400, this is a more specific reason
class ValidationError extends BadRequestError {
    readonly details: ValidationIssue[];
    constructor(details: ValidationIssue[]);   // message: "field: reason; field: reason"
}
```

`ValidationError` is named for Empire's `Error` suffix convention (`HttpError`, `BadRequestError`), not
`PLAN.md`'s original `ValidationException`; the departure is deliberate and `PLAN.md` cross-references it.

**The registration endpoint's checks** (`src/loadbalancing/registration/`):

```ts
/** Throws ValidationError listing every problem, else returns the clean values. */
function validateRegistrationRequest(id: string, body: unknown): { id: string; url: string };
function validateBackendId(id: string): { id: string };   // DELETE: the id only
```

**Test-only fixture** (`tests/fixtures/validation/schemas.ts`, not part of the package): small
hand-written builders that stand in for the Zod schemas the tests once used - `objectSchema`,
`objectField`, `stringField`, `numberField`, `booleanField`. Each rule takes an optional custom message
the way `z.string().min(1, "...")` did, optional fields are typed `T | undefined`, and an object schema
reports every failing field.

### 2.3 Internal Processing Logic Rules

1. **`validate()` wraps a handler and returns a plain `RouteHandler`.** It is the same shape as
   `createLoggerMiddleware(logger)` wrapping a dependency, so it needs no change to `Router`'s
   registration methods or to `Context`'s frozen API. A failure throws `ValidationError`, which `Router`
   already converts through its existing pipeline.
2. **Each supplied schema runs through the standard entry point:**
   `const result = await schema["~standard"].validate(value)`. The `await` handles synchronous and
   asynchronous validators alike. **Failure vs success is decided by `result.issues !== undefined`**,
   per the spec, and on success the returned `value` *replaces* the raw input - which is how coercion
   and defaults take effect.
3. **Every location is checked and the problems are collected.** Body, then query, then params: each
   supplied schema is run, the problems from all of them are concatenated in that order, and one
   `ValidationError` is thrown if there are any. The handler never runs if any location failed.
   * **Invalid JSON is still a plain `400`** (`BadRequestError("Invalid JSON")`), raised by
     `ctx.jsonBody()` before any validator runs. The body is only read when a body schema is supplied.
   * **A validator that throws is not converted.** Its error propagates at once - whichever location it
     is for, and even when an earlier location already failed - to the existing pipeline as a `500`: a
     bug in a validator is a server fault, not a client mistake.
   * **A trade-off, accepted:** a later location's validator still runs when an earlier one has failed,
     which wastes the work of an *asynchronous* validator.
4. **`formatIssueField` builds the `field`.** Each path segment is unwrapped if it is a `{ key }`
   object; numbers and strings go through `String()`; symbols go through `String(symbol)` because a bare
   `Array.join` throws on a symbol; segments are joined with `.`, giving `body.user.tags.0`. A missing or
   empty path yields the location alone - `body`, **not** `body.`. (The trailing dot of the Zod-era
   output was a cosmetic bug; this is the one intended change to `field` output.)
5. **An empty `issues` array is still a failure.** If a location's problems would be empty, one issue
   `{ field: <location>, message: "Invalid value" }` is substituted, so a client never receives a `400`
   with no reason.
6. **Query and params are converted, not passed as-is.** `ctx.query` is a `URLSearchParams`, so
   `Object.fromEntries(ctx.query)` turns it into something a validator can treat as an object; `ctx.params`
   is already a plain object. Every value in both is a string.
7. **`ValidationError` and the response.** It extends `BadRequestError`. Its `message` stays a single
   readable string (`field: reason; field: reason`), so anything that reads only `HttpError.message`,
   like logging, needs no change; `details` carries the structured breakdown. `sendErrorResponse` makes
   one additive change: when the caught error is a `ValidationError`, the JSON body gains `details`
   beside `error`. Every other `HttpError`, including a plain `BadRequestError`, keeps its
   `{ error }`-only body. The response format itself is unchanged.
8. **The registration endpoint validates by hand and collects everything.** `PUT` reports *every*
   problem in one `ValidationError`, in id-then-body order:
   * `params.id` must match `BACKEND_ID_PATTERN` (`[A-Za-z0-9_:-]`, 1-128 characters).
   * `body` must be a non-null, non-array object, else one issue `{ field: "body", message: "must be a
     JSON object" }`.
   * `body.url` must be a string (`"must be a string"`), then `normalizeBackendUrl(url) !== undefined`,
     else the "absolute http: origin" message.
   * Unknown body keys are ignored. `DELETE` checks only the id. `ctx.jsonBody()` still runs first, so
     invalid JSON is still a plain `400`.
9. **Examples validate without a library.** `examples/10-validation` is the `validate()` showcase, using
   hand-written Standard Schema validators. `examples/02-routing`, `05-error-handling`,
   `09-dependency-injection` and `full-featured.ts` check request bodies with `ctx.jsonBody()` and
   `BadRequestError`, as they did before Phase 11, rather than repeating a validator in each. Their
   `curl` output therefore changes (no `details` array).

### 2.4 Security & Performance Defaults

**Security**

* **Validation runs after `ctx.jsonBody()`,** and therefore after the request body size limit.
* **The registration validator is prototype-safe.** It reads fields by plain property access on
  `JSON.parse` output and never spreads, merges or assigns from it, so a `__proto__` key (which
  `JSON.parse` creates as an ordinary own property) is just an ignored field and pollutes nothing.
* **Issue messages reach the client.** They come from the validator, so a validator's messages must not
  contain secrets. The registration endpoint's own messages contain no token and no other backend's url.
* **A validator that never settles hangs its own request.** Standard Schema permits async validators and
  `validate()` awaits them; Empire adds no timeout, matching how any slow handler behaves.

**Performance**

* The change removes a module graph from `require("empire-ts")` and about 7 MB (Zod 4.5.4's unpacked
  size) from a consumer's install; the measured load-time difference is in 1.4.
* Validation is one call per supplied schema. A location without a schema costs nothing.

**Trade-offs and watch-outs**

* **Zod compatibility is no longer machine-checked.** With Zod out of the repository nothing in CI can
  import a real Zod schema, so "Zod schemas work with `validate()`" rests on the Standard Schema spec plus
  one manual check. That check *was* done, with Zod 4.5.4, using a throwaway script: a schema with
  `z.coerce.number().int().min(1)`, `.optional()` and `.email()` passed through a copy of the
  `StandardSchemaV1` interface; the inferred output types survived (`number`, `string | undefined`) and
  the failure messages and paths were identical to `safeParse`'s. **To re-verify** after a Zod upgrade,
  install Zod in a scratch directory *outside* the repository and repeat that check - do not add it to
  the project. A stand-in test (an object built like Zod 4's `~standard`) guards the *interface*, not Zod.
* **Breaking for Zod users** who assumed Empire installs it (Non-Goal 5).
* **The Standard Schema types are now ours to keep in step with the spec.** They are tiny and the spec is
  versioned (`version: 1`), so drift is unlikely, but a spec v2 would need a deliberate update.
* **`validate()` no longer knows it is talking to Zod,** so vendor-specific niceties (Zod's error
  formatting helpers) are unavailable to it. It never used them.
* **A validator-specific message difference exists and is the validator's, not Empire's.** With Zod,
  a custom `.min(1, "...")` message only fires for a field that is *present but empty*; a field missing
  entirely fails Zod's own base type check first, with Zod's own message. The tests cover both cases
  separately rather than assuming one covers the other, and the fixtures reproduce the same distinction.

---

## 3. Iterative Build Steps & Test Strategy (The Sonnet Instructions)

Each step lands with its tests before the next starts, and `npm run verify` plus `npm run lint` must pass
at the end of every step.

### Step 1: Types & Structural Definitions

* **Description:**
  * `ValidationError` (extending `BadRequestError`, with `details`) and `ValidationIssue`, each in its
    own file per the one-type-per-file convention.
  * The eight Standard Schema files under `src/validation/standard/` exactly as in 2.2.
  * `ValidationSchemas` and `Validated` in their own files; export the Standard Schema types from
    `src/index.ts`.
* **Sonnet Check:** `npx tsc --noEmit` clean once `validate()` is in place.
* [x] V-1 - `ValidationError` and `ValidationIssue`
* [x] Standard Schema types, `ValidationSchemas`, `Validated`, exports
* **Vitest Assertions:**
  * [x] `ValidationError.message` reads as one readable string even with several field failures
    (`tests/unit/errors/ValidationError.test.ts`).
  * [x] `StandardSchemaV1.test.ts` (type-level via `expectTypeOf` and `@ts-expect-error`, plus a runtime
    check each, **no validation library imported**): a hand-written object with a `~standard` property
    is assignable to `StandardSchemaV1<unknown, { page: number }>`; a fixture schema infers its output
    type from its field rules; a schema producing `{ a: string }` is *not* assignable to one producing
    `{ a: number }`; an object missing `~standard`, or with `version: 2`, is not assignable; an object
    written exactly like Zod 4's `~standard` (`vendor: "zod"`, `types` present) *is* assignable, proving
    the interface accepts what real vendors produce; and `ValidationSchemas` accepts a hand-written
    schema for `body`.

### Step 2: Component Logic & Isolated Unit Tests

* **Description:** Implement `validate()` (rules 1-6), `formatIssueField`, and the additive `details`
  in `sendErrorResponse` (rule 7); create the test fixtures in `tests/fixtures/validation/schemas.ts`.
* [x] V-2 - `sendErrorResponse.ts` extended: `details` only for a `ValidationError`
* [x] V-3 - `validate()`
* [x] `formatIssueField`, and the fixtures
* **Vitest Assertions:**
  * [x] **`sendErrorResponse`:** includes `details` for a `ValidationError` and does **not** for a plain
    `BadRequestError` or any other `HttpError` (`tests/unit/errors/sendErrorResponse.test.ts`).
  * [x] **`formatIssueField`:** `["user","tags",2]` gives `body.user.tags.2`; `[{ key: "name" }]` gives
    `body.name`, and `["a", { key: 1 }]` gives `body.a.1`; an `undefined` or `[]` path gives `body`
    (no trailing dot); a `Symbol("s")` segment gives `body.Symbol(s)` and does not throw; `body`,
    `query` and `params` are each used verbatim as the prefix.
  * [x] **`validate()` - body, query, params** (`tests/unit/validation/validate.test.ts`): a valid body
    reaches the handler typed and unchanged; an omitted optional field resolves to `undefined`; a
    missing required field, and a malformed value, throw `ValidationError` naming the field and
    reason; query values are coerced (`"2"` becomes `2`) and a missing required query param fails;
    route params validate the same way; all three together succeed and reach the handler; a location
    with no schema stays `undefined`.
  * [x] **Collecting all locations:** a failing body and a failing query are reported together, body
    first; only the locations that failed appear; body, query and params problems arrive in that order
    in one error; the handler never runs when any one fails; a later validator still runs after an
    earlier one fails; a validator that throws still surfaces as the thrown error even when an earlier
    location failed.
  * [x] **Any Standard Schema validator:** a synchronous validator's value reaches the handler and
    replaces the input (an upper-casing validator proves it); an asynchronous validator is awaited on
    success and on failure; issues become `{ field, message }` in order; a root-level issue reports
    `body`, not `body.`; an empty `issues: []` still throws with the single fallback
    `{ field: "body", message: "Invalid value" }`; the location of the failing schema is used
    (`query.x`, `params.x`); a validator that throws propagates unchanged (not a `ValidationError`);
    the `vendor` string is not inspected (`"valibot-like"` is accepted).
  * [x] **The fixtures** (`tests/unit/fixtures/schemas.test.ts`): required, optional, default, trim,
    min, email, pattern, int, positive and coerce each pass and fail correctly; nested paths report
    (`["user","name"]`); an object schema reports every failing field; a value that is not an object is a
    root issue.

### Step 3: Network Pipeline Integration & Live Sockets

* **Description:** Replace the Zod schemas in `BackendRegistrationEndpoint` with
  `validateRegistrationRequest` and `validateBackendId` (rule 8), and exercise `validate()` over real
  requests. No `Empire.ts` or `Router.ts` change.
* [x] Registration endpoint validated without a library
* **Unit Tests** (`tests/unit/loadbalancing/registration/validateRegistrationRequest.test.ts`):
  * [x] A valid id and `{ url }` return the id and the normalised url (a trailing slash is dropped).
  * [x] Id boundaries: 1 and 128 characters accepted, 0 and 129 rejected, and each of ` `, `/`, `;`, `<`
    rejected with field `params.id`.
  * [x] `url` cases (`ftp://x`, `http://h:1/api`, `http://user:pw@h:1`, `""`, `"not a url"`) fail with
    field `body.url` and the "absolute http: origin" message; a missing, `null`, numeric or array `url`
    fails with `"must be a string"`.
  * [x] A body that is `null`, an array, a string or a number gives a single `body` issue, `"must be a
    JSON object"`.
  * [x] **Everything is collected:** a bad id and a bad url produce one `ValidationError` with both
    details, id first.
  * [x] Extra keys, including a `__proto__` key, are ignored and `Object.prototype` is untouched.
  * [x] `validateBackendId` accepts and rejects the same ids and never looks at a body.
* **Integration Tests** (`tests/integration/Validation.test.ts`, real requests on ephemeral ports):
  * [x] A valid body returns `201` with the validated body.
  * [x] An invalid body returns `400` with field-level `details`.
  * [x] Query values are coerced per schema on a real request (`?page=2` arrives as the number `2`).
  * [x] A required query param missing entirely returns `400` naming the field.
  * [x] A required query param present but empty returns `400` with the custom message.
  * [x] The handler is never reached when validation fails.
* The existing `BackendRegistrationEndpoint.test.ts` and the `LoadBalancerRegistration` integration test
  pass **unchanged**.

### Step 4: Verification, Benchmarking, & Example App

* **Description:** Remove Zod from every remaining place, prove the examples run without it, and run
  the full gate.
* [x] V-4 - **Examples**, and their `package-example/examples/` mirrors (which import from `"empire-ts"`
  with the port +1000):
  * `10-validation` (port 8010) is rewritten around hand-written Standard Schema validators: a small
    local helper wraps a plain checking function into a Standard Schema, then one validator each for the
    body (`POST /users`), the query with string-to-number conversion (`GET /search`) and the route params
    (`GET /records/:id`). Its header keeps the `curl` cases for passing and failing requests and points
    to the README's Zod section.
  * `02-routing`, `05-error-handling`, `09-dependency-injection` and `package-example/full-featured.ts`
    check bodies with `ctx.jsonBody()` and `BadRequestError`; their header comments are updated (05 no
    longer claims `validate()` throws `ValidationError` and points to `10-validation`).
  * The `02-routing` block embedded in `README.MD` is regenerated from the `package-example` file and
    diffed byte-for-byte.
  * **Every changed example was actually run**, and each request its header comment describes was sent
    (66 requests across the examples and their mirrors, all as expected).
* [x] **Packaging.** The `dependencies` block is deleted from `package.json`; `zod` is deleted from
  `package-example/package.json`; both lockfiles are refreshed and no longer contain it.
  `npm pack --dry-run` lists 200 files, and the packed `package.json` has no `dependencies` key.
* [x] V-6 - **README sections.** "Validation with Zod (or any validator)" in `README.MD` and "Using Zod"
  and "Bring your own validator" in `README_DEVELOPMENT.MD`, with a pointer in the root `README.md`.
* [x] **Docs and policy.** `CLAUDE.md`, the `empire-feature` and `empire-review` skills, `PLAN.md`,
  `CHANGELOG.md` (a **breaking** entry with the `npm install zod` migration line), `ARCHITECTURE.md`, and
  the load balancer doc's Zod note.
* [x] **Gate.** `npx tsc --noEmit` at the root and in `package-example/`, `npm run lint`,
  `npm run verify`. Tests went from 795 passed / 2 skipped (54 files) to **876 passed / 2 skipped
  (58 files)** over the whole change, 81 new tests in 4 new files
  (`StandardSchemaV1`, the fixtures, `formatIssueField`, `validateRegistrationRequest`) plus the extended
  `validate.test.ts`.
* **As built - where the work departed from the plan:**
  * **`dist/` still says "Zod" in doc comments** (on `validate()`, `ValidationSchemas`, `StandardSchemaV1`)
    because an editor hover is where a user learns `z.coerce.number()` is needed. There is no import,
    `require` or dependency, so Goal 4 was worded around imports rather than the word.
  * **Eight type files, not seven** (`StandardSchemaV1` plus seven supporting types).
  * **The endpoint no longer sets `ctx.params`**; it only did so to feed `validate()`.
  * **`validate()` collecting across locations was added after the first build**, at the project owner's
    request. Before that it stopped at the first failing location (body, then query, then params).
  * **The type-level tests are not checked by `npm run typecheck`.** `tsconfig.json` includes `src/`,
    `examples/` and `scripts/` but not `tests/`, so the `@ts-expect-error` and `expectTypeOf` lines only
    run at type level under a config that includes them. They were checked once with a temporary config
    (clean), which also caught a typing mistake in a `validate.test.ts` helper, now fixed. This is a gap in
    the repository's checks, not something this change introduced.
  * **`package-example` was repacked locally** to verify the mirrors: its lockfile pinned an old tarball
    that depended on Zod, and the mirrors import `StandardSchemaV1`, which that package lacks. `npm pack`
    produced a new, gitignored `empire-ts-0.1.3.tgz` (no version bump, nothing published) and a reinstall
    refreshed the lockfile.
  * **Guardrail tests and real-socket integration tests were built, then dropped** at the project owner's
    request: a scanner for imports of `zod` in code and in both `package.json` files, a child-process
    check that loading the package requires only Node built-ins, and integration tests for the
    registration endpoint and `validate()` with hand-written validators. What that leaves uncovered:
    nothing fails automatically if `zod` or a `dependencies` entry returns, and the registration endpoint
    is no longer driven over a real socket by a test written for this change (its existing tests still
    pass). The checks were run once by hand instead: no import of `zod` in any code folder, none in either
    `package.json` or lockfile, and `require("empire-ts")` loading 0 files from `node_modules`.
* [ ] **Follow-ups, not built:** a fuller README section on writing validators, and an automated
  compatibility check against a real Zod (deliberately excluded, Non-Goal 9).
