// DesignSurface — the edit-mode stage (palette + canvas + inspector +
// validation overlay). Save/Validate live in the App top bar; this suite
// covers the surface itself and the buildWorkflow handle.

import { createRef } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import {
  DesignSurface,
  type DesignSurfaceHandle,
  flowToWorkflow,
} from "../views/DesignSurface";

function renderSurface(
  overrides: Partial<React.ComponentProps<typeof DesignSurface>> = {}
) {
  const ref = createRef<DesignSurfaceHandle>();
  const props = {
    canvasKey: "test",
    validationResult: null,
    onDismissValidation: vi.fn(),
    ...overrides,
  };
  render(<DesignSurface ref={ref} {...props} />);
  return { ref, props };
}

describe("DesignSurface", () => {
  it("renders the node palette with all 7 node types", () => {
    renderSurface();
    for (const label of ["Start", "End", "Agent", "Tool", "Router", "Memory", "Review"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it("clicking each palette item does not throw", () => {
    renderSurface();
    for (const label of ["Start", "End", "Agent", "Tool", "Router", "Memory", "Review"]) {
      fireEvent.click(screen.getByText(label));
    }
  });

  it("shows the validation error panel when errors are present", () => {
    renderSurface({
      validationResult: {
        is_valid: false,
        errors: [{ kind: "no_start_node" }, { kind: "cycle_detected" }],
      },
    });
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText(/No Start node/)).toBeTruthy();
    expect(screen.getByText(/Cycle detected/)).toBeTruthy();
  });

  it("hides the validation panel for a valid result", () => {
    renderSurface({
      validationResult: { is_valid: true, errors: [] },
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("dismiss button fires onDismissValidation", () => {
    const { props } = renderSurface({
      validationResult: {
        is_valid: false,
        errors: [{ kind: "no_end_node" }],
      },
    });
    fireEvent.click(screen.getByText("×"));
    expect(props.onDismissValidation).toHaveBeenCalled();
  });

  it("buildWorkflow returns a definition built from the canvas", () => {
    const { ref } = renderSurface();
    const wf = ref.current!.buildWorkflow("wf-test", "My Flow");
    expect(wf).not.toBeNull();
    expect(wf!.workflow_id).toBe("wf-test");
    expect(wf!.name).toBe("My Flow");
    expect(Array.isArray(wf!.nodes)).toBe(true);
    expect(Array.isArray(wf!.edges)).toBe(true);
  });
});

describe("flowToWorkflow", () => {
  it("maps flow nodes/edges to a WorkflowDefinition", () => {
    const wf = flowToWorkflow(
      {
        nodes: [
          {
            id: "n1",
            type: "agent",
            position: { x: 10, y: 20 },
            data: { kind: "agent", label: "Plan", config: { prompt: "p" } },
          } as never,
        ],
        edges: [
          {
            id: "e1",
            source: "n1",
            target: "n1",
            data: { condition_kind: "on_success" },
          } as never,
        ],
      },
      "wf-1",
      "Named"
    );
    expect(wf.nodes[0].node_id).toBe("n1");
    expect(wf.nodes[0].display).toEqual({ x: 10, y: 20 });
    expect(wf.nodes[0].config).toEqual({ prompt: "p" });
    expect(wf.edges[0].condition_kind).toBe("on_success");
    expect(wf.name).toBe("Named");
  });
});
