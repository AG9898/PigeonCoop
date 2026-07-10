// WorkflowSidebar — the always-visible library pane (DEC-011).
// Presentational: selection, empty states, runs sublist, import/export.

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { WorkflowSidebar, type WorkflowSidebarProps } from "../components/sidebar/WorkflowSidebar";
import type { RunInstance, WorkflowDefinition } from "../types/workflow";

function wf(id: string, name: string): WorkflowDefinition {
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

function run(id: string, status: RunInstance["status"]): RunInstance {
  return {
    run_id: id,
    workflow_id: "wf-aaaa",
    workflow_version: 1,
    status,
    workspace_root: "/tmp/proj",
    created_at: "2026-03-09T10:00:00Z",
    started_at: "2026-03-09T10:00:01Z",
  };
}

function renderSidebar(overrides: Partial<WorkflowSidebarProps> = {}) {
  const props: WorkflowSidebarProps = {
    workflows: [wf("wf-aaaa", "Alpha Flow"), wf("wf-bbbb", "Beta Flow")],
    runs: null,
    selectedWorkflowId: null,
    selectedRunId: null,
    onSelectWorkflow: vi.fn(),
    onSelectRun: vi.fn(),
    onNewWorkflow: vi.fn(),
    onImport: vi.fn(),
    onExport: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
  render(<WorkflowSidebar {...props} />);
  return props;
}

describe("WorkflowSidebar", () => {
  it("lists all workflows", () => {
    renderSidebar();
    expect(screen.getByText("Alpha Flow")).toBeTruthy();
    expect(screen.getByText("Beta Flow")).toBeTruthy();
  });

  it("shows an empty state when there are no workflows", () => {
    renderSidebar({ workflows: [] });
    expect(screen.getByTestId("empty-workflows")).toBeTruthy();
  });

  it("clicking a workflow card fires onSelectWorkflow", () => {
    const props = renderSidebar();
    fireEvent.click(screen.getByTestId("workflow-card-wf-bbbb"));
    expect(props.onSelectWorkflow).toHaveBeenCalledWith("wf-bbbb");
  });

  it("shows runs under the selected workflow and fires onSelectRun", () => {
    const props = renderSidebar({
      selectedWorkflowId: "wf-aaaa",
      runs: [run("run-1", "succeeded"), run("run-2", "failed")],
    });
    expect(screen.getByTestId("run-list")).toBeTruthy();
    expect(screen.getByText("succeeded")).toBeTruthy();
    expect(screen.getByText("failed")).toBeTruthy();

    fireEvent.click(screen.getByTestId("run-card-run-2"));
    expect(props.onSelectRun).toHaveBeenCalledWith("run-2");
  });

  it("shows the no-runs hint for a selected workflow without runs", () => {
    renderSidebar({ selectedWorkflowId: "wf-aaaa", runs: [] });
    expect(screen.getByTestId("empty-runs")).toBeTruthy();
  });

  it("New button fires onNewWorkflow", () => {
    const props = renderSidebar();
    fireEvent.click(screen.getByTestId("new-workflow-btn"));
    expect(props.onNewWorkflow).toHaveBeenCalled();
  });

  it("Export button on the selected card fires onExport without selecting", () => {
    const props = renderSidebar({ selectedWorkflowId: "wf-aaaa", runs: [] });
    fireEvent.click(screen.getByTestId("export-btn-wf-aaaa"));
    expect(props.onExport).toHaveBeenCalledWith("wf-aaaa");
    expect(props.onSelectWorkflow).not.toHaveBeenCalled();
  });

  it("Delete button on the selected card fires onDelete without selecting", () => {
    const props = renderSidebar({ selectedWorkflowId: "wf-aaaa", runs: [] });
    fireEvent.click(screen.getByTestId("delete-btn-wf-aaaa"));
    expect(props.onDelete).toHaveBeenCalledWith("wf-aaaa");
    expect(props.onSelectWorkflow).not.toHaveBeenCalled();
  });

  it("does not show a Delete button on unselected cards", () => {
    renderSidebar({ selectedWorkflowId: "wf-aaaa", runs: [] });
    expect(screen.queryByTestId("delete-btn-wf-bbbb")).toBeNull();
  });

  it("importing a file passes its JSON text to onImport", async () => {
    const props = renderSidebar();
    const input = screen.getByTestId("import-file-input") as HTMLInputElement;
    const file = new File(['{"name":"imported"}'], "wf.json", {
      type: "application/json",
    });
    // jsdom's File lacks Blob.text(); polyfill it for the component to read.
    Object.defineProperty(file, "text", {
      value: () => Promise.resolve('{"name":"imported"}'),
    });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => {
      expect(props.onImport).toHaveBeenCalledWith('{"name":"imported"}');
    });
  });

  it("renders the error banner when error is set", () => {
    renderSidebar({ error: "boom" });
    expect(screen.getByTestId("lib-error").textContent).toBe("boom");
  });
});
