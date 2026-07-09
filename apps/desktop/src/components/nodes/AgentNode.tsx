// Agent node — wraps the procedural PigeonSprite (DEC-008) in the same
// .wf-node container classes WorkflowNode uses, so container-level state
// glow/ring animations (node-pulse, node-fail-flash, node-paused-blink)
// still apply. The sprite itself has no frame or box of its own; run state
// is carried by the neck-patch tint (see docs/VISUAL_IDENTITY.md §2-§4).
//
// Shares WorkflowNodeData with WorkflowNode — no new prop types required.

import { memo } from "react";
import { Handle, Position, NodeProps } from "reactflow";
import type { WorkflowNodeData } from "./WorkflowNode";
import type { NodeState } from "../../types/workflow";
import PigeonSprite from "./PigeonSprite";

function AgentNode({ data, selected }: NodeProps<WorkflowNodeData>) {
  const state: NodeState = data.state ?? "idle";
  const cls = [
    "wf-node",
    "wf-node--agent",
    "ag-node",
    selected ? "wf-node--selected" : "",
    state !== "idle" ? `wf-node--${state}` : "",
    data.invalid ? "wf-node--invalid" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cls}>
      <Handle type="target" position={Position.Top} />
      <PigeonSprite state={state} />
      <div className="ag-node-footer">
        <span className="ag-node-label">{data.label}</span>
        <span className="ag-node-state-badge">{state}</span>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export default memo(AgentNode);
