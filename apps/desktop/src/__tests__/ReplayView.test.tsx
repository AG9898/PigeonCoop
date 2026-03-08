import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ReplayView } from "../views/ReplayView";
import { LibraryView } from "../views/LibraryView";
import { App } from "../app/App";
import type { RunEvent, WorkflowDefinition, RunInstance } from "../types/workflow";

const mockInvoke = invoke as ReturnType<typeof vi.fn>;

const SAMPLE_EVENTS: RunEvent[] = [
  {
    event_id: "evt-001",
    run_id: "run-abc",
    workflow_id: "wf-001",
    event_type: "run.started",
    timestamp: "2026-03-08T10:00:00.000Z",
    payload: { message: "run began" },
    sequence: 1,
  },
  {
    event_id: "evt-002",
    run_id: "run-abc",
    workflow_id: "wf-001",
    node_id: "node-start",
    event_type: "node.queued",
    timestamp: "2026-03-08T10:00:01.000Z",
    payload: {},
    sequence: 2,
  },
  {
    event_id: "evt-003",
    run_id: "run-abc",
    workflow_id: "wf-001",
    node_id: "node-start",
    event_type: "node.succeeded",
    timestamp: "2026-03-08T10:00:02.000Z",
    payload: { output: "done" },
    sequence: 3,
  },
];

const SAMPLE_WORKFLOW: WorkflowDefinition = {
  workflow_id: "wf-001",
  name: "Test Workflow",
  schema_version: 1,
  version: 1,
  metadata: null,
  nodes: [],
  edges: [],
  default_constraints: null,
  created_at: "2026-03-08T10:00:00.000Z",
  updated_at: "2026-03-08T10:00:00.000Z",
};

const SAMPLE_RUN: RunInstance = {
  run_id: "run-abc",
  workflow_id: "wf-001",
  workflow_version: 1,
  status: "succeeded",
  workspace_root: "/home/user/project",
  created_at: "2026-03-08T10:00:00.000Z",
  started_at: "2026-03-08T10:00:01.000Z",
  ended_at: "2026-03-08T10:01:00.000Z",
};

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("ReplayView", () => {
  it("shows no-run-selected message when runId is null", () => {
    render(<ReplayView runId={null} />);
    expect(screen.getByText(/no run selected/i)).toBeTruthy();
  });

  it("calls list_events_for_run when runId is provided", async () => {
    mockInvoke.mockResolvedValueOnce(SAMPLE_EVENTS);
    render(<ReplayView runId="run-abc" />);
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("list_events_for_run", {
        runId: "run-abc",
        offset: 0,
        limit: 500,
      })
    );
  });

  it("renders events in chronological order by sequence", async () => {
    mockInvoke.mockResolvedValueOnce(SAMPLE_EVENTS);
    render(<ReplayView runId="run-abc" />);
    await waitFor(() => screen.getAllByText("run.started"));
    const items = screen.getAllByRole("option");
    expect(items).toHaveLength(3);
    // Sequence numbers should appear in order 1, 2, 3
    expect(items[0].textContent).toContain("1");
    expect(items[1].textContent).toContain("2");
    expect(items[2].textContent).toContain("3");
  });

  it("sets initial scrubber position to first event", async () => {
    mockInvoke.mockResolvedValueOnce(SAMPLE_EVENTS);
    render(<ReplayView runId="run-abc" />);
    await waitFor(() => screen.getAllByText("run.started"));
    const scrubber = screen.getByRole("slider");
    expect(scrubber).toBeTruthy();
    expect((scrubber as HTMLInputElement).value).toBe("0");
  });

  it("shows detail for the currently selected event", async () => {
    mockInvoke.mockResolvedValueOnce(SAMPLE_EVENTS);
    render(<ReplayView runId="run-abc" />);
    await waitFor(() => screen.getAllByText("run.started"));
    // Initial event detail should show first event's type
    const detail = screen.getByTestId("event-detail");
    expect(detail.textContent).toContain("run.started");
    expect(detail.textContent).toContain("evt-001");
  });

  it("advances selected event when a different event is clicked", async () => {
    mockInvoke.mockResolvedValueOnce(SAMPLE_EVENTS);
    render(<ReplayView runId="run-abc" />);
    await waitFor(() => screen.getByText("node.queued"));
    fireEvent.click(screen.getAllByRole("option")[1]);
    const detail = screen.getByTestId("event-detail");
    expect(detail.textContent).toContain("node.queued");
    expect(detail.textContent).toContain("node-start");
  });

  it("shows error state when invoke rejects", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("DB error"));
    render(<ReplayView runId="run-abc" />);
    await waitFor(() => screen.getByText(/DB error/i));
  });

  it("shows REPLAY title", () => {
    render(<ReplayView runId={null} />);
    expect(screen.getByText("REPLAY")).toBeTruthy();
  });
});

describe("LibraryView — Replay access", () => {
  it("renders workflow list and shows replay button after selecting a workflow with runs", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_workflows") return Promise.resolve([SAMPLE_WORKFLOW]);
      if (cmd === "list_runs_for_workflow") return Promise.resolve([SAMPLE_RUN]);
      return Promise.resolve(null);
    });
    render(<LibraryView onOpenReplay={() => {}} />);
    await waitFor(() => screen.getByTestId("workflow-card-wf-001"));
    fireEvent.click(screen.getByTestId("workflow-card-wf-001"));
    await waitFor(() =>
      screen.getByTestId(`open-replay-${SAMPLE_RUN.run_id}`)
    );
    expect(screen.getByTestId(`open-replay-${SAMPLE_RUN.run_id}`)).toBeTruthy();
  });

  it("calls onOpenReplay with run_id when Replay button is clicked", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_workflows") return Promise.resolve([SAMPLE_WORKFLOW]);
      if (cmd === "list_runs_for_workflow") return Promise.resolve([SAMPLE_RUN]);
      return Promise.resolve(null);
    });
    const handler = vi.fn();
    render(<LibraryView onOpenReplay={handler} />);
    await waitFor(() => screen.getByTestId("workflow-card-wf-001"));
    fireEvent.click(screen.getByTestId("workflow-card-wf-001"));
    await waitFor(() =>
      screen.getByTestId(`open-replay-${SAMPLE_RUN.run_id}`)
    );
    fireEvent.click(screen.getByTestId(`open-replay-${SAMPLE_RUN.run_id}`));
    expect(handler).toHaveBeenCalledWith(SAMPLE_RUN.run_id);
  });
});

describe("App — Library to Replay navigation", () => {
  it("navigates from Library to Replay when a run's Replay button is clicked", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_workflows") return Promise.resolve([SAMPLE_WORKFLOW]);
      if (cmd === "list_runs_for_workflow") return Promise.resolve([SAMPLE_RUN]);
      if (cmd === "list_events_for_run") return Promise.resolve([]);
      return Promise.resolve(null);
    });
    render(<App />);
    // Go to Library
    fireEvent.click(screen.getByText("Library"));
    expect(screen.getByText("LIBRARY")).toBeTruthy();
    // Wait for workflow card and click to expand runs
    await waitFor(() => screen.getByTestId("workflow-card-wf-001"));
    fireEvent.click(screen.getByTestId("workflow-card-wf-001"));
    // Wait for run and click Replay
    await waitFor(() =>
      screen.getByTestId(`open-replay-${SAMPLE_RUN.run_id}`)
    );
    fireEvent.click(screen.getByTestId(`open-replay-${SAMPLE_RUN.run_id}`));
    // Should now be in Replay view
    expect(screen.getByText("REPLAY")).toBeTruthy();
  });
});
