import { memo, type CSSProperties } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import {
  Archive,
  Bot,
  Flag,
  GitBranch,
  Hammer,
  ShieldCheck,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import type { NodeKind, NodeState } from "../../types/workflow";
import type { WorkflowNodeData } from "./WorkflowNode";

interface RoleMeta {
  label: string;
  image: string;
  icon: LucideIcon;
}

export const ROLE_META: Record<NodeKind, RoleMeta> = {
  start: {
    label: "Start",
    image: "/assets/command-deck/role-start.webp",
    icon: Flag,
  },
  agent: {
    label: "Agent",
    image: "/assets/command-deck/role-agent.webp",
    icon: Bot,
  },
  tool: {
    label: "Tool",
    image: "/assets/command-deck/role-tool.webp",
    icon: Hammer,
  },
  router: {
    label: "Router",
    image: "/assets/command-deck/role-router.webp",
    icon: GitBranch,
  },
  memory: {
    label: "Memory",
    image: "/assets/command-deck/role-memory.webp",
    icon: Archive,
  },
  human_review: {
    label: "Review",
    image: "/assets/command-deck/role-review.webp",
    icon: ShieldCheck,
  },
  end: {
    label: "End",
    image: "/assets/command-deck/role-end.webp",
    icon: Trophy,
  },
};

type MeterStyle = CSSProperties & { "--meter-fill": string };

function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function RoleNode({ data, selected }: NodeProps<WorkflowNodeData>) {
  const meta = ROLE_META[data.kind];
  const Icon = meta.icon;
  const state: NodeState = data.state ?? "idle";
  const tokenPct =
    data.kind === "agent" && typeof data.tokenPct === "number"
      ? clampPct(data.tokenPct)
      : null;
  const classes = [
    "wf-node",
    "role-node",
    `wf-node--${data.kind}`,
    selected ? "wf-node--selected" : "",
    state !== "idle" ? `wf-node--${state}` : "",
    data.invalid ? "wf-node--invalid" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article className={classes} data-role={data.kind}>
      <Handle type="target" position={Position.Top} />
      <div className="role-node-portrait">
        <span className="role-node-fallback" aria-hidden="true">
          <Icon size={26} strokeWidth={1.5} />
        </span>
        <img
          src={meta.image}
          alt=""
          aria-hidden="true"
          width="384"
          height="384"
          draggable={false}
          onError={(event) => {
            event.currentTarget.hidden = true;
          }}
        />
        <span className="role-node-kind">
          <Icon size={11} aria-hidden="true" />
          {meta.label}
        </span>
      </div>

      <div className="role-node-content">
        <div className="role-node-title-row">
          <strong className="role-node-title">{data.label}</strong>
          <span className={`role-node-state role-node-state--${state}`}>
            <i aria-hidden="true" />
            {state}
          </span>
        </div>
        {tokenPct !== null && (
          <div
            className="role-node-meter"
            data-testid="agent-token-health"
            aria-label={`context usage ${Math.round(tokenPct)}%`}
            title={`Context usage ${Math.round(tokenPct)}%`}
            style={{ "--meter-fill": `${tokenPct}%` } as MeterStyle}
          >
            <span />
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} />
    </article>
  );
}

export default memo(RoleNode);
