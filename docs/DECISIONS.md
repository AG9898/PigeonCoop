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

### 2026-03-07 — Testing stack
Playwright cannot drive Tauri's native webview (WebView2/WKWebView/WebKitGTK). E2E testing uses `tauri-driver` + WebdriverIO instead. Frontend component tests use Vitest + React Testing Library with mocked `@tauri-apps/api`. Rust layers use `cargo test`. See [`docs/TESTING.md`](TESTING.md).

### 2026-03-07 — Distribution strategy
Distribute as native OS installers via GitHub Releases (`.dmg`, `.msi`, `.AppImage`). Also publish package manager formulae/manifests (Homebrew, winget, AUR) as early as possible — this is a trust signal and reduces install friction to a single command. Do not distribute the GUI app via npm; npm is inappropriate for a native binary + webview app. A future headless CLI companion (`agent-arcade-cli`) could be distributed via npm but is out of scope for v1. The Rust core crate architecture already supports this without structural changes.

### 2026-03-07 — Developer-first UX philosophy
The target user is a technical developer. The product must feel like it was built by developers for developers. Do not sand off technical edges in pursuit of consumer-grade polish. Keyboard-driven workflows, readable config files, and visible system state are higher priorities than visual smoothness. The setup-to-wow moment — watching a real workflow run against your own repo and replaying it — must be reachable in under 2 minutes from install. The demo workflow (`plan-execute-critique-approve`) must be the first thing a user can run, not a tutorial they have to complete first.

### 2026-03-07 — Workflow JSON schema versioning strategy (DEC-001)

**Context:** `WorkflowDefinition` had a single `version: u32` field with no documented meaning. It was being used by the persistence layer as a user revision counter (incrementing on save), but could also have been interpreted as a schema format version.

**Decision:** Two separate fields:
- `schema_version: u32` — set by the application, never by the user. Tracks the JSON format version. `CURRENT_SCHEMA_VERSION = 1`. Must be incremented whenever the schema changes in a backward-incompatible way, and a corresponding migration arm added to `workflow_model::workflow::migrate()`.
- `version: u32` — user-controlled revision counter. Incremented by the application each time the user saves a new revision of the same workflow. Used by the persistence layer as a row key in `workflow_versions`.

**Migration policy:** On load, call `migrate(wf)`. The function steps `schema_version` from the stored value to `CURRENT_SCHEMA_VERSION` one increment at a time, applying the appropriate transform in each `match` arm. This makes migrations composable and deterministic.

**Example v1 → v2 migration scenario:** If a future schema v2 adds a top-level `tags` array, the migrator sets `tags: []` on documents that lack it, then bumps `schema_version` to 2.

**Alternatives considered:**
- Single field (ambiguous — rejected; conflates schema format with user revision history)
- Semver string for schema_version (expressive but unnecessary complexity for a local-first tool with a simple u32 increment policy)
- User controls schema_version (rejected; users should not touch format metadata)

**Tradeoffs:** Adds one required field to the schema. Minor breaking change during v1 development, but no deployed users exist yet so cost is zero.

**Unblocks:** FOUND-003, MODEL-005.

---

## Open decisions

These are not blockers, but should be resolved early during implementation:
- whether to add bounded loop edges in v1 or v1.1
- how to detect changed files reliably across platforms
- whether to embed a terminal emulator component or use a custom output panel only
- how much structured output is required from CLI-backed agent nodes
