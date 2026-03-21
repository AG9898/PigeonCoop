import { useRef, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { WorkflowCanvas, WorkflowCanvasHandle } from "../components/canvas/WorkflowCanvas";
import { NodePalette } from "../components/panels/NodePalette";
import type { NodeKind, WorkflowDefinition } from "../types/workflow";
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
      condition_kind: "always" as const,
      label: typeof e.label === "string" ? e.label : undefined,
    })),
    default_constraints: null,
    created_at: now,
    updated_at: now,
  };
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
          {status && <span className="builder-status">{status}</span>}
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
      <div className="view-body builder-body">
        <NodePalette onAddNode={handleAddNode} />
        <WorkflowCanvas key={canvasKey} ref={canvasRef} workflow={loadedWorkflow} />
      </div>
    </div>
  );
}
