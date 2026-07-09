// Tool node wrapper for the procedural wrench-bot sprite.

import { memo } from "react";
import { Handle, Position, NodeProps } from "reactflow";
import type { WorkflowNodeData } from "./WorkflowNode";
import type { NodeState } from "../../types/workflow";
import ToolSprite from "./ToolSprite";

function ToolNode({ data, selected }: NodeProps<WorkflowNodeData>) {
  const state: NodeState = data.state ?? "idle";
  const cls = [
    "wf-node",
    "wf-node--tool",
    "tool-node",
    selected ? "wf-node--selected" : "",
    state !== "idle" ? `wf-node--${state}` : "",
    data.invalid ? "wf-node--invalid" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cls}>
      <Handle type="target" position={Position.Top} />
      <ToolSprite state={state} />
      <div className="tool-node-footer">
        <span className="tool-node-label">{data.label}</span>
        <span className="tool-node-state-badge">{state}</span>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export default memo(ToolNode);
