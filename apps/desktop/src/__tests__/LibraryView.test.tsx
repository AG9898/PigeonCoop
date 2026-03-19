import { render, screen, fireEvent, act } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { vi, type Mock } from "vitest";
import { LibraryView } from "../views/LibraryView";

const mockInvoke = invoke as Mock;

const DEMO_WF_ID = "00000000-0000-0000-0000-000000000001";

function mockWorkflow(id = DEMO_WF_ID, name = "Demo Workflow") {
  return {
    workflow_id: id,
    name,
    schema_version: 1,
    version: 1,
    metadata: null,
    nodes: [],
    edges: [],
    default_constraints: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

function mockRun(runId = "run-0001", workflowId = DEMO_WF_ID) {
  return {
    run_id: runId,
    workflow_id: workflowId,
    workflow_version: 1,
    status: "running",
    workspace_root: "/tmp/project",
    created_at: "2026-01-01T10:00:00Z",
    started_at: "2026-01-01T10:00:01Z",
    ended_at: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockInvoke.mockImplementation((cmd: string) => {
    if (cmd === "list_workflows") return Promise.resolve([mockWorkflow()]);
    if (cmd === "list_runs_for_workflow") return Promise.resolve([]);
    return Promise.resolve(null);
  });
});

describe("LibraryView Start Run button", () => {
  it("each workflow card has a Start Run button", async () => {
    await act(async () => {
      render(<LibraryView onOpenReplay={vi.fn()} />);
    });

    expect(screen.getByTestId(`start-run-${DEMO_WF_ID}`)).toBeTruthy();
  });

  it("clicking Start Run shows workspace input", async () => {
    await act(async () => {
      render(<LibraryView onOpenReplay={vi.fn()} />);
    });

    // Input not visible yet
    expect(screen.queryByTestId(`workspace-input-${DEMO_WF_ID}`)).toBeNull();

    fireEvent.click(screen.getByTestId(`start-run-${DEMO_WF_ID}`));

    expect(screen.getByTestId(`workspace-input-${DEMO_WF_ID}`)).toBeTruthy();
  });

  it("workspace input defaults to empty string", async () => {
    await act(async () => {
      render(<LibraryView onOpenReplay={vi.fn()} />);
    });

    fireEvent.click(screen.getByTestId(`start-run-${DEMO_WF_ID}`));

    const input = screen.getByTestId(`workspace-input-${DEMO_WF_ID}`) as HTMLInputElement;
    expect(input.value).toBe("");
  });

  it("calls create_run and start_run on submit and navigates to live run", async () => {
    const run = mockRun();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_workflows") return Promise.resolve([mockWorkflow()]);
      if (cmd === "list_runs_for_workflow") return Promise.resolve([]);
      if (cmd === "create_run") return Promise.resolve(run);
      if (cmd === "start_run") return Promise.resolve();
      return Promise.resolve(null);
    });

    const onOpenLiveRun = vi.fn();
    await act(async () => {
      render(<LibraryView onOpenReplay={vi.fn()} onOpenLiveRun={onOpenLiveRun} />);
    });

    fireEvent.click(screen.getByTestId(`start-run-${DEMO_WF_ID}`));

    const input = screen.getByTestId(`workspace-input-${DEMO_WF_ID}`);
    fireEvent.change(input, { target: { value: "/my/project" } });

    await act(async () => {
      fireEvent.click(screen.getByTestId(`submit-run-${DEMO_WF_ID}`));
    });

    const createCall = mockInvoke.mock.calls.find((c: unknown[]) => c[0] === "create_run");
    expect(createCall).toBeTruthy();
    expect((createCall as unknown[])[1]).toMatchObject({
      workflowId: DEMO_WF_ID,
      workspaceRoot: "/my/project",
    });

    const startCall = mockInvoke.mock.calls.find((c: unknown[]) => c[0] === "start_run");
    expect(startCall).toBeTruthy();
    expect((startCall as unknown[])[1]).toMatchObject({ runId: run.run_id });

    expect(onOpenLiveRun).toHaveBeenCalledWith(run.run_id);
  });

  it("shows inline error when create_run fails", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_workflows") return Promise.resolve([mockWorkflow()]);
      if (cmd === "list_runs_for_workflow") return Promise.resolve([]);
      if (cmd === "create_run") return Promise.reject(new Error("IPC error: backend down"));
      return Promise.resolve(null);
    });

    await act(async () => {
      render(<LibraryView onOpenReplay={vi.fn()} />);
    });

    fireEvent.click(screen.getByTestId(`start-run-${DEMO_WF_ID}`));

    await act(async () => {
      fireEvent.click(screen.getByTestId(`submit-run-${DEMO_WF_ID}`));
    });

    expect(screen.getByTestId(`start-run-error-${DEMO_WF_ID}`)).toBeTruthy();
    expect(screen.getByTestId(`start-run-error-${DEMO_WF_ID}`).textContent).toContain("IPC error");
  });

  it("shows inline error when start_run fails", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_workflows") return Promise.resolve([mockWorkflow()]);
      if (cmd === "list_runs_for_workflow") return Promise.resolve([]);
      if (cmd === "create_run") return Promise.resolve(mockRun());
      if (cmd === "start_run") return Promise.reject(new Error("start failed"));
      return Promise.resolve(null);
    });

    await act(async () => {
      render(<LibraryView onOpenReplay={vi.fn()} />);
    });

    fireEvent.click(screen.getByTestId(`start-run-${DEMO_WF_ID}`));

    await act(async () => {
      fireEvent.click(screen.getByTestId(`submit-run-${DEMO_WF_ID}`));
    });

    expect(screen.getByTestId(`start-run-error-${DEMO_WF_ID}`).textContent).toContain("start failed");
  });

  it("clicking Start Run again hides the form", async () => {
    await act(async () => {
      render(<LibraryView onOpenReplay={vi.fn()} />);
    });

    fireEvent.click(screen.getByTestId(`start-run-${DEMO_WF_ID}`));
    expect(screen.getByTestId(`workspace-input-${DEMO_WF_ID}`)).toBeTruthy();

    fireEvent.click(screen.getByTestId(`start-run-${DEMO_WF_ID}`));
    expect(screen.queryByTestId(`workspace-input-${DEMO_WF_ID}`)).toBeNull();
  });
});
