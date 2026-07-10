// App — unified workspace shell (DEC-011).
// Covers: initial library load, sidebar → canvas selection, save/validate
// from the top bar, the one-click Run flow into the run surface, workflow
// deletion, and the app-wide run_status_changed subscription.

import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { App } from "../app/App";
import { vi, type Mock } from "vitest";
import { DEMO_WORKFLOW_ID } from "../data/demo-workflow";

const mockInvoke = invoke as Mock;
const mockListen = listen as Mock;

/** Find the captured listener callback for a given Tauri event name. */
function listenerFor(eventName: string): (ev: { payload: unknown }) => void {
  const call = mockListen.mock.calls.find((c: unknown[]) => c[0] === eventName);
  if (!call) throw new Error(`no listener registered for ${eventName}`);
  return call[1] as (ev: { payload: unknown }) => void;
}

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
    // Resolve stored workflows by id; the demo id resolves so first-run
    // seeding skips.
    if (cmd === "get_workflow") {
      const id = (args as { id?: string } | undefined)?.id;
      const found = [WF_A, WF_B].find((w) => w.workflow_id === id);
      return Promise.resolve(found ?? wf(DEMO_WORKFLOW_ID, "Demo"));
    }
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
    expect(screen.getByText("Agent Arcade")).toBeTruthy();
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

  it("Delete removes the workflow after confirmation and opens the next one", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    let deleted = false;
    setupInvoke({
      delete_workflow: () => {
        deleted = true;
        return Promise.resolve(null);
      },
      list_workflows: () => Promise.resolve(deleted ? [WF_B] : [WF_A, WF_B]),
    });
    await act(async () => {
      render(<App />);
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("delete-btn-wf-aaaa"));
    });

    const deleteCall = mockInvoke.mock.calls.find((c) => c[0] === "delete_workflow");
    expect(deleteCall?.[1]).toEqual({ id: "wf-aaaa" });
    const nameInput = screen.getByTestId("workflow-name-input") as HTMLInputElement;
    expect(nameInput.value).toBe("Beta Flow");
  });

  it("Delete does nothing when the confirmation is declined", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    await act(async () => {
      render(<App />);
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("delete-btn-wf-aaaa"));
    });
    expect(mockInvoke.mock.calls.some((c) => c[0] === "delete_workflow")).toBe(false);
  });

  it("run_status_changed updates sidebar run chips without the run open", async () => {
    const sidebarRun = {
      run_id: "run-1234",
      workflow_id: "wf-aaaa",
      workflow_version: 1,
      status: "running",
      workspace_root: "/tmp/proj",
      created_at: "2026-03-09T10:00:00Z",
      started_at: "2026-03-09T10:00:01Z",
    };
    setupInvoke({
      list_runs_for_workflow: [sidebarRun],
      get_run: {
        ...sidebarRun,
        status: "succeeded",
        ended_at: "2026-03-09T10:05:00Z",
      },
    });
    await act(async () => {
      render(<App />);
    });
    await waitFor(() => {
      expect(screen.getByTestId("run-card-run-1234").textContent).toContain("running");
    });

    await act(async () => {
      listenerFor("run_status_changed")({
        payload: {
          run_id: "run-1234",
          old_status: "running",
          new_status: "succeeded",
          timestamp: "2026-03-09T10:05:00Z",
        },
      });
    });
    await waitFor(() => {
      expect(screen.getByTestId("run-card-run-1234").textContent).toContain("succeeded");
    });
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
