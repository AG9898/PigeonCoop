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

Suggested fields:
- `node_id`
- `node_type`
- `label`
- `config`
- `input_contract`
- `output_contract`
- `memory_access`
- `retry_policy`
- `display`

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
Suggested enum:
- `Created`
- `Validating`
- `Ready`
- `Running`
- `Paused`
- `Succeeded`
- `Failed`
- `Cancelled`

### 7.3 Node lifecycle
Suggested enum:
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

---

## 14. Future expansion points

Deferred, but architecture should not block them:
- external runtime monitoring mode
- plugin SDK
- simulation and cost modeling
- framework adapters
- persistent project memory
- collaboration/cloud sync
