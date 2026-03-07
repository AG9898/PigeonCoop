# Decisions

## Accepted decisions

### 2026-03-07 — Local-first product
The application is local-first for v1. No cloud-first architecture.

### 2026-03-07 — Desktop shell
The product will be built as a Tauri desktop app.

### 2026-03-07 — Core language
Rust is the core implementation language for engine/state/persistence.

### 2026-03-07 — Frontend approach
Use React + TypeScript inside Tauri rather than a Rust-only UI stack.

### 2026-03-07 — Primary v1 use case
Primary use case is workflow design wrapped in a fun interface, then live monitoring/replay of actual runs.

### 2026-03-07 — Execution target
First execution target is a CLI wrapper model operating in a selected local workspace/repository.

### 2026-03-07 — Task practicality
The tool must be practical for developing/coding in the repository or project that the agents are initialized in.

### 2026-03-07 — Human intervention
Support pause/review/approve/reject/retry/edit flows in v1.

### 2026-03-07 — Shell commands
Arbitrary shell commands are allowed in v1, with explicit logging and visibility.

### 2026-03-07 — File mutation policy
Raw write commands are allowed in v1, though Git-aware or patch-aware approaches are preferred where possible.

### 2026-03-07 — Orchestration scope
Do not include unconstrained orchestrator-agent instances in v1.

### 2026-03-07 — UX direction
2D mission-control / strategy HUD aesthetic. Practicality and debugging clarity outrank pure visual novelty.

---

## Open decisions

These are not blockers, but should be resolved early during implementation:
- exact workflow JSON schema versioning strategy
- whether to add bounded loop edges in v1 or v1.1
- how to detect changed files reliably across platforms
- whether to embed a terminal emulator component or use a custom output panel only
- how much structured output is required from CLI-backed agent nodes
