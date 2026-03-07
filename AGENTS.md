# AGENTS.md

## Project: Agent Arcade

Agent Arcade is a local-first desktop application for designing, running, monitoring, and replaying agent workflows through a game-inspired 2D interface. It is built as a Tauri desktop app with a Rust core engine and a React/TypeScript frontend.

This file is the working contract for implementation agents (Claude Sonnet/Opus, Codex, or similar). Follow it strictly.

---

## 1. Product intent

Build a **workflow design and monitoring tool** for agentic systems.

It is **not**:
- a generic chatbot app
- a cloud-first SaaS in v1
- a universal autonomous multi-agent framework
- a full 3D game
- an unconstrained agent swarm sandbox

It **is**:
- a local desktop tool
- a visual workflow builder
- a runtime monitor
- a replay/debugger
- a CLI/task wrapper for practical development workflows
- a game-styled but developer-grade systems tool

### Core promise
A developer should be able to:
1. define a workflow visually
2. execute it against a local project/repository
3. watch progress live
4. inspect prompts, commands, outputs, and routing
5. replay and debug failures after the run

---

## 2. Non-negotiable architectural rules

### Rule A — Engine owns truth
The Rust core owns execution state. The UI renders state but never invents it.

### Rule B — Event-first system
Every important transition emits a typed event. Replay is a first-class requirement, not an add-on.

### Rule C — Separate definition from execution
Keep these distinct:
- `WorkflowDefinition`
- `RunInstance`
- `RunEvent`
- `MemoryState`
- `NodeSnapshot`

Do not mutate workflow definitions during execution.

### Rule D — Explicit state transitions only
Node and run state must be modeled as finite state machines. Do not infer state from logs, timers, or UI state.

### Rule E — Constrained execution
No unbounded orchestration in v1.

Allowed:
- DAG execution
- conditional routing
- bounded retries
- human review gates
- optional bounded loop support only if explicitly modeled

Not allowed in v1:
- autonomous graph rewrites
- freeform agent spawning
- unconstrained agent-to-agent chatter outside the graph
- hidden side effects

### Rule F — Explicit I/O contracts
Every node type must declare:
- expected inputs
- produced outputs
- memory access
- side effects
- retry semantics

---

## 3. v1 scope boundaries

### In scope
- Tauri desktop app
- Rust core engine
- React/TypeScript UI
- 2D graph/canvas builder
- local workflow execution
- CLI/shell wrapper execution model
- project/repo-aware execution context
- live run visualization
- replay/timeline debugging
- human review nodes
- local SQLite persistence
- JSON workflow format
- import/export
- practical developer workflows (code/project tasks)

### Out of scope
- cloud multi-tenant deployment
- collaborative editing
- distributed workers
- plugin marketplace
- dynamic graph mutation at runtime
- open-ended orchestrator agents
- full framework compatibility with every agent ecosystem
- 3D graphics/game engine first build

---

## 4. Primary user and primary use case

### Primary user
A technical developer building or debugging agent workflows that operate on a local repository or workspace.

### Primary v1 use case
The user designs a workflow in a visual app, runs it against a local project directory, watches node execution live, and uses replay/debugging to inspect what happened.

### Secondary use case
The user uses the tool as a more visual, inspectable wrapper around CLI-based agent or automation commands.

---

## 5. Approved stack

### Desktop shell
- Tauri

### Core engine
- Rust

### Frontend
- React
- TypeScript
- graph editor library such as React Flow (or equivalent)

### Persistence
- SQLite

### Serialization
- JSON

### Execution model
- CLI/shell command wrapper first
- commands execute in a selected workspace/project root
- support arbitrary shell commands in v1, behind safety controls and explicit user configuration
- allow raw write commands in v1, but prefer Git-aware patch/edit flows where possible

### Safety preference for implementation
When building task execution features:
1. prefer structured edit/patch operations
2. support raw command execution when necessary
3. always log commands, working directory, exit code, stdout/stderr metadata, and changed files if detectable

---

## 6. Node taxonomy for v1

Implement exactly these node types first:

1. **Start Node**
   - entry point only
2. **End Node**
   - terminal success/failure sink
3. **Agent Node**
   - runs an agent-oriented task via CLI/provider adapter
4. **Tool Node**
   - runs scripts, build/test commands, linters, formatters, or other local tools
5. **Router Node**
   - deterministic branching based on prior outputs or explicit rules
6. **Memory Node**
   - read/write run-scoped shared memory
7. **Human Review Node**
   - pauses execution for inspection/approve/reject/edit

Do not add manager/orchestrator nodes in v1 unless the rest of the system is already stable.

---

## 7. Canonical first demo workflow

Use this as the first real end-to-end workflow:

**Plan -> Execute Tool -> Critique -> Approve**

Concrete example:
1. Agent node analyzes a repo task
2. Tool node runs build/test/lint or a CLI action
3. Agent node critiques the result
4. Human review node approves retry/escalation/finalize

This workflow should drive schema, run state, UI, replay, and event design.

---

## 8. State model requirements

### Run lifecycle
Recommended enum:
- `Created`
- `Validating`
- `Ready`
- `Running`
- `Paused`
- `Succeeded`
- `Failed`
- `Cancelled`

### Node lifecycle
Recommended enum:
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

### Memory scopes
Support these scopes in v1:
- `run_shared`
- `node_local`

Later expansions can add project/persistent memory.

---

## 9. Event model requirements

Every important transition must emit a typed event.

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

Each event should include, where applicable:
- `event_id`
- `run_id`
- `workflow_id`
- `node_id`
- `timestamp`
- `event_type`
- `payload`
- `causation_id`
- `correlation_id`

---

## 10. UX principles

### The UI should feel alive, not childish
Target vibe:
- mission control
- strategy game HUD
- systems simulator

Not:
- toy game
- noisy arcade gimmick
- visual clutter

### UX priorities
1. debugging clarity
2. practical task execution
3. live visibility
4. aesthetic differentiation

### Required views
- Builder View
- Live Run View
- Replay View
- Workflow/Run Library View

---

## 11. Implementation priorities

### Phase order
1. shared models and schemas
2. core engine state machine
3. event log and persistence
4. minimal CLI execution adapter
5. builder UI
6. live monitoring UI
7. replay UI
8. polish and docs

### What to optimize for
- inspectability
- deterministic replay
- typed contracts
- clean module boundaries
- documentation quality

### What not to optimize for initially
- massive adapter surface area
- multi-user collaboration
- remote orchestration
- visual overproduction before core execution works

---

## 12. Documentation obligations

Every substantial implementation change must update the relevant docs.

At minimum, keep these in sync:
- `PRD.md`
- `ARCHITECTURE.md`
- `DESIGN_SPEC.md`
- `EVENT_SCHEMA.md`
- `REPO_STRUCTURE.md`
- `DECISIONS.md`

When changing schema/state/event design:
- update docs in the same change
- add examples where practical
- note migration implications

Do not let code drift far ahead of documentation.

---

## 13. Coding and repo guidelines

### Rust
- prefer strong typing over dynamic maps
- use enums for state machines and node/event kinds
- avoid hidden side effects
- keep core engine crate independent from Tauri-specific concerns
- design for testability first

### Frontend
- treat backend events as source-of-truth input
- do not duplicate execution logic in the UI
- keep visual state derivable from engine state/events
- separate design-time graph editing concerns from run-time monitoring concerns

### Persistence
- workflow definitions versioned separately from runs
- event log append-only in principle
- avoid lossy transformation of run traces

---

## 14. ADR / decision policy

Track meaningful technical decisions in `DECISIONS.md` or ADR files.

Record at least:
- context
- decision
- alternatives considered
- tradeoffs
- follow-up implications

This project will be implemented with multiple agents/models. Decision logging is mandatory to keep work coherent.

---

## 15. Current assumptions locked for v1

These are currently approved:
- local-first desktop app
- Tauri shell
- Rust core
- React/TypeScript frontend
- CLI wrapper as first execution target
- practical repository-aware task execution
- support arbitrary shell commands in a chosen workspace
- allow raw write commands, with logged execution and preference for patch-aware flows when available
- human review/edit/retry support
- JSON workflow format initially
- open source orientation

If implementation pressure forces tradeoffs, preserve these in order:
1. replay/debugging integrity
2. execution state correctness
3. practical usability on real projects
4. visual polish
