import { render, screen, fireEvent, act } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { vi } from "vitest";
import { BuilderView } from "../views/BuilderView";
import type { WorkflowDefinition } from "../types/workflow";

const mockInvoke = invoke as ReturnType<typeof vi.fn>;

const SAMPLE_WF: WorkflowDefinition = {
  workflow_id: "wf-001",
  name: "Test Workflow",
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
      display: { x: 100, y: 50 },
    },
  ],
  edges: [],
  default_constraints: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("BuilderView save/load", () => {
  it("renders Save and Load buttons", () => {
    render(<BuilderView />);
    expect(screen.getByText("Save")).toBeTruthy();
    expect(screen.getByText("Load")).toBeTruthy();
  });

  it("calls create_workflow on first save", async () => {
    mockInvoke.mockResolvedValue(undefined);
    render(<BuilderView />);
    await act(async () => {
      fireEvent.click(screen.getByText("Save"));
    });
    expect(mockInvoke).toHaveBeenCalledWith(
      "create_workflow",
      expect.objectContaining({ workflow: expect.objectContaining({ name: "Untitled Workflow" }) })
    );
    expect(screen.getByText("Saved")).toBeTruthy();
  });

  it("calls update_workflow on subsequent save after load", async () => {
    mockInvoke
      .mockResolvedValueOnce([SAMPLE_WF]) // list_workflows
      .mockResolvedValueOnce(undefined);  // update_workflow

    render(<BuilderView />);

    // Open picker and load workflow
    await act(async () => {
      fireEvent.click(screen.getByText("Load"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Test Workflow"));
    });

    expect(screen.getByText("Loaded")).toBeTruthy();

    // Save — should use update_workflow since workflowId is now set
    await act(async () => {
      fireEvent.click(screen.getByText("Save"));
    });
    expect(mockInvoke).toHaveBeenCalledWith(
      "update_workflow",
      expect.objectContaining({ workflow: expect.objectContaining({ workflow_id: "wf-001" }) })
    );
  });

  it("shows workflow picker with loaded list", async () => {
    mockInvoke.mockResolvedValue([SAMPLE_WF]);
    render(<BuilderView />);
    await act(async () => {
      fireEvent.click(screen.getByText("Load"));
    });
    expect(screen.getByText("Select Workflow")).toBeTruthy();
    expect(screen.getByText("Test Workflow")).toBeTruthy();
  });

  it("shows empty state when no saved workflows", async () => {
    mockInvoke.mockResolvedValue([]);
    render(<BuilderView />);
    await act(async () => {
      fireEvent.click(screen.getByText("Load"));
    });
    expect(screen.getByText("No saved workflows")).toBeTruthy();
  });

  it("closes picker when × is clicked", async () => {
    mockInvoke.mockResolvedValue([SAMPLE_WF]);
    render(<BuilderView />);
    await act(async () => {
      fireEvent.click(screen.getByText("Load"));
    });
    expect(screen.getByText("Select Workflow")).toBeTruthy();
    fireEvent.click(screen.getByText("×"));
    expect(screen.queryByText("Select Workflow")).toBeNull();
  });

  it("shows error message on save failure", async () => {
    mockInvoke.mockRejectedValue("DB error");
    render(<BuilderView />);
    await act(async () => {
      fireEvent.click(screen.getByText("Save"));
    });
    expect(screen.getByText("Save failed: DB error")).toBeTruthy();
  });

  it("shows error message on load failure", async () => {
    mockInvoke.mockRejectedValue("connection error");
    render(<BuilderView />);
    await act(async () => {
      fireEvent.click(screen.getByText("Load"));
    });
    expect(screen.getByText("Load failed: connection error")).toBeTruthy();
  });
});

describe("BuilderView node palette integration", () => {
  it("renders the node palette with all 7 node types", () => {
    render(<BuilderView />);
    expect(screen.getByText("NODES")).toBeTruthy();
    for (const label of ["Start", "End", "Agent", "Tool", "Router", "Memory", "Review"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it("clicking a palette item does not throw", () => {
    render(<BuilderView />);
    expect(() => fireEvent.click(screen.getByText("Agent"))).not.toThrow();
  });

  it("clicking each palette item does not throw", () => {
    render(<BuilderView />);
    for (const label of ["Start", "End", "Agent", "Tool", "Router", "Memory", "Review"]) {
      expect(() => fireEvent.click(screen.getByText(label))).not.toThrow();
    }
  });
});

describe("BuilderView validation", () => {
  it("renders Validate button", () => {
    render(<BuilderView />);
    expect(screen.getByText("Validate")).toBeTruthy();
  });

  it("calls validate_workflow on Validate click", async () => {
    const result = { is_valid: true, errors: [] };
    mockInvoke.mockResolvedValue(result);
    render(<BuilderView />);
    await act(async () => {
      fireEvent.click(screen.getByText("Validate"));
    });
    expect(mockInvoke).toHaveBeenCalledWith(
      "validate_workflow",
      expect.objectContaining({ workflow: expect.objectContaining({ name: "Untitled Workflow" }) })
    );
  });

  it("shows Valid status when workflow passes validation", async () => {
    const result = { is_valid: true, errors: [] };
    mockInvoke.mockResolvedValue(result);
    render(<BuilderView />);
    await act(async () => {
      fireEvent.click(screen.getByText("Validate"));
    });
    expect(screen.getByText("Valid")).toBeTruthy();
  });

  it("shows validation error panel when errors are present", async () => {
    const result = {
      is_valid: false,
      errors: [{ kind: "no_start_node" }],
    };
    mockInvoke.mockResolvedValue(result);
    render(<BuilderView />);
    await act(async () => {
      fireEvent.click(screen.getByText("Validate"));
    });
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("VALIDATION ERRORS")).toBeTruthy();
    expect(screen.getByText("No Start node — add exactly one Start node.")).toBeTruthy();
  });

  it("shows error count in status badge when validation fails", async () => {
    const result = {
      is_valid: false,
      errors: [{ kind: "no_start_node" }, { kind: "no_end_node" }],
    };
    mockInvoke.mockResolvedValue(result);
    render(<BuilderView />);
    await act(async () => {
      fireEvent.click(screen.getByText("Validate"));
    });
    expect(screen.getByText("2 error(s)")).toBeTruthy();
  });

  it("dismisses validation panel when × is clicked", async () => {
    const result = {
      is_valid: false,
      errors: [{ kind: "no_end_node" }],
    };
    mockInvoke.mockResolvedValue(result);
    render(<BuilderView />);
    await act(async () => {
      fireEvent.click(screen.getByText("Validate"));
    });
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getAllByText("×")[0]);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows Validation failed status on invoke error", async () => {
    mockInvoke.mockRejectedValue("backend error");
    render(<BuilderView />);
    await act(async () => {
      fireEvent.click(screen.getByText("Validate"));
    });
    expect(screen.getByText("Validation failed: backend error")).toBeTruthy();
  });
});
