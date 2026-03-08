// Workflow builder canvas powered by React Flow.
// Loads from a WorkflowDefinition or starts with an empty canvas.
// Nodes are draggable and selectable. Edge connections can be drawn.

import { forwardRef, useCallback, useImperativeHandle, useMemo } from "react";
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
} from "reactflow";
import "reactflow/dist/style.css";
import WorkflowNode, { WorkflowNodeData } from "../nodes/WorkflowNode";
import type { WorkflowDefinition } from "../../types/workflow";

// All 7 node types mapped to the single WorkflowNode component.
// React Flow requires all types used in node.type to be registered here.
const NODE_TYPES: NodeTypes = {
  start:        WorkflowNode,
  end:          WorkflowNode,
  agent:        WorkflowNode,
  tool:         WorkflowNode,
  router:       WorkflowNode,
  memory:       WorkflowNode,
  human_review: WorkflowNode,
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
}

interface WorkflowCanvasProps {
  workflow?: WorkflowDefinition;
}

export const WorkflowCanvas = forwardRef<WorkflowCanvasHandle, WorkflowCanvasProps>(
  function WorkflowCanvas({ workflow }, ref) {
    const initial = useMemo(
      () =>
        workflow
          ? workflowToFlow(workflow)
          : { nodes: EMPTY_NODES, edges: EMPTY_EDGES },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      []
    );

    const [nodes, , onNodesChange] = useNodesState(initial.nodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);

    useImperativeHandle(ref, () => ({
      getFlowData: () => ({ nodes, edges }),
    }), [nodes, edges]);

    const onConnect = useCallback(
      (params: Connection) => setEdges((eds) => addEdge(params, eds)),
      [setEdges]
    );

    return (
      <div className="wf-canvas">
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
