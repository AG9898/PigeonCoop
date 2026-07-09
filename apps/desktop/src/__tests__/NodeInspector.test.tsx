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

/** The MODEL select is the only <select> containing an "Other..." option. */
function getModelSelect(): HTMLSelectElement {
  return screen.getByRole("option", { name: "Other..." }).closest("select") as HTMLSelectElement;
}

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

  it("renders output mode select defaulting to raw", () => {
    render(<NodeInspector node={makeNode("agent", { prompt: "", output_mode: "raw" })} {...callbacks} />);
    const sel = screen.getByDisplayValue("raw") as HTMLSelectElement;
    expect(sel.tagName).toBe("SELECT");
  });
});

// ---------------------------------------------------------------------------
// Agent config — provider / model selector (UI-BLD-008)
// ---------------------------------------------------------------------------

describe("NodeInspector — agent provider/model selector", () => {
  it("does not show a raw COMMAND field or MODEL selector by default (no provider set)", () => {
    render(<NodeInspector node={makeNode("agent", { prompt: "", output_mode: "raw" })} {...callbacks} />);
    expect(screen.queryByPlaceholderText("e.g. claude-code")).toBeNull();
    // MODEL select is shown when provider isn't "custom" — verify it's present and blank.
    const modelSelect = getModelSelect();
    expect(modelSelect.value).toBe("");
  });

  it("lists all KNOWN_PROVIDERS entries in the provider dropdown", () => {
    render(<NodeInspector node={makeNode("agent", { prompt: "", output_mode: "raw" })} {...callbacks} />);
    expect(screen.getByRole("option", { name: "Claude Code" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "OpenAI Codex" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Gemini CLI" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Custom Command" })).toBeTruthy();
  });

  it("populates the model dropdown with curated models for a known provider", () => {
    render(
      <NodeInspector
        node={makeNode("agent", { prompt: "", output_mode: "raw", provider_hint: "claude" })}
        {...callbacks}
      />
    );
    expect(screen.getByRole("option", { name: "Claude Sonnet 4.6" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Claude Opus 4.6" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Other..." })).toBeTruthy();
  });

  it("shows a free-form model input when Other... is selected", () => {
    render(
      <NodeInspector
        node={makeNode("agent", { prompt: "", output_mode: "raw", provider_hint: "claude" })}
        {...callbacks}
      />
    );
    const modelSelect = getModelSelect();
    fireEvent.change(modelSelect, { target: { value: "__other__" } });
    expect(screen.getByPlaceholderText("e.g. claude-sonnet-4-6")).toBeTruthy();
  });

  it("shows a raw CLI command input and hides the model dropdown when provider is Custom", () => {
    render(
      <NodeInspector
        node={makeNode("agent", { prompt: "", output_mode: "raw", provider_hint: "custom" })}
        {...callbacks}
      />
    );
    expect(screen.getByPlaceholderText("e.g. claude-code")).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Other..." })).toBeNull();
  });

  it("resets model to undefined when provider changes", () => {
    const onUpdateConfig = vi.fn();
    render(
      <NodeInspector
        node={makeNode("agent", { prompt: "", output_mode: "raw", provider_hint: "claude", model: "claude-sonnet-4-6" })}
        onUpdateLabel={vi.fn()}
        onUpdateConfig={onUpdateConfig}
        onUpdateRetryPolicy={vi.fn()}
      />
    );
    const providerSelect = screen.getByDisplayValue("Claude Code");
    fireEvent.change(providerSelect, { target: { value: "openai" } });
    expect(onUpdateConfig).toHaveBeenCalledWith(
      expect.objectContaining({ provider_hint: "openai", model: undefined })
    );
  });

  it("updates config with a curated model selection", () => {
    const onUpdateConfig = vi.fn();
    render(
      <NodeInspector
        node={makeNode("agent", { prompt: "", output_mode: "raw", provider_hint: "gemini" })}
        onUpdateLabel={vi.fn()}
        onUpdateConfig={onUpdateConfig}
        onUpdateRetryPolicy={vi.fn()}
      />
    );
    const modelSelect = getModelSelect();
    fireEvent.change(modelSelect, { target: { value: "gemini-2.5-pro" } });
    expect(onUpdateConfig).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gemini-2.5-pro" })
    );
  });

  it("loads an existing node without a model field with a blank model selector", () => {
    render(
      <NodeInspector
        node={makeNode("agent", { prompt: "", output_mode: "raw", provider_hint: "claude" })}
        {...callbacks}
      />
    );
    const modelSelect = getModelSelect();
    expect(modelSelect.value).toBe("");
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
