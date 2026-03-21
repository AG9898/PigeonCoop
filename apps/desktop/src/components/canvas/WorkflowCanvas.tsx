// Workflow builder canvas powered by React Flow.
// Loads from a WorkflowDefinition or starts with an empty canvas.
// Nodes are draggable and selectable. Edge connections can be drawn.
// NodePalette items can be dragged onto the canvas or clicked to add nodes.

import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef } from "react";
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
import type { NodeKind, WorkflowDefinition } from "../../types/workflow";

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

function workflowToFlow(wf: WorkflowDefinition): {
  nodes: Node<WorkflowNodeData>[];
  edges: Edge[];
} {
  const nodes: Node<WorkflowNodeData>[] = wf.nodes.map((n) => ({
    id: n.node_id,
    type: n.node_type,
    position: { x: n.display.x, y: n.display.y },
    data: { kind: n.node_type, label: n.label },
  }));

  const edges: Edge[] = wf.edges.map((e) => ({
    id: e.edge_id,
    source: e.source_node_id,
    target: e.target_node_id,
    label: e.label ?? undefined,
  }));

  return { nodes, edges };
}

const EMPTY_NODES: Node[] = [];
const EMPTY_EDGES: Edge[] = [];

export interface WorkflowCanvasHandle {
  getFlowData(): { nodes: Node<WorkflowNodeData>[]; edges: Edge[] };
  addNode(kind: NodeKind, position?: { x: number; y: number }): void;
}

interface WorkflowCanvasProps {
  workflow?: WorkflowDefinition;
}

// CanvasInner uses useReactFlow — must be inside ReactFlowProvider.
const CanvasInner = forwardRef<WorkflowCanvasHandle, WorkflowCanvasProps>(
  function CanvasInner({ workflow }, ref) {
    const { project } = useReactFlow();
    const containerRef = useRef<HTMLDivElement>(null);

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

    useImperativeHandle(
      ref,
      () => ({
        getFlowData: () => ({ nodes, edges }),
        addNode: addNodeImpl,
      }),
      [nodes, edges, addNodeImpl]
    );

    const onConnect = useCallback(
      (params: Connection) => setEdges((eds) => addEdge(params, eds)),
      [setEdges]
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
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
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
