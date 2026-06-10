# Empire

Empire is a lightweight TypeScript web framework built from scratch using Node.js.

The goal of the project is to understand how modern web frameworks such as Express, Koa, Fastify, and ASP.NET Core work internally by implementing the core features ourselves.

## Current Features

* HTTP server
* Configurable host and port
* Graceful startup and shutdown
* TypeScript support

## Roadmap

### Phase 1

* HTTP server
* Start and stop lifecycle
* Configuration

### Phase 2

* Middleware pipeline
* Request processing
* Logging middleware

### Phase 3

* Routing
* Route parameters
* Query string support

### Phase 4

* Context object
* Request helpers
* Response helpers

### Phase 5

* JSON body parsing
* Validation

### Phase 6

* Error handling
* Exception middleware

### Phase 7

* Static file serving

## Installation

```bash
npm install
```

## Running

```bash
npm start
```

or

```bash
npx tsx server.ts
```

## Example

```ts
import { Empire } from "./src/Empire";

const app = new Empire({
    host: "localhost",
    port: 8008
});

await app.start();
```

## Project Structure

```text
rom-server/
├── README.md
├── PLAN.md
├── package.json
├── tsconfig.json
├── server.ts
└── src/
```

## Motivation

This project is primarily a learning exercise and a platform for experimenting with framework design, middleware pipelines, routing, and modern TypeScript development.

## License

MIT
