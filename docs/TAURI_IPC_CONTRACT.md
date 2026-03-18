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
{ workflow_id: string; workspace_root: string }
```

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
{ run_id: string }
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
{ run_id: string }
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
{ run_id: string }
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
{ workflow_id: string }
```

**Return type:** `RunInstance[]`

**Error type:** `CmdError`

---

### Event log (planned; not yet registered)

---

#### `list_events_for_run`

Planned paginated event log for a run, ordered by `sequence ASC`. The persistence repository implements this query, and the frontend Replay view already expects it, but the Tauri `invoke_handler` does not currently register this command.

**Rust arg struct:**
```rust
run_id: String,  // UUID
offset: u32,
limit: u32,
```

**TypeScript arg interface:**
```ts
{ run_id: string; offset: number; limit: number }
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
{ run_id: string; node_id: string; decision: HumanReviewDecision }
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

## Events (listen)

These events are emitted by the Rust backend and received via `listen()` on the frontend.

---

### `run_status_changed`

Emitted whenever a run's status transitions.

**Emitter:** `crates/core-engine` run state machine, bridged via TAURI-002 event handler

**Subscriber:** `LiveRunView` — updates run status badge and graph overlay

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

**Subscriber:** `LiveRunView` — updates per-node visual state on the graph canvas

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

Emitted whenever a new `RunEvent` is appended to the log. Used by Live Run View to stream the event feed.

**Emitter:** event persistence layer, called from TAURI-002/003 bridge after `append_event`

**Subscriber:** `LiveRunView` event feed panel, optionally `ReplayView` if watching a live run

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

**Subscriber:** `LiveRunView` — shows review panel; optionally triggers a system notification

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

## Type reference

Types defined in `apps/desktop/src/types/workflow.ts` that are referenced above:

- `WorkflowDefinition`
- `RunInstance`
- `RunEvent`
- `RunStatus`
- `NodeStatus`

Additional types introduced by this contract are defined in `apps/desktop/src/types/ipc.ts`.
