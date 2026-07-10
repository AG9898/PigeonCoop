import { render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "reactflow";
import RoleNode, { ROLE_META } from "../components/nodes/RoleNode";

function renderRole(kind: keyof typeof ROLE_META, tokenPct?: number) {
  return render(
    <ReactFlowProvider>
      <RoleNode
        id="node-1"
        type={kind}
        data={{ kind, label: "Role label", state: "running", tokenPct }}
        selected={false}
        isConnectable
        zIndex={0}
        xPos={0}
        yPos={0}
        dragging={false}
      />
    </ReactFlowProvider>
  );
}

describe("RoleNode", () => {
  it.each(Object.keys(ROLE_META) as Array<keyof typeof ROLE_META>)(
    "renders generated identity for %s",
    (kind) => {
      const { container } = renderRole(kind);
      expect(screen.getByText(ROLE_META[kind].label)).toBeTruthy();
      expect(container.querySelector("img")?.getAttribute("src")).toBe(
        ROLE_META[kind].image
      );
      expect(screen.getByTestId("animated-role-sprite")).toBeTruthy();
      expect(screen.getByText("Role label")).toBeTruthy();
      expect(screen.getByText("running")).toBeTruthy();
    }
  );

  it("shows the context meter only for agent nodes with token data", () => {
    const { rerender } = renderRole("agent", 72);
    expect(screen.getByTestId("agent-token-health")).toBeTruthy();

    rerender(
      <ReactFlowProvider>
        <RoleNode
          id="node-2"
          type="tool"
          data={{ kind: "tool", label: "Tool", state: "idle", tokenPct: 72 }}
          selected={false}
          isConnectable
          zIndex={0}
          xPos={0}
          yPos={0}
          dragging={false}
        />
      </ReactFlowProvider>
    );
    expect(screen.queryByTestId("agent-token-health")).toBeNull();
  });
});
