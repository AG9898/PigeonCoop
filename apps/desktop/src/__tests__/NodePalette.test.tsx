import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import { NodePalette } from "../components/panels/NodePalette";

const ALL_NODE_LABELS = ["Start", "End", "Agent", "Tool", "Router", "Memory", "Review"];

describe("NodePalette", () => {
  it("renders all 7 node types", () => {
    render(<NodePalette onAddNode={vi.fn()} />);
    for (const label of ALL_NODE_LABELS) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it("calls onAddNode with correct kind when an item is clicked", () => {
    const onAddNode = vi.fn();
    render(<NodePalette onAddNode={onAddNode} />);
    fireEvent.click(screen.getByText("Agent"));
    expect(onAddNode).toHaveBeenCalledWith("agent");
  });

  it("calls onAddNode for each node type when clicked", () => {
    const onAddNode = vi.fn();
    render(<NodePalette onAddNode={onAddNode} />);

    const expectations: Array<[string, string]> = [
      ["Start",  "start"],
      ["End",    "end"],
      ["Agent",  "agent"],
      ["Tool",   "tool"],
      ["Router", "router"],
      ["Memory", "memory"],
      ["Review", "human_review"],
    ];

    for (const [label, kind] of expectations) {
      onAddNode.mockClear();
      fireEvent.click(screen.getByText(label));
      expect(onAddNode).toHaveBeenCalledWith(kind);
    }
  });

  it("sets dataTransfer on drag start", () => {
    render(<NodePalette onAddNode={vi.fn()} />);
    const agentItem = screen.getByText("Agent").closest(".palette-item")!;

    const dataStore: Record<string, string> = {};
    const mockDataTransfer = {
      setData: (type: string, value: string) => { dataStore[type] = value; },
      effectAllowed: "",
    };

    fireEvent.dragStart(agentItem, { dataTransfer: mockDataTransfer });
    expect(dataStore["application/reactflow"]).toBe("agent");
  });

  it("items have draggable attribute", () => {
    render(<NodePalette onAddNode={vi.fn()} />);
    const agentItem = screen.getByText("Agent").closest(".palette-item")!;
    expect(agentItem.getAttribute("draggable")).toBe("true");
  });

  it("calls onAddNode via keyboard Enter", () => {
    const onAddNode = vi.fn();
    render(<NodePalette onAddNode={onAddNode} />);
    const toolItem = screen.getByText("Tool").closest(".palette-item")!;
    fireEvent.keyDown(toolItem, { key: "Enter" });
    expect(onAddNode).toHaveBeenCalledWith("tool");
  });
});
