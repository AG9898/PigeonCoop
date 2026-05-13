# AGENTS.md

## Project: Agent Arcade

Agent Arcade is a local-first Tauri desktop app for designing, running, monitoring, and replaying agent workflows through a game-inspired 2D interface. Rust owns the core engine; React/TypeScript renders the workflow builder, live monitor, replay tools, and library views.

This is the working contract for implementation agents. Keep it current, concise, and aligned with the docs in `docs/`.

---

## 1. Product intent

Build a workflow design and monitoring tool for agentic systems.

It is:
- a local desktop tool
- a visual workflow builder
- a runtime monitor and replay/debugger
- a CLI/task wrapper for practical repository workflows
- game-styled, but developer-grade

It is not:
- a generic chatbot app
- a cloud-first SaaS in v1
- a universal autonomous multi-agent framework
- a full 3D game
- an unconstrained swarm sandbox

Core promise: a developer can define a workflow visually, run it against a local repo, watch progress live, inspect prompts/commands/outputs/routing, and replay failures afterward.

---

## 2. Non-negotiable architecture

### Engine owns truth
The Rust core owns execution state. The UI renders backend state/events and must not invent execution truth.

### Event-first system
Every important transition emits a typed event. Replay is a first-class requirement.

### Definition and execution are separate
Keep these distinct:
- `WorkflowDefinition`
- `RunInstance`
- `RunEvent`
- `MemoryState`
- `NodeSnapshot`

Do not mutate workflow definitions during execution.

### Explicit state machines
Node and run state must be modeled as finite state machines. Do not infer state from logs, timers, or UI-only state.

### Constrained execution
Allowed in v1:
- DAG execution
- conditional routing
- bounded retries
- human review gates
- optional bounded loops only if explicitly modeled

Not allowed in v1:
- autonomous graph rewrites
- freeform agent spawning
- unconstrained agent-to-agent chatter outside the graph
- hidden side effects

### Explicit I/O contracts
Every node type must declare expected inputs, produced outputs, memory access, side effects, and retry semantics.

---

## 3. v1 scope

In scope:
- Tauri desktop app with Rust core and React/TypeScript frontend
- 2D graph/canvas builder
- local workflow execution against selected projects/repos
- CLI/shell command wrapper execution
- live run visualization
- replay/timeline debugging
- human review nodes
- local SQLite persistence
- JSON workflow import/export
- practical developer workflows

Out of scope:
- cloud multi-tenant deployment
- collaborative editing
- distributed workers
- plugin marketplace
- dynamic runtime graph mutation
- open-ended orchestrator agents
- broad compatibility with every agent ecosystem
- 3D-first game engine work

If tradeoffs are required, preserve this order:
1. replay/debugging integrity
2. execution state correctness
3. practical usability on real projects
4. visual polish

---

## 4. Stack and execution model

- Desktop shell: Tauri
- Core engine: Rust
- Frontend: React, TypeScript, React Flow or equivalent
- Persistence: SQLite
- Serialization: JSON
- Execution: CLI/shell command wrapper first

Commands execute in a selected workspace root. Arbitrary shell commands are allowed in v1 behind explicit user configuration and safety controls. Prefer structured patch/edit flows when available, but raw write commands are allowed if execution logs capture command, working directory, exit code, stdout/stderr metadata, and detectable changed files.

---

## 5. Node taxonomy

Implement exactly these node types first:

1. Start Node: entry point only
2. End Node: terminal success/failure sink
3. Agent Node: runs an agent-oriented task via CLI/provider adapter
4. Tool Node: runs scripts, build/test commands, linters, formatters, or local tools
5. Router Node: deterministic branching based on prior outputs or explicit rules
6. Memory Node: read/write run-scoped shared memory
7. Human Review Node: pauses execution for inspect/approve/reject/edit

Do not add manager/orchestrator nodes in v1 unless the rest of the system is stable.

Canonical first demo workflow: **Plan -> Execute Tool -> Critique -> Approve**.

---

## 6. State and event requirements

Run lifecycle:
- `Created`
- `Validating`
- `Ready`
- `Running`
- `Paused`
- `Succeeded`
- `Failed`
- `Cancelled`

Node lifecycle:
- `Draft`
- `Validated`
- `Ready`
- `Queued`
- `Running`
- `Waiting`
- `Succeeded`
- `Failed`
- `Cancelled`
- `Skipped`

Memory scopes for v1:
- `run_shared`
- `node_local`

Minimum event families:
- workflow events
- run lifecycle events
- node lifecycle events
- routing events
- command execution events
- agent request/response events
- memory read/write events
- human review events
- budget/guardrail events
- persistence/import/export events

Each event should include, where applicable: `event_id`, `run_id`, `workflow_id`, `node_id`, `timestamp`, `event_type`, `payload`, `causation_id`, and `correlation_id`.

---

## 7. UX principles

The UI should feel like mission control, a strategy-game HUD, or a systems simulator. It should not feel like a toy, noisy arcade gimmick, or decorative tech demo.

Prioritize:
1. debugging clarity
2. practical task execution
3. live visibility
4. aesthetic differentiation

Required views:
- Builder View
- Live Run View
- Replay View
- Workflow/Run Library View

---

## 8. Implementation priorities

Phase order:
1. shared models and schemas
2. core engine state machine
3. event log and persistence
4. minimal CLI execution adapter
5. builder UI
6. live monitoring UI
7. replay UI
8. polish and docs

Optimize for inspectability, deterministic replay, typed contracts, clean module boundaries, and documentation quality. Do not optimize first for adapter breadth, collaboration, remote orchestration, or visual overproduction.

---

## 9. Coding guidelines

Rust:
- prefer strong typing over dynamic maps
- use enums for state machines and node/event kinds
- avoid hidden side effects
- keep core engine crates independent from Tauri concerns
- design for testability

Frontend:
- treat backend events as source-of-truth input
- do not duplicate execution logic in the UI
- keep visual state derivable from engine state/events
- separate design-time graph editing from run-time monitoring

Persistence:
- version workflow definitions separately from runs
- keep the event log append-only in principle
- avoid lossy transformation of run traces

---

## 10. Docs and decisions

Every substantial implementation change must update relevant docs in the same change.

Update:
- `docs/PRD.md` for product scope, users, or success criteria
- `docs/ARCHITECTURE.md` for topology, boundaries, crates, or data flow
- `docs/DESIGN_SPEC.md` for UI behavior and visual language
- `docs/EVENT_SCHEMA.md` for events, lifecycles, replay, or payloads
- `docs/REPO_STRUCTURE.md` for layout or major generated assets
- `docs/TAURI_IPC_CONTRACT.md` for frontend/backend command contracts
- `docs/TESTING.md` for test strategy, commands, fixtures, or patterns
- `docs/workboard.md` and `docs/workboard.schema.json` for workboard shape/rules
- `docs/DECISIONS.md` for meaningful technical decisions
- this file when durable agent rules or summarized constraints change

When changing schema, state, or event design, include examples where practical and note migration implications.

Decision records must include context, decision, alternatives considered, tradeoffs, and follow-up implications.

---

## 11. Workboard

Canonical queue: `docs/workboard.json`.
Contract: `docs/workboard.md`.
Schema: `docs/workboard.schema.json`.

Use the workboard skills for targeted selection and updates:
- `query-workboard`
- `start-task`
- `edit-workboard`
- `project-plan`

Do not dump the full board into context when a targeted query is enough.

A task is startable when:
- `status` is `todo` or `ready`
- `blocked_by` is empty
- every `depends_on` task is `done`

Targeted edit rules:
- never bulk-rewrite `docs/workboard.json`
- edit only fields relevant to the active task or requested planning change
- keep `project.updated_at` current when the board changes
- do not invent new `group_id` values without updating `task_groups` and workboard docs

---

## 12. Agent workflow

Standard task cycle:
1. Read this file at the start of a task.
2. Use `query-workboard` when task selection is needed.
3. Use `start-task` for end-to-end workboard task execution when appropriate.
4. Read only the docs relevant to the task before editing.
5. Implement the smallest coherent change that satisfies the task.
6. Run relevant verification commands.
7. Update docs and workboard entries in the same change when needed.
8. Record meaningful decisions in `docs/DECISIONS.md`.

Repo-local skills are synced from `/home/ag9898/projects/ag.dev/skills-core` into `.claude/skills/`, `.agents/skills/`, and `.codex/skills/`. Do not hand-edit generated skill copies unless the user explicitly asks for a local override; prefer updating the source in `ag.dev` and re-running the sync script.

Stop and report when:
- no startable workboard task exists
- verification fails and the fix is not clear
- a request would violate v1 boundaries
- a schema, event, or state-machine change needs an uncaptured decision
- an irreversible action is required without explicit authorization

---

## 13. Verification commands

Prefer the narrowest relevant checks, but do not skip fast checks for touched areas.

| Command | What it checks |
|---|---|
| `cargo test --workspace --exclude agent-arcade` | Rust workspace tests excluding the Tauri binary shell |
| `cd apps/desktop && npm test -- --run` | Frontend unit/component tests |
| `npx --yes ajv-cli validate -s docs/workboard.schema.json -d docs/workboard.json` | Workboard schema validity |
| `cd apps/desktop && npm run dev` | Browser-only frontend startup |
| `cd apps/desktop && npm run tauri dev` | Full desktop startup |

---

## 14. Discoveries

Append durable project discoveries here when they would save future agents time.

Format:

```md
### YYYY-MM-DD — Short title
What was discovered, why it matters, and what future agents should do differently.
```

Keep entries short. Do not reorganize or rewrite existing entries unless asked.
