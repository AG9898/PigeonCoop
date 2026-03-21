// Node palette panel — lists all 7 node types.
// Items can be dragged onto the WorkflowCanvas or clicked to add at a default position.

import type { NodeKind } from "../../types/workflow";

interface PaletteItem {
  kind: NodeKind;
  icon: string;
  label: string;
  colorVar: string;
}

const PALETTE_ITEMS: PaletteItem[] = [
  { kind: "start",        icon: "▶", label: "Start",  colorVar: "var(--node-start)" },
  { kind: "end",          icon: "■", label: "End",    colorVar: "var(--node-end)" },
  { kind: "agent",        icon: "◈", label: "Agent",  colorVar: "var(--node-agent)" },
  { kind: "tool",         icon: "⚙", label: "Tool",   colorVar: "var(--node-tool)" },
  { kind: "router",       icon: "⑂", label: "Router", colorVar: "var(--node-router)" },
  { kind: "memory",       icon: "⊟", label: "Memory", colorVar: "var(--node-memory)" },
  { kind: "human_review", icon: "⏸", label: "Review", colorVar: "var(--node-review)" },
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
      <div className="node-palette-header">NODES</div>
      {PALETTE_ITEMS.map(({ kind, icon, label, colorVar }) => (
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
          <span className="palette-item-icon" style={{ color: colorVar }}>{icon}</span>
          <span className="palette-item-label">{label}</span>
        </div>
      ))}
    </aside>
  );
}
