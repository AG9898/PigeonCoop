// Node palette panel — lists all 7 node types.
// Items can be dragged onto the WorkflowCanvas or clicked to add at a default position.

import type { NodeKind } from "../../types/workflow";
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
import { ROLE_META } from "../nodes/RoleNode";

interface PaletteItem {
  kind: NodeKind;
  icon: LucideIcon;
  label: string;
  colorVar: string;
}

const PALETTE_ITEMS: PaletteItem[] = [
  { kind: "start",        icon: Flag,        label: "Start",  colorVar: "var(--node-start)" },
  { kind: "agent",        icon: Bot,         label: "Agent",  colorVar: "var(--node-agent)" },
  { kind: "tool",         icon: Hammer,      label: "Tool",   colorVar: "var(--node-tool)" },
  { kind: "router",       icon: GitBranch,   label: "Router", colorVar: "var(--node-router)" },
  { kind: "memory",       icon: Archive,     label: "Memory", colorVar: "var(--node-memory)" },
  { kind: "human_review", icon: ShieldCheck, label: "Review", colorVar: "var(--node-review)" },
  { kind: "end",          icon: Trophy,      label: "End",    colorVar: "var(--node-end)" },
];

interface NodePaletteProps {
  onAddNode: (kind: NodeKind) => void;
}

export function NodePalette({ onAddNode }: NodePaletteProps) {
  function handleDragStart(event: React.DragEvent, kind: NodeKind) {
    event.dataTransfer.setData("application/reactflow", kind);
    event.dataTransfer.effectAllowed = "copy";
  }

  return (
    <aside className="node-palette">
      <div className="node-palette-header">Role shelf</div>
      {PALETTE_ITEMS.map(({ kind, icon: Icon, label, colorVar }) => (
        <div
          key={kind}
          className="palette-item"
          draggable
          onDragStart={(e) => handleDragStart(e, kind)}
          onClick={() => onAddNode(kind)}
          title={`Add ${label} node`}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onAddNode(kind); }}
        >
          <span className="palette-item-icon" style={{ color: colorVar }}>
            <Icon size={18} className="palette-item-fallback" />
            <img
              src={ROLE_META[kind].image}
              alt=""
              aria-hidden="true"
              width="384"
              height="384"
              draggable={false}
              onError={(event) => {
                event.currentTarget.hidden = true;
              }}
            />
          </span>
          <span className="palette-item-label">{label}</span>
        </div>
      ))}
    </aside>
  );
}
