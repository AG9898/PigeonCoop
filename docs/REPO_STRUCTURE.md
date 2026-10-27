# Repository Structure

## Accepted target boundaries (DEC-014, 2026-10-27)

The actual tree below is the existing desktop-first implementation, not the new
package layout. CLI, MCP, terminal, and skill entry points are planned. Keep
current binary/package names until a deliberate rename; do not create empty
crates merely to match this document.

Target responsibilities:

- workflow-model/event-model: typed versioned definitions, reports, evidence,
  owner/cycle/control metadata and compatibility contracts;
- core/application services: transport-independent validation, recording,
  persistence/query access, projections, and replay; extract Tauri coordination
  without creating a second real-work scheduler;
- persistence: shared durable recording and legacy-compatible storage;
- runtime-adapters: legacy executors and future explicit report/capture adapters;
  keep execution ownership unambiguous during migration;
- simulation: mock-only routing/review/retry/limit driver, no real executor access;
- CLI/MCP surfaces: shared application operations with no desktop dependency;
- skill/template package: assistant-owned general workflows, canonical bounded
  project pipeline, and repository-configurable contracts;
- desktop and terminal workspaces: optional clients over the same project record.
- visual runtime: planned Rust actor positions/facing, presentation sequences and
  sprite-sheet sampling; separate from workflow state and drawing-backend choice.
  Module/crate locations follow a walking-and-interaction prototype.

Exact new crate/directory names are implementation details. The shipped workflow
skill must not be confused with generated repo-local development skills under
.agents/.claude/.codex; those copies still sync from ag.dev/skills-core.

DEC-015 requires a new pixel-character workspace/asset family. Current command-
deck RPG art, public sprites/backdrops, and procedural city/pigeon renderers in
the actual tree are retired design inputs. They remain only for the legacy app;
remove deployed art/imports during replacement rather than repurpose them as
new-UI fallbacks. New asset locations are established by the design task.

New planning docs: INTEGRATION_CONTRACT.md defines the target responsibilities;
implementation-tasks.draft.json holds proposed task records outside the active
workboard. The draft IDs need collision reconciliation before board insertion.

VISUAL_PROTOTYPE_PLAN.md proposes the V2 asset pipeline and first scene test;
assets/concepts/ retains the preferred imagegen draft and prompts as design
references only, not deployed sprite sheets. No runtime imports these concepts.

## Actual layout

```text
.github/
  workflows/
    ci.yml               # CI: cargo test (--exclude agent-arcade) + npm test
    release.yml          # Release: builds .dmg/.msi/.AppImage on v* tag push, attaches to GitHub Release

AGENTS.md
CLAUDE.md               # Symlink to AGENTS.md
Cargo.lock
Cargo.toml

docs/
  ARCHITECTURE.md
  DECISIONS.md
  DESIGN_SPEC.md
  EVENT_SCHEMA.md
  INTEGRATION_CONTRACT.md
  implementation-tasks.draft.json # Proposed tasks only; not the active queue
  PRD.md
  README.md
  REPO_STRUCTURE.md
  TAURI_IPC_CONTRACT.md
  TESTING.md
  workboard.md
  workboard.json
  workboard.schema.json

distribution/
  homebrew/
    agent-arcade.rb      # Homebrew formula (macOS arm64/x64)
  winget/
    AgentArcade.yaml     # winget manifest (Windows MSI)
  aur/
    PKGBUILD             # AUR binary package (Linux AppImage)
    .SRCINFO             # AUR source info

apps/
  desktop/
    package-lock.json
    package.json
    public/
      sprites/             # Legacy WebP sprite sheets served by Vite at /sprites/<filename> (fallback only; procedural rendering is primary per DEC-008)
      backdrops/           # Superseded by procedural city backdrop (DEC-008); kept for legacy tiles if any
      assets/
        command-deck/      # Runtime generated RPG command-interface artwork (DEC-013)
          sprites/         # Transparent 4-frame role strips, 512x128 WebP
    src/
      __mocks__/
      __tests__/
      app/
      components/
        canvas/            # WorkflowCanvas; pigeonDrawing.ts (procedural pigeon, SPRITE-002, integrated); cityDrawing.ts + CityBackdrop.tsx planned (SPRITE-003)
        nodes/             # WorkflowNode (text-based, 6 node types); PigeonSprite + AgentNode (procedural pigeon for the agent node type, SPRITE-002)
        panels/
        sidebar/           # WorkflowSidebar — always-visible library pane (DEC-011)
      data/               # Embedded static data (e.g. demo workflow for first-run seeding)
      hooks/              # React hooks (useFirstRun for demo seeding, useCanvasKeyboard for keyboard-driven canvas navigation, useAnimationTick for the shared ~100ms sprite tick, SPRITE-002)
      main.tsx
      state/              # Pure state-derivation utilities (no React, no side effects)
        deriveNodeStates.ts  # Reconstruct node statuses from an event slice (used by RunPanel)
        deriveTokenPcts.ts   # Derive per-node token-usage percentages from agent events (shared, DEC-011)
      styles/
      types/
      views/               # DesignSurface (edit stage) + RunPanel (run stage, live + replay unified — DEC-011)
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
      agent.rs             # Agent CLI adapter, pipe path (ADAPT-003)
      agent_interactive.rs # Interactive PTY claude sessions (DEC-009)
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

assets/
  generated/
    command-deck/          # Retained source-quality generated art and prompt manifest (DEC-013)
  character-sprites/
    assets_2026-03-27/    # Legacy pigeon sprite sheets (WebP + PNG); superseded by procedural rendering (DEC-008)
  backdrops/              # Legacy source backdrop tiles; superseded by procedural city backdrop (DEC-008)
  design_handoff_city_backdrop_pigeon_sprites/  # High-fidelity design handoff: procedural city backdrop + pigeon sprite (src/ modules are integration source of truth; preview/ is design-tool scaffolding — do not port); see docs/VISUAL_IDENTITY.md and DEC-008

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
Currently a placeholder. DEC-014 changes its target to isolated mock routing,
review, retry, and bounded-cycle simulation. Predictive latency/cost/risk modeling
is not a v1 requirement. No simulator is implemented yet.

### `tests/e2e`
End-to-end tests using `tauri-driver` + WebdriverIO against a real compiled Tauri build. See [`docs/TESTING.md`](TESTING.md) for setup and usage.

---

## Historical early implementation order

Recommended order:
1. `workflow-model`
2. `event-model`
3. `core-engine`
4. `persistence`
5. `runtime-adapters`
6. `apps/desktop`

For new work use PRD.md migration order and DEC-014. This historical list is not
the implementation sequence for assistant-owned recording and optional clients.

### Isolated renderer experiment

`experiments/renderer-lab/` contains the Windows headless PixiJS visual study,
editable SVG/PNG test atlas, draft Rust fixture sampler, browser tests/capture
scripts, and local evidence gallery. It has its own Cargo workspace and npm lock
file; production clients/crates do not import it. See its README/REVIEW for the
native execution blocker and remaining Macroquad/Tauri comparison gates.

The renderer lab now also contains `src/native.rs` (Macroquad), `src/wasm.rs`
(bulk browser sampling), editable test `.aseprite` files, normalized full/trimmed
atlas exports, and a small compiled WASM artifact. `web/draw-adapters.mjs` shares
scene semantics across Canvas/Pixi; `scripts/` contains asset, native/webview,
CLI lifecycle and screenshot conformance probes. `PRODUCT_VERDICT.md` summarizes
results; generated screenshots/raw measurements remain local under `evidence/`.
