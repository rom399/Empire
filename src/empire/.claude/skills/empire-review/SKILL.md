---
name: "empire-review"
description: "Pre-PR review of changed files against Empire's CONTRIBUTING.md conventions - one class per file, filename matches the class, JSDoc on public members, no magic numbers, no new runtime dependencies. Use before opening a pull request, when the user asks to review changes against project conventions, or asks \"is this ready for PR\" or \"does this follow our conventions\"."
---

Check every changed file against `CONTRIBUTING.md` before a PR is opened. Report findings, don't just fix silently - the user decides what's worth changing.

## Checklist

- **One class, interface, or enum per file** - no file defines more than one of these. A tightly-coupled factory function living alongside its concept (like `createLoggerMiddleware` in `LoggerMiddleware.ts`) is the one established exception, not a license to bundle unrelated types together.
- **Filename matches the type name exactly** - `ServiceCollection.ts` contains only `ServiceCollection`, no exceptions.
- **`I`-prefixed interfaces** - `IServiceCollection`, not `ServiceCollectionInterface` or unprefixed.
- **JSDoc on every public class, method, and property** - comments explain *why*, not *what*; no inline comments unless the reasoning is genuinely non-obvious.
- **No magic numbers or strings** - named constants instead (`DEFAULT_PORT`, `MAX_BODY_SIZE`), not bare literals scattered through logic.
- **No new runtime dependencies** - `zod` is the one existing exception, already agreed on and scoped to `src/validation/`. Flag any new `dependencies` entry in `package.json` as something requiring explicit sign-off, not something to wave through.
- **No deeply nested code** - flat, early-return style over nested callbacks or chained `.then()`.
- **Constructor injection only** - no service locator pattern.
- **A test file exists for every new or changed class**, mirroring its path under `tests/unit/`, covering failure cases as well as the golden path.
- **Examples touched or added actually run** - not just compile. If a PR adds or changes `examples/`, confirm `npm run examples` (or the specific example) was actually executed, not just written.

## Output

List findings grouped by file, each naming the specific rule violated - not a vague "cleanup needed." If everything's clean, say so plainly rather than inventing nitpicks to seem thorough.
