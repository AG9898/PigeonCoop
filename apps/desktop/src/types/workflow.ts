// TypeScript types mirroring the Rust workflow-model crate structs.
// Keep in sync with crates/workflow-model/src/ when Rust types change.

export type NodeKind =
  | "start"
  | "end"
  | "agent"
  | "tool"
  | "router"
  | "memory"
  | "human_review";

export type NodeState =
  | "idle"
  | "queued"
  | "running"
  | "waiting"
  | "succeeded"
  | "failed"
  | "skipped"
  | "paused";

export interface NodeDisplay {
  x: number;
  y: number;
}

export interface RetryPolicy {
  max_retries: number;
  max_runtime_ms?: number;
}

export interface NodeDefinition {
  node_id: string;
  node_type: NodeKind;
  label: string;
  config: unknown;
  input_contract: unknown;
  output_contract: unknown;
  memory_access: unknown;
  retry_policy: RetryPolicy;
  display: NodeDisplay;
}

export type ConditionKind = "always" | "on_success" | "on_failure" | "expression";

export interface EdgeDefinition {
  edge_id: string;
  source_node_id: string;
  target_node_id: string;
  condition_kind: ConditionKind;
  condition_payload?: unknown;
  label?: string;
}

export interface WorkflowDefinition {
  workflow_id: string;
  name: string;
  schema_version: number;
  version: number;
  metadata: unknown;
  nodes: NodeDefinition[];
  edges: EdgeDefinition[];
  default_constraints: unknown;
  created_at: string;
  updated_at: string;
}

/** Node lifecycle status as reported by the backend engine. */
export type NodeStatus =
  | "draft"
  | "validated"
  | "ready"
  | "queued"
  | "running"
  | "waiting"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "skipped";

export type RunStatus =
  | "created"
  | "validating"
  | "ready"
  | "running"
  | "paused"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface RunInstance {
  run_id: string;
  workflow_id: string;
  workflow_version: number;
  status: RunStatus;
  workspace_root: string;
  created_at: string;
  started_at?: string;
  ended_at?: string;
}

export interface RunEvent {
  event_id: string;
  run_id: string;
  workflow_id: string;
  node_id?: string;
  event_type: string;
  timestamp: string;
  payload: unknown;
  causation_id?: string;
  correlation_id?: string;
  sequence: number;
}
