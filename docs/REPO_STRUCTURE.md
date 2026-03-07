# Repository Structure

## Proposed layout

```text
docs/
  AGENTS.md
  PRD.md
  ARCHITECTURE.md
  DESIGN_SPEC.md
  EVENT_SCHEMA.md
  REPO_STRUCTURE.md
  DECISIONS.md
  README.md

  apps/
    desktop/
      package.json
      src/
        app/
        components/
        views/
        hooks/
        state/
        styles/
      src-tauri/
        Cargo.toml
        src/
          main.rs
          commands/
          bridge/

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
        tools/
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
      specs/                 # WebdriverIO E2E test specs
      wdio.conf.js           # tauri-driver + WebdriverIO config

  docs/
    decisions/
    architecture/
    ux/
```

---

## Structure rationale

### Root docs
Keep the core markdown docs in the root during early development so implementation agents and contributors see them immediately.

### `apps/desktop`
Contains the Tauri application and frontend. Avoid putting core engine logic here beyond bridge concerns.

### `crates/workflow-model`
Shared workflow definitions and validation-friendly types.

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
