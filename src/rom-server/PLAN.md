# Empire Framework Plan

## Goal

Build a lightweight TypeScript web framework from scratch without Express.

Empire should eventually support:

* HTTP server startup/shutdown
* Middleware pipeline
* Routing
* Request/response helpers
* JSON body parsing
* Error handling
* Static files
* Testing support
* Dependency injection

---

## Phase 1 — Foundation

### Completed

* TypeScript project setup
* tsconfig configuration
* Empire class
* HTTP server using Node createServer
* Host and port configuration
* Promise-based start()
* Promise-based stop()
* Graceful shutdown using SIGINT
* .gitignore
* ILogger abstraction
* ConsoleLogger implementation
* Timestamped logging
* Logger injection through EmpireOptions

---

## Phase 2 — Middleware

### Completed

* Middleware type definition
* Middleware collection
* app.use() registration

### In Progress

* Middleware execution pipeline

### Remaining

* Async middleware support
* Middleware error handling
* Route-specific middleware

Target API:

```ts
app.use(logger);
app.use(auth);
```

---

## Phase 3 — Routing

Target API:

```ts
app.get("/", (ctx) => {
    ctx.text("Hello World");
});

app.post("/users", (ctx) => {
    ctx.json({ created: true });
});
```

### Tasks

* Route table
* GET routes
* POST routes
* PUT routes
* DELETE routes
* Route matching
* 404 handling

---

## Phase 4 — Context

Target API:

```ts
ctx.req
ctx.res
ctx.path
ctx.method
ctx.query
ctx.text()
ctx.json()
ctx.status()
```

### Tasks

* Context object
* Query string parsing
* Response helpers
* Request helpers

---

## Phase 5 — Request Bodies

### Tasks

* Request stream reading
* JSON body parsing
* Invalid JSON handling
* Request size limits

---

## Phase 6 — Error Handling

### Tasks

* Global error handling
* Middleware exception handling
* Development error responses
* Production error responses

---

## Phase 7 — Static Files

### Tasks

* Static file middleware
* MIME type support
* Path traversal protection
* File caching

---

## Phase 8 — Developer Experience

### Tasks

* npm run dev
* npm run build
* npm start
* Example applications
* API test files
* Documentation

---

## Future Ideas

### Dependency Injection

```ts
app.services.addSingleton(
    ILogger,
    ConsoleLogger
);
```

### Configuration

```ts
app.configuration.get("Database");
```

### Controllers

```ts
app.controller(UserController);
```

### OpenAPI / Swagger

```ts
app.useSwagger();
```

---

## Current Priority

1. Complete middleware execution pipeline
2. Add request context object
3. Implement routing
4. Add route parameters
5. Add JSON responses
6. Add request body parsing

## Current Version

0.1.0 - Foundation Complete
