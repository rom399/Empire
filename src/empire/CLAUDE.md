# Empire

TypeScript HTTP framework built from scratch on Node's `http` module.

- **Layout**: `src/` — one class/interface/enum per file. `tests/unit/` mirrors `src/` 1:1, one test file per class. `tests/fixtures/` — shared mocks/helpers. `examples/` — numbered `NN-name/server.ts` runnable apps. `doc/` — architecture/state docs, `doc/features/` per-feature design docs.
- **Runtime**: CommonJS, run via `tsx`. `npm test` runs Vitest. `npx tsc --noEmit` type-checks.
- **Naming**: one class, interface, or enum per file; filename matches the type exactly. Interfaces are `I`-prefixed (`IServiceCollection`); PascalCase types, camelCase methods.
- **Dependencies**: `zod` is the only runtime dependency, and it stays that way — do not add npm packages without being asked.

Full conventions: [CONTRIBUTING.md](CONTRIBUTING.md).
