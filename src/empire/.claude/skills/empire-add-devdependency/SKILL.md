---
name: "empire-add-devdependency"
description: "Vet a new devDependency against this project's TypeScript version before installing it, and safely test a candidate tsconfig compiler flag. Use before running npm install -D for any new tool, or when auditing whether a tsconfig flag (noUnusedLocals, noUncheckedIndexedAccess, isolatedModules, etc.) should be enabled."
---

Empire tracks TypeScript at `^7.0.2` - the new Go-native compiler, a very recent major version. Any devDependency that hooks the TypeScript compiler's JS API (linters, test-type-checkers, doc generators) can lag behind a TS major for months. This already happened once: `typescript-eslint`'s peer range caps at `<6.1.0` and the maintainers closed a TS 7 support request outright, because TS 7.0 shipped without a stable programmatic API (landing in 7.1). `oxlint` + `oxlint-tsgolint` worked instead specifically because it doesn't depend on that API - it builds on `typescript-go` directly.

## Before installing anything new

1. Check the candidate's peer dependencies against the pinned `typescript` version *before* running `npm install`:
   ```bash
   npm view <package> peerDependencies
   ```
2. If `npm install` fails with `ERESOLVE` over a `typescript` peer range, that is real information, not noise to push past. **Never** reach for `--legacy-peer-deps` or `--force` to silence it - a tool built against an older TS compiler API can silently misparse or misanalyze code on a newer major rather than just emitting a version warning.
3. Search for whether the tool has a newer release, a canary/alpha channel, or a completely different tool that solves the same problem without depending on TS's JS API (a tool with its own parser, or one built on `typescript-go` directly, sidesteps the whole class of conflict). Check the dist-tags, not just `latest`:
   ```bash
   npm view <package> dist-tags --json
   npm view <package>@<tag> peerDependencies
   ```
4. Only fall back to pinning `typescript` down to satisfy a tool's peer range, or accepting a forced install, with the user's explicit sign-off - both are real tradeoffs (an older compiler for the whole project, or an unverified tool/TS combination), not silent workarounds.

## Testing whether a candidate tsconfig flag is worth enabling

Never speculate about what a flag would surface - test it. But the temp config must live *inside* the project, not in a system temp directory:

```bash
cat > tsconfig.audit-tmp.json << 'EOF'
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "noUncheckedIndexedAccess": true }
}
EOF
npx tsc -p tsconfig.audit-tmp.json --noEmit
rm tsconfig.audit-tmp.json
```

A temp config placed in a system temp directory (`/tmp`, `$TMPDIR`) breaks `"extends"` resolution - `extends` is resolved relative to the config file's own location, not the working directory - and `tsc` can silently fall back to scanning whatever unrelated `.ts` files happen to sit in that temp directory instead of erroring clearly. Always create the temp config as a sibling of the real `tsconfig.json`, and delete it when done (`git status` should show no trace of it afterward).

For each violation the flag surfaces, check whether it is a real gap or safe by construction (a loop invariant, a value already validated upstream) before recommending the flag - see the CHANGELOG-worthy example: `noUncheckedIndexedAccess` flagged 9 sites in this codebase, 2 of which were mathematically impossible (`String.prototype.split()` never returns an empty array) and 3 of which were true by a loop-bound invariant the type checker can't see.

## Output

Report what was checked (peer range, dist-tags, alternatives considered) and why the chosen tool or flag decision was made, before installing or editing `tsconfig.json` - this is exactly the kind of decision that needs the user's sign-off, not a silent default.
