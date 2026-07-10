# Tauri IPC Contract

This document is the **authoritative specification** for every `invoke()` command and `listen()` event crossing the Tauri bridge. Any deviation between a Rust implementation and this contract is a bug.

**Blocks:** TAURI-002, TAURI-003, TAURI-004 must implement against this contract. No undocumented commands or events are permitted.

---

## Error handling

All command handlers return `Result<T, CmdError>` where:

```rust
#[derive(Debug, Serialize)]
pub struct CmdError {
    pub message: String,
}
```

On the JavaScript side, Tauri 2.x rejects the `invoke()` Promise with the serialized error value. Because `CmdError` implements `Serialize`, the rejected value is a **JSON object**:

```json
{ "message": "human-readable error string" }
```

Use the `invokeTyped<T>()` wrapper in `apps/desktop/src/types/ipc.ts` at every call site — it types both the success value and the error shape consistently.

---

## Commands

### Workflow CRUD (TAURI-001)

---

#### `create_workflow`

Persist a new workflow definition.

**Rust arg struct:**
```rust
workflow: WorkflowDefinition
```

**TypeScript arg interface:**
```ts
{ workflow: WorkflowDefinition }
```

**Return type:** `void`

**Error type:** `CmdError`

**Example call:**
```json
{ "workflow": { "workflow_id": "...", "name": "My Flow", ... } }
```

**Example error:**
```json
{ "message": "UNIQUE constraint failed: workflows.id" }
```

---

#### `get_workflow`

Retrieve the latest version of a workflow by UUID string.

**Rust arg struct:**
```rust
id: String  // UUID
```

**TypeScript arg interface:**
```ts
{ id: string }
```

**Return type:** `WorkflowDefinition | null`

**Error type:** `CmdError`

**Example return:**
```json
{ "workflow_id": "...", "name": "My Flow", "version": 1, ... }
```

---

#### `list_workflows`

List the latest version of every stored workflow.

**Rust arg struct:** none

**TypeScript arg interface:** `Record<string, never>` (empty object)

**Return type:** `WorkflowDefinition[]`

**Error type:** `CmdError`

---

#### `update_workflow`

Upsert a workflow — updates metadata row and saves a new version snapshot.

**Rust arg struct:**
```rust
workflow: WorkflowDefinition
```

**TypeScript arg interface:**
```ts
{ workflow: WorkflowDefinition }
```

**Return type:** `void`

**Error type:** `CmdError`

---

#### `delete_workflow`

Delete a workflow and all its version snapshots.

**Rust arg struct:**
```rust
id: String  // UUID
```

**TypeScript arg interface:**
```ts
{ id: string }
```

**Return type:** `void`

**Error type:** `CmdError`

---

#### `import_workflow`

Parse a workflow from a JSON string and persist it. Returns the parsed definition.

**Rust arg struct:**
```rust
json: String
```

**TypeScript arg interface:**
```ts
{ json: string }
```

**Return type:** `WorkflowDefinition`

**Error type:** `CmdError`

---

#### `export_workflow`

Serialize a stored workflow to a JSON string.

**Rust arg struct:**
```rust
id: String  // UUID
```

**TypeScript arg interface:**
```ts
{ id: string }
```

**Return type:** `string` (JSON-encoded `WorkflowDefinition`)

**Error type:** `CmdError`

---

### Run lifecycle (TAURI-002)

---

#### `create_run`

Create a new `RunInstance` for a given workflow and workspace root. Does not start execution.

**Rust arg struct:**
```rust
workflow_id: String,    // UUID
workspace_root: String,
```

**TypeScript arg interface:**
```ts
{ workflowId: string; workspaceRoot: string }
```

> **Tauri 2.x camelCase rule:** `#[tauri::command]` applies `rename_all = "camelCase"` when deserializing arguments from JavaScript. All TypeScript arg interfaces must use camelCase keys (`workflowId`, not `workflow_id`). The Rust structs themselves keep snake_case — only the JS-side call site changes. This applies to every command below.

**Return type:** `RunInstance`

**Error type:** `CmdError`

**Example return:**
```json
{
  "run_id": "550e8400-e29b-41d4-a716-446655440000",
  "workflow_id": "...",
  "workflow_version": 1,
  "status": "created",
  "workspace_root": "/home/user/myproject",
  "created_at": "2026-03-08T10:00:00Z",
  "started_at": null,
  "ended_at": null
}
```

---

#### `start_run`

Transition a `created` or `ready` run to `running`. Triggers engine execution.

**Rust arg struct:**
```rust
run_id: String,  // UUID
```

**TypeScript arg interface:**
```ts
{ runId: string }
```

**Return type:** `void`

**Error type:** `CmdError`

**Example error:**
```json
{ "message": "run abc... is not in a startable state (current: running)" }
```

---

#### `cancel_run`

Request cancellation of an active run. The engine will transition through `cancelled` and emit events.

**Rust arg struct:**
```rust
run_id: String,  // UUID
```

**TypeScript arg interface:**
```ts
{ runId: string }
```

**Return type:** `void`

**Error type:** `CmdError`

---

#### `get_run`

Retrieve a single run by ID.

**Rust arg struct:**
```rust
run_id: String,  // UUID
```

**TypeScript arg interface:**
```ts
{ runId: string }
```

**Return type:** `RunInstance | null`

**Error type:** `CmdError`

---

#### `list_runs_for_workflow`

List all runs for a given workflow, ordered by `created_at DESC`.

**Rust arg struct:**
```rust
workflow_id: String,  // UUID
```

**TypeScript arg interface:**
```ts
{ workflowId: string }
```

**Return type:** `RunInstance[]`

**Error type:** `CmdError`

---

### Event log

---

#### `list_events_for_run`

Paginated event log for a run, ordered by `sequence ASC`. Used by `RunPanel` for the on-open backfill and the polling fallback.

**Rust arg struct:**
```rust
run_id: String,  // UUID
offset: u32,
limit: u32,
```

**TypeScript arg interface:**
```ts
{ runId: string; offset: number; limit: number }
```

**Return type:** `RunEvent[]`

**Error type:** `CmdError`

**Example return:**
```json
[
  {
    "event_id": "...",
    "run_id": "...",
    "workflow_id": "...",
    "node_id": null,
    "event_type": "run.started",
    "timestamp": "2026-03-08T10:00:01Z",
    "payload": {},
    "causation_id": null,
    "correlation_id": null,
    "sequence": 1
  }
]
```

---

### Human review (TAURI-004)

---

#### `submit_human_review_decision`

Submit an operator decision for a paused human-review node.

**Rust arg struct:**
```rust
run_id: String,   // UUID
node_id: String,  // UUID
decision: HumanReviewDecision,
```

Where the backend currently accepts:
```rust
pub enum HumanReviewDecision {
    Approved,
    Rejected,
    RetryRequested,
}
```

**TypeScript arg interface:**
```ts
{ runId: string; nodeId: string; decision: HumanReviewDecision }
```

Where the backend currently accepts:
```ts
type HumanReviewDecision =
  | { type: "approved" }
  | { type: "rejected" }
  | { type: "retry_requested" };
```

Note:
- `apps/desktop/src/types/ipc.ts` still carries a planned `{ type: "edited"; memory_patch: unknown }` variant.
- The Rust command layer does not currently deserialize or handle that variant.
- `human_review_requested.available_actions` may still include `"edit_memory"` because the event model supports it, but the submit command does not yet accept it.

**Return type:** `void`

**Error type:** `CmdError`

---

### Interactive agent sessions (DEC-009)

---

#### `agent_terminal_input`

Write user keystrokes to the PTY of a running interactive agent session.

**Rust arg struct:**
```rust
run_id: String,   // UUID
node_id: String,  // UUID
data: String,     // UTF-8 keystroke bytes (may include control chars, e.g. "\r")
```

**TypeScript arg interface:**
```ts
{ runId: string; nodeId: string; data: string }
```

**Return type:** `void` — no-op error if no live session matches (session ended between render and keypress is expected, not exceptional)

**Error type:** `CmdError`

---

#### `agent_terminal_resize`

Resize the PTY of a running interactive agent session (cols × rows).

**Rust arg struct:**
```rust
run_id: String, node_id: String, cols: u16, rows: u16,
```

**TypeScript arg interface:**
```ts
{ runId: string; nodeId: string; cols: number; rows: number }
```

**Return type:** `void`

**Error type:** `CmdError`

---

#### `complete_agent_node`

Complete an interactive agent node that is `Waiting` in `completion_mode: manual`. Finalizes the session (sends `/exit`, extracts output from the transcript) and resumes the run.

**Rust arg struct:**
```rust
run_id: String, node_id: String,
```

**TypeScript arg interface:**
```ts
{ runId: string; nodeId: string }
```

**Return type:** `void`

**Error type:** `CmdError` — errors if the node has no live session awaiting completion

---

#### `get_codex_default_model`

Read the default model from `~/.codex/config.toml` (`model = "..."`). Used by the NodeInspector to label the OpenAI Codex no-model option (DEC-010).

**Args:** none

**Return type:** `string | null` — `null` when the file or key is absent

**Error type:** `CmdError`

---

## Events (listen)

These events are emitted by the Rust backend and received via `listen()` on the frontend.

---

### `run_status_changed`

Emitted whenever a run's status transitions.

**Emitter:** `crates/core-engine` run state machine, bridged via TAURI-002 event handler

**Subscriber:** `RunPanel` — updates the open run's status strip and graph overlay; `App` shell — keeps sidebar run chips live for runs not open on the stage (refetches the run via `get_run` on terminal transitions to pick up `ended_at`)

**Payload interface:**
```ts
interface RunStatusChangedPayload {
  run_id: string;
  old_status: RunStatus;
  new_status: RunStatus;
  timestamp: string;
}
```

**Example:**
```json
{
  "run_id": "...",
  "old_status": "ready",
  "new_status": "running",
  "timestamp": "2026-03-08T10:00:01Z"
}
```

---

### `node_status_changed`

Emitted whenever a node's status transitions within an active run.

**Emitter:** `crates/core-engine` node state machine, bridged via TAURI-002 event handler

**Subscriber:** none currently — `RunPanel` derives per-node visual state from the event log (`node.*` events) rather than this push event

**Payload interface:**
```ts
interface NodeStatusChangedPayload {
  run_id: string;
  node_id: string;
  old_status: NodeStatus;
  new_status: NodeStatus;
  attempt: number;
  timestamp: string;
}
```

**Example:**
```json
{
  "run_id": "...",
  "node_id": "...",
  "old_status": "queued",
  "new_status": "running",
  "attempt": 1,
  "timestamp": "2026-03-08T10:00:02Z"
}
```

---

### `run_event_appended`

Emitted whenever a new `RunEvent` is appended to the log. Streams the run surface's event feed.

**Emitter:** event persistence layer, called from TAURI-002/003 bridge after `append_event`

**Subscriber:** `RunPanel` — appends to the in-memory event log (deduped by `event_id` against the on-open backfill)

**Payload interface:**
```ts
interface RunEventAppendedPayload {
  event: RunEvent;
}
```

**Example:**
```json
{
  "event": {
    "event_id": "...",
    "run_id": "...",
    "workflow_id": "...",
    "node_id": "...",
    "event_type": "command.stdout",
    "timestamp": "2026-03-08T10:00:05Z",
    "payload": { "line": "✓ 42 tests passed" },
    "causation_id": "...",
    "correlation_id": null,
    "sequence": 7
  }
}
```

---

### `human_review_requested`

Emitted when a human-review node suspends execution and requires operator input.

**Emitter:** `crates/core-engine` when a `HumanReview` node transitions to `Waiting`, bridged via TAURI-002 handler

**Subscriber:** `RunPanel` — shows review panel; optionally triggers a system notification

**Payload interface:**
```ts
interface HumanReviewRequestedPayload {
  run_id: string;
  node_id: string;
  node_label: string;
  reason: string;
  available_actions: Array<"approve" | "reject" | "retry" | "edit_memory">;
  timestamp: string;
}
```

**Example:**
```json
{
  "run_id": "...",
  "node_id": "...",
  "node_label": "Human Approve",
  "reason": "Tests failed after patch application",
  "available_actions": ["approve", "reject", "retry", "edit_memory"],
  "timestamp": "2026-03-08T10:00:10Z"
}
```

---

### `agent_terminal_output`

Raw PTY output bytes from a live interactive agent session (DEC-009). High-frequency; not persisted; never enters the run event log.

**Emitter:** interactive-session bridge task in `apps/desktop/src-tauri/src/commands/mod.rs`

**Subscriber:** `AgentSessionTerminal` (xterm.js) in `RunPanel` — writes `data` to the terminal when `run_id`/`node_id` match

**Payload interface:**
```ts
interface AgentTerminalOutputPayload {
  run_id: string;
  node_id: string;
  data: string; // UTF-8 chunk of PTY output (lossy-decoded), may contain ANSI escapes
}
```

---

### `agent_session_state`

Lifecycle of a live interactive agent session, for terminal-panel chrome (distinct from node status: the node may remain `Running` while claude is between turns).

**Emitter:** interactive-session bridge task in `apps/desktop/src-tauri/src/commands/mod.rs`

**Subscriber:** `AgentSessionTerminal` in `RunPanel` — shows/hides the panel and the *Complete node* button

**Payload interface:**
```ts
interface AgentSessionStatePayload {
  run_id: string;
  node_id: string;
  state: "started" | "awaiting_user" | "ended";
  session_id: string;
}
```

---

## Type reference

Types defined in `apps/desktop/src/types/workflow.ts` that are referenced above:

- `WorkflowDefinition`
- `RunInstance`
- `RunEvent`
- `RunStatus`
- `NodeStatus`

Additional types introduced by this contract are defined in `apps/desktop/src/types/ipc.ts`.
