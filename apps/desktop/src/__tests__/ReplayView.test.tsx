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
    payload: { node_type: "tool", attempt: 1, input_refs: ["mem:run_shared:task_brief"] },
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

const ROUTING_EVENT: RunEvent = {
  event_id: "evt-r01",
  run_id: "run-abc",
  workflow_id: "wf-001",
  node_id: "node-router-1",
  event_type: "router.branch_selected",
  timestamp: "2026-03-08T10:00:03.000Z",
  payload: {
    router_node_id: "node_router_1",
    selected_edge_ids: ["edge_ok"],
    reason: "exit_code == 0",
  },
  sequence: 4,
};

const COMMAND_EVENT: RunEvent = {
  event_id: "evt-c01",
  run_id: "run-abc",
  workflow_id: "wf-001",
  node_id: "node-tool-1",
  event_type: "command.completed",
  timestamp: "2026-03-08T10:00:04.000Z",
  payload: {
    command: "npm test",
    exit_code: 0,
    duration_ms: 4123,
    stdout_bytes: 12044,
    stderr_bytes: 0,
  },
  sequence: 5,
};

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

describe("ReplayView — graph state panel", () => {
  it("shows no-node-events message when no node events have occurred at scrub position 0", async () => {
    // SAMPLE_EVENTS[0] is run.started (no node_id), so graph state should be empty
    mockInvoke.mockResolvedValueOnce(SAMPLE_EVENTS);
    render(<ReplayView runId="run-abc" />);
    await waitFor(() => screen.getAllByText("run.started"));
    const panel = screen.getByTestId("graph-state-panel");
    expect(panel.textContent).toContain("No node events up to this point.");
  });

  it("shows node state after scrubbing to a node event", async () => {
    mockInvoke.mockResolvedValueOnce(SAMPLE_EVENTS);
    render(<ReplayView runId="run-abc" />);
    await waitFor(() => screen.getByText("node.queued"));
    // Click the second event (node.queued for node-start)
    fireEvent.click(screen.getAllByRole("option")[1]);
    const panel = screen.getByTestId("graph-state-panel");
    expect(panel.textContent).toContain("node-start");
    expect(panel.textContent).toContain("queued");
  });

  it("updates node state when scrubber advances to a later node event", async () => {
    mockInvoke.mockResolvedValueOnce(SAMPLE_EVENTS);
    render(<ReplayView runId="run-abc" />);
    await waitFor(() => screen.getByText("node.succeeded"));
    // Click the third event (node.succeeded for node-start)
    fireEvent.click(screen.getAllByRole("option")[2]);
    const nodeItem = screen.getByTestId("node-state-node-start");
    expect(nodeItem.textContent).toContain("succeeded");
  });

  it("graph state panel is present in the DOM", async () => {
    render(<ReplayView runId={null} />);
    expect(screen.getByTestId("graph-state-panel")).toBeTruthy();
  });
});

describe("ReplayView — scrubber drives node states", () => {
  const MULTI_NODE_EVENTS: RunEvent[] = [
    {
      event_id: "evt-s01",
      run_id: "run-abc",
      workflow_id: "wf-001",
      event_type: "run.started",
      timestamp: "2026-03-08T10:00:00.000Z",
      payload: {},
      sequence: 1,
    },
    {
      event_id: "evt-s02",
      run_id: "run-abc",
      workflow_id: "wf-001",
      node_id: "node-plan",
      event_type: "node.queued",
      timestamp: "2026-03-08T10:00:01.000Z",
      payload: { node_type: "agent" },
      sequence: 2,
    },
    {
      event_id: "evt-s03",
      run_id: "run-abc",
      workflow_id: "wf-001",
      node_id: "node-plan",
      event_type: "node.running",
      timestamp: "2026-03-08T10:00:02.000Z",
      payload: {},
      sequence: 3,
    },
    {
      event_id: "evt-s04",
      run_id: "run-abc",
      workflow_id: "wf-001",
      node_id: "node-plan",
      event_type: "node.succeeded",
      timestamp: "2026-03-08T10:00:03.000Z",
      payload: { output: "plan complete" },
      sequence: 4,
    },
    {
      event_id: "evt-s05",
      run_id: "run-abc",
      workflow_id: "wf-001",
      node_id: "node-tool",
      event_type: "node.queued",
      timestamp: "2026-03-08T10:00:04.000Z",
      payload: { node_type: "tool" },
      sequence: 5,
    },
    {
      event_id: "evt-s06",
      run_id: "run-abc",
      workflow_id: "wf-001",
      node_id: "node-tool",
      event_type: "node.running",
      timestamp: "2026-03-08T10:00:05.000Z",
      payload: {},
      sequence: 6,
    },
    {
      event_id: "evt-s07",
      run_id: "run-abc",
      workflow_id: "wf-001",
      node_id: "node-tool",
      event_type: "node.failed",
      timestamp: "2026-03-08T10:00:06.000Z",
      payload: { error: "exit code 1" },
      sequence: 7,
    },
  ];

  it("changing the range slider updates node states in the graph panel", async () => {
    mockInvoke.mockResolvedValueOnce(MULTI_NODE_EVENTS);
    render(<ReplayView runId="run-abc" />);
    await waitFor(() => expect(screen.getAllByRole("option").length).toBe(7));

    // At position 0 (run.started) — no node events yet
    expect(screen.getByTestId("graph-state-panel").textContent).toContain(
      "No node events"
    );

    // Move slider to position 3 (node-plan succeeded)
    fireEvent.change(screen.getByRole("slider"), { target: { value: "3" } });
    await waitFor(() => {
      const planItem = screen.getByTestId("node-state-node-plan");
      expect(planItem.textContent).toContain("succeeded");
    });

    // Move slider to position 5 (node-tool running, node-plan still succeeded)
    fireEvent.change(screen.getByRole("slider"), { target: { value: "5" } });
    await waitFor(() => {
      expect(screen.getByTestId("node-state-node-plan").textContent).toContain(
        "succeeded"
      );
      expect(screen.getByTestId("node-state-node-tool").textContent).toContain(
        "running"
      );
    });

    // Move slider to position 6 (node-tool failed)
    fireEvent.change(screen.getByRole("slider"), { target: { value: "6" } });
    await waitFor(() => {
      expect(screen.getByTestId("node-state-node-tool").textContent).toContain(
        "failed"
      );
    });
  });

  it("scrubbing backward reverts node states to earlier point", async () => {
    mockInvoke.mockResolvedValueOnce(MULTI_NODE_EVENTS);
    render(<ReplayView runId="run-abc" />);
    await waitFor(() => expect(screen.getAllByRole("option").length).toBe(7));

    // Go to end — both nodes have final states
    fireEvent.change(screen.getByRole("slider"), { target: { value: "6" } });
    await waitFor(() => {
      expect(screen.getByTestId("node-state-node-tool").textContent).toContain(
        "failed"
      );
    });

    // Rewind to position 2 — only node-plan running, no node-tool yet
    fireEvent.change(screen.getByRole("slider"), { target: { value: "2" } });
    await waitFor(() => {
      expect(screen.getByTestId("node-state-node-plan").textContent).toContain(
        "running"
      );
      expect(screen.queryByTestId("node-state-node-tool")).toBeNull();
    });
  });

  it("next/prev scrubber buttons update node states incrementally", async () => {
    mockInvoke.mockResolvedValueOnce(MULTI_NODE_EVENTS);
    render(<ReplayView runId="run-abc" />);
    await waitFor(() => expect(screen.getAllByRole("option").length).toBe(7));

    const nextBtn = screen.getByLabelText("next event");

    // At position 0 — no node events
    expect(screen.getByTestId("graph-state-panel").textContent).toContain(
      "No node events"
    );

    // Click next → position 1 (node-plan queued)
    fireEvent.click(nextBtn);
    await waitFor(() => {
      expect(screen.getByTestId("node-state-node-plan").textContent).toContain(
        "queued"
      );
    });

    // Click next → position 2 (node-plan running)
    fireEvent.click(screen.getByLabelText("next event"));
    await waitFor(() => {
      expect(screen.getByTestId("node-state-node-plan").textContent).toContain(
        "running"
      );
    });

    // Click prev → back to position 1 (node-plan queued again)
    fireEvent.click(screen.getByLabelText("previous event"));
    await waitFor(() => {
      expect(screen.getByTestId("node-state-node-plan").textContent).toContain(
        "queued"
      );
    });
  });

  it("event inspector payload updates when scrubber position changes via slider", async () => {
    mockInvoke.mockResolvedValueOnce(MULTI_NODE_EVENTS);
    render(<ReplayView runId="run-abc" />);
    await waitFor(() => expect(screen.getAllByRole("option").length).toBe(7));

    // Position 0: run.started
    expect(screen.getByTestId("event-detail").textContent).toContain("run.started");

    // Move to position 3: node.succeeded with output
    fireEvent.change(screen.getByRole("slider"), { target: { value: "3" } });
    await waitFor(() => {
      const detail = screen.getByTestId("event-detail");
      expect(detail.textContent).toContain("node.succeeded");
      expect(detail.textContent).toContain("plan complete");
    });

    // Move to position 6: node.failed with error
    fireEvent.change(screen.getByRole("slider"), { target: { value: "6" } });
    await waitFor(() => {
      const detail = screen.getByTestId("event-detail");
      expect(detail.textContent).toContain("node.failed");
      expect(detail.textContent).toContain("exit code 1");
    });
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

describe("EventInspector — typed panes", () => {
  it("shows full typed payload for any event", async () => {
    mockInvoke.mockResolvedValueOnce(SAMPLE_EVENTS);
    render(<ReplayView runId="run-abc" />);
    await waitFor(() => screen.getAllByText("run.started"));
    // The envelope pane should show event_id and event_type
    const envelope = screen.getByTestId("ei-envelope");
    expect(envelope.textContent).toContain("evt-001");
    expect(envelope.textContent).toContain("run.started");
    // The payload pane should show the full JSON
    const payload = screen.getByTestId("ei-payload");
    expect(payload.textContent).toContain("run began");
  });

  it("shows node context pane for node events with input/output", async () => {
    mockInvoke.mockResolvedValueOnce(SAMPLE_EVENTS);
    render(<ReplayView runId="run-abc" />);
    await waitFor(() => screen.getByText("node.queued"));
    // Click the node.queued event
    fireEvent.click(screen.getAllByRole("option")[1]);
    const nodePane = screen.getByTestId("ei-node-pane");
    expect(nodePane.textContent).toContain("node-start");
    expect(nodePane.textContent).toContain("tool");
    expect(nodePane.textContent).toContain("mem:run_shared:task_brief");
  });

  it("shows node output in node context pane", async () => {
    mockInvoke.mockResolvedValueOnce(SAMPLE_EVENTS);
    render(<ReplayView runId="run-abc" />);
    await waitFor(() => screen.getByText("node.succeeded"));
    // Click the node.succeeded event
    fireEvent.click(screen.getAllByRole("option")[2]);
    const nodePane = screen.getByTestId("ei-node-pane");
    expect(nodePane.textContent).toContain("done");
  });

  it("shows routing pane with branch_selected reason", async () => {
    const eventsWithRouting = [...SAMPLE_EVENTS, ROUTING_EVENT];
    mockInvoke.mockResolvedValueOnce(eventsWithRouting);
    render(<ReplayView runId="run-abc" />);
    await waitFor(() => screen.getByText("router.branch_selected"));
    // Click the routing event
    fireEvent.click(screen.getAllByRole("option")[3]);
    const routePane = screen.getByTestId("ei-routing-pane");
    expect(routePane.textContent).toContain("exit_code == 0");
    expect(routePane.textContent).toContain("node_router_1");
    expect(routePane.textContent).toContain("edge_ok");
  });

  it("shows command pane with command, exit_code, stdout/stderr", async () => {
    const eventsWithCommand = [...SAMPLE_EVENTS, COMMAND_EVENT];
    mockInvoke.mockResolvedValueOnce(eventsWithCommand);
    render(<ReplayView runId="run-abc" />);
    await waitFor(() => screen.getByText("command.completed"));
    // Click the command event
    fireEvent.click(screen.getAllByRole("option")[3]);
    const cmdPane = screen.getByTestId("ei-command-pane");
    expect(cmdPane.textContent).toContain("npm test");
    expect(cmdPane.textContent).toContain("0");
    expect(cmdPane.textContent).toContain("4123");
    expect(cmdPane.textContent).toContain("12044");
  });

  it("does not show node/routing/command pane for run-level events", async () => {
    mockInvoke.mockResolvedValueOnce(SAMPLE_EVENTS);
    render(<ReplayView runId="run-abc" />);
    await waitFor(() => screen.getAllByText("run.started"));
    // First event is run.started — no family-specific pane
    expect(screen.queryByTestId("ei-node-pane")).toBeNull();
    expect(screen.queryByTestId("ei-routing-pane")).toBeNull();
    expect(screen.queryByTestId("ei-command-pane")).toBeNull();
  });

  it("shows select prompt when no event is selected", () => {
    render(<ReplayView runId={null} />);
    const detail = screen.getByTestId("event-detail");
    expect(detail.textContent).toContain("Select an event to inspect");
  });
});
