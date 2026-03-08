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
