# Empire Framework Plan

## Goal

Build a small TypeScript web server framework from scratch, without Express.

Empire should eventually support:

- HTTP server startup/shutdown
- Middleware pipeline
- Routing
- Request/response helpers
- JSON body parsing
- Error handling
- Static files
- Basic API testing

---

## Phase 1 — Basic Server

### Done

- Create TypeScript project
- Configure `tsconfig.json`
- Create `Empire` class
- Start server using Node `http.createServer`
- Pass `host` and `port`
- Add `start()` method
- Add `stop()` method
- Handle `Ctrl+C` using `process.on("SIGINT")`
- Add `.gitignore`

### Next

- Make `start()` return `Promise<void>`
- Make `stop()` return `Promise<void>`
- Add better startup/shutdown logging

---

## Phase 2 — Middleware

Add middleware support similar to Express/Koa.

Example target API:

```ts
app.use(logger);
app.use(auth);