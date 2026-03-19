# Repository Structure

## Actual layout

```text
.github/
  workflows/
    ci.yml               # CI: cargo test (--exclude agent-arcade) + npm test

AGENTS.md
CLAUDE.md               # Symlink to AGENTS.md
Cargo.lock
Cargo.toml

docs/
  ARCHITECTURE.md
  DECISIONS.md
  DESIGN_SPEC.md
  EVENT_SCHEMA.md
  PRD.md
  README.md
  REPO_STRUCTURE.md
  TAURI_IPC_CONTRACT.md
  TESTING.md
  workboard.json

apps/
  desktop/
    package-lock.json
    package.json
    src/
      __mocks__/
      __tests__/
      app/
      components/
        canvas/
        nodes/
        panels/
      data/               # Embedded static data (e.g. demo workflow for first-run seeding)
      hooks/              # React hooks (e.g. useFirstRun for demo seeding)
      main.tsx
      state/              # Pure state-derivation utilities (no React, no side effects)
        deriveNodeStates.ts  # Reconstruct node statuses from an event slice (used by ReplayView)
      styles/
      types/
      views/
    src-tauri/
      build.rs               # Required: calls tauri_build::build() for generate_context!()
      Cargo.toml
      gen/
        schemas/
      tauri.conf.json        # Tauri app config (read at compile time by generate_context!())
      icons/
        icon.png             # App icon (RGBA PNG required by tauri_build)
      src/
        bridge/
          mod.rs             # TauriEventLog + frontend event payload types
        commands/
          mod.rs             # All Tauri command handlers
        lib.rs               # Tauri setup, invoke_handler registration
        main.rs

crates/
  workflow-model/
    src/
  event-model/
    src/
  core-engine/
    src/
      scheduler/
      state_machine/
      validation/
      execution/
      review/
  runtime-adapters/
    src/
      agent.rs        # Agent CLI adapter (ADAPT-003)
      cli/
      mock/
      tools/
  persistence/
    migrations/
      001_initial_schema.sql
    src/
      repositories/
      sqlite/
  simulation/
    src/

schemas/
  workflow.schema.json
  run-event.schema.json

examples/
  plan-execute-critique-approve/
    workflow.json
    README.md

tests/
  e2e/
    fixtures/
      test-workspace/
    package-lock.json
    package.json
    specs/                   # WebdriverIO E2E test specs
    wdio.conf.js             # tauri-driver + WebdriverIO config
```

---

## Structure rationale

### Root docs
Core product and architecture docs live under `docs/`, while `AGENTS.md` remains at the repository root so implementation agents see it immediately.

### `apps/desktop`
Contains the Tauri application and frontend. Avoid putting core engine logic here beyond bridge concerns.

### `crates/workflow-model`
Shared workflow definitions and validation-friendly types.

Key source files:
- `src/node.rs` — `NodeKind` enum and `NodeDefinition` struct (with custom `Deserialize` using `node_type` to drive config parsing)
- `src/node_config.rs` — typed `NodeConfig` enum and per-kind config structs (`AgentNodeConfig`, `ToolNodeConfig`, `RouterNodeConfig`, `MemoryNodeConfig`, `HumanReviewNodeConfig`, `StartNodeConfig`, `EndNodeConfig`)

### `crates/event-model`
Shared event types and payload definitions. This crate is foundational for replay.

### `crates/core-engine`
Execution coordinator, scheduler, state machine logic, and run control.

### `crates/runtime-adapters`
Boundary layer for CLI-backed execution and future adapters.

### `crates/persistence`
SQLite access, repositories, and migration-related concerns.

### `crates/simulation`
Reserved for future modeling of latency/cost/risk without polluting core execution early.

### `tests/e2e`
End-to-end tests using `tauri-driver` + WebdriverIO against a real compiled Tauri build. See [`docs/TESTING.md`](TESTING.md) for setup and usage.

---

## Early implementation order

Recommended order:
1. `workflow-model`
2. `event-model`
3. `core-engine`
4. `persistence`
5. `runtime-adapters`
6. `apps/desktop`

The UI will move faster once the engine and event contracts stabilize.
