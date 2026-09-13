# Using empire-ts

A standalone demo of consuming **empire-ts** the way a real npm
consumer would - `import { Empire } from "empire-ts"`, nothing else.
This is deliberately separate from Empire's own [`examples/`](examples)
folder, which imports the framework's source directly
(`../../src/Empire`) to exercise the code as currently written; this
folder instead exercises the actual **published package shape** - only
what `dist/index.js` exports, nothing from internal files.

> This lives inside the Empire monorepo for convenience, but nothing
> here is Empire-specific tooling - delete `node_modules/` and
> `package-lock.json` and this folder works as a completely independent
> project.

## Setup

**If empire-ts is published on npm:**

```bash
npm install empire-ts
```

**If you're running this from inside the Empire repo, before/without a
real publish** (which is how this folder's own `package.json` is set up
right now): build the package first, then point at the tarball it
produces.

```bash
cd ..                  # src/empire
npm run build
npm pack                # produces empire-ts-<version>.tgz
cd package-example
npm install             # installs the tarball referenced in package.json
```

Either way, `import { Empire } from "empire-ts"` resolves the same way -
there's nothing local-install-specific about the example code itself.

## Examples

### `basic-server.ts`

The smallest possible server: an HTML route, a health check, and an
echo endpoint.

```bash
npx tsx basic-server.ts
```

```
http://localhost:9001/
http://localhost:9001/health
curl -X POST http://localhost:9001/echo -H "Content-Type: application/json" -d '{"hi":"there"}'
```

### `full-featured.ts`

A small users API wiring several features together through nothing but
the public exports of `empire-ts`: a singleton repository via the DI
container, logger and CORS middleware, Zod-based request validation,
and `HttpError` for a clean 404.

```bash
npx tsx full-featured.ts
```

```bash
curl http://localhost:9002/users
curl -X POST http://localhost:9002/users -H "Content-Type: application/json" -d '{"name":"Ada","email":"ada@example.com"}'
curl http://localhost:9002/users/1
curl http://localhost:9002/users/999   # 404
```

## What this proves

Both examples were run for real against `node_modules/empire-ts`
installed from the actual `npm pack` tarball - not a symlink into the
source tree, not hand-copied files. If `tsc --noEmit` and both servers
work here, the package genuinely works as published: the right things
are exported from `dist/index.js`, the `.d.ts` files type-check
correctly for a consumer, and `main`/`types` in `package.json` point
where they should.

## Updating the Source Code

This file ships with the published npm package, so it can only link
elsewhere by full URL - a relative link to a file that isn't bundled in
the package (like the one below) would be broken for anyone reading this
from npmjs.com or from inside an installed `node_modules/empire-ts`.

If you want to modify empire-ts itself - add a feature, fix a bug, run
the test suite, understand how the framework is built - see
[README_DEVELOPMENT.MD](https://github.com/rom399/Empire/blob/main/src/empire/README_DEVELOPMENT.MD)
on GitHub.

## Learn more

Full API walkthrough, the complete example suite, and contribution
guidelines: [github.com/rom399/Empire](https://github.com/rom399/Empire).
