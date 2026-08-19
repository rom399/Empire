# Empire — Validation: Design & Build Doc

**Status:** Implemented — V-1 through V-6 all complete and shipped (see §3)
**Scope:** Empire (native TypeScript webserver). Phase 11 in `PLAN.md`.

## 1. Context & Goals

Every route handler that accepts a body, query string, or route param
currently validates it by hand: read via `ctx.jsonBody()`/`ctx.query`/
`ctx.params`, check the shape, throw `BadRequestError` on failure. This is
repetitive, error-prone (easy to check some fields and forget others), and
produces inconsistent error messages across handlers since nothing
standardizes the wording.

**Goal:** schema-based validation for body, query, and route params, with
automatic `400` responses on failure, reusing Empire's *existing* error
pipeline rather than inventing a new one. `Router` already catches any
thrown `HttpError` and converts it to a consistent JSON response — a
validation failure should just be another `HttpError`, not a parallel
mechanism.

**Non-goal:** hand-rolling a schema validation engine from scratch. Unlike
the DI container (see `doc/features/DEPENDENCY_INJECTION.md`), this is the
one place a dependency is the right call — see §2.1.

## 2. Design

### 2.1 The dependency question — this breaks "zero runtime dependencies"

Empire has stayed dependency-free through routing, middleware, static
files, and a full DI container. Validation is different: schema
validation has a lot of real edge-case surface — nested objects, unions,
array validation, string formats (email, URL, UUID), type coercion from
query-string strings — and a mature library has already hardened all of
it. Hand-rolling this teaches nothing the DI container's token/lifetime
design didn't already teach about building primitives from scratch; it's
just a large amount of tedious edge-case work for a feature whose value is
in being *correct*.

**Recommendation: [Zod](https://zod.dev).** TypeScript-first, gives real
compile-time type inference via `z.infer<typeof schema>` — something
Empire cannot offer anywhere today (`ctx.jsonBody()` returns `unknown`) —
and has no side effects on the rest of the framework; it would only ever
be imported by the validation module, never by `Router`, `Context`,
`Empire`, or `src/di/`.

**Packaging decision (§8, 2026-08-19): `zod` is a regular `dependency`,
not a `peerDependency`.** The `peerDependency` idea below was the original
plan, to avoid forcing every Empire install to pull in Zod even if an app
never validates anything - but that concern only matters for *downstream
npm consumers*, and Empire isn't published to npm (see README.MD's Status
section), so there currently are none to protect. This is a scoped
exception, not a policy change — `src/di/`, `src/routing/`, `src/http/`,
etc. all stay exactly as dependency-free as they are today; only
`src/validation/` and the errors it throws depend on Zod.

### 2.2 Core API — wrapping a handler, not touching Router or Context

Same shape `LoggerMiddleware.ts` already uses (`createLoggerMiddleware(logger)`
— a factory returning something Empire's existing types already accept).
`validate()` wraps a handler and returns a plain `RouteHandler`, so it
needs zero changes to `Router.ts`'s registration methods or `Context`'s
frozen API:

```ts
// src/validation/validate.ts
import { ZodType } from "zod";
import { Context } from "../http/Context";
import { RouteHandler } from "../types";
import { ValidationError } from "./ValidationError";

interface ValidationSchemas<TBody, TQuery, TParams> {
    body?: ZodType<TBody>;
    query?: ZodType<TQuery>;
    params?: ZodType<TParams>;
}

interface Validated<TBody, TQuery, TParams> {
    body: TBody;
    query: TQuery;
    params: TParams;
}

export function validate<TBody = undefined, TQuery = undefined, TParams = undefined>(
    schemas: ValidationSchemas<TBody, TQuery, TParams>
) {
    return (
        handler: (ctx: Context, data: Validated<TBody, TQuery, TParams>) => void | Promise<void>
    ): RouteHandler =>
        async (ctx) => {
            const body = schemas.body
                ? parseOrThrow(schemas.body, await ctx.jsonBody(), "body")
                : (undefined as TBody);

            const query = schemas.query
                ? parseOrThrow(schemas.query, Object.fromEntries(ctx.query), "query")
                : (undefined as TQuery);

            const params = schemas.params
                ? parseOrThrow(schemas.params, ctx.params, "params")
                : (undefined as TParams);

            return handler(ctx, { body, query, params });
        };
}

function parseOrThrow<T>(schema: ZodType<T>, value: unknown, location: string): T {
    const result = schema.safeParse(value);

    if (!result.success) {
        throw new ValidationError(
            result.error.issues.map((issue) => ({
                field: `${location}.${issue.path.join(".")}`,
                message: issue.message,
            }))
        );
    }

    return result.data;
}
```

One real technical detail worth calling out: `ctx.query` is a
`URLSearchParams`, not a plain object, and every value in it is a string —
`Object.fromEntries(ctx.query)` converts it to something Zod can validate
as an object, but a query param intended as a number (`?page=2`) arrives
as the string `"2"`. Schemas for query validation need `z.coerce.number()`
rather than `z.number()` to account for this; `ctx.params` has the same
all-strings characteristic for the same reason (both come off a raw URL).

### 2.3 Error handling — `ValidationError`

`PLAN.md`'s Phase 11 task list names this `ValidationException`. Empire's
existing convention is the `Error` suffix (`HttpError`, `BadRequestError`),
not `Exception` — recommend `ValidationError`, flagged explicitly here so
the naming departure from the roadmap's original wording is a conscious
choice, not a doc that quietly drifted from the plan (see §7).

```ts
// src/validation/ValidationError.ts
import { BadRequestError } from "../errors/BadRequestError";

export interface ValidationIssue {
    field: string;
    message: string;
}

export class ValidationError extends BadRequestError {
    public readonly details: ValidationIssue[];

    constructor(details: ValidationIssue[]) {
        super(details.map((d) => `${d.field}: ${d.message}`).join("; "));
        this.name = "ValidationError";
        this.details = details;
    }
}
```

Extends `BadRequestError` rather than `HttpError` directly — it already
*is* a 400, this is just a more specific reason for one. The `message`
stays a single readable string (so `Router`'s existing error handling
needs no changes at all for the base case), but `details` carries the
structured per-field breakdown for anything that wants it.

`sendErrorResponse.ts` needs one small, additive change: when the caught
error is a `ValidationError`, include `details` in the JSON body alongside
the existing `error` field. Any other `HttpError` (including plain
`BadRequestError`) is completely unaffected — this is purely additive to
an existing, already-shipped file.

```json
{
    "error": "body.email: Required; body.name: name is required",
    "details": [
        { "field": "body.email", "message": "Required" },
        { "field": "body.name", "message": "name is required" }
    ]
}
```

## 3. Build order / milestones

- [x] **V-1: `ValidationError`** — extends `BadRequestError`, carries structured `details`. `ValidationIssue` split into its own file per the one-type-per-file convention
- [x] **V-2: `sendErrorResponse.ts` extended** — additive `details` field in the JSON body when the error is a `ValidationError`; every other `HttpError` keeps its existing `{ error }`-only shape, verified by a dedicated test
- [x] **V-3: `validate()`** — the wrapper in §2.2, `zod` added as a real `dependency` (not a `peerDependency` - see §7, decided rather than left open)
- [x] **V-4: Example** — `examples/10-validation/server.ts` (port 8010): body validation (`POST /users`), query validation with coercion (`GET /search`), and route param validation (`GET /records/:id`), all verified by actually running the server and curling every pass/fail case, not just compiling
- [x] **V-5: Tests** — see §5
- [x] **V-6: README section** — "Validation" section added to `src/empire/README.MD`, linked from the Examples table

## 4. Examples

The create-user example this doc grew out of:

```ts
import { z } from "zod";
import { validate } from "../../src/validation/validate";

const createUserSchema = z.object({
    name: z.string().min(1, "name is required"),
    email: z.string().email("email must be a valid address"),
    age: z.number().int().min(13, "must be at least 13").optional(),
});

app.post("/users", validate({ body: createUserSchema })(async (ctx, { body }) => {
    // body.name: string, body.email: string, body.age: number | undefined
    // - already validated, no casts, no manual checks
    const user = await repo.create(body);
    ctx.status(201).json(user);
}));
```

Query validation, showing the string-coercion detail from §2.2:

```ts
const searchQuerySchema = z.object({
    q: z.string().min(1),
    page: z.coerce.number().int().min(1).default(1),
});

app.get("/search", validate({ query: searchQuerySchema })(async (ctx, { query }) => {
    // query.page is a real number, even though it arrived as "?page=2"
    const results = await search(query.q, query.page);
    ctx.json(results);
}));
```

## 5. Tests

Minimum coverage:

- [x] Valid body passes through with the schema's inferred type, unchanged — `tests/unit/validation/validate.test.ts`, `tests/integration/Validation.test.ts`
- [x] Missing required body field throws `ValidationError` (400) naming the field
- [x] Invalid format (e.g. malformed email) throws `ValidationError` naming the field and reason
- [x] Optional field omitted from the body resolves to `undefined`, not an error
- [x] Query string values are coerced per schema (`z.coerce.number()` turns `"2"` into `2`) — verified over a real request in `tests/integration/Validation.test.ts`
- [x] Route params validate the same way as query params (both all-string sources)
- [x] A route validating body **and** query **and** params simultaneously surfaces all three correctly on success, and the first failing one on failure
- [x] `sendErrorResponse.ts` includes `details` in the response body for a `ValidationError`, and does **not** include it for a plain `BadRequestError` or other `HttpError` — `tests/unit/errors/sendErrorResponse.test.ts`
- [x] `ValidationError.message` reads as one readable string even with multiple field failures — `tests/unit/errors/ValidationError.test.ts`

One real thing found while writing these tests, not in the original list:
Zod's custom `.min(1, "...")` message only fires when a field is *present
but empty* — when a field is missing entirely, Zod's own base type-check
message ("Invalid input: expected string, received undefined") wins
instead, and the custom message never runs. `tests/integration/Validation.test.ts`
has both cases as separate tests specifically because of this, rather than
assuming one covers the other.

## 6. Guardrails (over-engineering risk)

- No custom validation DSL on top of Zod — if Zod can express it, use Zod's own API rather than wrapping it further
- No automatic OpenAPI/schema generation from these Zod schemas in v1 — that's Phase 18 territory (`OpenAPI generation`), a separate, much later concern
- No decorator-based validation (`@IsEmail()` etc.) — Phase 14 (Controllers) hasn't started, and class-validator-style decorators would need the same `reflect-metadata` conversation already settled against for DI
- Scope stays exactly what `PLAN.md`'s Phase 11 lists: body, query, route params. No header or cookie validation in v1

## 7. Open questions / parking lot

Both questions this doc raised at Draft stage got resolved during the
build - see §8. One remains genuinely open:

- Should `ValidationError`'s `details` array be exposed as a fully public, documented response shape (i.e. a client can rely on it), or an informal debugging aid that could change shape later without being a breaking change? Currently documented in README.MD as if it's the former, but no explicit versioning/stability guarantee has been made about it the way Context's API is explicitly frozen for v1.

## 8. Decisions log

- **2026-08-19** — Spec created. Recommends Zod over a hand-rolled validator (§2.1) and `ValidationError extends BadRequestError` with an additive `details` field (§2.3), reusing Empire's existing `HttpError`/`sendErrorResponse.ts` pipeline rather than introducing a parallel error-handling path. Dependency packaging (§7) and the `ValidationError`/`ValidationException` naming departure from `PLAN.md` are both explicitly left open, not decided by this doc alone.
- **2026-08-19** — Dependency packaging resolved: `zod` added as a regular `dependency` in `package.json` (option 1 of §7's three, not the `peerDependency` §2.1 originally recommended). Reasoning: the `peerDependency` option exists to protect *downstream npm consumers* from an unwanted transitive dependency - but Empire is not published to npm (see README.MD's Status section), so there currently are no such consumers to protect. This can be revisited if/when Empire is ever actually published; nothing about `validate()`'s own API depends on which packaging option is used, so switching later is a `package.json`-only change.
- **2026-08-19** — Naming resolved: `ValidationError`, not `PLAN.md`'s original `ValidationException`, confirmed as final (not just recommended) - `PLAN.md`'s Phase 11 section now cross-references this doc and explains the departure, so it's not silent drift.
- **2026-08-19** — `ValidationIssue` (the `{ field, message }` shape) was split into its own file, `src/errors/ValidationIssue.ts`, rather than living inside `ValidationError.ts` as §2.3's snippet showed - required by the one-type-per-file convention in `CONTRIBUTING.md`/`doc/ARCHITECTURE.md`, same treatment every DI type got.
- **2026-08-19** — `ValidationSchemas` and `Validated` (§2.2's snippet) were likewise split into their own files under `src/validation/`, for the same one-type-per-file reason - `validate.ts` itself keeps only the `validate()` function and its private `parseOrThrow()` helper, the same pattern `ServiceCollection.ts`'s private `crash()` helper already established for DI.
- **2026-08-19** — Real behavior found while writing tests, not anticipated by this doc: Zod's custom `.min(1, "message")` only fires when a field is *present but empty*; a field that's missing entirely fails Zod's own base type check first, with Zod's own message, not the custom one. Documented in §5 and covered by separate tests for each case in `tests/integration/Validation.test.ts` rather than assuming one test covers both.
