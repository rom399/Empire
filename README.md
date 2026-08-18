# Empire

[![CI](https://github.com/rom399/Empire/actions/workflows/ci.yml/badge.svg)](https://github.com/rom399/Empire/actions/workflows/ci.yml)

A lightweight TypeScript web framework built from scratch on Node's `http` module. Routing, a middleware pipeline, a Context API, static file serving, and centralized error handling, with zero runtime dependencies.

Empire exists to answer a question that using a framework never does: what is actually happening between the socket and your handler? Express, Koa, Fastify, and ASP.NET Core all solve the same problems in recognisably similar ways, and the fastest way to understand those solutions is to build them. Every feature here is implemented directly against Node's `http` module rather than wrapped around an existing library.

## Features

- HTTP server on Node's `http` module, with configurable host and port
- Promise-based `start()` and `stop()` lifecycle
- Routing across all six HTTP methods, with `:param` capture and automatic HEAD and OPTIONS handling
- Middleware pipeline executing in registration order (`app.use()`)
- Static file serving, with optional URL prefixes and SPA fallback
- Centralized error handling built around `HttpError`
- Configurable request body size limit
- Pluggable logging abstraction (`ILogger`), with a built-in console logger

## Quick start

```bash
cd src/empire
npm install
npm start
```

`npm start` runs `examples/01-basic-server/server.ts`. There is no
standalone server file at the project root - see Examples below for what
else is available.

```typescript
import { Empire } from "./src/Empire";

const app = new Empire({
    host: "localhost",
    port: 8008
});

app.get("/", (ctx) => {
    ctx.html(`
        <!DOCTYPE html>
        <html>
            <head>
                <title>Empire</title>
            </head>
            <body>
                <h1>Welcome to Empire</h1>
                <p>A lightweight TypeScript web framework.</p>
            </body>
        </html>
    `);
});

await app.start();
```

## Documentation

The framework source and its full documentation live in [`src/empire`](src/empire).

**[Read the full documentation](src/empire/README.MD)** for routing, middleware, static files, error handling, logging, and request body limits, each with worked examples.

## Examples

Nine runnable examples live in [`src/empire/examples`](src/empire/examples), each a single `server.ts` covering one feature - routing, middleware, static files, error handling, a React SPA, body size limits, authentication, and dependency injection. See the [Examples section of the full documentation](src/empire/README.MD#examples) for the complete list with ports and descriptions.

```bash
cd src/empire
npx tsx examples/02-routing/server.ts
```

## Repository layout

```
Empire/
├── .github/          CI workflow and Dependabot config
├── src/empire/       Framework source, tests, examples, and full documentation
└── README.md         You are here
```

## Status

Empire is under active development and is not published to npm. The API is not yet stable and may change between commits.

## License

MIT. See [LICENSE](LICENSE).
