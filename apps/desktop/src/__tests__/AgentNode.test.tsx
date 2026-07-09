// AgentNode — verifies the .wf-node container classes (state glow, selected,
// invalid) still apply alongside the sprite, and that the footer shows the
// label + state badge. See docs/VISUAL_IDENTITY.md §4.

import { render } from "@testing-library/react";
import AgentNode from "../components/nodes/AgentNode";
import type { WorkflowNodeData } from "../components/nodes/WorkflowNode";
import type { NodeProps } from "reactflow";

function makeProps(data: WorkflowNodeData, selected = false): NodeProps<WorkflowNodeData> {
  return {
    id: "n1",
    data,
    selected,
    type: "agent",
    zIndex: 0,
    isConnectable: true,
    xPos: 0,
    yPos: 0,
    dragging: false,
  } as unknown as NodeProps<WorkflowNodeData>;
}

describe("AgentNode", () => {
  it("renders the wf-node + ag-node container classes", () => {
    const { container } = render(<AgentNode {...makeProps({ kind: "agent", label: "Planner" })} />);
    const root = container.querySelector(".wf-node");
    expect(root).toBeTruthy();
    expect(root?.classList.contains("ag-node")).toBe(true);
    expect(root?.classList.contains("wf-node--agent")).toBe(true);
  });

  it("applies a wf-node--<state> class for non-idle states so container glow/ring still works", () => {
    const { container } = render(
      <AgentNode {...makeProps({ kind: "agent", label: "Planner", state: "running" })} />
    );
    expect(container.querySelector(".wf-node--running")).toBeTruthy();
  });

  it("applies wf-node--selected when selected", () => {
    const { container } = render(
      <AgentNode {...makeProps({ kind: "agent", label: "Planner" }, true)} />
    );
    expect(container.querySelector(".wf-node--selected")).toBeTruthy();
  });

  it("applies wf-node--invalid when flagged invalid", () => {
    const { container } = render(
      <AgentNode {...makeProps({ kind: "agent", label: "Planner", invalid: true })} />
    );
    expect(container.querySelector(".wf-node--invalid")).toBeTruthy();
  });

  it("renders the footer with label and state badge", () => {
    const { getByText } = render(
      <AgentNode {...makeProps({ kind: "agent", label: "Critique", state: "waiting" })} />
    );
    expect(getByText("Critique")).toBeTruthy();
    expect(getByText("waiting")).toBeTruthy();
  });

  it("renders the PigeonSprite canvas inside the node", () => {
    const { container } = render(<AgentNode {...makeProps({ kind: "agent", label: "Planner" })} />);
    expect(container.querySelector("canvas.ag-node-sprite")).toBeTruthy();
  });

  it("hides the token health bar when tokenPct is absent", () => {
    const { queryByTestId } = render(
      <AgentNode {...makeProps({ kind: "agent", label: "Planner" })} />
    );
    expect(queryByTestId("agent-token-health")).toBeNull();
  });

  it.each([
    [42, "#22c55e"],
    [60, "#f59e0b"],
    [86, "#ef4444"],
  ])("renders token health color for %s%% usage", (tokenPct, color) => {
    const { getByTestId } = render(
      <AgentNode
        {...makeProps({ kind: "agent", label: "Planner", tokenPct })}
      />
    );
    const bar = getByTestId("agent-token-health");
    expect(bar.style.getPropertyValue("--fill")).toBe(String(tokenPct));
    expect(bar.style.getPropertyValue("--health-color")).toBe(color);
  });

  it("keeps 85% usage in the amber threshold", () => {
    const { getByTestId } = render(
      <AgentNode
        {...makeProps({ kind: "agent", label: "Planner", tokenPct: 85 })}
      />
    );
    expect(getByTestId("agent-token-health").style.getPropertyValue("--health-color")).toBe("#f59e0b");
  });
});
