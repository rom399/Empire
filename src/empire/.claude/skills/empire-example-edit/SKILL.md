---
name: "empire-example-edit"
description: "Propagate a change made to a file under examples/ to its package-example mirror and any README.MD embedded code block. Use whenever a file under examples/NN-name/ is added, fixed, or edited for any reason - a bug fix, a lint fix, a refactor - not just when building a new feature."
---

Every numbered example under `examples/` has up to two copies elsewhere that must stay byte-identical except for the import line and port number. Nothing enforces this automatically - a one-line fix applied only to `examples/` silently drifts out of sync with its copies, and nothing fails CI to catch it.

## 1. Check for a `package-example/` mirror

`package-example/examples/NN-name/server.ts` mirrors `examples/NN-name/server.ts` 1:1, except:
- Imports come from `"empire-ts"` instead of relative `../../src/...` paths
- The port is shifted +1000 (e.g. `8002` -> `9002`)
- Its doc comment has a `(package-example mirror)` suffix and a "Same as Empire's examples/NN-name, but..." opening line

If the mirror exists (all 11 numbered examples currently have one), apply the identical change there too - same logic, same structure, only the import/port difference preserved.

## 2. Check whether `README.MD` embeds this example's code verbatim

As of this writing, only `01-basic-server` and `02-routing` are inlined byte-for-byte into `src/empire/README.MD` (the file npm bundles) - check the file for a ` ```ts ` block under a `### NN-name` heading matching the example you changed. If found, apply the same change to that block. Diff rather than eyeball:

```bash
diff <(tr -d '\r' < package-example/examples/NN-name/server.ts) \
     <(sed -n 'START,ENDp' README.MD)
```

(`README.MD`'s embedded blocks match the `package-example` version - `empire-ts` imports, shifted port - not the `examples/` version.)

## 3. Check the doc comment, not just the code

If the change alters what the example demonstrates (e.g. replacing a hand-rolled check with a built-in mechanism), the file's own header doc comment likely claims the old behavior as a feature - update it to match, in both the real file and its mirror. See `examples/05-error-handling/server.ts`'s history: converting `/orders` to `validate()` required updating the comment's "Throwing BadRequestError for invalid input" bullet to explain it now happens via `validate()`'s automatic `ValidationError`, not a manual throw.

## 4. Verify all three locations, not just the one you edited

After propagating:
```bash
npx tsc --noEmit                                    # root - covers examples/
cd package-example && npx tsc --noEmit && cd ..     # separate tsconfig, not covered by the above
npm run lint
npm run examples                                     # smoke-tests every real example end-to-end
```
Then exercise the actual changed behavior with a real request (`curl`) if the change affects runtime behavior, not just types - a smoke test only hits one basic route per example and will not catch a broken POST body handler.

## Output

If you find a mirror or embedded block that's already out of sync with the real example *before* your own change (a pre-existing drift, not one you're about to introduce), flag it rather than silently fixing scope you weren't asked to touch.
