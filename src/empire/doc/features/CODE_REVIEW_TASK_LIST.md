# Empire: Code Review Task List

Findings from a review of `src/empire/src` at commit 77 on `main`. Ordered
by value, highest first. Each task states the problem, where it lives, and
a suggested solution. Suggestions are starting points, not specifications.
If you disagree with an approach, say so before implementing it.

## Working principles

These apply to every task below.

* Readability over cleverness. If a simpler version is slightly longer but
  obvious on first read, take the longer version.
* No decorators. Not now, not as a stepping stone toward anything.
* No new features. This is a refactor and correctness pass. Do not add
  capabilities that are not already implemented.
* No public API changes without flagging first. If a task seems to require
  changing a signature on `Empire`, `Context` or `Router`, stop and explain
  why before proceeding.
* Tests must pass after every task. Run `npx tsc --noEmit` and
  `npx vitest run` from `src/empire`. Both must be green before you move to
  the next task.
* One commit per task. Clear messages. Reference the task number.
* Plain hyphens only. No em dashes or en dashes in code comments,
  documentation, or commit messages.

## Task 1: Extract the duplicated file streaming block

**Priority: high**

### Problem

`Context.sendFile()` in `src/http/Context.ts` and
`StaticFileHandler.sendFile()` in `src/static/StaticFileHandler.ts`
contain the same roughly 35 line streaming block, duplicated near
verbatim: the same `cleanup`, `onFinish`, `onClose` and `onError`
handlers, the same `stream.pipe()`, and the same comment about the client
disconnecting mid stream.

This is the subtlest code in the repository. It handles a genuine failure
mode (an aborted download leaving a promise pending forever and leaking a
file descriptor) and it is correct in both places. That is the problem: a
future fix or improvement to one copy will not reach the other, and the
fact that it is correct today makes the divergence easy to miss.

### Suggested solution

Create `src/http/streamFile.ts` exporting a single function:

```typescript
export function streamFileToResponse(
    res: http.ServerResponse,
    filePath: string
): Promise<void>
```

Move the promise, the four handlers and the pipe into it. Both call sites
keep their own logic for what happens before the stream starts, since it
genuinely differs:

* `Context.sendFile` stats the file, throws `HttpError(404)` when missing,
  sets `Content-Type` and `Content-Length`.
* `StaticFileHandler.sendFile` stats the file, sets the same two headers,
  and returns early for `HEAD` without streaming at all.

Only the streaming itself moves. Keep the explanatory comment about
`close` versus `finish` with the extracted function, since that is where
it now belongs.

Consider whether the file location is right. `src/http/` is reasonable
given it operates on a `ServerResponse`. Do not put it in `src/static/`,
since `Context` is not static file specific.

## Task 2: Extract the duplicated error to response conversion

**Priority: high**

### Problem

The catch block in `Empire.handleRequest()` and the catch block in
`Router.invokeHandler()` implement the same logic:

1. Log the error.
2. Check `headersSent` and bail if the response has already started.
3. If the error is an `HttpError`, respond with its status code and
   `{ error: message }` as JSON.
4. Otherwise respond 500 with `{ error: "Internal Server Error" }`.

Two copies means the error response shape is defined twice. Adding a
field, changing the content type, or including `HttpError.code` in the
body currently requires remembering both places.

### Suggested solution

Add a shared function, for example `src/errors/sendErrorResponse.ts`:

```typescript
export function sendErrorResponse(
    res: http.ServerResponse,
    err: unknown,
    logger: ILogger,
    logMessage: string
): void
```

Call it from both catch blocks. The two call sites pass different log
messages ("Unhandled middleware error" and "Unhandled route error"), which
is worth preserving because it tells you where the error came from, so
keep that as a parameter rather than hardcoding it.

Note while you are here: `HttpError` carries `code` and `retryable` fields
that never reach the response body. That may be deliberate. Do not change
the response shape as part of this task, but mention it in your summary so
a decision can be made separately.

## Task 3: Break up `Router.handle()`

**Priority: high**

### Problem

`Router.handle()` in `src/routing/Router.ts` runs to about 70 lines and
carries seven responsibilities: matching routes, accumulating the allowed
method set, rewriting `HEAD` to `GET`, dispatching to a handler, answering
`OPTIONS` automatically, returning 405 with an `Allow` header, running the
fallback, and returning 404.

The logic is correct and the comments are good. The problem is purely
that the whole decision tree has to be held in your head at once, and the
matching loop is interleaved with the response decisions that follow it.

### Suggested solution

Separate finding from deciding. Extract a private method along the lines
of:

```typescript
private findRoute(requestPath: string, method: string): {
    route?: Route;
    params: Record<string, string>;
    allowedMethods: Set<string>;
}
```

It owns the loop, the matcher calls, the `allowedMethods` accumulation
including the implicit `HEAD` entry, and nothing else.

`handle()` then reads as a short sequence: find, then dispatch if matched,
then automatic `OPTIONS`, then 405, then fallback, then 404. Each branch
becomes two or three lines.

Keep the existing doc comments and RFC references. Redistribute them to
whichever method now owns the behaviour they describe rather than leaving
them all on `handle()`.

## Task 4: Replace the `discardBody` monkey patch

**Priority: medium**

### Problem

`Router.discardBody()` reassigns `res.write` and `res.end` on a live
`ServerResponse` so that a matched `GET` handler can run unchanged for a
`HEAD` request while its body is silently dropped.

Meanwhile `StaticFileHandler.sendFile()` handles `HEAD` differently and
more directly: it checks `ctx.method === "HEAD"`, sets the headers, calls
`res.end()` and returns without opening a read stream at all.

Two strategies for one concern. The monkey patch is the clever one, and it
is the one that will surprise a reader, since after it runs the response
object no longer behaves the way the Node documentation says it does. It
also does strictly more work: the handler runs, a file may be opened and
read, and the bytes are then thrown away.

### Suggested solution

There is a real trade off here, so read both options before choosing.

Option A, keep the current behaviour, make it explicit. The monkey patch
exists because RFC 9110 section 9.3.2 requires `HEAD` to return exactly
the headers `GET` would, including `Content-Length`, and running the real
handler is the only way to guarantee that for dynamic responses. If you
keep it, at minimum move it out of `Router` into a clearly named helper,
for example `src/http/suppressResponseBody.ts`, with a comment stating
plainly that it mutates the response object and why no simpler approach
preserves header accuracy.

Option B, converge on the explicit check. Handlers that call `ctx.file()`
or `ctx.json()` could check `ctx.method === "HEAD"` at the point of
writing the body, matching what `StaticFileHandler` already does. This is
cleaner but pushes responsibility onto every response method in `Context`,
and risks a handler that computes headers by hand getting it wrong.

I lean toward Option A, since correctness of `Content-Length` matters more
than avoiding one mutation, and Option B spreads the concern across more
code. But make the call yourself and explain your reasoning. Whichever you
pick, the two strategies should be documented as a single deliberate
decision rather than looking accidental.

## Task 5: Deal with the stub middleware

**Priority: medium**

### Problem

`src/middleware/AuthMiddleware.ts` is a stub. It contains
`const authorized = true;` and always calls `next()`. It is shipped in
framework source, not in examples, and its name promises authentication.
A reader encountering it sees either an unfinished feature or, read less
charitably, authentication that silently approves every request.

`src/middleware/LoggerMiddleware.ts` has a smaller problem: it calls
`console.log` directly, bypassing the `ILogger` abstraction the rest of
the framework is built around. A server constructed with a custom logger
still gets raw console output from this middleware.

### Suggested solution

For `AuthMiddleware`, pick one and say which:

* Delete it. It can return when real authentication is implemented.
* Move it to `examples/` as a worked example of writing a middleware that
  short circuits the pipeline, renamed to something that does not claim
  to be auth.

Do not leave it in `src/middleware/`.

For `LoggerMiddleware`, it cannot reach the server's logger through the
current `Middleware` signature, which receives only `ctx` and `next`. Do
not change that signature as part of this task. The straightforward fix
is a factory:

```typescript
export function createLoggerMiddleware(logger: ILogger): Middleware
```

Flag this before implementing, since it changes how the middleware is
registered.

## Task 6: Fix `package.json`

**Priority: medium, but trivial**

### Problem

`src/empire/package.json` contradicts the documentation and itself:

* `"license": "ISC"`, while `README.MD` states MIT.
* `"main": "index.js"`, a file that does not exist anywhere in the
  repository.
* `"description"`, `"author"` and `"keywords"` are all empty.

The license contradiction is the one that matters. Two files making
different claims about the licence terms is worse than neither making a
claim.

### Suggested solution

Set `"license": "MIT"` to match the README, and add a `LICENSE` file at
the repository root with the standard MIT text, copyright Roman,
current year.

Fill in `description` from the repository description. Set `author`. Add
keywords such as `typescript`, `http`, `web-framework`, `middleware`.

For `main`: the package has no build output and no entry point, and is
not published. Either point it at the real entry (`src/Empire.ts`, though
that is TypeScript source) or remove the field until there is a build
step. Removing it is honest and I would prefer that, but flag which you
chose.

## Task 7: Return 400, not 500, for malformed request paths

**Priority: medium**

### Problem

`RouteMatcher.splitRequestSegments()` calls `decodeURIComponent()` on
every segment. A malformed percent sequence such as `%zz` throws a
`URIError`, which propagates up through `Router.handle()` to the pipeline
level catch in `Empire.handleRequest()` and becomes a 500.

A malformed URL is a client error. 500 tells the client the server is
broken when the request was.

Worse, the status depends on unrelated state.
`tests/integration/MalformedRequestPath.test.ts` documents this:
`/users/%zz` returns 500 when a route is registered (the matcher runs and
throws), but `/other/%zz` returns 404 when no routes exist (the loop
never runs, so nothing decodes). Same malformed input, different status,
determined by whether some other route happens to be registered.

`Context.path` has the same exposure, since it also decodes and is used
by `StaticFileHandler`.

### Suggested solution

Catch `URIError` where decoding happens and convert it to a client error.

In `splitRequestSegments()`, wrap the decode. Returning `null` (the
existing signal for an unmatchable path, already used for doubled
slashes) would give a 404, which is defensible and requires no other
change. Throwing `BadRequestError` gives a 400, which is more accurate. I
would prefer 400, since it distinguishes "you sent a malformed request"
from "that resource does not exist", but either beats 500.

Whichever you choose, apply the same treatment in `Context.path` so a
static file request behaves the same way as a routed one, and make sure
the outcome no longer depends on how many routes are registered.

`MalformedRequestPath.test.ts` asserts the current 500 and 404 behaviour
and will need updating. Read its comments first: they are careful about
why the second case behaves differently, and that reasoning should
survive into the revised test.

## Task 8: Remove the `any` cast in `Context.addHeaders`

**Priority: low**

### Problem

`Context.addHeaders()` casts to `any` when calling `setHeader`, with a
comment noting that `IncomingHttpHeaders` values may be
`string | string[]`.

### Suggested solution

The real signature accepts `string | number | readonly string[]`.
Narrowing the value to that type removes the escape hatch without
changing behaviour. Small, but it is the only `any` in the codebase and
worth keeping it that way.

## Not tasks, but worth knowing

`Context` is at 362 lines and currently holds request accessors, response
builders, body parsing, cookies and file serving. Task 1 takes a bite out
of it. Do not split it further yet: there is no obvious seam, and
splitting for its own sake would make the API harder to follow. Worth
revisiting if it grows past roughly 450 lines.

Route matching is a linear scan through registered routes, with segment
by segment comparison rather than compiled regexes. For the number of
routes a framework of this size will see, this is the right call: it is
readable, has no compilation step, and the performance difference is
irrelevant. No change wanted.

The `//` rejection in `splitRequestSegments` deliberately refuses to
collapse doubled slashes rather than silently matching a shorter path.
That is a good decision and the comment explains it well. Leave it alone.

## When you are done

Report back with:

1. What you changed, per task.
2. Any task where you disagreed with the suggested solution, and what you
   did instead.
3. Any task you chose not to do, and why.
4. Anything you found while working that is not on this list.
5. Confirmation that `npx tsc --noEmit` and `npx vitest run` both pass.
