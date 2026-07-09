// App — unified workspace shell (DEC-011).
// Covers: initial library load, sidebar → canvas selection, save/validate
// from the top bar, and the one-click Run flow into the run surface.

import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { App } from "../app/App";
import { vi, type Mock } from "vitest";
import { DEMO_WORKFLOW_ID } from "../data/demo-workflow";

const mockInvoke = invoke as Mock;

function wf(id: string, name: string) {
  return {
    workflow_id: id,
    name,
    schema_version: 1,
    version: 1,
    metadata: null,
    nodes: [],
    edges: [],
    default_constraints: null,
    created_at: "2026-03-09T09:00:00Z",
    updated_at: "2026-03-09T09:00:00Z",
  };
}

const WF_A = wf("wf-aaaa", "Alpha Flow");
const WF_B = wf("wf-bbbb", "Beta Flow");

function setupInvoke(overrides: Record<string, unknown> = {}) {
  mockInvoke.mockImplementation((cmd: string, args?: unknown) => {
    if (cmd in overrides) {
      const v = overrides[cmd];
      return typeof v === "function" ? (v as (a?: unknown) => unknown)(args) : Promise.resolve(v);
    }
    // Demo workflow already present → first-run seeding skips.
    if (cmd === "get_workflow") return Promise.resolve(wf(DEMO_WORKFLOW_ID, "Demo"));
    if (cmd === "list_workflows") return Promise.resolve([WF_A, WF_B]);
    if (cmd === "list_runs_for_workflow") return Promise.resolve([]);
    if (cmd === "validate_workflow")
      return Promise.resolve({ is_valid: true, errors: [] });
    if (cmd === "create_run")
      return Promise.resolve({
        run_id: "run-1234",
        workflow_id: "wf-aaaa",
        workflow_version: 1,
        status: "created",
        workspace_root: "/tmp/proj",
        created_at: "2026-03-09T10:00:00Z",
      });
    if (cmd === "get_run")
      return Promise.resolve({
        run_id: "run-1234",
        workflow_id: "wf-aaaa",
        workflow_version: 1,
        status: "running",
        workspace_root: "/tmp/proj",
        created_at: "2026-03-09T10:00:00Z",
        started_at: "2026-03-09T10:00:01Z",
      });
    if (cmd === "list_events_for_run") return Promise.resolve([]);
    return Promise.resolve(null);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  setupInvoke();
});

describe("App — unified workspace shell", () => {
  it("renders the top bar, sidebar and design surface", async () => {
    await act(async () => {
      render(<App />);
    });
    expect(screen.getByText("AGENT ARCADE")).toBeTruthy();
    expect(screen.getByTestId("workflow-sidebar")).toBeTruthy();
    expect(screen.getByTestId("design-surface")).toBeTruthy();
    expect(screen.getByTestId("run-btn")).toBeTruthy();
  });

  it("loads workflows on start and opens the first one", async () => {
    await act(async () => {
      render(<App />);
    });
    await waitFor(() => {
      expect(screen.getByTestId("workflow-list")).toBeTruthy();
    });
    const nameInput = screen.getByTestId("workflow-name-input") as HTMLInputElement;
    expect(nameInput.value).toBe("Alpha Flow");
    // Its runs were requested for the sidebar.
    expect(
      mockInvoke.mock.calls.some((c) => c[0] === "list_runs_for_workflow")
    ).toBe(true);
  });

  it("selecting another workflow in the sidebar loads it onto the canvas", async () => {
    await act(async () => {
      render(<App />);
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("workflow-card-wf-bbbb"));
    });
    const nameInput = screen.getByTestId("workflow-name-input") as HTMLInputElement;
    expect(nameInput.value).toBe("Beta Flow");
  });

  it("New starts an empty untitled canvas", async () => {
    await act(async () => {
      render(<App />);
    });
    fireEvent.click(screen.getByTestId("new-workflow-btn"));
    const nameInput = screen.getByTestId("workflow-name-input") as HTMLInputElement;
    expect(nameInput.value).toBe("Untitled Workflow");
  });

  it("Save calls update_workflow for a loaded workflow", async () => {
    await act(async () => {
      render(<App />);
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("save-btn"));
    });
    expect(mockInvoke.mock.calls.some((c) => c[0] === "update_workflow")).toBe(true);
  });

  it("Save calls create_workflow for a new canvas", async () => {
    await act(async () => {
      render(<App />);
    });
    fireEvent.click(screen.getByTestId("new-workflow-btn"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("save-btn"));
    });
    expect(mockInvoke.mock.calls.some((c) => c[0] === "create_workflow")).toBe(true);
  });

  it("Validate reports a valid workflow in the status area", async () => {
    await act(async () => {
      render(<App />);
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("validate-btn"));
    });
    expect(screen.getByTestId("topbar-status").textContent).toBe("Valid");
  });

  it("Validate surfaces errors in the validation panel", async () => {
    setupInvoke({
      validate_workflow: {
        is_valid: false,
        errors: [{ kind: "no_start_node" }],
      },
    });
    await act(async () => {
      render(<App />);
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("validate-btn"));
    });
    expect(screen.getByText(/No Start node/)).toBeTruthy();
    expect(screen.getByTestId("topbar-status").textContent).toContain("error");
  });

  it("Run without a workspace folder shows an inline error and does not create a run", async () => {
    await act(async () => {
      render(<App />);
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("run-btn"));
    });
    expect(screen.getByTestId("topbar-status").textContent).toContain("workspace");
    expect(mockInvoke.mock.calls.some((c) => c[0] === "create_run")).toBe(false);
  });

  it("Run saves, creates and starts a run, then opens the run surface", async () => {
    await act(async () => {
      render(<App />);
    });
    fireEvent.change(screen.getByTestId("workspace-input"), {
      target: { value: "/tmp/proj" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("run-btn"));
    });

    expect(mockInvoke.mock.calls.some((c) => c[0] === "create_run")).toBe(true);
    expect(mockInvoke.mock.calls.some((c) => c[0] === "start_run")).toBe(true);
    await waitFor(() => {
      expect(screen.getByTestId("run-panel")).toBeTruthy();
    });
    // Design-mode controls are replaced by the back-to-editor affordance.
    expect(screen.getByTestId("back-to-editor-btn")).toBeTruthy();
  });

  it("Back to editor returns to the design surface", async () => {
    await act(async () => {
      render(<App />);
    });
    fireEvent.change(screen.getByTestId("workspace-input"), {
      target: { value: "/tmp/proj" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("run-btn"));
    });
    await waitFor(() => {
      expect(screen.getByTestId("run-panel")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("back-to-editor-btn"));
    });
    expect(screen.getByTestId("design-surface")).toBeTruthy();
  });

  it("persists the workspace folder across sessions", async () => {
    await act(async () => {
      render(<App />);
    });
    fireEvent.change(screen.getByTestId("workspace-input"), {
      target: { value: "/home/me/repo" },
    });
    await waitFor(() => {
      expect(localStorage.getItem("agent-arcade.workspaceRoot")).toBe("/home/me/repo");
    });
  });
});
