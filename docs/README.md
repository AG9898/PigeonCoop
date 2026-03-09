# Agent Arcade

Agent Arcade is a local-first desktop application for designing, running, monitoring, and replaying agent workflows through a game-inspired 2D interface.

## Core idea

Use a visual workflow builder and mission-control style runtime view to manage practical agent and tool tasks operating on a local repository or workspace.

## Status

Active development — foundations, data models, event schema, persistence, core engine skeleton, and basic UI canvas are complete. CI is running.

![CI](https://github.com/ag9898/PigeonCoup/actions/workflows/ci.yml/badge.svg)

## Development setup

```bash
# Rust unit tests (excludes src-tauri binary shell)
cargo test --workspace --exclude agent-arcade

# Frontend component tests
cd apps/desktop && npm test -- --run
```

CI runs both automatically on every push and PR to `main` via `.github/workflows/ci.yml`.

### Running the app

**Browser only (no Rust backend):**
```bash
cd apps/desktop
npm run dev
# Open http://localhost:1420 in your browser
```

**Full Tauri desktop app:**
```bash
cd apps/desktop
npm run tauri dev
# Starts Vite on port 1420 and opens a native window
```

The Tauri config (`src-tauri/tauri.conf.json`) is set up with `beforeDevCommand` so Vite starts automatically alongside the Rust backend — no need to start the frontend separately.

#### WSL2 / WSLg note
On WSL2, the native window requires WSLg (Windows 11 with `wsl --update`). The MESA/ZINK GPU warnings in the console are harmless. If the window hangs on close, run `wsl --shutdown` from PowerShell to clear it.

## Core docs

- [AGENTS.md](./AGENTS.md)
- [PRD.md](./PRD.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [DESIGN_SPEC.md](./DESIGN_SPEC.md)
- [EVENT_SCHEMA.md](./EVENT_SCHEMA.md)
- [REPO_STRUCTURE.md](./REPO_STRUCTURE.md)
- [DECISIONS.md](./DECISIONS.md)
- [TESTING.md](./TESTING.md)

## v1 focus

- visual workflow design
- local CLI-backed execution
- repository-aware tasks
- live monitoring
- replay/debugging
- human review gates
