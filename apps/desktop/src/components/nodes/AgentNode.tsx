// Agent node — wraps the procedural PigeonSprite (DEC-008) in the same
// .wf-node container classes WorkflowNode uses, so container-level state
// glow/ring animations (node-pulse, node-fail-flash, node-paused-blink)
// still apply. The sprite itself has no frame or box of its own; run state
// is carried by the neck-patch tint (see docs/VISUAL_IDENTITY.md §2-§4).
//
// Shares WorkflowNodeData with WorkflowNode. Runtime views may pass tokenPct
// for the optional context-window health bar; builder nodes omit it.

import { memo, type CSSProperties } from "react";
import { Handle, Position, NodeProps } from "reactflow";
import type { WorkflowNodeData } from "./WorkflowNode";
import type { NodeState } from "../../types/workflow";
import PigeonSprite from "./PigeonSprite";

const HEALTH_GREEN = "#22c55e";
const HEALTH_AMBER = "#f59e0b";
const HEALTH_RED = "#ef4444";

type HealthStyle = CSSProperties & {
  "--fill": number;
  "--health-color": string;
};

export function clampTokenPct(tokenPct: number): number {
  if (!Number.isFinite(tokenPct)) return 0;
  return Math.min(100, Math.max(0, tokenPct));
}

export function agentTokenHealthColor(tokenPct: number): string {
  const pct = clampTokenPct(tokenPct);
  if (pct > 85) return HEALTH_RED;
  if (pct >= 60) return HEALTH_AMBER;
  return HEALTH_GREEN;
}

export function agentTokenHealthStyle(tokenPct: number): HealthStyle {
  const pct = clampTokenPct(tokenPct);
  return {
    "--fill": pct,
    "--health-color": agentTokenHealthColor(pct),
  };
}

function AgentNode({ data, selected }: NodeProps<WorkflowNodeData>) {
  const state: NodeState = data.state ?? "idle";
  const hasTokenPct =
    typeof data.tokenPct === "number" && Number.isFinite(data.tokenPct);
  const tokenPct = hasTokenPct ? clampTokenPct(data.tokenPct as number) : null;
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
      {tokenPct !== null && (
        <div
          className="ag-node-health-bar"
          data-testid="agent-token-health"
          aria-label={`context usage ${Math.round(tokenPct)}%`}
          title={`Context usage ${Math.round(tokenPct)}%`}
          style={agentTokenHealthStyle(tokenPct)}
        />
      )}
      <div className="ag-node-footer">
        <span className="ag-node-label">{data.label}</span>
        <span className="ag-node-state-badge">{state}</span>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export default memo(AgentNode);
