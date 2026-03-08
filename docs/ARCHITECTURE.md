# Architecture

## 1. System overview

Agent Arcade is a local-first desktop system with four major layers:

1. **Desktop shell** — Tauri packaging and native bridge
2. **Frontend UI** — React/TypeScript app for building, monitoring, and replaying workflows
3. **Core engine** — Rust workflow execution engine and event/state system
4. **Persistence** — SQLite-backed storage for workflows, runs, and events

The architecture is intentionally optimized for:
- deterministic execution state
- replayability
- practical local task execution
- clear separation between workflow definition and run state

---

## 2. Top-level component model

```text
+----------------------------------------------------------+
|                     Tauri Desktop App                    |
|                                                          |
|  +-------------------+        +-----------------------+  |
|  | React/TS UI       | <----> | Tauri Bridge         |  |
|  | - Builder View    |        | commands / events    |  |
|  | - Live Run View   |        +----------+------------+  |
|  | - Replay View     |                   |               |
|  | - Library View    |                   v               |
|  +-------------------+        +-----------------------+  |
|                               | Rust Core Engine      |  |
|                               | - workflow validator  |  |
|                               | - run coordinator     |  |
|                               | - state machines      |  |
|                               | - event bus           |  |
|                               | - runtime adapters    |  |
|                               +----------+------------+  |
|                                          |               |
|                                          v               |
|                               +-----------------------+  |
|                               | SQLite Persistence    |  |
|                               | - workflows           |  |
|                               | - versions            |  |
|                               | - runs                |  |
|                               | - events              |  |
|                               | - settings            |  |
|                               +-----------------------+  |
+----------------------------------------------------------+
```

---

## 3. Architectural style

### 3.1 Event-sourced execution core
The engine should emit typed events for every important transition. Run replay is reconstructed from an event stream plus stored snapshots or derived state.

### 3.2 State-machine-driven lifecycle
Runs and nodes are modeled as explicit state machines. The UI reflects state from the engine rather than deriving it independently.

### 3.3 Local-first command execution
Execution targets in v1 are primarily local CLI/shell-backed actions running in a selected workspace or repository root.

### 3.4 Constrained workflow graph
Workflow execution is graph-based but intentionally constrained to preserve observability and debuggability.

---

## 4. Primary runtime responsibilities

### Frontend responsibilities
- graph editing
- node configuration
- run view rendering
- replay timeline UI
- validation feedback display
- settings/workspace selection

### Core engine responsibilities
- validate workflow definitions
- construct run plans
- schedule node execution
- manage run and node state transitions
- emit typed events
- enforce guardrails and limits
- invoke runtime adapters
- persist run/event data

### Persistence responsibilities
- store workflow definitions and versions
- store run metadata
- store append-only event history
- support lookup for replay and library views

---

## 5. Domain model

### 5.1 WorkflowDefinition
Static graph definition editable by the user.

Suggested fields:
- `workflow_id`
- `name`
- `version`
- `metadata`
- `nodes[]`
- `edges[]`
- `default_constraints`
- `created_at`
- `updated_at`

### 5.2 NodeDefinition
Static description of one node.

Fields:
- `node_id`
- `node_type`
- `label`
- `config` — typed `NodeConfig` enum; discriminated by `node_type` during JSON deserialisation
- `input_contract`
- `output_contract`
- `memory_access`
- `retry_policy`
- `display`

#### NodeConfig variants (`crates/workflow-model/src/node_config.rs`)

| NodeKind     | Config struct            | Required fields          | Optional fields                     |
|--------------|--------------------------|--------------------------|-------------------------------------|
| `start`      | `StartNodeConfig`        | —                        | —                                   |
| `end`        | `EndNodeConfig`          | —                        | —                                   |
| `agent`      | `AgentNodeConfig`        | `prompt`                 | `provider_hint`                     |
| `tool`       | `ToolNodeConfig`         | `command`                | `shell`, `timeout_ms`               |
| `router`     | `RouterNodeConfig`       | `rules[]`                | —                                   |
| `memory`     | `MemoryNodeConfig`       | `key`, `scope`, `operation` | —                                |
| `human_review` | `HumanReviewNodeConfig` | —                       | `prompt`, `reason`, `available_actions` |

`NodeConfig` serialises as the inner struct (untagged). `node_type` drives deserialisation so no extra discriminator field is needed in JSON.

### 5.3 EdgeDefinition
Static directed connection between nodes.

Suggested fields:
- `edge_id`
- `source_node_id`
- `target_node_id`
- `condition_kind`
- `condition_payload`
- `label`

### 5.4 RunInstance
One execution of a workflow definition.

Suggested fields:
- `run_id`
- `workflow_id`
- `workflow_version`
- `status`
- `workspace_root`
- `created_at`
- `started_at`
- `ended_at`
- `active_nodes[]`
- `constraints`
- `summary`

### 5.5 RunEvent
Immutable event emitted during execution.

Suggested fields:
- `event_id`
- `run_id`
- `workflow_id`
- `node_id?`
- `event_type`
- `timestamp`
- `payload`
- `causation_id?`
- `correlation_id?`

### 5.6 MemoryState
Execution-visible memory scoped to run or node.

Suggested scopes:
- `run_shared`
- `node_local`

---

## 6. Node taxonomy

### Start Node
No inbound edges. Initializes execution.

### End Node
Terminal node for success/failure completion.

### Agent Node
Represents an agent task. In v1 this is typically executed via a CLI/provider adapter and produces a structured output artifact plus logs.

### Tool Node
Represents a tool/script/build/test/lint/action against the workspace.

### Router Node
Evaluates deterministic routing conditions and activates one or more outgoing edges.

### Memory Node
Reads from or writes to run-scoped or node-local memory.

### Human Review Node
Suspends execution and waits for operator intervention.

---

## 7. Execution model

### 7.1 Workflow execution style
Primary model:
- directed graph execution
- single local coordinator
- deterministic routing rules
- bounded retries
- optional pause/resume

### 7.2 Run lifecycle
Implemented as `RunStatus` in `crates/workflow-model/src/run.rs`. Variants:
- `Created`
- `Validating`
- `Ready`
- `Running`
- `Paused`
- `Succeeded`
- `Failed`
- `Cancelled`

State transitions are enforced by `crates/core-engine/src/state_machine/mod.rs` via `try_transition(current: &RunStatus, input: RunTransitionInput) -> Result<(RunStatus, RunEventKind), TransitionError>`. Valid transitions:
- `Created` → `Validating` (BeginValidation → emits `run.validation_started`)
- `Validating` → `Ready` (ValidationPassed → emits `run.validation_passed`)
- `Validating` → `Failed` (ValidationFailed → emits `run.validation_failed`)
- `Ready` → `Running` (Start → emits `run.started`)
- `Running` → `Paused` (Pause → emits `run.paused`)
- `Paused` → `Running` (Resume → emits `run.resumed`)
- `Running` → `Succeeded` (Succeed → emits `run.succeeded`)
- `Running` → `Failed` (Fail → emits `run.failed`)
- `Running` → `Cancelled` (Cancel → emits `run.cancelled`)
- `Paused` → `Cancelled` (Cancel → emits `run.cancelled`)

All other transitions return `TransitionError::InvalidTransition`. The function is pure (no I/O or side effects).

### 7.3 Node lifecycle
Implemented as `NodeStatus` in `crates/workflow-model/src/run.rs`. Variants:
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

Per-node state is captured in `NodeSnapshot` (same file): `node_id`, `status`, `attempt`, `started_at`, `ended_at`, `output`.

Node state transitions are enforced by `crates/core-engine/src/state_machine/node.rs` via `try_node_transition(current: &NodeStatus, attempt: u32, input: NodeTransitionInput) -> Result<(NodeStatus, u32, NodeEventKind), NodeTransitionError>`. The returned `u32` is the new attempt count (incremented only on `ScheduleRetry`). Valid transitions:
- `Ready` → `Queued` (Queue → emits `node.queued`)
- `Queued` → `Running` (Start → emits `node.started`)
- `Running` → `Waiting` (WaitForReview → emits `node.waiting`)
- `Waiting` → `Running` (Resume → emits `node.started`)
- `Running` → `Succeeded` (Succeed → emits `node.succeeded`)
- `Running` → `Failed` (Fail → emits `node.failed`)
- `Failed` → `Queued` (ScheduleRetry → emits `node.retry_scheduled`, increments attempt)
- `Running` → `Cancelled` (Cancel → emits `node.cancelled`)
- `Queued` → `Cancelled` (Cancel → emits `node.cancelled`)
- `Waiting` → `Cancelled` (Cancel → emits `node.cancelled`)
- `Ready` → `Skipped` (Skip → emits `node.skipped`)
- `Queued` → `Skipped` (Skip → emits `node.skipped`)

All other transitions return `NodeTransitionError::InvalidTransition`. The function is pure (no I/O or side effects).

### 7.4 Guardrails
At minimum support:
- `max_retries`
- `max_runtime_ms`
- `max_steps`
- optional budget/token controls where available

---

## 8. Runtime adapter model

The first execution target is a CLI wrapper model.

### v1 adapter types
- shell command adapter
- external CLI agent adapter
- local tool/script adapter

### Adapter requirements
Each adapter should expose a consistent interface such as:
- prepare execution
- launch process
- stream stdout/stderr/progress
- capture exit code
- collect outputs/artifacts metadata
- emit completion/failure events

### Implementation notes (ADAPT-001)
- `Adapter` trait defined in `crates/runtime-adapters/src/lib.rs`
- Methods: `prepare`, `execute`, `abort` — all return `Pin<Box<dyn Future + Send>>` for object-safety
- `execute` receives `&NodeDefinition`, `workspace_root: &str`, `&MemoryState`, and `mpsc::Sender<CommandEventKind>` for streaming events
- Returns `AdapterOutput` (output JSON, exit_code, stdout, stderr, duration_ms) or `AdapterError`
- `MockAdapter` in `crates/runtime-adapters/src/mock/mod.rs` — configurable canned output for engine tests

### Implementation notes (ADAPT-002)
- `CliAdapter` in `crates/runtime-adapters/src/cli/mod.rs`
- Executes commands via `sh -c <command>` in the given `workspace_root`
- Command extracted from `node.config` by matching on `NodeConfig::Tool(cfg)` and reading `cfg.command` — **do not call `.get("command")` on `NodeConfig`; it is a typed enum, not a `serde_json::Value`**
- Streams stdout/stderr via background `tokio::spawn` tasks, emitting `CommandEventKind::Stdout/Stderr` chunks
- Abort support: `CliAdapter` stores a `oneshot::Sender`; `abort()` sends the signal; `execute` races via `tokio::select!`
- Timeout from `node.retry_policy.max_runtime_ms`; emits `CommandEventKind::Failed` with reason on timeout or abort
- Event sequence: `Prepared` → `Started` → `Stdout`/`Stderr` (streamed) → `Completed` or `Failed`
- All metadata fields logged: command, shell, cwd, timeout_ms, exit_code, duration_ms, stdout_bytes, stderr_bytes

### Execution assumptions approved for v1
- commands execute within a chosen workspace root
- arbitrary shell commands are allowed
- raw write commands are allowed
- structured patch-aware editing flows are preferred where possible
- all side effects must be observable through logs/events/metadata as much as practical

---

## 9. Event flow

Representative execution flow:

1. user starts run
2. engine validates workflow
3. engine emits `run.started`
4. start node activates downstream node(s)
5. engine emits `node.queued`
6. node executes via adapter
7. adapter emits progress-related events
8. engine applies result and determines routing
9. engine emits `edge.routed`
10. next node(s) activate
11. run continues until terminal condition
12. engine emits `run.completed` or `run.failed`

This flow must be reconstructable from persisted events.

---

## 10. UI architecture

### 10.1 Builder View
Purpose:
- author workflows
- configure nodes/edges
- validate graph

Key panels:
- canvas
- node palette
- property inspector
- validation/errors panel

### 10.2 Live Run View
Purpose:
- monitor active execution

Key panels:
- animated graph state
- active node details
- event feed
- workspace/run summary

### 10.3 Replay View
Purpose:
- inspect completed runs

Key panels:
- timeline scrubber
- event inspector
- node state playback
- command/prompt/output details

Implementation notes (UI-RPL-001):
- `apps/desktop/src/views/ReplayView.tsx`
- Accepts `runId: string | null` prop from App shell
- On mount/runId change, calls `invoke("list_events_for_run", { runId, offset, limit })` to load events
- All state is derived from the persisted event sequence — never from live engine state
- Scrubber starts at index 0 (first event); prev/next buttons + range input control position
- Accessible from Library view via "Open in Replay" button (`LibraryView.onOpenReplay` callback)
- `RunEvent` and `RunInstance` types defined in `apps/desktop/src/types/workflow.ts`

### 10.4 Library View
Purpose:
- manage workflows and run history

Key panels:
- workflow list
- versions
- recent runs
- import/export controls

---

## 11. Persistence architecture

SQLite is the primary local datastore.

### Suggested stored entities
- `workflows`
- `workflow_versions`
- `runs`
- `events`
- `settings`
- optional `artifacts`

### Storage guidance
- use normalized tables for core metadata
- store config and payloads as JSON blobs where useful
- preserve append-oriented event history
- support efficient lookup by run id and workflow id

### Implementation notes (PERSIST-001)
- Driver: `rusqlite` (bundled, no system SQLite required)
- Connection wrapper: `Db` in `crates/persistence/src/sqlite/mod.rs`
- Entry points: `Db::open(path)` for file databases, `Db::open_in_memory()` for tests
- Migrations: versioned SQL files in `crates/persistence/migrations/`, embedded via `include_str!`
- Migration tracking: `migrations` table records applied version + timestamp; re-running is safe (idempotent)
- Tables created on first launch: `migrations`, `workflows`, `workflow_versions`, `runs`, `events`, `settings`, `artifacts`

### Implementation notes (PERSIST-002)
- Workflow repository: `crates/persistence/src/repositories/workflows.rs`
- Functions: `save_workflow`, `get_workflow_by_id`, `list_workflows`, `save_workflow_version`, `get_workflow_version`
- `save_workflow` upserts the `workflows` metadata row and inserts/replaces a `workflow_versions` row
- `get_workflow_by_id` returns the highest-version snapshot for a given workflow UUID
- `list_workflows` returns the latest version of each distinct workflow, ordered by `created_at DESC`
- `save_workflow_version` inserts a versioned snapshot independently (used when bumping version without changing the `workflows` row)
- `get_workflow_version` retrieves an exact `(workflow_id, version)` pair
- `WorkflowDefinition` is serialized as JSON into the `definition_json` blob column
- Error type: `RepoError` (wraps `rusqlite::Error` and `serde_json::Error`)

### Implementation notes (PERSIST-003)
- Run repository: `crates/persistence/src/repositories/runs.rs`
- Exposed as `RunRepository<'db>` — a struct holding `&Db`
- `create_run(run)`: inserts a new `RunInstance` row into `runs`
- `update_run_status(run_id, status, started_at, ended_at)`: updates status and timestamps in-place
- `get_run_by_id(run_id)`: single run lookup by UUID; returns `None` if not found
- `list_runs_for_workflow(workflow_id)`: all runs for a workflow, ordered by `created_at DESC`
- `get_active_runs()`: all runs with status in `{created, validating, ready, running, paused}`
- `active_nodes` and `constraints` are not persisted in schema v1; on load, `active_nodes` defaults to `[]` and `constraints` to `RunConstraints::default()`
- Error type: `RunRepoError` (wraps `rusqlite::Error`, parse errors, and invalid status strings)

### Implementation notes (PERSIST-004)
- Event log repository: `crates/persistence/src/repositories/events.rs`
- Exposed as `EventRepository<'db>` — a struct holding `&Db`
- `append_event`: insert-only, assigns monotonically increasing `sequence` per `run_id`
- `list_events_for_run(run_id, offset, limit)`: paginated, ordered by `sequence ASC`
- `get_event_by_id(event_id)`: single event lookup by UUID
- `list_events_for_node(run_id, node_id)`: filtered by node, ordered by `sequence ASC`
- No update or delete methods — append-only by design; duplicate `event_id` fails with PK violation
- Sequence is per-run (not global); each run starts at 1
- Error type: `EventRepoError` (wraps `rusqlite::Error` and `serde_json::Error`)

---

## 12. Proposed repository/module structure

```text
agent-arcade/
  apps/
    desktop/
      src/                 # React/TS frontend
      src-tauri/           # Tauri glue
  crates/
    workflow-model/        # definitions for nodes/edges/workflows
    event-model/           # typed event schema and payloads
    core-engine/           # state machines, scheduler, run coordinator
    runtime-adapters/      # CLI/tool adapters
    persistence/           # SQLite access layer
    simulation/            # later, cost/latency simulation
  docs/
    architecture/
    decisions/
  schemas/
    workflow.schema.json
    run-event.schema.json
  examples/
    plan-execute-critique-approve/
```

---

## 13. Architectural risks

### Risk 1 — State leakage between design-time and run-time
Mitigation:
- strictly separate workflow definition from run instance state

### Risk 2 — Replay drift
Mitigation:
- event-first design
- immutable run history
- deterministic state transitions

### Risk 3 — CLI side effects become opaque
Mitigation:
- log command metadata
- capture stdout/stderr
- track working directory and exit status
- detect changed files where practical

### Risk 4 — UI over-focus on aesthetics
Mitigation:
- keep debugging and inspection usability as the primary design standard

### Risk 5 — Adapter sprawl
Mitigation:
- ship a minimal CLI wrapper abstraction first
- do not chase broad integrations early

### Risk 6 — IPC contract drift between Rust and TypeScript
The Tauri bridge is the hardest boundary to catch at compile time. If a Rust command renames a field or changes a return type, the TypeScript caller silently receives `unknown`.

Mitigation:
- define all IPC contracts in `docs/TAURI_IPC_CONTRACT.md` before implementing run-lifecycle commands
- mirror every contract as a TypeScript interface in `apps/desktop/src/types/ipc.ts`
- use a typed `invokeTyped<T>()` wrapper at every call site — never cast `unknown` inline
- see workboard task **QA-001** (must complete before TAURI-002, TAURI-003, TAURI-004)

### Implementation notes (ENGINE-005)
- `RouterEvaluator` in `crates/core-engine/src/execution/mod.rs` — pure evaluator for outgoing edge conditions
- `RouteDecision` enum: `Routed { selected_edge_ids, skipped_node_ids, reason }` or `NoMatch { reason }`
- Edge evaluation per `ConditionKind`: `Always` → always active; `OnSuccess` → active if source Succeeded; `OnFailure` → active if source Failed; `Expression` → matched via `{"key": "<k>", "equals": <v>}` against source node's `output` JSON
- `apply_routing()` in execution module: called after every node reaches a terminal status; skips non-selected downstream nodes, emits `router.evaluated`, `router.branch_selected` (or `router.no_match`) events
- `NoMatch` causes immediate `run.failed` regardless of whether the source node succeeded or failed
- Scheduler updated: `Failed` and `Cancelled` predecessors are now treated as terminal (alongside `Succeeded`/`Skipped`), enabling `OnFailure`-routed successors to be picked up
- `RunCoordinator::skip_node` transitions a node Ready/Queued → Skipped; `emit_event` appends a pre-built event to the log

### Implementation notes (ENGINE-004)
- `RunCoordinator<L: EventLog>` in `crates/core-engine/src/coordinator.rs` owns all live run state
- `transition_run(RunTransitionInput)` drives run-level state machine, emits `RunEvent` via `EventLog`
- `transition_node(node_id, NodeTransitionInput)` drives per-node state machine, emits node events
- `complete_node_success(node_id, duration_ms)` — increments `steps_executed`, enforces `max_steps` guardrail, auto-succeeds run when all nodes are terminal
- `fail_node(node_id, reason, retries_remaining)` — schedules retry (Failed→Queued) if retries > 0; otherwise fails the run
- `pause_for_review(node_id, reason)` — transitions node Running→Waiting, run Running→Paused
- `approve_review(node_id)` — transitions node Waiting→Running, run Paused→Running
- `cancel(reason)` — valid from Running or Paused; emits `run.cancelled`
- `EventLog` trait is the injection point for the persistence layer; tests use `InMemoryEventLog`
- `RunScheduler` in `crates/core-engine/src/scheduler/mod.rs` — `next_ready_nodes` returns nodes whose predecessors are all Succeeded/Skipped; `topological_order` uses Kahn's algorithm
- `ExecutionDriver` in `crates/core-engine/src/execution/mod.rs` — async driver that loops scheduler→coordinator→adapter; `NodeExecutor` trait injectable; `StubNodeExecutor` used in tests

### Risk 7 — Engine implementation without executable specs
The run coordinator and workflow validator are the most load-bearing Rust components. Implementing them without prior test definitions allows silent correctness assumptions to accumulate.

Mitigation:
- write failing unit tests for `WorkflowValidator` and `RunCoordinator` before implementation begins
- tests define the error vocabulary (`ValidationError`, `StateTransitionError`) used system-wide
- use trait injection for the event log in coordinator tests — no SQLite dependency in unit tests
- see workboard task **QA-002** (must complete before ENGINE-003, ENGINE-004)

### Implementation notes (TAURI-002)
- Run lifecycle commands: `create_run`, `start_run`, `cancel_run`, `get_run`, `list_runs_for_workflow`
- `AppState` updated: `db` is now `Arc<Mutex<Db>>` (shared with background tasks); `active_runs: Mutex<HashMap<Uuid, Arc<AtomicBool>>>` tracks per-run cancellation flags
- `start_run` uses `tokio::spawn` to launch `run_workflow_background` and returns immediately — does not block the `invoke()` call
- Background task drives run through `Created → Validating → Ready → Running`, initializes node snapshots in `Ready` state, runs step loop, persists final status
- Cancellation: `cancel_run` sets the `AtomicBool` flag; the background loop checks it before each step and calls `coordinator.cancel()`
- `TauriEventLog` in `apps/desktop/src-tauri/src/bridge/mod.rs`: implements `EventLog`, persists events to SQLite via `EventRepository`, and emits `run_event_appended`, `run_status_changed`, `node_status_changed` Tauri events on every append
- Stub execution semantics for v1 (all nodes succeed immediately); real adapter dispatch wired in ADAPT-001/ADAPT-002

### Implementation notes (TAURI-001)
- Workflow CRUD commands: `apps/desktop/src-tauri/src/commands/mod.rs`
- Commands registered: `create_workflow`, `get_workflow`, `list_workflows`, `update_workflow`, `delete_workflow`, `import_workflow`, `export_workflow`
- Shared database state: `AppState { db: Arc<Mutex<Db>> }` managed via `app.manage()` in the Tauri `setup` hook
- Database file opened from `app_data_dir()` at startup; migrations run automatically on open
- All command handlers delegate to `persistence::repositories::workflows` — no engine logic in command layer
- Error type: `CmdError { message: String }` implements `Serialize` for Tauri `invoke()` error responses
- `delete_workflow` also added to `persistence::repositories::workflows` (removes versions first, then the workflow row)

---

## 14. Testing architecture

See [`docs/TESTING.md`](TESTING.md) for the full testing strategy.

Summary:
- **Rust unit tests** (`cargo test`) cover the core engine, state machines, event model, and persistence
- **Frontend component tests** (Vitest + React Testing Library) cover React components and hooks with mocked Tauri APIs
- **E2E tests** (`tauri-driver` + WebdriverIO) cover full app flows against a real Tauri build

Playwright is **not used** — it cannot drive Tauri's native webview. Use `tauri-driver` + WebdriverIO for E2E coverage.

### Quality gates for the critical integration path

Before any run-lifecycle or event-bridge Tauri command is implemented, two quality gates must be satisfied:

1. **QA-001 — IPC boundary contract**: `docs/TAURI_IPC_CONTRACT.md` must exist and cover every `invoke()` command and `listen()` event for the run lifecycle. `apps/desktop/src/types/ipc.ts` must export typed interfaces mirroring the contract. This gate blocks TAURI-002, TAURI-003, TAURI-004.

2. **QA-002 — Engine test-first mandate**: Failing unit tests for `WorkflowValidator` and `RunCoordinator` must be committed before ENGINE-003 or ENGINE-004 implementation begins. The tests define the error types and state transition contracts that the rest of the system depends on. This gate blocks ENGINE-003, ENGINE-004.

---

## 15. Future expansion points

Deferred, but architecture should not block them:
- external runtime monitoring mode
- plugin SDK
- simulation and cost modeling
- framework adapters
- persistent project memory
- collaboration/cloud sync
