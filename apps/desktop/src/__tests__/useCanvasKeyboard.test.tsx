import { render, fireEvent } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { useRef } from "react";
import { useCanvasKeyboard } from "../hooks/useCanvasKeyboard";
import { useReactFlow } from "reactflow";

// The mock from setup.ts returns an object with vi.fn() values.
// Cast to access the mock functions.
interface FlowMock {
  getViewport: ReturnType<typeof vi.fn>;
  setViewport: ReturnType<typeof vi.fn>;
  zoomIn: ReturnType<typeof vi.fn>;
  zoomOut: ReturnType<typeof vi.fn>;
  fitView: ReturnType<typeof vi.fn>;
  getNodes: ReturnType<typeof vi.fn>;
  setNodes: ReturnType<typeof vi.fn>;
}

function getFlowMock(): FlowMock {
  return (useReactFlow as ReturnType<typeof vi.fn>)() as FlowMock;
}

function Harness() {
  const ref = useRef<HTMLDivElement>(null);
  useCanvasKeyboard(ref);
  return <div ref={ref} tabIndex={0} data-testid="canvas" />;
}

describe("useCanvasKeyboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("pans right when ArrowRight is pressed", () => {
    const flow = getFlowMock();
    render(<Harness />);
    const canvas = document.querySelector("[data-testid='canvas']")!;

    fireEvent.keyDown(canvas, { key: "ArrowRight" });
    expect(flow.setViewport).toHaveBeenCalledWith({ x: -50, y: 0, zoom: 1 });
  });

  it("pans left when ArrowLeft is pressed", () => {
    const flow = getFlowMock();
    render(<Harness />);
    const canvas = document.querySelector("[data-testid='canvas']")!;

    fireEvent.keyDown(canvas, { key: "ArrowLeft" });
    expect(flow.setViewport).toHaveBeenCalledWith({ x: 50, y: 0, zoom: 1 });
  });

  it("pans up when ArrowUp is pressed", () => {
    const flow = getFlowMock();
    render(<Harness />);
    const canvas = document.querySelector("[data-testid='canvas']")!;

    fireEvent.keyDown(canvas, { key: "ArrowUp" });
    expect(flow.setViewport).toHaveBeenCalledWith({ x: 0, y: 50, zoom: 1 });
  });

  it("pans down when ArrowDown is pressed", () => {
    const flow = getFlowMock();
    render(<Harness />);
    const canvas = document.querySelector("[data-testid='canvas']")!;

    fireEvent.keyDown(canvas, { key: "ArrowDown" });
    expect(flow.setViewport).toHaveBeenCalledWith({ x: 0, y: -50, zoom: 1 });
  });

  it("zooms in on + key", () => {
    const flow = getFlowMock();
    render(<Harness />);
    const canvas = document.querySelector("[data-testid='canvas']")!;

    fireEvent.keyDown(canvas, { key: "+" });
    expect(flow.zoomIn).toHaveBeenCalled();
  });

  it("zooms in on = key", () => {
    const flow = getFlowMock();
    render(<Harness />);
    const canvas = document.querySelector("[data-testid='canvas']")!;

    fireEvent.keyDown(canvas, { key: "=" });
    expect(flow.zoomIn).toHaveBeenCalled();
  });

  it("zooms out on - key", () => {
    const flow = getFlowMock();
    render(<Harness />);
    const canvas = document.querySelector("[data-testid='canvas']")!;

    fireEvent.keyDown(canvas, { key: "-" });
    expect(flow.zoomOut).toHaveBeenCalled();
  });

  it("fits view on F key", () => {
    const flow = getFlowMock();
    render(<Harness />);
    const canvas = document.querySelector("[data-testid='canvas']")!;

    fireEvent.keyDown(canvas, { key: "f" });
    expect(flow.fitView).toHaveBeenCalledWith({ padding: 0.2 });
  });

  it("does not fit view when Ctrl+F is pressed (browser find)", () => {
    const flow = getFlowMock();
    render(<Harness />);
    const canvas = document.querySelector("[data-testid='canvas']")!;

    fireEvent.keyDown(canvas, { key: "f", ctrlKey: true });
    expect(flow.fitView).not.toHaveBeenCalled();
  });

  it("cycles node selection with Tab", () => {
    const flow = getFlowMock();
    const nodes = [
      { id: "a", selected: false },
      { id: "b", selected: false },
    ];
    flow.getNodes.mockReturnValue(nodes);

    render(<Harness />);
    const canvas = document.querySelector("[data-testid='canvas']")!;

    fireEvent.keyDown(canvas, { key: "Tab" });
    expect(flow.setNodes).toHaveBeenCalledWith([
      { id: "a", selected: true },
      { id: "b", selected: false },
    ]);
  });

  it("cycles in reverse with Shift+Tab", () => {
    const flow = getFlowMock();
    const nodes = [
      { id: "a", selected: true },
      { id: "b", selected: false },
    ];
    flow.getNodes.mockReturnValue(nodes);

    render(<Harness />);
    const canvas = document.querySelector("[data-testid='canvas']")!;

    fireEvent.keyDown(canvas, { key: "Tab", shiftKey: true });
    expect(flow.setNodes).toHaveBeenCalledWith([
      { id: "a", selected: false },
      { id: "b", selected: true },
    ]);
  });

  it("deselects all on Escape", () => {
    const flow = getFlowMock();
    const nodes = [
      { id: "a", selected: true },
      { id: "b", selected: false },
    ];
    flow.getNodes.mockReturnValue(nodes);

    render(<Harness />);
    const canvas = document.querySelector("[data-testid='canvas']")!;

    fireEvent.keyDown(canvas, { key: "Escape" });
    expect(flow.setNodes).toHaveBeenCalledWith([
      { id: "a", selected: false },
      { id: "b", selected: false },
    ]);
  });

  it("ignores keys when target is an input", () => {
    const flow = getFlowMock();
    render(<Harness />);
    const canvas = document.querySelector("[data-testid='canvas']")!;

    const input = document.createElement("input");
    canvas.appendChild(input);
    fireEvent.keyDown(input, { key: "ArrowRight" });

    expect(flow.setViewport).not.toHaveBeenCalled();
  });

  it("ignores arrow keys with Ctrl modifier", () => {
    const flow = getFlowMock();
    render(<Harness />);
    const canvas = document.querySelector("[data-testid='canvas']")!;

    fireEvent.keyDown(canvas, { key: "ArrowRight", ctrlKey: true });
    expect(flow.setViewport).not.toHaveBeenCalled();
  });
});
