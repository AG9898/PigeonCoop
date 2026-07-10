// DesignSurface — the edit-mode canvas of the unified workspace:
// node palette + workflow canvas + node inspector + validation overlay.
// Save/Validate/Run controls live in the workspace top bar (App), which
// pulls flow data through the imperative handle exposed here.

import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { Node } from "reactflow";
import {
  WorkflowCanvas,
  WorkflowCanvasHandle,
} from "../components/canvas/WorkflowCanvas";
import { NodePalette } from "../components/panels/NodePalette";
import { NodeInspector, defaultConfig } from "../components/panels/NodeInspector";
import type {
  ConditionKind,
  NodeKind,
  ValidationResult,
  WorkflowDefinition,
} from "../types/workflow";
import type { WorkflowNodeData } from "../components/nodes/WorkflowNode";
import { MousePointer2, SlidersHorizontal } from "lucide-react";

/** Convert React Flow canvas data into a WorkflowDefinition for the backend. */
export function flowToWorkflow(
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
      // Never-configured nodes get the same per-kind skeleton the inspector
      // starts from — the backend's NodeConfig variants reject null.
      config:
        (n.data as WorkflowNodeData).config ??
        defaultConfig((n.type ?? "agent") as NodeKind),
      input_contract: null,
      output_contract: null,
      memory_access: null,
      retry_policy: (n.data as WorkflowNodeData).retry_policy ?? { max_retries: 0 },
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
    // default_constraints intentionally omitted — see WorkflowDefinition.
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

export interface DesignSurfaceHandle {
  /** Build a WorkflowDefinition from the current canvas contents. */
  buildWorkflow(workflowId: string, name: string): WorkflowDefinition | null;
}

export interface DesignSurfaceProps {
  /** Workflow to load onto the canvas; undefined starts empty. */
  workflow?: WorkflowDefinition;
  /**
   * Canvas identity — when this changes the canvas re-mounts and reloads
   * from `workflow`. Use the workflow_id, or a fresh key for a new canvas.
   */
  canvasKey: string;
  /** Latest validation result (owned by the shell); null = not validated. */
  validationResult: ValidationResult | null;
  /** Clears the validation overlay. */
  onDismissValidation: () => void;
}

export const DesignSurface = forwardRef<DesignSurfaceHandle, DesignSurfaceProps>(
  function DesignSurface(
    { workflow, canvasKey, validationResult, onDismissValidation },
    ref
  ) {
    const canvasRef = useRef<WorkflowCanvasHandle>(null);
    const [selectedNode, setSelectedNode] =
      useState<Node<WorkflowNodeData> | null>(null);

    const invalidNodeIds = validationResult
      ? invalidNodeIdsFromResult(validationResult)
      : [];
    const invalidEdgeIds = validationResult
      ? invalidEdgeIdsFromResult(validationResult)
      : [];

    useImperativeHandle(
      ref,
      () => ({
        buildWorkflow(workflowId: string, name: string) {
          const flowData = canvasRef.current?.getFlowData();
          if (!flowData) return null;
          return flowToWorkflow(flowData, workflowId, name);
        },
      }),
      []
    );

    const handleAddNode = useCallback((kind: NodeKind) => {
      canvasRef.current?.addNode(kind);
    }, []);

    const handleNodeSelect = useCallback(
      (node: Node<WorkflowNodeData> | null) => {
        setSelectedNode(node);
      },
      []
    );

    return (
      <div className="design-surface" data-testid="design-surface">
        {validationResult && !validationResult.is_valid && (
          <div className="validation-panel" role="alert" aria-label="Validation errors">
            <div className="validation-panel-header">
              <span className="validation-panel-title">VALIDATION ERRORS</span>
              <button className="validation-panel-close" onClick={onDismissValidation}>×</button>
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
        <NodePalette onAddNode={handleAddNode} />
        <WorkflowCanvas
          key={canvasKey}
          ref={canvasRef}
          workflow={workflow}
          invalidNodeIds={invalidNodeIds}
          invalidEdgeIds={invalidEdgeIds}
          onNodeSelect={handleNodeSelect}
        />
        {selectedNode ? (
          <NodeInspector
            key={selectedNode.id}
            node={selectedNode}
            onUpdateLabel={(label) => canvasRef.current?.updateNodeLabel(selectedNode.id, label)}
            onUpdateConfig={(config) => canvasRef.current?.updateNodeConfig(selectedNode.id, config)}
            onUpdateRetryPolicy={(rp) => canvasRef.current?.updateNodeRetryPolicy(selectedNode.id, rp)}
          />
        ) : (
          <aside className="node-inspector node-inspector--empty" aria-label="Context panel">
            <div className="ni-header">
              <span className="ni-kind"><SlidersHorizontal size={15} /> Context</span>
              <span className="ni-title">DESIGN</span>
            </div>
            <div className="context-empty">
              <span className="context-empty-icon"><MousePointer2 size={22} /></span>
              <strong>Select a node</strong>
              <span>Configure its role, inputs, retry policy, and execution behavior.</span>
            </div>
          </aside>
        )}
      </div>
    );
  }
);
