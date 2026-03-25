// WorkflowCanvas tests — edge creation dialog and canvas imperative handle.
//
// This file overrides the global reactflow mock (from setup.ts) to capture the
// onConnect and onSelectionChange callbacks that React Flow passes to the canvas.
// That lets us trigger the EdgeConditionDialog and selection flows without a
// real browser drag gesture.

import { createRef } from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { vi } from "vitest";

// ---------------------------------------------------------------------------
// Override reactflow mock to capture canvas callbacks
// ---------------------------------------------------------------------------

// vi.hoisted runs before imports so these are available inside vi.mock factories.
const hooks = vi.hoisted(() => ({
  onConnect: null as ((conn: unknown) => void) | null,
  onSelectionChange: null as ((data: { nodes: unknown[] }) => void) | null,
  setNodes: vi.fn() as ReturnType<typeof vi.fn>,
  setEdges: vi.fn() as ReturnType<typeof vi.fn>,
  nodes: [] as unknown[],
  edges: [] as unknown[],
}));

vi.mock("reactflow", () => ({
  default: (props: {
    onConnect?: (conn: unknown) => void;
    onSelectionChange?: (data: { nodes: unknown[] }) => void;
    children?: unknown;
  }) => {
    hooks.onConnect = props.onConnect ?? null;
    hooks.onSelectionChange = props.onSelectionChange ?? null;
    return null;
  },
  ReactFlowProvider: ({ children }: { children?: unknown }) => children,
  Background: () => null,
  BackgroundVariant: { Dots: "dots", Lines: "lines", Cross: "cross" },
  Controls: () => null,
  MiniMap: () => null,
  Handle: () => null,
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  useNodesState: (init: unknown[]) => {
    hooks.nodes = init;
    return [init, hooks.setNodes, vi.fn()];
  },
  useEdgesState: (init: unknown[]) => {
    hooks.edges = init;
    return [init, hooks.setEdges, vi.fn()];
  },
  addEdge: vi.fn((params: unknown, eds: unknown[]) => [...eds, params]),
  useReactFlow: (() => {
    const inst = {
      project: vi.fn(({ x, y }: { x: number; y: number }) => ({ x, y })),
      getViewport: vi.fn(() => ({ x: 0, y: 0, zoom: 1 })),
      setViewport: vi.fn(),
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
      fitView: vi.fn(),
      getNodes: vi.fn(() => []),
      setNodes: vi.fn(),
    };
    return () => inst;
  })(),
}));

import { WorkflowCanvas, WorkflowCanvasHandle } from "../components/canvas/WorkflowCanvas";
import type { WorkflowDefinition } from "../types/workflow";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SAMPLE_WF: WorkflowDefinition = {
  workflow_id: "wf-test",
  name: "Test",
  schema_version: 1,
  version: 1,
  metadata: null,
  nodes: [
    {
      node_id: "n1",
      node_type: "start",
      label: "Start",
      config: null,
      input_contract: null,
      output_contract: null,
      memory_access: null,
      retry_policy: { max_retries: 0 },
      display: { x: 0, y: 0 },
    },
    {
      node_id: "n2",
      node_type: "end",
      label: "End",
      config: null,
      input_contract: null,
      output_contract: null,
      memory_access: null,
      retry_policy: { max_retries: 0 },
      display: { x: 200, y: 0 },
    },
  ],
  edges: [
    {
      edge_id: "e1",
      source_node_id: "n1",
      target_node_id: "n2",
      condition_kind: "always",
      label: undefined,
    },
  ],
  default_constraints: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

beforeEach(() => {
  hooks.onConnect = null;
  hooks.onSelectionChange = null;
  hooks.setNodes.mockClear();
  hooks.setEdges.mockClear();
  hooks.nodes = [];
  hooks.edges = [];
});

// ---------------------------------------------------------------------------
// getFlowData — loading from workflow
// ---------------------------------------------------------------------------

describe("WorkflowCanvas — getFlowData", () => {
  it("returns nodes and edges loaded from a workflow prop", () => {
    const ref = createRef<WorkflowCanvasHandle>();
    render(<WorkflowCanvas ref={ref} workflow={SAMPLE_WF} />);
    const data = ref.current?.getFlowData();
    expect(data?.nodes).toHaveLength(2);
    expect(data?.edges).toHaveLength(1);
    expect(data?.nodes[0].type).toBe("start");
    expect(data?.nodes[1].type).toBe("end");
    expect(data?.edges[0].id).toBe("e1");
    expect(data?.edges[0].data).toEqual({ condition_kind: "always" });
  });

  it("returns empty arrays when no workflow is provided", () => {
    const ref = createRef<WorkflowCanvasHandle>();
    render(<WorkflowCanvas ref={ref} />);
    const data = ref.current?.getFlowData();
    expect(data?.nodes).toHaveLength(0);
    expect(data?.edges).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// addNode — imperative handle
// ---------------------------------------------------------------------------

describe("WorkflowCanvas — addNode", () => {
  it("calls setNodes with a new agent node appended", () => {
    const ref = createRef<WorkflowCanvasHandle>();
    render(<WorkflowCanvas ref={ref} />);
    hooks.setNodes.mockClear();

    ref.current?.addNode("agent");

    expect(hooks.setNodes).toHaveBeenCalledOnce();
    // The argument is an updater function — call it to inspect the new state.
    const updater = hooks.setNodes.mock.calls[0][0] as (nds: unknown[]) => unknown[];
    const result = updater([]);
    expect(result).toHaveLength(1);
    expect((result[0] as { type: string }).type).toBe("agent");
    expect((result[0] as { data: { kind: string; label: string } }).data.kind).toBe("agent");
    expect((result[0] as { data: { label: string } }).data.label).toBe("Agent");
  });

  it("appends to existing nodes", () => {
    const ref = createRef<WorkflowCanvasHandle>();
    render(<WorkflowCanvas ref={ref} />);
    hooks.setNodes.mockClear();

    ref.current?.addNode("tool");

    const updater = hooks.setNodes.mock.calls[0][0] as (nds: unknown[]) => unknown[];
    const existing = [{ id: "existing", type: "start" }];
    const result = updater(existing);
    expect(result).toHaveLength(2);
    expect((result[1] as { type: string }).type).toBe("tool");
  });

  it("uses provided position when given", () => {
    const ref = createRef<WorkflowCanvasHandle>();
    render(<WorkflowCanvas ref={ref} />);
    hooks.setNodes.mockClear();

    ref.current?.addNode("memory", { x: 300, y: 150 });

    const updater = hooks.setNodes.mock.calls[0][0] as (nds: unknown[]) => unknown[];
    const result = updater([]);
    expect((result[0] as { position: { x: number; y: number } }).position).toEqual({ x: 300, y: 150 });
  });
});

// ---------------------------------------------------------------------------
// updateNodeLabel — imperative handle
// ---------------------------------------------------------------------------

describe("WorkflowCanvas — updateNodeLabel", () => {
  it("calls setNodes with updated label", () => {
    const ref = createRef<WorkflowCanvasHandle>();
    render(<WorkflowCanvas ref={ref} />);
    hooks.setNodes.mockClear();

    ref.current?.updateNodeLabel("n1", "New Label");

    expect(hooks.setNodes).toHaveBeenCalledOnce();
    const updater = hooks.setNodes.mock.calls[0][0] as (
      nds: { id: string; data: { label: string } }[]
    ) => { id: string; data: { label: string } }[];
    const existing = [{ id: "n1", data: { label: "Old Label" } }];
    const result = updater(existing);
    expect(result[0].data.label).toBe("New Label");
  });
});

// ---------------------------------------------------------------------------
// onNodeSelect — selection callback
// ---------------------------------------------------------------------------

describe("WorkflowCanvas — onNodeSelect", () => {
  const sampleNode = {
    id: "n1",
    type: "start",
    position: { x: 0, y: 0 },
    data: { kind: "start", label: "Start" },
  };

  it("calls onNodeSelect with the node when one node is selected", () => {
    const onNodeSelect = vi.fn();
    render(<WorkflowCanvas onNodeSelect={onNodeSelect} />);
    hooks.onSelectionChange!({ nodes: [sampleNode] });
    expect(onNodeSelect).toHaveBeenCalledWith(sampleNode);
  });

  it("calls onNodeSelect with null when selection is cleared", () => {
    const onNodeSelect = vi.fn();
    render(<WorkflowCanvas onNodeSelect={onNodeSelect} />);
    hooks.onSelectionChange!({ nodes: [] });
    expect(onNodeSelect).toHaveBeenCalledWith(null);
  });

  it("calls onNodeSelect with null when multiple nodes are selected", () => {
    const onNodeSelect = vi.fn();
    render(<WorkflowCanvas onNodeSelect={onNodeSelect} />);
    hooks.onSelectionChange!({ nodes: [sampleNode, { ...sampleNode, id: "n2" }] });
    expect(onNodeSelect).toHaveBeenCalledWith(null);
  });
});

// ---------------------------------------------------------------------------
// Edge creation — EdgeConditionDialog
// ---------------------------------------------------------------------------

describe("WorkflowCanvas — edge creation (EdgeConditionDialog)", () => {
  it("shows EDGE CONDITION dialog when a connection is made", async () => {
    render(<WorkflowCanvas />);
    expect(hooks.onConnect).toBeTruthy();
    await act(async () => {
      hooks.onConnect!({ source: "n1", target: "n2", sourceHandle: null, targetHandle: null });
    });
    expect(screen.getByText("EDGE CONDITION")).toBeTruthy();
  });

  it("shows all four condition options in the dialog", async () => {
    render(<WorkflowCanvas />);
    await act(async () => {
      hooks.onConnect!({ source: "n1", target: "n2", sourceHandle: null, targetHandle: null });
    });
    expect(screen.getByText("Always")).toBeTruthy();
    expect(screen.getByText("On Success")).toBeTruthy();
    expect(screen.getByText("On Failure")).toBeTruthy();
    expect(screen.getByText("Expression")).toBeTruthy();
  });

  it("shows condition descriptions", async () => {
    render(<WorkflowCanvas />);
    await act(async () => {
      hooks.onConnect!({ source: "n1", target: "n2", sourceHandle: null, targetHandle: null });
    });
    expect(screen.getByText("Follow this edge regardless of outcome")).toBeTruthy();
  });

  it("dismisses dialog when × is clicked", async () => {
    render(<WorkflowCanvas />);
    await act(async () => {
      hooks.onConnect!({ source: "n1", target: "n2", sourceHandle: null, targetHandle: null });
    });
    expect(screen.getByText("EDGE CONDITION")).toBeTruthy();
    fireEvent.click(screen.getByText("×"));
    expect(screen.queryByText("EDGE CONDITION")).toBeNull();
  });

  it("dismisses dialog when overlay is clicked", async () => {
    const { container } = render(<WorkflowCanvas />);
    await act(async () => {
      hooks.onConnect!({ source: "n1", target: "n2", sourceHandle: null, targetHandle: null });
    });
    const overlay = container.querySelector(".edge-condition-overlay")!;
    fireEvent.click(overlay);
    expect(screen.queryByText("EDGE CONDITION")).toBeNull();
  });

  it("commits edge and dismisses dialog when a condition is selected", async () => {
    render(<WorkflowCanvas />);
    // Clear mount-time setEdges call (from invalidEdgeIds effect) before tracking.
    hooks.setEdges.mockClear();
    await act(async () => {
      hooks.onConnect!({ source: "n1", target: "n2", sourceHandle: null, targetHandle: null });
    });
    fireEvent.click(screen.getByText("On Success"));
    // Dialog should close after selection
    expect(screen.queryByText("EDGE CONDITION")).toBeNull();
    // setEdges should have been called exactly once to commit the new edge
    expect(hooks.setEdges).toHaveBeenCalledOnce();
  });

  it("commits edge with correct condition_kind in edge data", async () => {
    render(<WorkflowCanvas />);
    // Clear mount-time setEdges call before tracking.
    hooks.setEdges.mockClear();
    await act(async () => {
      hooks.onConnect!({ source: "n1", target: "n2", sourceHandle: null, targetHandle: null });
    });
    fireEvent.click(screen.getByText("Always"));
    expect(hooks.setEdges).toHaveBeenCalledOnce();
    // The updater receives current edges; call it to see the new edge
    const updater = hooks.setEdges.mock.calls[0][0] as (eds: unknown[]) => unknown[];
    const result = updater([]);
    expect((result[0] as { data: { condition_kind: string } }).data.condition_kind).toBe("always");
  });
});
