# Repository Structure

## Actual layout

```text
.github/
  workflows/
    ci.yml               # CI: cargo test (--exclude agent-arcade) + npm test

docs/
  AGENTS.md
  PRD.md
  ARCHITECTURE.md
  DESIGN_SPEC.md
  EVENT_SCHEMA.md
  REPO_STRUCTURE.md
  DECISIONS.md
  TAURI_IPC_CONTRACT.md
  TESTING.md
  README.md

apps/
  desktop/
    dist/                    # Frontend build output (placeholder until npm run build)
    package.json
    src/
      app/
      components/
      views/
      hooks/
      state/
      styles/
    src-tauri/
      build.rs               # Required: calls tauri_build::build() for generate_context!()
      Cargo.toml
      tauri.conf.json        # Tauri app config (read at compile time by generate_context!())
      icons/
        icon.png             # App icon (RGBA PNG required by tauri_build)
      src/
        main.rs
        lib.rs               # Tauri setup, invoke_handler registration
        commands/
          mod.rs             # All Tauri command handlers
        bridge/
          mod.rs             # TauriEventLog + frontend event payload types

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
      cli/
      mock/
  persistence/
    src/
      sqlite/
      repositories/
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
    specs/                   # WebdriverIO E2E test specs
    wdio.conf.js             # tauri-driver + WebdriverIO config
```

---

## Structure rationale

### Root docs
Keep the core markdown docs in the root during early development so implementation agents and contributors see them immediately.

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
