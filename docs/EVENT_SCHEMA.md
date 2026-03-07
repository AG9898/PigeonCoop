# Event Schema

## 1. Purpose

The event model is the backbone of monitoring and replay. Every important execution transition should be captured as a typed event.

This document defines the initial event taxonomy and payload expectations for v1.

---

## 2. Core event envelope

Suggested base shape:

```json
{
  "event_id": "evt_...",
  "run_id": "run_...",
  "workflow_id": "wf_...",
  "node_id": "node_...",
  "event_type": "node.started",
  "timestamp": "2026-03-07T16:00:00Z",
  "causation_id": "evt_prev",
  "correlation_id": "corr_...",
  "payload": {}
}
```

### Notes
- `node_id` is optional for run-level events.
- `causation_id` should point to the event that directly triggered this one when applicable.
- `correlation_id` groups related events across a single action chain.

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

### 3.6 Agent interaction events
- `agent.request_prepared`
- `agent.started`
- `agent.output_received`
- `agent.completed`
- `agent.failed`

### 3.7 Memory events
- `memory.read`
- `memory.write`
- `memory.snapshot_created`

### 3.8 Human review events
- `review.required`
- `review.approved`
- `review.rejected`
- `review.edited`
- `review.retry_requested`

### 3.9 Guardrail / budget events
- `guardrail.warning`
- `guardrail.exceeded`
- `budget.updated`

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
