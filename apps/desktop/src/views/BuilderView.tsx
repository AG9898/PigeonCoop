import { useRef, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { WorkflowCanvas, WorkflowCanvasHandle } from "../components/canvas/WorkflowCanvas";
import { NodePalette } from "../components/panels/NodePalette";
import type { ConditionKind, NodeKind, ValidationResult, WorkflowDefinition } from "../types/workflow";
import type { WorkflowNodeData } from "../components/nodes/WorkflowNode";

function flowToWorkflow(
  flowData: ReturnType<WorkflowCanvasHandle["getFlowData"]>,
  workflowId: string,
  name: string
): WorkflowDefinition {
  const now = new Date().toISOString();
  return {
    workflow_id: workflowId,
    name,
    schema_version: 1,
    version: 1,
    metadata: null,
    nodes: flowData.nodes.map((n) => ({
      node_id: n.id,
      node_type: (n.type ?? "agent") as NodeKind,
      label: (n.data as WorkflowNodeData).label,
      config: null,
      input_contract: null,
      output_contract: null,
      memory_access: null,
      retry_policy: { max_retries: 0 },
      display: { x: n.position.x, y: n.position.y },
    })),
    edges: flowData.edges.map((e) => ({
      edge_id: e.id,
      source_node_id: e.source,
      target_node_id: e.target,
      // Use condition_kind stored in edge data, falling back to "always".
      condition_kind: ((e.data as { condition_kind?: ConditionKind } | undefined)?.condition_kind ?? "always"),
      label: typeof e.label === "string" ? e.label : undefined,
    })),
    default_constraints: null,
    created_at: now,
    updated_at: now,
  };
}

/** Extract node IDs referenced in validation errors (unreachable, cycle). */
function invalidNodeIdsFromResult(result: ValidationResult): string[] {
  const ids = new Set<string>();
  for (const err of result.errors) {
    if (err.kind === "unreachable_node" && err.node_id) {
      ids.add(err.node_id);
    }
    if (err.kind === "cycle_detected" && err.node_ids) {
      err.node_ids.forEach((id) => ids.add(id));
    }
  }
  return Array.from(ids);
}

/** Extract edge IDs referenced in validation errors (invalid_edge_reference). */
function invalidEdgeIdsFromResult(result: ValidationResult): string[] {
  const ids = new Set<string>();
  for (const err of result.errors) {
    if (err.kind === "invalid_edge_reference" && err.edge_id) {
      ids.add(err.edge_id);
    }
  }
  return Array.from(ids);
}

/** Human-readable summary of a single validation error. */
function errorMessage(err: ValidationResult["errors"][number]): string {
  switch (err.kind) {
    case "no_start_node":           return "No Start node — add exactly one Start node.";
    case "no_end_node":             return "No End node — add at least one End node.";
    case "multiple_start_nodes":    return `${err.count ?? "?"} Start nodes found — only one is allowed.`;
    case "multiple_end_nodes":      return `${err.count ?? "?"} End nodes found — only one is allowed.`;
    case "cycle_detected":          return "Cycle detected — workflow must be a DAG (no loops).";
    case "invalid_edge_reference":  return `Edge references unknown node ${err.missing_node_id ?? "?"}.`;
    case "unreachable_node":        return `Node ${err.node_id ?? "?"} is unreachable from the Start node.`;
    default:                        return "Unknown validation error.";
  }
}

export function BuilderView() {
  const canvasRef = useRef<WorkflowCanvasHandle>(null);
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [workflowName] = useState("Untitled Workflow");
  const [loadedWorkflow, setLoadedWorkflow] = useState<WorkflowDefinition | undefined>();
  const [canvasKey, setCanvasKey] = useState("new");
  const [status, setStatus] = useState<string>("");
  const [showPicker, setShowPicker] = useState(false);
  const [pickerList, setPickerList] = useState<WorkflowDefinition[]>([]);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);

  const invalidNodeIds = validationResult ? invalidNodeIdsFromResult(validationResult) : [];
  const invalidEdgeIds = validationResult ? invalidEdgeIdsFromResult(validationResult) : [];

  async function handleSave() {
    const flowData = canvasRef.current?.getFlowData();
    if (!flowData) return;

    const id = workflowId ?? crypto.randomUUID();
    const wf = flowToWorkflow(flowData, id, workflowName);

    try {
      if (workflowId) {
        await invoke("update_workflow", { workflow: wf });
      } else {
        await invoke("create_workflow", { workflow: wf });
        setWorkflowId(id);
      }
      setStatus("Saved");
    } catch (e) {
      setStatus(`Save failed: ${e}`);
    }
  }

  async function handleValidate() {
    const flowData = canvasRef.current?.getFlowData();
    if (!flowData) return;

    const id = workflowId ?? crypto.randomUUID();
    const wf = flowToWorkflow(flowData, id, workflowName);

    try {
      const result = await invoke<ValidationResult>("validate_workflow", { workflow: wf });
      setValidationResult(result);
      setStatus(result.is_valid ? "Valid" : `${result.errors.length} error(s)`);
    } catch (e) {
      setStatus(`Validation failed: ${e}`);
    }
  }

  async function handleLoadClick() {
    try {
      const list = await invoke<WorkflowDefinition[]>("list_workflows");
      setPickerList(list);
      setShowPicker(true);
    } catch (e) {
      setStatus(`Load failed: ${e}`);
    }
  }

  function handlePickWorkflow(wf: WorkflowDefinition) {
    setLoadedWorkflow(wf);
    setWorkflowId(wf.workflow_id);
    setCanvasKey(wf.workflow_id);
    setShowPicker(false);
    setValidationResult(null);
    setStatus("Loaded");
  }

  const handleAddNode = useCallback((kind: NodeKind) => {
    canvasRef.current?.addNode(kind);
  }, []);

  return (
    <div className="view builder-view">
      <div className="view-header">
        <span className="view-title">BUILDER</span>
        <span className="view-subtitle">workflow design canvas</span>
        <div className="builder-toolbar">
          <button className="toolbar-btn" onClick={handleSave}>Save</button>
          <button className="toolbar-btn" onClick={handleLoadClick}>Load</button>
          <button className="toolbar-btn toolbar-btn--validate" onClick={handleValidate}>Validate</button>
          {status && (
            <span className={`builder-status${validationResult && !validationResult.is_valid ? " builder-status--error" : ""}`}>
              {status}
            </span>
          )}
        </div>
      </div>
      {showPicker && (
        <div className="workflow-picker">
          <div className="workflow-picker-header">
            <span>Select Workflow</span>
            <button className="picker-close" onClick={() => setShowPicker(false)}>×</button>
          </div>
          <ul className="workflow-picker-list">
            {pickerList.length === 0 && (
              <li className="picker-empty">No saved workflows</li>
            )}
            {pickerList.map((wf) => (
              <li key={wf.workflow_id}>
                <button className="picker-item" onClick={() => handlePickWorkflow(wf)}>
                  {wf.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {validationResult && !validationResult.is_valid && (
        <div className="validation-panel" role="alert" aria-label="Validation errors">
          <div className="validation-panel-header">
            <span className="validation-panel-title">VALIDATION ERRORS</span>
            <button className="validation-panel-close" onClick={() => setValidationResult(null)}>×</button>
          </div>
          <ul className="validation-error-list">
            {validationResult.errors.map((err, i) => (
              <li key={i} className="validation-error-item">
                {errorMessage(err)}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="view-body builder-body">
        <NodePalette onAddNode={handleAddNode} />
        <WorkflowCanvas
          key={canvasKey}
          ref={canvasRef}
          workflow={loadedWorkflow}
          invalidNodeIds={invalidNodeIds}
          invalidEdgeIds={invalidEdgeIds}
        />
      </div>
    </div>
  );
}
