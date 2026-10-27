# PigeonCoop

PigeonCoop packages assistant-owned project workflows as a skill with CLI and
MCP interfaces, backed by Rust recording, validation, replay, and mock simulation.
Desktop and simplified terminal workspaces are optional views of the same local
project activity.

## Direction and implementation status

The accepted direction is documented in DEC-014 (2026-10-27). The assistant owns
real execution; Rust owns the validated recorded projection. Native Windows and
Linux execution are both required for v1.

The repository still implements the earlier Agent Arcade desktop application.
The new skill/package, CLI/MCP protocol, terminal workspace, recorder boundary,
and mock simulator are planned. Current package/binary names remain unchanged.
No new installation or runtime commands are available from this documentation
change.

The first built-in template will package:

**project-plan -> edit-workboard -> ralphloop(start-task, explicit bound)**

The workspace connects plans, task dependencies, cycles/runs, artifacts, changes,
and verification. It does not require a codebase knowledge graph.

DEC-015 specifies a fresh pixel-character desktop workspace and a matching
cell/ASCII character language for the terminal. Current RPG and older city/pigeon
assets are retired design inputs; the replacement UI will use new art and layout.

## Documentation

- [AGENTS.md](../AGENTS.md) — implementation contract and task workflow
- [PRD.md](PRD.md) — target scope and success criteria
- [ARCHITECTURE.md](ARCHITECTURE.md) — target boundaries and existing baseline
- [INTEGRATION_CONTRACT.md](INTEGRATION_CONTRACT.md) — assistant/CLI/MCP/recorder responsibilities
- [DESIGN_SPEC.md](DESIGN_SPEC.md) — optional desktop/terminal workspace behavior
- [VISUAL_IDENTITY.md](VISUAL_IDENTITY.md) — information hierarchy and presentation
- [VISUAL_PROTOTYPE_PLAN.md](VISUAL_PROTOTYPE_PLAN.md) — proposed V2 asset pipeline and living-scene experiment
- [EVENT_SCHEMA.md](EVENT_SCHEMA.md) — current event contract and migration requirements
- [TAURI_IPC_CONTRACT.md](TAURI_IPC_CONTRACT.md) — existing desktop API
- [REPO_STRUCTURE.md](REPO_STRUCTURE.md) — actual layout and planned boundaries
- [TESTING.md](TESTING.md) — current commands and target verification matrix
- [DECISIONS.md](DECISIONS.md) — accepted decisions and supersession
- [implementation-tasks.draft.json](implementation-tasks.draft.json) — proposed implementation records, outside the active queue
- [workboard.md](workboard.md) — canonical queue rules
- [workboard.schema.json](workboard.schema.json) — current queue schema

The active board has not been replanned for DEC-014. Check legacy task intent
against the accepted direction before execution; docs changes do not modify task
statuses or create queue entries.

## Current development commands

Run Rust tests from the repository root:

    cargo test --workspace --exclude agent-arcade

Run frontend checks from apps/desktop:

    npm test -- --run

Run the current browser-only frontend from apps/desktop:

    npm run dev

Run the current Tauri desktop application from apps/desktop:

    npm run tauri dev

The Tauri beforeDevCommand starts Vite for desktop development. Browser-only
startup has no real Rust backend. See TESTING.md for native desktop prerequisites
and the existing headed Linux/WSL test runbook.

## Windows and Linux development

Use a native toolchain and native checkout for Windows application work, and a
Linux toolchain/checkout for Linux verification. A Linux checkout reached through
a Windows UNC path does not verify Windows process behavior. Do not move or reset
an existing checkout as part of documentation work.

The target headless package must work without a display or Tauri dependencies.
The current adapters still include sh -c execution and desktop-owned interactive
PTY sessions; OS portability and detached inspection are implementation work.
Windows-to-WSL execution is deferred. Existing historical test results are not
evidence that the new package passes on either OS.
