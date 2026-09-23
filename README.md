# Empire

A lightweight TypeScript HTTP framework built from scratch on Node's `http` module - with a small layer-7 load balancer built the same way.

![The load balancer example running: backends under traffic, a drill-down into one, and one deregistering and rejoining](https://raw.githubusercontent.com/rom399/Empire/main/src/empire/doc/images/load-balancer-example.gif)

[![CI](https://github.com/rom399/Empire/actions/workflows/ci.yml/badge.svg)](https://github.com/rom399/Empire/actions/workflows/ci.yml)

Empire is built directly against Node's `http` module instead of wrapping an existing framework, so it's easy to see exactly what's happening between the socket and your handler. Routing, middleware, dependency injection, schema-based validation, and the load balancer shown above are all implemented that way, with zero runtime dependencies. The GIF shows the load balancer's live dashboard: backends registering themselves, taking traffic, and one deregistering and rejoining, with no config to edit.

## Quick start

```bash
cd src/empire
npm install
npm start
```

`npm start` runs `examples/01-basic-server/server.ts`. There is no
standalone server file at the project root - see
[README_DEVELOPMENT.MD](https://github.com/rom399/Empire/blob/main/src/empire/README_DEVELOPMENT.MD#examples)
for what else is available.

```typescript
import { Empire } from "./src/Empire";

const app = new Empire({
    host: "localhost",
    port: 8008
});

app.get("/", (ctx) => {
    ctx.text("Welcome to Empire");
});

await app.start();
```

## Features

- HTTP server on Node's `http` module, with configurable host and port
- Promise-based `start()` and `stop()` lifecycle
- Routing across all six HTTP methods, with `:param` capture and automatic HEAD and OPTIONS handling
- Middleware pipeline executing in registration order (`app.use()`)
- Static file serving, with optional URL prefixes and SPA fallback
- A hand-rolled dependency injection container - singleton/scoped/transient lifetimes, disposal, graceful shutdown
- Schema-based request validation (body, query, route params) via `validate()`, accepting any [Standard Schema](https://standardschema.dev) validator - [Zod](https://zod.dev), Valibot, ArkType, or your own - so you bring the validator and Empire depends on none of them
- CORS support via `createCorsMiddleware()` - origin/method/header allowlisting, preflight handling, credentials, and per-path policies
- A small layer-7 load balancer - backends that register themselves, round robin or least connections, and a live 3D dashboard (a learning and local-development tool, not a production edge)
- Centralized error handling built around `HttpError`
- Configurable request body size limit
- Pluggable logging abstraction (`ILogger`), with a built-in console logger

## Learn more

The framework source and its full documentation live in [`src/empire`](src/empire).

* **[README_DEVELOPMENT.MD](https://github.com/rom399/Empire/blob/main/src/empire/README_DEVELOPMENT.MD)** - the full walkthrough: every feature with worked examples, the load balancer in depth, testing, and project structure. Start here to build or contribute to Empire itself.
* **[README.MD](https://github.com/rom399/Empire/blob/main/src/empire/README.MD)** - installing and using the published `empire-ts` npm package. This is also the README bundled with the package on npm.
* **[Runnable examples](https://github.com/rom399/Empire/tree/main/src/empire/examples)** - twelve numbered apps, one per feature, importing the source tree directly. See [`package-example`](https://github.com/rom399/Empire/tree/main/src/empire/package-example) instead if you just want to see the published package consumed.

## Status

Empire is under active development. It's published to npm as [`empire-ts`](https://www.npmjs.com/package/empire-ts), but the API is not yet stable and may change between releases.

## License

MIT. See [LICENSE](LICENSE).
