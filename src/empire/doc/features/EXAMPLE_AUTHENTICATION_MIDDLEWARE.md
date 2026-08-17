# Empire: Example Authentication Middleware

Replace the `AuthMiddleware` stub with a worked example that shows a
developer how to write their own authentication middleware for Empire.

Repository root for all paths below is `src/empire`.

## Dependency

This work requires `ctx.state` to exist on `Context`. It is Part 1 of the
middleware build spec. If `Context` does not yet have a `state` property,
stop and do that first, then return here.

## Working principles

* Readability over cleverness. This file's whole purpose is to be read by
  someone learning the framework. Optimise for that over everything else.
* No decorators.
* Do not change the `Middleware` type in `src/types.ts`.
* Do not add this to framework source. It belongs in `examples/`, not `src/`.
* Tests must pass. Run `npx tsc --noEmit` and `npx vitest run` from
  `src/empire`. Both green before you finish.
* Plain hyphens only. No em dashes or en dashes in code, comments, docs or
  commit messages.
* If you disagree with an approach here, say so before implementing rather
  than quietly doing something different.

## Background: why this is an example and not a feature

The framework should own the mechanical parts of authentication that every
application does identically: parsing the `Authorization` header, rejecting
malformed input, returning a correctly formed 401. It should not own the
decision about what counts as a valid credential, because only the
application knows about its own users, token format and storage.

Rather than shipping a framework middleware with a pluggable callback, this
ships as an example. The reason is that Empire already gives a developer
everything needed to write this in about twenty lines of their own code:
middleware that throws `HttpError(401)` already produces a correct JSON
response through the existing pipeline. A framework wrapper around a
callback would add maintained surface area for very little gain. An example
teaches the shape and leaves the developer in control.

### The copy-paste risk

Example authentication code is the most copy-pasted kind of file in any
framework repository. Someone will lift this into a real application. The
file must therefore be useful as a shape and obviously unusable as an
implementation. Every instruction below about naming, comments and warnings
exists for that reason. Do not soften them.

## Task 1: Remove the stub

Delete `src/middleware/AuthMiddleware.ts`.

It currently contains `const authorized = true;` and always calls `next()`.
It is a placeholder that reads as either an unfinished feature or, less
charitably, as authentication that silently approves every request.

Find and update every import of it. Check at minimum:

* `examples/03-middleware/server.ts`
* `tests/unit/middleware/BuiltInMiddleware.test.ts`
* Any usage in `README.MD`

If `examples/03-middleware/server.ts` uses it to demonstrate pipeline
ordering or short-circuiting, replace that usage with a small inline
middleware defined in the example itself, so the example still teaches
ordering without depending on framework internals that no longer exist.

If `tests/unit/middleware/BuiltInMiddleware.test.ts` covers only the stub
and `LoggerMiddleware`, and both are being removed, delete the test file
rather than leaving an empty describe block. If it covers something still
in use, remove only the relevant tests.

Commit this separately from the rest so the deletion is legible in history.

## Task 2: Build the example

New directory `examples/08-authentication/` containing a single
`server.ts`, matching the pattern of the other examples.

### File header comment

The file must open with a comment block. It needs to say, in plain
language:

* This is an example of how to write authentication middleware for
  Empire, not an authentication system.
* The token store is hardcoded and the tokens are plaintext. Never do
  this in a real application.
* A real implementation needs, at minimum: credentials stored hashed
  rather than in plaintext, token expiry, a real user store, and
  constant-time comparison to avoid timing attacks.
* The part worth copying is the shape, meaning where the middleware sits,
  how it rejects, and how it hands the authenticated user to route
  handlers. The token checking logic is deliberately trivial and is not
  the point.

Write this as clear prose, not a bulleted warning block. It should read
like a person explaining a decision.

### The fake token store

```typescript
interface DemoUser {
    id: string;
    name: string;
    active: boolean;
}

// Hardcoded plaintext tokens. See the warning at the top of this file:
// this stands in for a real user store so the example stays readable.
const FAKE_TOKENS: Record<string, DemoUser> = {
    "alice-token": { id: "1", name: "Alice", active: true },
    "bob-token": { id: "2", name: "Bob", active: false },
};
```

The naming matters. `FAKE_TOKENS` is unmistakable if it ever appears in a
real diff or code review. Do not rename it to something more neutral.

### The three cases, and why they were chosen

The example must demonstrate exactly these three outcomes:

1. `alice-token` is a known token belonging to an active user. The
   request proceeds.
2. `bob-token` is a known token belonging to a user whose account is
   disabled. The request is rejected.
3. Anything else is an unknown token. The request is rejected.

Case 2 is the important one and must not be simplified away. If the
example only had one valid token and one junk string, a reader would
conclude that authentication is a map lookup. Rejecting a token that is
in the store makes it obvious that the decision belongs to the
application, and that this is where the reader's own logic goes. Add a
short comment at that branch saying so.

### Middleware behaviour

The middleware must:

1. Read the `authorization` request header.
2. Reject when it is absent.
3. Reject when it is present but does not use the Bearer scheme.
4. Extract the token.
5. Look it up. Reject when unknown.
6. Reject when the user is found but not active.
7. On success, put the user on `ctx.state.user` and call `next()`.

A reference implementation, satisfying every point above plus the details
in the next section:

```typescript
const PUBLIC_PATHS = ["/public"];

function unauthorized(ctx: Context): never {
    ctx.res.setHeader("WWW-Authenticate", "Bearer");
    throw new HttpError(401, "Invalid or missing credentials");
}

const authMiddleware: Middleware = (ctx, next) => {

    // Empire does not yet support per-route middleware, so this is how a
    // path gets excluded from an app.use() middleware that otherwise runs
    // for every request. A real framework would let you scope this to a
    // route group instead. Using ctx.path here, not ctx.req.url, so this
    // check agrees with what the rest of the app sees as "the path" - see
    // the note below on why that also means this middleware can throw on
    // a malformed URL before auth logic even runs.
    if (PUBLIC_PATHS.includes(ctx.path)) {
        return next();
    }

    // Node lowercases every incoming header name, so
    // ctx.headers["Authorization"] would silently always be undefined.
    const header = ctx.headers.authorization;

    // A duplicated header yields an array rather than a string.
    if (typeof header !== "string") {
        unauthorized(ctx);
    }

    // RFC 9110 defines the auth scheme as case-insensitive, so "bearer",
    // "Bearer" and "BEARER" are all valid. Split on the first space only,
    // rather than on all whitespace, so a token is never assumed to be
    // exactly one word.
    const spaceIndex = header.indexOf(" ");
    const scheme = spaceIndex === -1 ? header : header.slice(0, spaceIndex);
    const token = spaceIndex === -1 ? "" : header.slice(spaceIndex + 1);

    if (scheme.toLowerCase() !== "bearer" || !token) {
        unauthorized(ctx);
    }

    const user = FAKE_TOKENS[token];

    // A token that is simply not in the store, and a token that belongs
    // to a real but disabled user, are different situations server-side
    // but must produce an identical response. Telling a caller "that
    // account is disabled" instead of a generic rejection confirms the
    // token was real, which is exactly what an attacker probing tokens
    // would want to know.
    if (!user || !user.active) {
        unauthorized(ctx);
    }

    // Throwing HttpError here, rather than writing the response by hand,
    // means this 401 goes through the exact same pipeline as every other
    // error Empire produces - same JSON shape, same status handling.
    ctx.state.user = user;

    return next();
};
```

### Details that must be correct, because they will be copied

Header lookup must be lowercase. Node lowercases every incoming header
name, so `ctx.headers["Authorization"]` returns `undefined` always, and
does so silently.

Header values may be `string | string[]`. A duplicated header yields an
array. Guard with a `typeof` check rather than casting to string.

Scheme matching must be case-insensitive. RFC 9110 defines the auth
scheme as case-insensitive, so `bearer`, `Bearer` and `BEARER` are all
valid. Match accordingly. Split the header on the first space only; do
not assume exactly two parts after splitting on all whitespace.

Reject by throwing `HttpError(401)`, not by writing the response by
hand. Empire's pipeline already converts a thrown `HttpError` into a
JSON response with the right status. Using it means the example's error
output matches every other error the framework produces. Add a comment
saying this explicitly, because it teaches the reader something about
Empire that is not obvious from the outside.

Set `WWW-Authenticate: Bearer` on the 401. RFC 9110 section 11.6.1
requires a 401 response to carry this header, and almost every homegrown
implementation omits it. Because the rejection path throws rather than
writing the response, the header must be set on `ctx.res` before the
throw. Add a brief comment noting the ordering requirement.

Do not distinguish "unknown token" from "disabled account" in the
response message. Both should return the same generic message to the
client. Telling an attacker that a token is real but the account is
disabled is an information leak. Log the difference server-side if you
like, but keep the response identical. This is worth a comment, since it
is exactly the kind of thing a reader would otherwise get wrong when
adapting the example.

### Routes

The example server needs three routes to make the effect visible:

* `GET /public` registered so that it is not covered by the auth
  middleware. Returns something trivial. Its purpose is to prove that
  unauthenticated requests still work where auth is not applied.
* `GET /protected` returns data and reads the authenticated user from
  `ctx.state.user`.
* `GET /me` returns the authenticated user directly. This is the
  clearest demonstration of the handoff: the middleware resolved an
  identity and a completely separate function consumed it.

Reading `ctx.state.user` requires narrowing, since `state` is
`Record<string, unknown>`. Show the narrowing honestly in the handler
rather than casting with `as`. This is a real ergonomic cost of the
untyped state bag and the example should not hide it:

```typescript
function isDemoUser(value: unknown): value is DemoUser {
    return typeof value === "object"
        && value !== null
        && "id" in value
        && "name" in value
        && "active" in value;
}

app.get("/me", (ctx) => {
    const user = ctx.state.user;

    // A cast with "as" would compile even if ctx.state.user were the
    // wrong shape, or missing entirely - authMiddleware runs on this
    // path, so this should never actually fail, but the type system has
    // no way to know that, and the check is what keeps it honest.
    if (!isDemoUser(user)) {
        throw new HttpError(500, "Expected an authenticated user on ctx.state");
    }

    ctx.json(user);
});
```

### The application-wide versus per-route problem

Empire's `app.use()` registers middleware for every request. There is
currently no way to apply middleware to a subset of routes, so a naive
example would protect `/public` too, contradicting its own purpose.

Handle this by having the middleware check the request path and skip a
small list of public paths before doing any auth work. Implement it
plainly, for example an array of public path strings and an early
`return next()` when the current path is in it.

Add a comment explaining that this is a workaround for Empire not yet
supporting per-route middleware, and that a real framework would let you
scope middleware to a route group. Being upfront about a framework
limitation in your own example is more credible than quietly working
around it, and it flags the gap for future work.

Use `ctx.req.url` split on `?`, or `ctx.path`, for this check. If you use
`ctx.path`, note that it calls `decodeURIComponent` and can throw
`URIError` on a malformed percent sequence, which would surface as a 500
from the auth middleware. Choose one, and say in a comment why.

### Bottom-of-file usage notes

End the file with a comment block giving copy-pasteable curl commands
for all four cases: no header, `alice-token`, `bob-token`, and an
unknown token, plus a hit on `/public`. State the expected status code
for each. The other examples should be checked for their existing
convention here; follow it if one exists.

## Task 3: Tests

New file `tests/integration/ExampleAuth.test.ts`.

Test the middleware behaviour, not the example's route wiring. If
extracting the middleware function from the example file for
testability would clutter the example, define an equivalent middleware
inside the test file and note in a comment that it mirrors the example.
Prefer importing from the example if it can be done cleanly.

Cases:

* No `Authorization` header returns 401.
* A header not using the Bearer scheme returns 401.
* `bearer alice-token` in lowercase succeeds, proving case-insensitive
  scheme matching.
* An unknown token returns 401.
* `bob-token`, a known token for an inactive user, returns 401.
* The 401 response carries a `WWW-Authenticate` header.
* The rejection message is identical for the unknown-token and
  inactive-user cases. Assert the bodies match rather than checking each
  against a literal, so the test fails if they ever diverge.
* A successful request reaches the handler and `ctx.state.user` holds
  the expected user.
* A request to a public path succeeds with no `Authorization` header at
  all.

Use `tests/fixtures/http/MockHttp.ts` where a mock suffices. Use a real
server over a real socket for the header assertions, since header
behaviour is exactly the kind of thing mocks get wrong. Follow the port
allocation pattern used in the existing integration tests.

## Task 4: Documentation

Add a short section to `README.MD` covering authentication.

It should state that Empire does not ship authentication middleware,
explain briefly why (the framework owns the pipeline mechanics, the
application owns the credential decision), point at
`examples/08-authentication`, and show a minimal snippet of the shape:
throw `HttpError(401)` to reject, set `ctx.state.user` to pass the
identity downstream.

Follow the style of the existing sections: brief prose, a worked
snippet, and an honest note about sharp edges. The per-route middleware
limitation belongs in that note.

Also check whether the existing examples list in `README.MD` enumerates
examples by number. If it does, add this one. If the earlier
documentation pass added a table of all examples, add a row.

Do not document anything not implemented.

## When you are done

Report:

1. What you built and what you deleted.
2. Every file that imported `AuthMiddleware` and how you handled each
   one.
3. Anything you disagreed with and what you did instead.
4. Results of `npx tsc --noEmit` and `npx vitest run`.
5. Anything you found along the way not covered here, particularly
   other stubs or placeholders in framework source.
