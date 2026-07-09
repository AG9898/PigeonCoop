// ToolNode verifies the procedural wrench-bot keeps shared node state classes.

import { render } from "@testing-library/react";
import ToolNode from "../components/nodes/ToolNode";
import type { WorkflowNodeData } from "../components/nodes/WorkflowNode";
import type { NodeProps } from "reactflow";

function makeProps(data: WorkflowNodeData, selected = false): NodeProps<WorkflowNodeData> {
  return {
    id: "n1",
    data,
    selected,
    type: "tool",
    zIndex: 0,
    isConnectable: true,
    xPos: 0,
    yPos: 0,
    dragging: false,
  } as unknown as NodeProps<WorkflowNodeData>;
}

describe("ToolNode", () => {
  it("renders the wf-node + tool-node container classes", () => {
    const { container } = render(<ToolNode {...makeProps({ kind: "tool", label: "Tests" })} />);
    const root = container.querySelector(".wf-node");
    expect(root).toBeTruthy();
    expect(root?.classList.contains("tool-node")).toBe(true);
    expect(root?.classList.contains("wf-node--tool")).toBe(true);
  });

  it("applies a wf-node--<state> class for non-idle states", () => {
    const { container } = render(
      <ToolNode {...makeProps({ kind: "tool", label: "Tests", state: "running" })} />
    );
    expect(container.querySelector(".wf-node--running")).toBeTruthy();
  });

  it("applies selected and invalid classes", () => {
    const { container } = render(
      <ToolNode {...makeProps({ kind: "tool", label: "Tests", invalid: true }, true)} />
    );
    expect(container.querySelector(".wf-node--selected")).toBeTruthy();
    expect(container.querySelector(".wf-node--invalid")).toBeTruthy();
  });

  it("renders the footer with label and state badge", () => {
    const { getByText } = render(
      <ToolNode {...makeProps({ kind: "tool", label: "Lint", state: "waiting" })} />
    );
    expect(getByText("Lint")).toBeTruthy();
    expect(getByText("waiting")).toBeTruthy();
  });

  it("renders the ToolSprite canvas inside the node", () => {
    const { container } = render(<ToolNode {...makeProps({ kind: "tool", label: "Tests" })} />);
    expect(container.querySelector("canvas.tool-node-sprite")).toBeTruthy();
  });
});
