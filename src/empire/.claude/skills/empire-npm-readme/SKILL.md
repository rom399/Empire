---
name: "empire-npm-readme"
description: "Audit and update src/empire/README.MD - the file npm bundles for the empire-ts package - so every link and example matches what actually ships. Use before an npm publish, or after examples/ or package-example/ change, or when the user asks to sync/update/review the npm README."
---

`src/empire/README.MD` is the only file npm auto-bundles from the package root (alongside `LICENSE` and, since it's explicitly listed in `package.json`'s `files`, `CHANGELOG.md`). It is read by people who ran `npm install empire-ts` and never cloned the repo - a relative link that works fine on GitHub can be silently broken for that reader if it points at something outside what actually ships.

## 1. Check every link's reach, not just that it points somewhere real

- If the target is **in `package.json`'s `files`** (`dist/`, `CHANGELOG.md`) or **lives in the same directory as `README.MD` once published** (`LICENSE`), a relative link is correct.
- If the target is **anything else** - `README_DEVELOPMENT.MD`, `doc/`, the framework's own `examples/`, `PLAN.md`, `CONTRIBUTING.md` - it does not ship, so the link must be a full `https://github.com/rom399/Empire/blob/main/...` or `.../tree/main/...` URL. A relative link there resolves fine for a GitHub browser but 404s (or worse, silently links to nothing) for anyone reading this from npmjs.com or from inside an installed `node_modules/empire-ts`.
- Don't assume a link that "used to be right" still is - a file this doc points at may have moved (this is exactly how the `../examples` and `README_DEVELOPMENT.MD` links went stale here: the file itself moved out of `package-example/` and became the package root's own README).

## 2. Cross-check every embedded code block against the real file

Any source code shown inline (not just referenced) must match the actual file in `package-example/` byte-for-byte, ignoring only its header doc-comment. Diff them - don't eyeball it:

```bash
diff <(tr -d '\r' < package-example/examples/NN-name/server.ts | tail -n +LINE) \
     <(sed -n 'START,ENDp' README.MD)
```

A line-ending-only diff (git's autocrlf on `.ts` files) is fine; any real content difference means the README has drifted from the code.

## 3. Cross-check the examples table against `package-example/examples/`

Same count, same ports, same one-line description per row as what's actually in that directory. If a new example was added or a port changed there, this table and any full-code sections drift out of sync silently - nothing enforces it automatically.

## 4. Replace bare run-commands with real usage where it matters

A shell line like `npx tsx examples/02-routing/server.ts` shows how to *run* something, not how the package is *used*. Where the goal is demonstrating the package's API (not just pointing at more files), show the actual `import { ... } from "empire-ts"` code instead.

## 5. Verify with a real pack, not just a read-through

```bash
cd src/empire
npm run build
npm pack --dry-run
```

Confirm everything the README references or claims is bundled (or, correctly, isn't) actually shows up that way in the tarball listing.

## Output

Before changing anything beyond what was explicitly asked, report what you found: which links were broken and why, which code blocks had drifted, whether the examples table matches reality. Fix what was asked; flag the rest rather than silently expanding scope.
