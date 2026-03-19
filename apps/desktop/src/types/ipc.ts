// Typed IPC interfaces for every Tauri invoke() command and listen() event.
// This file is the canonical TypeScript mirror of docs/TAURI_IPC_CONTRACT.md.
// Keep both in sync — a discrepancy is a bug, not a design choice.

import { invoke } from "@tauri-apps/api/core";
import type {
  NodeStatus,
  RunEvent,
  RunInstance,
  RunStatus,
  WorkflowDefinition,
} from "./workflow";

// ---------------------------------------------------------------------------
// Error shape
// ---------------------------------------------------------------------------

/** Shape of the rejected value from any invoke() call. */
export interface CmdError {
  message: string;
}

// ---------------------------------------------------------------------------
// invokeTyped — typed wrapper around invoke()
// ---------------------------------------------------------------------------

/**
 * Typed wrapper around Tauri's invoke().
 * Call this instead of raw invoke() to avoid silent `unknown` casts.
 *
 * @example
 * const run = await invokeTyped<RunInstance>("get_run", { run_id: id });
 */
export async function invokeTyped<T>(
  command: string,
  args?: unknown
): Promise<T> {
  return invoke<T>(command, args as Record<string, unknown> | undefined);
}

// ---------------------------------------------------------------------------
// Command arg interfaces
// ---------------------------------------------------------------------------

// --- Workflow CRUD (TAURI-001) ---

export interface CreateWorkflowArgs {
  workflow: WorkflowDefinition;
}

export interface GetWorkflowArgs {
  id: string;
}

export interface UpdateWorkflowArgs {
  workflow: WorkflowDefinition;
}

export interface DeleteWorkflowArgs {
  id: string;
}

export interface ImportWorkflowArgs {
  json: string;
}

export interface ExportWorkflowArgs {
  id: string;
}

// --- Run lifecycle (TAURI-002) ---
// Note: Tauri 2.x #[tauri::command] uses rename_all = "camelCase" for JS args.
// All arg interfaces use camelCase keys to match what the Rust handler expects.

export interface CreateRunArgs {
  workflowId: string;
  workspaceRoot: string;
}

export interface StartRunArgs {
  runId: string;
}

export interface CancelRunArgs {
  runId: string;
}

export interface GetRunArgs {
  runId: string;
}

export interface ListRunsForWorkflowArgs {
  workflowId: string;
}

// --- Event log (TAURI-003) ---

export interface ListEventsForRunArgs {
  runId: string;
  offset: number;
  limit: number;
}

// --- Human review (TAURI-004) ---

export type HumanReviewDecision =
  | { type: "approved" }
  | { type: "rejected" }
  | { type: "retry_requested" }
  | { type: "edited"; memory_patch: unknown };

export interface SubmitHumanReviewDecisionArgs {
  runId: string;
  nodeId: string;
  decision: HumanReviewDecision;
}

// ---------------------------------------------------------------------------
// Event payload interfaces (listen())
// ---------------------------------------------------------------------------

/** Payload for the `run_status_changed` backend event. */
export interface RunStatusChangedPayload {
  run_id: string;
  old_status: RunStatus;
  new_status: RunStatus;
  timestamp: string;
}

/** Payload for the `node_status_changed` backend event. */
export interface NodeStatusChangedPayload {
  run_id: string;
  node_id: string;
  old_status: NodeStatus;
  new_status: NodeStatus;
  attempt: number;
  timestamp: string;
}

/** Payload for the `run_event_appended` backend event. */
export interface RunEventAppendedPayload {
  event: RunEvent;
}

/** Payload for the `human_review_requested` backend event. */
export interface HumanReviewRequestedPayload {
  run_id: string;
  node_id: string;
  node_label: string;
  reason: string;
  available_actions: Array<"approve" | "reject" | "retry" | "edit_memory">;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Typed command helpers
// ---------------------------------------------------------------------------
// Convenience wrappers that bind arg types to return types.
// Import these in UI components instead of calling invokeTyped directly.

export const ipc = {
  // Workflow CRUD
  createWorkflow: (args: CreateWorkflowArgs) =>
    invokeTyped<void>("create_workflow", args),

  getWorkflow: (args: GetWorkflowArgs) =>
    invokeTyped<WorkflowDefinition | null>("get_workflow", args),

  listWorkflows: () => invokeTyped<WorkflowDefinition[]>("list_workflows"),

  updateWorkflow: (args: UpdateWorkflowArgs) =>
    invokeTyped<void>("update_workflow", args),

  deleteWorkflow: (args: DeleteWorkflowArgs) =>
    invokeTyped<void>("delete_workflow", args),

  importWorkflow: (args: ImportWorkflowArgs) =>
    invokeTyped<WorkflowDefinition>("import_workflow", args),

  exportWorkflow: (args: ExportWorkflowArgs) =>
    invokeTyped<string>("export_workflow", args),

  // Run lifecycle
  createRun: (args: CreateRunArgs) =>
    invokeTyped<RunInstance>("create_run", args),

  startRun: (args: StartRunArgs) =>
    invokeTyped<void>("start_run", args),

  cancelRun: (args: CancelRunArgs) =>
    invokeTyped<void>("cancel_run", args),

  getRun: (args: GetRunArgs) =>
    invokeTyped<RunInstance | null>("get_run", args),

  listRunsForWorkflow: (args: ListRunsForWorkflowArgs) =>
    invokeTyped<RunInstance[]>("list_runs_for_workflow", args),

  // Event log
  listEventsForRun: (args: ListEventsForRunArgs) =>
    invokeTyped<RunEvent[]>("list_events_for_run", args),

  // Human review
  submitHumanReviewDecision: (args: SubmitHumanReviewDecisionArgs) =>
    invokeTyped<void>("submit_human_review_decision", args),
};
