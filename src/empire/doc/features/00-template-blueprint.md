# Empire — [Feature Name]: Design & Build Doc

**Status:** [Proposed | Implemented]
**Scope:** Native TypeScript architecture. Phase [X] in PLAN.md.
**Timeline:** Designed by Opus ➡️ Executed by Sonnet

---

## 1. Context & Architectural Goals
### 1.1 The Problem
<!-- What limitation does this feature address? Why does Empire need it? -->

### 1.2 System Goals
<!-- Granular, high-level functional expectations. Keep these bounded. -->
* **Goal 1:** ...
* **Goal 2:** ...

### 1.3 Non-Goals (Scope Guardrails)
<!-- Crucial for preventing AI hallucination. What are we explicitly NOT building? -->
* **Non-Goal 1:** ...

### 1.4 Dependency Stance
<!-- Define package restrictions. Usually: "Zero runtime dependencies. Native Node.js modules only." -->

---

## 2. Design & API Contracts (The Opus Blueprint)
### 2.1 Public User API
<!-- Code snippets demonstrating exactly how a framework user registers this feature -->
```typescript
// Example usage snippet
```

### 2.2 Core Interfaces & Data Models
<!-- Strict TypeScript types, schemas, or interfaces that define boundaries -->
```typescript
export interface IExampleSeam { ... }
```

### 2.3 Internal Processing Logic Rules
<!-- Step-by-step state and execution mechanics. How do things handle failure or race conditions? -->
1. **Rule 1:** ...
2. **Rule 2:** ...

### 2.4 Security & Performance Defaults
<!-- Explicit mitigations for edge cases, memory pressure, or network exploits -->

---

## 3. Iterative Build Steps & Test Strategy (The Sonnet Instructions)
<!-- Granular steps for Sonnet to execute sequentially. Each step must define its test criteria. -->

### Step 1: Types & Structural Definitions
* **Description:** Define the base contracts inside `src/[domain]/types.ts`.
* **Sonnet Check:** Ensure compile-time safety across existing imports.

### Step 2: Component Logic & Isolated Unit Tests
* **Description:** Implement the primary class/utility.
* **Vitest Assertions:** 
  * Assert [Condition A] behaves correctly.
  * Assert [Edge Case B] fails cleanly without crashing the process.

### Step 3: Network Pipeline Integration & Live Sockets
* **Description:** Wire the component into `Empire.ts` or `Router.ts` middleware hooks.
* **Integration Tests:** Spin up an ephemeral port server and drive mock HTTP traffic to verify behavior end-to-end.

### Step 4: Verification, Benchmarking, & Example App
* **Description:** Add a runnable showcase script inside `examples/` and run type/lint checks.
