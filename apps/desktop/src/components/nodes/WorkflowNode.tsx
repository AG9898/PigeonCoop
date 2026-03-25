// Custom React Flow node component shared by all 7 workflow node types.
// Each node type is registered separately in WorkflowCanvas nodeTypes but
// uses this component with type-specific visual metadata.

import { memo } from "react";
import { Handle, Position, NodeProps } from "reactflow";
import type { NodeKind, NodeState } from "../../types/workflow";

export interface WorkflowNodeData {
  kind: NodeKind;
  label: string;
  state?: NodeState;
  /** True when the engine validator has flagged this node with an error. */
  invalid?: boolean;
  /** Node-kind-specific configuration, mirrors Rust NodeConfig variants. */
  config?: Record<string, unknown>;
  /** Retry policy for this node. */
  retry_policy?: { max_retries: number; max_runtime_ms?: number };
}

interface KindMeta {
  icon: string;
  abbrev: string;
  colorVar: string;
}

const KIND_META: Record<NodeKind, KindMeta> = {
  start:        { icon: "▶", abbrev: "START",  colorVar: "var(--node-start)" },
  end:          { icon: "■", abbrev: "END",    colorVar: "var(--node-end)" },
  agent:        { icon: "◈", abbrev: "AGENT",  colorVar: "var(--node-agent)" },
  tool:         { icon: "⚙", abbrev: "TOOL",   colorVar: "var(--node-tool)" },
  router:       { icon: "⑂", abbrev: "ROUTE",  colorVar: "var(--node-router)" },
  memory:       { icon: "⊟", abbrev: "MEM",    colorVar: "var(--node-memory)" },
  human_review: { icon: "⏸", abbrev: "REVIEW", colorVar: "var(--node-review)" },
};

const STATE_COLOR: Record<NodeState, string> = {
  idle:      "var(--color-text-muted)",
  queued:    "var(--color-text-muted)",
  running:   "var(--color-accent)",
  waiting:   "#f59e0b",
  succeeded: "#22c55e",
  failed:    "#ef4444",
  skipped:   "var(--color-text-muted)",
  paused:    "#f59e0b",
};

function WorkflowNode({ data, selected }: NodeProps<WorkflowNodeData>) {
  const meta = KIND_META[data.kind];
  const state: NodeState = data.state ?? "idle";
  const stateColor = STATE_COLOR[state];
  const cls = [
    "wf-node",
    `wf-node--${data.kind}`,
    selected ? "wf-node--selected" : "",
    state !== "idle" ? `wf-node--${state}` : "",
    data.invalid ? "wf-node--invalid" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cls}>
      <Handle type="target" position={Position.Top} />
      <div className="wf-node-header" style={{ borderTopColor: meta.colorVar }}>
        <span className="wf-node-icon">{meta.icon}</span>
        <span className="wf-node-type" style={{ color: meta.colorVar }}>
          {meta.abbrev}
        </span>
        <span
          className="wf-node-state"
          style={{ color: stateColor, borderColor: stateColor }}
        >
          {state}
        </span>
      </div>
      <div className="wf-node-label">{data.label}</div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export default memo(WorkflowNode);
