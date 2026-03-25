# Event Schema

## 1. Purpose

The event model is the backbone of monitoring and replay. Every important execution transition should be captured as a typed event.

This document defines the initial event taxonomy and payload expectations for v1.

---

## 2. Core event envelope

Suggested base shape:

```json
{
  "event_id": "550e8400-e29b-41d4-a716-446655440000",
  "run_id": "550e8400-e29b-41d4-a716-446655440001",
  "workflow_id": "550e8400-e29b-41d4-a716-446655440002",
  "node_id": "550e8400-e29b-41d4-a716-446655440003",
  "event_type": "node.started",
  "timestamp": "2026-03-07T16:00:00Z",
  "causation_id": "550e8400-e29b-41d4-a716-446655440004",
  "correlation_id": "550e8400-e29b-41d4-a716-446655440005",
  "payload": {}
}
```

All ID fields are UUIDs (v4). `node_id`, `causation_id`, and `correlation_id` are nullable.

### Notes
- `node_id` is optional for run-level events.
- `causation_id` should point to the event that directly triggered this one when applicable.
- `correlation_id` groups related events across a single action chain.
- The `RunEvent` struct in `crates/event-model/src/event.rs` provides typed constructors: `from_run_kind`, `from_node_kind`, `from_routing_kind`, `from_review_kind`, and `from_guardrail_kind`. These populate `event_type` and `payload` automatically from the variant. `CommandEventKind` and `AgentEventKind` do not yet have envelope constructors — callers must build the envelope manually.

---

## 3. Event families

### 3.1 Workflow events
- `workflow.created`
- `workflow.updated`
- `workflow.validated`
- `workflow.imported`
- `workflow.exported`

### 3.2 Run lifecycle events
- `run.created`
- `run.validation_started`
- `run.validation_passed`
- `run.validation_failed`
- `run.started`
- `run.paused`
- `run.resumed`
- `run.succeeded`
- `run.failed`
- `run.cancelled`

### 3.3 Node lifecycle events
- `node.queued`
- `node.started`
- `node.waiting`
- `node.succeeded`
- `node.failed`
- `node.cancelled`
- `node.skipped`
- `node.retry_scheduled`

### 3.4 Routing events
- `edge.routed`
- `router.evaluated`
- `router.branch_selected`
- `router.no_match`

### 3.5 Command / tool execution events
- `command.prepared`
- `command.started`
- `command.stdout`
- `command.stderr`
- `command.completed`
- `command.failed`

Implemented in `crates/event-model/src/command_events.rs` as typed payload structs and `CommandEventKind` enum.

### 3.6 Agent interaction events
- `agent.request_prepared`
- `agent.started`
- `agent.output_received`
- `agent.completed`
- `agent.failed`

Implemented in `crates/event-model/src/agent_events.rs` as typed payload structs and `AgentEventKind` enum.

### 3.7 Memory events
- `memory.read`
- `memory.write`
- `memory.snapshot_created`

Implemented in `crates/event-model/src/memory_events.rs` as `MemoryReadPayload`, `MemoryWritePayload`, `MemorySnapshotCreatedPayload`, and `MemoryEventKind` enum.

Memory scope (`MemoryScope`) mirrors the v1 scopes: `RunShared`, `NodeLocal`. Serializes as snake_case: `"run_shared"` or `"node_local"`.

### 3.8 Human review events
- `review.required`
- `review.approved`
- `review.rejected`
- `review.edited`
- `review.retry_requested`

Implemented in `crates/event-model/src/human_review_events.rs` as typed payload structs and `HumanReviewEventKind` enum.

### 3.9 Guardrail / budget events
- `guardrail.warning`
- `guardrail.exceeded`
- `budget.updated`

Implemented in `crates/event-model/src/guardrail_events.rs` as typed payload structs and `GuardrailEventKind` enum. Includes `GuardrailSeverity` (low/medium/high/critical) and `BudgetResource` (tokens/time/api_calls/retries) enums.

### 3.10 Run lifecycle events (implementation note)

Implemented in `crates/event-model/src/run_events.rs` as `RunEventKind` enum with 10 variants. The `RunEvent` base envelope is defined in `crates/event-model/src/event.rs`.

### 3.11 Node lifecycle events (implementation note)

Implemented in `crates/event-model/src/node_events.rs` as `NodeEventKind` enum with 8 variants.

### 3.12 Routing events (implementation note)

Implemented in `crates/event-model/src/routing_events.rs` as `RoutingEventKind` enum with 4 variants.

---

## 4. Event payload guidance

### 4.1 `node.started`
```json
{
  "node_type": "tool",
  "attempt": 1,
  "input_refs": ["mem:run_shared:task_brief"],
  "workspace_root": "/repo/path"
}
```

### 4.2 `command.started`
```json
{
  "command": "npm test",
  "shell": "bash",
  "cwd": "/repo/path",
  "timeout_ms": 300000
}
```

### 4.3 `command.completed`
```json
{
  "exit_code": 0,
  "duration_ms": 4123,
  "stdout_bytes": 12044,
  "stderr_bytes": 0
}
```

### 4.4 `router.branch_selected`
```json
{
  "router_node_id": "node_router_1",
  "selected_edge_ids": ["edge_ok"],
  "reason": "exit_code == 0"
}
```

### 4.5 `review.required`
```json
{
  "reason": "Tests failed after patch application",
  "blocking": true,
  "available_actions": ["approve", "reject", "retry", "edit_memory"]
}
```

### 4.6 Run lifecycle events

#### `run.created`
```json
{
  "workflow_id": "550e8400-e29b-41d4-a716-446655440002",
  "workflow_version": 1,
  "workspace_root": "/home/user/projects/my-repo"
}
```

#### `run.validation_started`
```json
{ "node_count": 4 }
```

#### `run.validation_passed`
```json
{ "node_count": 4 }
```

#### `run.validation_failed`
```json
{
  "reason": "missing start node",
  "errors": ["no start node found in workflow definition"]
}
```

#### `run.started`
```json
{ "node_count": 4 }
```

#### `run.paused`
```json
{
  "reason": "human review required",
  "waiting_node_ids": ["550e8400-e29b-41d4-a716-446655440003"]
}
```

#### `run.resumed`
```json
{ "resumed_by": "user@example.com" }
```
`resumed_by` is nullable.

#### `run.succeeded`
```json
{
  "duration_ms": 12345,
  "steps_executed": 4
}
```

#### `run.failed`
```json
{
  "reason": "tool node exited with code 1",
  "failed_node_id": "550e8400-e29b-41d4-a716-446655440003",
  "duration_ms": 5000
}
```
`failed_node_id` and `duration_ms` are nullable.

#### `run.cancelled`
```json
{
  "reason": "user requested cancel",
  "duration_ms": 1000
}
```
Both fields are nullable.

---

### 4.7 Remaining node lifecycle events

#### `node.queued`
```json
{ "node_type": "tool" }
```

#### `node.waiting`
```json
{ "reason": "human review required" }
```
`reason` is nullable.

#### `node.succeeded`
```json
{
  "attempt": 1,
  "duration_ms": 4321
}
```

#### `node.failed`
```json
{
  "attempt": 1,
  "reason": "exit code 1",
  "duration_ms": 1000
}
```
`duration_ms` is nullable.

#### `node.cancelled`
```json
{ "reason": "user cancelled run" }
```
`reason` is nullable.

#### `node.skipped`
```json
{ "reason": "router selected other branch" }
```
`reason` is nullable.

#### `node.retry_scheduled`
```json
{
  "attempt": 2,
  "delay_ms": 500,
  "reason": "exit code 1"
}
```

---

### 4.8 Remaining routing events

#### `edge.routed`
```json
{
  "edge_id": "edge_ok",
  "source_node_id": "node_router_1",
  "target_node_id": "node_tool_1"
}
```

#### `router.evaluated`
```json
{
  "router_node_id": "node_router_1",
  "candidates_evaluated": 2
}
```

#### `router.no_match`
```json
{
  "router_node_id": "node_router_1",
  "reason": "no condition matched exit_code 2"
}
```
`reason` is nullable.

---

### 4.9 Remaining command events

#### `command.prepared`
```json
{
  "command": "npm test",
  "shell": "bash",
  "cwd": "/repo/path",
  "timeout_ms": 300000
}
```
`timeout_ms` is nullable. Fields are identical to `command.started`.

#### `command.stdout`
```json
{
  "chunk": "PASS src/foo.test.ts\n",
  "byte_offset": 0
}
```
`chunk` is a UTF-8 string (lossy). May be a partial line.

#### `command.stderr`
```json
{
  "chunk": "warning: unused variable\n",
  "byte_offset": 0
}
```

#### `command.failed`
```json
{
  "reason": "timed out after 300000ms",
  "exit_code": null,
  "duration_ms": 300001,
  "stdout_bytes": 0,
  "stderr_bytes": 0
}
```
`exit_code` and `duration_ms` are nullable. `exit_code` is null when the process was killed or never started.

---

### 4.10 Agent events

#### `agent.request_prepared`
```json
{
  "provider": "claude-sonnet-4-6",
  "prompt_tokens": 1200,
  "memory_keys_used": ["task_brief", "repo_context"]
}
```
`prompt_tokens` is nullable.

#### `agent.started`
```json
{
  "provider": "claude-sonnet-4-6",
  "run_elapsed_ms": 250
}
```

#### `agent.output_received`
```json
{
  "chunk": "Here is my plan:\n1. ...",
  "cumulative_chars": 22,
  "is_final": false
}
```

#### `agent.completed`
```json
{
  "provider": "claude-sonnet-4-6",
  "duration_ms": 3500,
  "input_tokens": 1200,
  "output_tokens": 400,
  "output_memory_key": "plan_output"
}
```
`input_tokens`, `output_tokens`, and `output_memory_key` are nullable.

#### `agent.failed`
```json
{
  "provider": "claude-sonnet-4-6",
  "reason": "rate limit exceeded",
  "error_code": "429",
  "duration_ms": null
}
```
`error_code` and `duration_ms` are nullable.

---

### 4.11 Memory events

Memory scope serializes as `"run_shared"` or `"node_local"`.

#### `memory.read`
```json
{
  "scope": "run_shared",
  "key": "task_brief",
  "found": true
}
```
`found` is false on a cache miss.

#### `memory.write`
```json
{
  "scope": "run_shared",
  "key": "plan_output",
  "value_type": "json",
  "value_bytes": 1024
}
```

#### `memory.snapshot_created`
```json
{
  "scope": "run_shared",
  "key_count": 5,
  "total_bytes": 8192
}
```

---

### 4.12 Remaining human review events

#### `review.approved`
```json
{ "comment": "Looks good, continuing." }
```
`comment` is nullable.

#### `review.rejected`
```json
{ "reason": "Output quality too low" }
```

#### `review.edited`
```json
{
  "edited_keys": ["task_brief", "constraints"],
  "comment": "Narrowed scope before retry"
}
```
`comment` is nullable.

#### `review.retry_requested`
```json
{
  "target_node_id": "node_tool_1",
  "comment": null
}
```
`comment` is nullable.

---

### 4.13 Guardrail and budget events

`GuardrailSeverity` serializes as `"low"` | `"medium"` | `"high"` | `"critical"`.
`BudgetResource` serializes as `"tokens"` | `"time"` | `"api_calls"` | `"retries"`.

#### `guardrail.warning`
```json
{
  "guardrail": "token_budget",
  "severity": "high",
  "message": "Token usage at 85% of limit",
  "current_value": 8500.0,
  "threshold": 10000.0
}
```

#### `guardrail.exceeded`
```json
{
  "guardrail": "time_limit",
  "message": "Run exceeded 5 minute time limit",
  "final_value": 305.0,
  "threshold": 300.0,
  "enforcement_action": "cancel_run"
}
```
`enforcement_action` is a string such as `"pause_run"`, `"fail_node"`, or `"cancel_run"`.

#### `budget.updated`
```json
{
  "resource": "tokens",
  "consumed": 4200.0,
  "limit": 10000.0,
  "remaining": 5800.0
}
```

---

## 5. Event quality requirements

Events should be:
- typed
- timestamped
- attributable to a run and optionally a node
- sufficiently detailed for replay
- stable enough for UI rendering and future export/import

The event model should avoid:
- UI-only event types leaking into engine history
- large opaque blobs with no typed structure
- lossy summaries that prevent later debugging

---

## 6. Replay requirements

The event stream must support:
- event-by-event playback
- timeline scrubbing
- node state reconstruction
- route decision inspection
- command/output inspection
- review action inspection

If replay cannot explain a run from stored events, the schema is incomplete.

### 6.1 UI inspection support

The Replay View's `EventInspector` component renders typed panes for the following event families, pulling structured fields from the payload:

| Family | Pane | Payload fields rendered |
|--------|------|------------------------|
| `node.*` | NODE CONTEXT | `node_type`, `attempt`, `workspace_root`, `input_refs[]`, `output`, `error` |
| `router.*` / `edge.*` | ROUTING DECISION | `router_node_id`, `reason`, `selected_edge_ids[]` |
| `command.*` | COMMAND | `command`, `shell`, `cwd`, `exit_code`, `duration_ms`, `stdout_bytes`, `stderr_bytes`, `timeout_ms` |

All events additionally show the envelope fields and full JSON payload. New event families (agent, memory, review, guardrail) can be added by creating a new pane component in `EventInspector.tsx`.
