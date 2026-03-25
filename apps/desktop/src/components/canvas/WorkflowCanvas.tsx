// Workflow builder canvas powered by React Flow.
// Loads from a WorkflowDefinition or starts with an empty canvas.
// Nodes are draggable and selectable. Edge connections can be drawn.
// NodePalette items can be dragged onto the canvas or clicked to add nodes.
// When a new edge is drawn, a condition_kind picker is shown before committing.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Node,
  Edge,
  NodeTypes,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  ReactFlowProvider,
  useReactFlow,
} from "reactflow";
import "reactflow/dist/style.css";
import WorkflowNode, { WorkflowNodeData } from "../nodes/WorkflowNode";
import type { ConditionKind, NodeKind, WorkflowDefinition } from "../../types/workflow";
import { useCanvasKeyboard } from "../../hooks/useCanvasKeyboard";

// All 7 node types mapped to the single WorkflowNode component.
const NODE_TYPES: NodeTypes = {
  start:        WorkflowNode,
  end:          WorkflowNode,
  agent:        WorkflowNode,
  tool:         WorkflowNode,
  router:       WorkflowNode,
  memory:       WorkflowNode,
  human_review: WorkflowNode,
};

const DEFAULT_LABELS: Record<NodeKind, string> = {
  start:        "Start",
  end:          "End",
  agent:        "Agent",
  tool:         "Tool",
  router:       "Router",
  memory:       "Memory",
  human_review: "Review",
};

const CONDITION_OPTIONS: { value: ConditionKind; label: string; desc: string }[] = [
  { value: "always",      label: "Always",     desc: "Follow this edge regardless of outcome" },
  { value: "on_success",  label: "On Success",  desc: "Follow only when the source node succeeds" },
  { value: "on_failure",  label: "On Failure",  desc: "Follow only when the source node fails" },
  { value: "expression",  label: "Expression",  desc: "Follow based on a custom condition expression" },
];

// ---------------------------------------------------------------------------
// EdgeConditionDialog
// ---------------------------------------------------------------------------

interface EdgeConditionDialogProps {
  onSelect: (kind: ConditionKind) => void;
  onCancel: () => void;
}

function EdgeConditionDialog({ onSelect, onCancel }: EdgeConditionDialogProps) {
  return (
    <div className="edge-condition-overlay" onClick={onCancel}>
      <div className="edge-condition-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="edge-condition-header">
          <span className="edge-condition-title">EDGE CONDITION</span>
          <button className="edge-condition-close" onClick={onCancel}>×</button>
        </div>
        <p className="edge-condition-hint">Select when this edge should be followed:</p>
        <div className="edge-condition-options">
          {CONDITION_OPTIONS.map(({ value, label, desc }) => (
            <button
              key={value}
              className="edge-condition-option"
              onClick={() => onSelect(value)}
            >
              <span className="edge-condition-option-label">{label}</span>
              <span className="edge-condition-option-desc">{desc}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// workflowToFlow
// ---------------------------------------------------------------------------

function workflowToFlow(wf: WorkflowDefinition): {
  nodes: Node<WorkflowNodeData>[];
  edges: Edge[];
} {
  const nodes: Node<WorkflowNodeData>[] = wf.nodes.map((n) => ({
    id: n.node_id,
    type: n.node_type,
    position: { x: n.display.x, y: n.display.y },
    data: {
      kind: n.node_type,
      label: n.label,
      config: n.config as Record<string, unknown> | undefined ?? undefined,
      retry_policy: n.retry_policy,
    },
  }));

  const edges: Edge[] = wf.edges.map((e) => ({
    id: e.edge_id,
    source: e.source_node_id,
    target: e.target_node_id,
    label: e.condition_kind !== "always" ? e.condition_kind : (e.label ?? undefined),
    data: { condition_kind: e.condition_kind },
  }));

  return { nodes, edges };
}

const EMPTY_NODES: Node[] = [];
const EMPTY_EDGES: Edge[] = [];

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface WorkflowCanvasHandle {
  getFlowData(): { nodes: Node<WorkflowNodeData>[]; edges: Edge[] };
  addNode(kind: NodeKind, position?: { x: number; y: number }): void;
  updateNodeLabel(nodeId: string, label: string): void;
  updateNodeConfig(nodeId: string, config: Record<string, unknown>): void;
  updateNodeRetryPolicy(nodeId: string, retryPolicy: { max_retries: number; max_runtime_ms?: number }): void;
}

interface WorkflowCanvasProps {
  workflow?: WorkflowDefinition;
  /** Node IDs flagged as invalid by the validator. */
  invalidNodeIds?: string[];
  /** Edge IDs flagged as invalid by the validator. */
  invalidEdgeIds?: string[];
  /** Called when the node selection changes; null means nothing selected. */
  onNodeSelect?: (node: Node<WorkflowNodeData> | null) => void;
}

// ---------------------------------------------------------------------------
// CanvasInner — must be inside ReactFlowProvider
// ---------------------------------------------------------------------------

const CanvasInner = forwardRef<WorkflowCanvasHandle, WorkflowCanvasProps>(
  function CanvasInner({ workflow, invalidNodeIds, invalidEdgeIds, onNodeSelect }, ref) {
    const { project } = useReactFlow();
    const containerRef = useRef<HTMLDivElement>(null);

    // Keyboard-driven canvas navigation (pan, zoom, node selection).
    useCanvasKeyboard(containerRef);

    const initial = useMemo(
      () =>
        workflow
          ? workflowToFlow(workflow)
          : { nodes: EMPTY_NODES, edges: EMPTY_EDGES },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      []
    );

    const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);

    // Pending connection waiting for condition_kind selection.
    const [pendingConnection, setPendingConnection] = useState<Connection | null>(null);

    // Apply invalid flags to nodes when the invalidNodeIds prop changes.
    useEffect(() => {
      const invalidSet = new Set(invalidNodeIds ?? []);
      setNodes((nds) =>
        nds.map((n) => {
          const shouldBeInvalid = invalidSet.has(n.id);
          if ((n.data as WorkflowNodeData).invalid === shouldBeInvalid) return n;
          return { ...n, data: { ...n.data, invalid: shouldBeInvalid } };
        })
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [invalidNodeIds]);

    // Apply invalid class to edges when the invalidEdgeIds prop changes.
    useEffect(() => {
      const invalidSet = new Set(invalidEdgeIds ?? []);
      setEdges((eds) =>
        eds.map((e) => {
          const shouldBeInvalid = invalidSet.has(e.id);
          const hasClass = e.className?.includes("wf-edge--invalid") ?? false;
          if (shouldBeInvalid === hasClass) return e;
          const base = (e.className ?? "").replace("wf-edge--invalid", "").trim();
          return { ...e, className: shouldBeInvalid ? `${base} wf-edge--invalid`.trim() : base };
        })
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [invalidEdgeIds]);

    const addNodeImpl = useCallback(
      (kind: NodeKind, position?: { x: number; y: number }) => {
        const pos = position ?? { x: 200, y: 200 };
        const newNode: Node<WorkflowNodeData> = {
          id: crypto.randomUUID(),
          type: kind,
          position: pos,
          data: { kind, label: DEFAULT_LABELS[kind] },
        };
        setNodes((nds) => [...nds, newNode]);
      },
      [setNodes]
    );

    const updateNodeLabel = useCallback(
      (nodeId: string, label: string) => {
        setNodes((nds) =>
          nds.map((n) => n.id === nodeId ? { ...n, data: { ...n.data, label } } : n)
        );
      },
      [setNodes]
    );

    const updateNodeConfig = useCallback(
      (nodeId: string, config: Record<string, unknown>) => {
        setNodes((nds) =>
          nds.map((n) => n.id === nodeId ? { ...n, data: { ...n.data, config } } : n)
        );
      },
      [setNodes]
    );

    const updateNodeRetryPolicy = useCallback(
      (nodeId: string, retryPolicy: { max_retries: number; max_runtime_ms?: number }) => {
        setNodes((nds) =>
          nds.map((n) => n.id === nodeId ? { ...n, data: { ...n.data, retry_policy: retryPolicy } } : n)
        );
      },
      [setNodes]
    );

    const handleSelectionChange = useCallback(
      ({ nodes: selectedNodes }: { nodes: Node[] }) => {
        onNodeSelect?.(
          selectedNodes.length === 1
            ? (selectedNodes[0] as Node<WorkflowNodeData>)
            : null
        );
      },
      [onNodeSelect]
    );

    useImperativeHandle(
      ref,
      () => ({
        getFlowData: () => ({ nodes, edges }),
        addNode: addNodeImpl,
        updateNodeLabel,
        updateNodeConfig,
        updateNodeRetryPolicy,
      }),
      [nodes, edges, addNodeImpl, updateNodeLabel, updateNodeConfig, updateNodeRetryPolicy]
    );

    // Intercept connection before adding — store as pending to show condition dialog.
    const onConnect = useCallback((params: Connection) => {
      setPendingConnection(params);
    }, []);

    const handleConditionSelect = useCallback(
      (kind: ConditionKind) => {
        if (!pendingConnection) return;
        const label = kind !== "always" ? kind : undefined;
        setEdges((eds) =>
          addEdge({ ...pendingConnection, label, data: { condition_kind: kind } }, eds)
        );
        setPendingConnection(null);
      },
      [pendingConnection, setEdges]
    );

    const handleDragOver = useCallback((event: React.DragEvent) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    }, []);

    const handleDrop = useCallback(
      (event: React.DragEvent) => {
        event.preventDefault();
        const kind = event.dataTransfer.getData("application/reactflow") as NodeKind;
        if (!kind) return;
        const bounds = containerRef.current?.getBoundingClientRect();
        const position = project({
          x: event.clientX - (bounds?.left ?? 0),
          y: event.clientY - (bounds?.top ?? 0),
        });
        addNodeImpl(kind, position);
      },
      [project, addNodeImpl]
    );

    return (
      <div
        ref={containerRef}
        className="wf-canvas"
        tabIndex={0}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onSelectionChange={handleSelectionChange}
          nodeTypes={NODE_TYPES}
          fitView
          deleteKeyCode="Delete"
          proOptions={{ hideAttribution: true }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1}
            color="var(--color-border)"
          />
          <Controls showInteractive={false} />
          <MiniMap
            nodeColor="var(--color-surface)"
            maskColor="rgba(13,15,20,0.75)"
          />
        </ReactFlow>
        {pendingConnection && (
          <EdgeConditionDialog
            onSelect={handleConditionSelect}
            onCancel={() => setPendingConnection(null)}
          />
        )}
      </div>
    );
  }
);

export const WorkflowCanvas = forwardRef<WorkflowCanvasHandle, WorkflowCanvasProps>(
  function WorkflowCanvas(props, ref) {
    return (
      <ReactFlowProvider>
        <CanvasInner {...props} ref={ref} />
      </ReactFlowProvider>
    );
  }
);
