# Contributing to Empire

Thank you for your interest in contributing to Empire. This document outlines the conventions and processes all contributors must follow. Please read it carefully before submitting any code.

---

## Philosophy

Empire prioritises **readability over cleverness**. Code should be immediately understandable to any developer familiar with C# or ASP.NET Core patterns. If a junior developer cannot read your code at a glance, it needs to be rewritten.

We deliberately follow C# and ASP.NET Core conventions rather than typical JavaScript/TypeScript idioms. This is intentional — Empire is designed to feel familiar to developers coming from strongly typed, enterprise backgrounds.

---

## Project Structure

```
empire/
├── src/                    # Published package — production code only
│   ├── http/               # HTTP server, context, request and response
│   ├── logging/            # ILogger and implementations
│   ├── middleware/         # Middleware pipeline and built-in middleware
│   ├── errors/             # HttpError and derived error types
│   ├── static/             # Static file serving
│   ├── di/                 # Dependency injection
│   ├── routing/            # Router and route matching
│   ├── gateway/            # Gateway and load balancing
│   └── Empire.ts           # Main entry point
├── tests/
│   ├── unit/               # Vitest unit tests — mirrors src/ structure
│   ├── http/               # REST client test files (.http)
│   └── fixtures/           # Shared test helpers, mocks and test data
├── examples/               # Example applications — not published to npm
└── docs/                   # Documentation
```

### Rules

- New source files always go in the correct `src/` subfolder
- New test files always go in the matching `tests/unit/` subfolder
- Test data and helpers always go in `tests/fixtures/`
- Example applications always go in `examples/`
- Never put test files, fixtures or examples inside `src/`

---

## File Structure

- **One class, interface, or enum per file — no exceptions**
- File name must exactly match the class, interface, or enum name
- Example: `ServiceCollection.ts` contains only the `ServiceCollection` class

---

## Naming Conventions

| Type | Convention | Example |
|------|-----------|---------|
| Classes | PascalCase | `ServiceCollection` |
| Interfaces | PascalCase with I prefix | `IServiceCollection` |
| Enums | PascalCase | `Lifetime` |
| Enum values | PascalCase | `Singleton`, `Transient`, `Scoped` |
| Methods | camelCase descriptive verbs | `addSingleton`, `resolve` |
| Files | Match class name exactly | `ServiceCollection.ts` |

### Additional Rules

- No lowercase filenames — `auth.ts` is wrong, `AuthMiddleware.ts` is correct
- No abbreviations unless universally understood — HTTP, DI, and URL are acceptable
- Method names should describe what they do — avoid vague names like `process` or `handle`

---

## Code Style

### Readability First

```typescript
// ✅ Correct — readable and explicit
public async resolve<T>(token: ServiceToken<T>): Promise<T> {
    const descriptor = this.descriptors.get(token);

    if (!descriptor) {
        throw new Error(`Service not registered: ${token.description}`);
    }

    return descriptor.factory(this);
}

// ❌ Wrong — clever but unclear
public async resolve<T>(t: any) {
    const d = this.d.get(t);
    if (!d) throw new Error(`Not found: ${t.description}`);
    return d.factory(this);
}
```

### No Deeply Nested Code

```typescript
// ✅ Correct — flat and readable
public async handle(ctx: Context): Promise<void> {
    const file = await this.findFile(ctx.path);

    if (!file) {
        ctx.status(404).text('Not found');
        return;
    }

    await this.sendFile(ctx, file);
}

// ❌ Wrong — deeply nested
public async handle(ctx: Context): Promise<void> {
    this.findFile(ctx.path).then(file => {
        if (file) {
            this.sendFile(ctx, file).then(() => {}).catch(e => {});
        } else {
            ctx.status(404).text('Not found');
        }
    });
}
```

### No Magic Numbers or Strings

```typescript
// ✅ Correct
const DEFAULT_PORT = 3000;
const MAX_BODY_SIZE = 1024 * 1024; // 1MB

// ❌ Wrong
listen(3000);
if (body.length > 1048576) { ... }
```

### Comments

- Comments explain **why**, not what
- Every public class, method and property must have a JSDoc comment

```typescript
/**
 * Registers a service with singleton lifetime.
 * The same instance is returned for every resolution.
 */
public addSingleton<T>(token: ServiceToken<T>, factory: Factory<T>): void {
    // Store as singleton so the provider only ever builds one instance
    this.register(token, Lifetime.Singleton, factory);
}
```

---

## C# / ASP.NET Core Patterns

Empire deliberately mirrors ASP.NET Core conventions. When in doubt, ask yourself — how would ASP.NET Core do this?

- Interfaces define contracts, implementations are separate files
- Constructor injection for all dependencies — never use a service locator
- Configuration via options objects rather than long parameter lists
- Separate concerns strictly — one responsibility per class

---

## Testing

Every class must have a corresponding test file.

### Structure

- Test file lives in `tests/unit/` mirroring the `src/` folder structure
- Test file named exactly: `ClassName.test.ts`
- Use Vitest for all tests
- Shared helpers and mock services go in `tests/fixtures/`
- CI (`.github/workflows/ci.yml`) runs `tsc --noEmit` and `vitest run`
  automatically on every pull request — a PR won't merge cleanly until
  both pass

### Test Naming

Test names must describe behaviour in plain English:

```typescript
// ✅ Correct
it('returns the same instance for singleton registrations')
it('throws when resolving an unregistered service')
it('creates a new instance for each transient resolution')

// ❌ Wrong
it('singleton works')
it('throws error')
it('transient test')
```

### Test Structure

```typescript
import { describe, it, expect } from 'vitest';
import { ServiceCollection } from '../../src/di/ServiceCollection';
import { createToken } from '../../src/di/ServiceToken';
import { TestLogger } from '../fixtures/services/TestLogger';

const LoggerToken = createToken<TestLogger>('Logger');

describe('ServiceCollection', () => {

    describe('addSingleton', () => {

        // provider.resolve() is DI-3 — this is the target shape once it lands
        it('returns the same instance on every resolution', async () => {
            const services = new ServiceCollection();
            const logger = new TestLogger();

            services.addSingleton(LoggerToken, () => logger);
            const provider = services.build();

            const first = await provider.resolve(LoggerToken);
            const second = await provider.resolve(LoggerToken);

            expect(first).toBe(second);
        });

    });

});
```

---

## Contribution Process

1. Fork the repository
2. Create a feature branch — `feature/your-feature-name`
3. Follow all conventions in this document
4. Write tests for every class you create or modify
5. Ensure all existing tests pass before submitting
6. Submit a pull request with a clear description of what you built and why

### Pull Request Guidelines

- One feature or fix per pull request
- Reference the relevant roadmap phase in your PR description
- Do not refactor existing code unless it is the explicit purpose of the PR
- All new files must follow the one class per file rule before a PR will be reviewed

---

## Questions

If you are unsure about a convention or approach, open a GitHub Discussion before writing code. It is much easier to align on an approach before implementation than after.

---

*Empire is inspired by ASP.NET Core and built for developers who value structure, clarity and maintainability over brevity and cleverness.*
