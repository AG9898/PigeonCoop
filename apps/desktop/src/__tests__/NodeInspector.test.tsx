import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import type { Node } from "reactflow";
import { NodeInspector } from "../components/panels/NodeInspector";
import type { WorkflowNodeData } from "../components/nodes/WorkflowNode";
import type { NodeKind } from "../types/workflow";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(
  kind: NodeKind,
  configOverride?: Record<string, unknown>
): Node<WorkflowNodeData> {
  return {
    id: "n1",
    type: kind,
    position: { x: 0, y: 0 },
    data: {
      kind,
      label: "Test Node",
      config: configOverride,
      retry_policy: { max_retries: 0 },
    },
  };
}

const callbacks = {
  onUpdateLabel: vi.fn(),
  onUpdateConfig: vi.fn(),
  onUpdateRetryPolicy: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Kind header
// ---------------------------------------------------------------------------

describe("NodeInspector — kind header", () => {
  it.each([
    ["start",        "START"],
    ["end",          "END"],
    ["agent",        "AGENT"],
    ["tool",         "TOOL"],
    ["router",       "ROUTER"],
    ["memory",       "MEMORY"],
    ["human_review", "HUMAN REVIEW"],
  ] as [NodeKind, string][])("renders %s kind label", (kind, expected) => {
    render(<NodeInspector node={makeNode(kind)} {...callbacks} />);
    expect(screen.getByText(expected)).toBeTruthy();
    expect(screen.getByText("INSPECTOR")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Start / End — no config
// ---------------------------------------------------------------------------

describe("NodeInspector — start / end nodes", () => {
  it("shows no-config message for start node", () => {
    render(<NodeInspector node={makeNode("start")} {...callbacks} />);
    expect(screen.getByText("Start node — no configuration")).toBeTruthy();
  });

  it("shows no-config message for end node", () => {
    render(<NodeInspector node={makeNode("end")} {...callbacks} />);
    expect(screen.getByText("End node — no configuration")).toBeTruthy();
  });

  it("does not render CONFIG section for start node", () => {
    render(<NodeInspector node={makeNode("start")} {...callbacks} />);
    expect(screen.queryByText("CONFIG")).toBeNull();
  });

  it("does not render CONFIG section for end node", () => {
    render(<NodeInspector node={makeNode("end")} {...callbacks} />);
    expect(screen.queryByText("CONFIG")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Agent config form
// ---------------------------------------------------------------------------

describe("NodeInspector — agent config", () => {
  it("renders prompt textarea", () => {
    render(<NodeInspector node={makeNode("agent", { prompt: "", output_mode: "raw" })} {...callbacks} />);
    expect(screen.getByPlaceholderText("Instruction text sent to the agent")).toBeTruthy();
  });

  it("renders command and model inputs", () => {
    render(<NodeInspector node={makeNode("agent", { prompt: "", output_mode: "raw" })} {...callbacks} />);
    expect(screen.getByPlaceholderText("e.g. claude-code")).toBeTruthy();
    expect(screen.getByPlaceholderText("e.g. claude-sonnet-4-6")).toBeTruthy();
  });

  it("renders provider input", () => {
    render(<NodeInspector node={makeNode("agent", { prompt: "", output_mode: "raw" })} {...callbacks} />);
    expect(screen.getByPlaceholderText("e.g. claude, openai")).toBeTruthy();
  });

  it("renders output mode select defaulting to raw", () => {
    render(<NodeInspector node={makeNode("agent", { prompt: "", output_mode: "raw" })} {...callbacks} />);
    const sel = screen.getByDisplayValue("raw") as HTMLSelectElement;
    expect(sel.tagName).toBe("SELECT");
  });
});

// ---------------------------------------------------------------------------
// Tool config form
// ---------------------------------------------------------------------------

describe("NodeInspector — tool config", () => {
  it("renders command, shell, and timeout fields", () => {
    render(<NodeInspector node={makeNode("tool", { command: "" })} {...callbacks} />);
    expect(screen.getByPlaceholderText("e.g. cargo test")).toBeTruthy();
    expect(screen.getByPlaceholderText("e.g. bash (default: system shell)")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Memory config form
// ---------------------------------------------------------------------------

describe("NodeInspector — memory config", () => {
  it("renders key, scope, and operation fields", () => {
    render(<NodeInspector node={makeNode("memory", { key: "", scope: "run_shared", operation: "read" })} {...callbacks} />);
    expect(screen.getByPlaceholderText("e.g. run_shared.plan")).toBeTruthy();
    expect(screen.getByDisplayValue("run_shared")).toBeTruthy();
    expect(screen.getByDisplayValue("read")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Router config form
// ---------------------------------------------------------------------------

describe("NodeInspector — router config", () => {
  it("renders ROUTING RULES section and add button", () => {
    render(<NodeInspector node={makeNode("router", { rules: [] })} {...callbacks} />);
    expect(screen.getByText("ROUTING RULES")).toBeTruthy();
    expect(screen.getByText("+ Add Rule")).toBeTruthy();
  });

  it("adds a rule row when Add Rule is clicked", () => {
    render(<NodeInspector node={makeNode("router", { rules: [] })} {...callbacks} />);
    fireEvent.click(screen.getByText("+ Add Rule"));
    expect(screen.getByPlaceholderText("condition expression")).toBeTruthy();
    expect(screen.getByPlaceholderText("target_key")).toBeTruthy();
  });

  it("calls onUpdateConfig with the new rule on Add Rule click", () => {
    render(<NodeInspector node={makeNode("router", { rules: [] })} {...callbacks} />);
    fireEvent.click(screen.getByText("+ Add Rule"));
    expect(callbacks.onUpdateConfig).toHaveBeenCalledWith(
      expect.objectContaining({ rules: [{ condition: "", target_key: "" }] })
    );
  });
});

// ---------------------------------------------------------------------------
// Human review config form
// ---------------------------------------------------------------------------

describe("NodeInspector — human_review config", () => {
  it("renders prompt, reason, and actions fields", () => {
    render(<NodeInspector node={makeNode("human_review", {})} {...callbacks} />);
    expect(screen.getByPlaceholderText("Instructions shown to the reviewer")).toBeTruthy();
    expect(screen.getByPlaceholderText("Machine-readable rationale")).toBeTruthy();
    expect(screen.getByPlaceholderText("approve, reject, retry")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Label editing
// ---------------------------------------------------------------------------

describe("NodeInspector — label editing", () => {
  it("calls onUpdateLabel when label input changes", () => {
    const onUpdateLabel = vi.fn();
    render(
      <NodeInspector
        node={makeNode("agent", { prompt: "", output_mode: "raw" })}
        onUpdateLabel={onUpdateLabel}
        onUpdateConfig={vi.fn()}
        onUpdateRetryPolicy={vi.fn()}
      />
    );
    fireEvent.change(screen.getByPlaceholderText("Node label"), { target: { value: "My Agent" } });
    expect(onUpdateLabel).toHaveBeenCalledWith("My Agent");
  });

  it("calls onUpdateLabel for start node label change", () => {
    const onUpdateLabel = vi.fn();
    render(
      <NodeInspector
        node={makeNode("start")}
        onUpdateLabel={onUpdateLabel}
        onUpdateConfig={vi.fn()}
        onUpdateRetryPolicy={vi.fn()}
      />
    );
    fireEvent.change(screen.getByPlaceholderText("Node label"), { target: { value: "Entry" } });
    expect(onUpdateLabel).toHaveBeenCalledWith("Entry");
  });
});

// ---------------------------------------------------------------------------
// Config editing callbacks
// ---------------------------------------------------------------------------

describe("NodeInspector — config editing", () => {
  it("calls onUpdateConfig when agent prompt changes", () => {
    const onUpdateConfig = vi.fn();
    render(
      <NodeInspector
        node={makeNode("agent", { prompt: "old", output_mode: "raw" })}
        onUpdateLabel={vi.fn()}
        onUpdateConfig={onUpdateConfig}
        onUpdateRetryPolicy={vi.fn()}
      />
    );
    fireEvent.change(
      screen.getByPlaceholderText("Instruction text sent to the agent"),
      { target: { value: "new prompt" } }
    );
    expect(onUpdateConfig).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "new prompt" })
    );
  });

  it("calls onUpdateConfig when tool command changes", () => {
    const onUpdateConfig = vi.fn();
    render(
      <NodeInspector
        node={makeNode("tool", { command: "cargo test" })}
        onUpdateLabel={vi.fn()}
        onUpdateConfig={onUpdateConfig}
        onUpdateRetryPolicy={vi.fn()}
      />
    );
    fireEvent.change(
      screen.getByPlaceholderText("e.g. cargo test"),
      { target: { value: "npm test" } }
    );
    expect(onUpdateConfig).toHaveBeenCalledWith(
      expect.objectContaining({ command: "npm test" })
    );
  });

  it("calls onUpdateConfig when memory key changes", () => {
    const onUpdateConfig = vi.fn();
    render(
      <NodeInspector
        node={makeNode("memory", { key: "", scope: "run_shared", operation: "read" })}
        onUpdateLabel={vi.fn()}
        onUpdateConfig={onUpdateConfig}
        onUpdateRetryPolicy={vi.fn()}
      />
    );
    fireEvent.change(
      screen.getByPlaceholderText("e.g. run_shared.plan"),
      { target: { value: "run_shared.output" } }
    );
    expect(onUpdateConfig).toHaveBeenCalledWith(
      expect.objectContaining({ key: "run_shared.output" })
    );
  });

  it("calls onUpdateConfig when human_review reason changes", () => {
    const onUpdateConfig = vi.fn();
    render(
      <NodeInspector
        node={makeNode("human_review", {})}
        onUpdateLabel={vi.fn()}
        onUpdateConfig={onUpdateConfig}
        onUpdateRetryPolicy={vi.fn()}
      />
    );
    fireEvent.change(
      screen.getByPlaceholderText("Machine-readable rationale"),
      { target: { value: "needs approval" } }
    );
    expect(onUpdateConfig).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "needs approval" })
    );
  });
});

// ---------------------------------------------------------------------------
// Retry policy editing
// ---------------------------------------------------------------------------

describe("NodeInspector — retry policy", () => {
  it("renders RETRY POLICY section", () => {
    render(<NodeInspector node={makeNode("start")} {...callbacks} />);
    expect(screen.getByText("RETRY POLICY")).toBeTruthy();
  });

  it("calls onUpdateRetryPolicy when max_retries changes", () => {
    const onUpdateRetryPolicy = vi.fn();
    render(
      <NodeInspector
        node={makeNode("start")}
        onUpdateLabel={vi.fn()}
        onUpdateConfig={vi.fn()}
        onUpdateRetryPolicy={onUpdateRetryPolicy}
      />
    );
    // max_retries is the first spinbutton rendered (type=number, value=0)
    const inputs = screen.getAllByRole("spinbutton");
    fireEvent.change(inputs[0], { target: { value: "3" } });
    expect(onUpdateRetryPolicy).toHaveBeenCalledWith(
      expect.objectContaining({ max_retries: 3 })
    );
  });

  it("calls onUpdateRetryPolicy when max_runtime_ms changes", () => {
    const onUpdateRetryPolicy = vi.fn();
    render(
      <NodeInspector
        node={makeNode("start")}
        onUpdateLabel={vi.fn()}
        onUpdateConfig={vi.fn()}
        onUpdateRetryPolicy={onUpdateRetryPolicy}
      />
    );
    const inputs = screen.getAllByRole("spinbutton");
    fireEvent.change(inputs[1], { target: { value: "5000" } });
    expect(onUpdateRetryPolicy).toHaveBeenCalledWith(
      expect.objectContaining({ max_runtime_ms: 5000 })
    );
  });
});
