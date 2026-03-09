import { render, screen, fireEvent, act } from "@testing-library/react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { LiveRunView } from "../views/LiveRunView";
import { vi, type Mock } from "vitest";

// Type the mocks for convenience
const mockInvoke = invoke as Mock;
const mockListen = listen as Mock;

function mockRun(overrides: Record<string, unknown> = {}) {
  return {
    run_id: "aaaa-1111",
    workflow_id: "wf-0001",
    workflow_version: 1,
    status: "running",
    workspace_root: "/tmp/project",
    created_at: "2026-03-09T10:00:00Z",
    started_at: "2026-03-09T10:00:01Z",
    ...overrides,
  };
}

function mockWorkflow(overrides: Record<string, unknown> = {}) {
  return {
    workflow_id: "wf-0001",
    name: "Demo Workflow",
    schema_version: 1,
    version: 1,
    metadata: {},
    nodes: [
      {
        node_id: "node-start",
        node_type: "start",
        label: "Start",
        config: {},
        input_contract: {},
        output_contract: {},
        memory_access: {},
        retry_policy: { max_retries: 0 },
        display: { x: 0, y: 0 },
      },
      {
        node_id: "node-agent",
        node_type: "agent",
        label: "Plan Task",
        config: {},
        input_contract: {},
        output_contract: {},
        memory_access: {},
        retry_policy: { max_retries: 1 },
        display: { x: 0, y: 150 },
      },
    ],
    edges: [
      {
        edge_id: "edge-1",
        source_node_id: "node-start",
        target_node_id: "node-agent",
        condition_kind: "always",
      },
    ],
    default_constraints: {},
    created_at: "2026-03-09T09:00:00Z",
    updated_at: "2026-03-09T09:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: invoke returns appropriate mock data
  mockInvoke.mockImplementation((cmd: string) => {
    if (cmd === "get_run") return Promise.resolve(mockRun());
    if (cmd === "get_workflow") return Promise.resolve(mockWorkflow());
    return Promise.resolve(null);
  });
  // listen returns an unlisten function
  mockListen.mockImplementation(() => Promise.resolve(() => {}));
});

describe("LiveRunView", () => {
  it("shows placeholder when no runId", () => {
    render(<LiveRunView runId={null} />);
    expect(screen.getByText("LIVE RUN")).toBeTruthy();
    expect(
      screen.getByText("[ no active run — start one from the Library ]")
    ).toBeTruthy();
  });

  it("is reachable from the app shell (renders LIVE RUN header)", () => {
    render(<LiveRunView runId={null} />);
    expect(screen.getByText("LIVE RUN")).toBeTruthy();
    expect(screen.getByText("active execution monitor")).toBeTruthy();
  });

  it("subscribes to all Tauri event families when runId is set", async () => {
    await act(async () => {
      render(<LiveRunView runId="aaaa-1111" />);
    });

    const eventNames = mockListen.mock.calls.map(
      (call: unknown[]) => call[0]
    );
    expect(eventNames).toContain("run_status_changed");
    expect(eventNames).toContain("node_status_changed");
    expect(eventNames).toContain("run_event_appended");
  });

  it("shows run HUD with run_id, workflow name, status, workspace, elapsed", async () => {
    await act(async () => {
      render(<LiveRunView runId="aaaa-1111" />);
    });

    const hud = screen.getByTestId("run-hud");
    expect(hud).toBeTruthy();

    // run_id (truncated)
    expect(screen.getByText("aaaa-111")).toBeTruthy();
    // workflow name
    expect(screen.getByText("Demo Workflow")).toBeTruthy();
    // status
    expect(screen.getByTestId("run-status").textContent).toBe("running");
    // workspace
    expect(screen.getByText("/tmp/project")).toBeTruthy();
    // elapsed (starts at some value, not --)
    expect(screen.getByText("ELAPSED")).toBeTruthy();
  });

  it("updates run status when run_status_changed event fires", async () => {
    // Capture the listener callback for run_status_changed
    let statusCallback: ((ev: unknown) => void) | undefined;
    mockListen.mockImplementation(
      (event: string, cb: (ev: unknown) => void) => {
        if (event === "run_status_changed") statusCallback = cb;
        return Promise.resolve(() => {});
      }
    );

    await act(async () => {
      render(<LiveRunView runId="aaaa-1111" />);
    });

    expect(screen.getByTestId("run-status").textContent).toBe("running");

    // Fire a status change event
    await act(async () => {
      statusCallback?.({
        payload: {
          run_id: "aaaa-1111",
          old_status: "running",
          new_status: "succeeded",
          timestamp: "2026-03-09T10:05:00Z",
        },
      });
    });

    expect(screen.getByTestId("run-status").textContent).toBe("succeeded");
  });

  it("adds events to feed when run_event_appended fires", async () => {
    let eventCallback: ((ev: unknown) => void) | undefined;
    mockListen.mockImplementation(
      (event: string, cb: (ev: unknown) => void) => {
        if (event === "run_event_appended") eventCallback = cb;
        return Promise.resolve(() => {});
      }
    );

    await act(async () => {
      render(<LiveRunView runId="aaaa-1111" />);
    });

    // Feed should initially show waiting message
    expect(screen.getAllByText("waiting for events...").length).toBeGreaterThan(
      0
    );

    // Fire an event
    await act(async () => {
      eventCallback?.({
        payload: {
          event: {
            event_id: "ev-001",
            run_id: "aaaa-1111",
            workflow_id: "wf-0001",
            event_type: "run.started",
            timestamp: "2026-03-09T10:00:01Z",
            payload: {},
            sequence: 1,
          },
        },
      });
    });

    expect(screen.getByText("#1")).toBeTruthy();
    expect(screen.getByText("run.started")).toBeTruthy();
  });

  it("ignores events for other run IDs", async () => {
    let eventCallback: ((ev: unknown) => void) | undefined;
    mockListen.mockImplementation(
      (event: string, cb: (ev: unknown) => void) => {
        if (event === "run_event_appended") eventCallback = cb;
        return Promise.resolve(() => {});
      }
    );

    await act(async () => {
      render(<LiveRunView runId="aaaa-1111" />);
    });

    // Fire an event for a different run
    await act(async () => {
      eventCallback?.({
        payload: {
          event: {
            event_id: "ev-999",
            run_id: "bbbb-2222",
            workflow_id: "wf-0001",
            event_type: "run.started",
            timestamp: "2026-03-09T10:00:01Z",
            payload: {},
            sequence: 1,
          },
        },
      });
    });

    // Should not appear in the feed
    expect(screen.queryByText("#1")).toBeNull();
  });

  it("shows event detail when an event is clicked", async () => {
    let eventCallback: ((ev: unknown) => void) | undefined;
    mockListen.mockImplementation(
      (event: string, cb: (ev: unknown) => void) => {
        if (event === "run_event_appended") eventCallback = cb;
        return Promise.resolve(() => {});
      }
    );

    await act(async () => {
      render(<LiveRunView runId="aaaa-1111" />);
    });

    await act(async () => {
      eventCallback?.({
        payload: {
          event: {
            event_id: "ev-001",
            run_id: "aaaa-1111",
            workflow_id: "wf-0001",
            event_type: "node.started",
            timestamp: "2026-03-09T10:00:02Z",
            payload: { foo: "bar" },
            sequence: 1,
            node_id: "node-abc",
          },
        },
      });
    });

    // Click the event
    fireEvent.click(screen.getByText("node.started"));

    // Detail panel should show event info
    expect(screen.getByText("ev-001")).toBeTruthy();
    // node-abc appears in both event feed and detail panel
    expect(screen.getAllByText("node-abc").length).toBeGreaterThanOrEqual(2);
  });

  it("renders GRAPH panel header when runId is set", async () => {
    await act(async () => {
      render(<LiveRunView runId="aaaa-1111" />);
    });

    expect(screen.getByText("GRAPH")).toBeTruthy();
    expect(screen.getByTestId("live-graph")).toBeTruthy();
  });

  it("updates node visual state in graph when node_status_changed fires", async () => {
    let nodeCallback: ((ev: unknown) => void) | undefined;
    mockListen.mockImplementation(
      (event: string, cb: (ev: unknown) => void) => {
        if (event === "node_status_changed") nodeCallback = cb;
        return Promise.resolve(() => {});
      }
    );

    await act(async () => {
      render(<LiveRunView runId="aaaa-1111" />);
    });

    // Fire a node status change to running
    await act(async () => {
      nodeCallback?.({
        payload: {
          run_id: "aaaa-1111",
          node_id: "node-agent",
          old_status: "ready",
          new_status: "running",
          attempt: 1,
          timestamp: "2026-03-09T10:00:02Z",
        },
      });
    });

    // The node status list should show the running status badge
    const badges = screen.getAllByText("running");
    const nodeBadge = badges.find((el) =>
      el.classList.contains("lr-node-status")
    );
    expect(nodeBadge).toBeTruthy();
    expect(nodeBadge!.classList.contains("lr-node-status--running")).toBe(true);
  });

  it("cleans up listeners on unmount", async () => {
    const unlisten = vi.fn();
    mockListen.mockImplementation(() => Promise.resolve(unlisten));

    let unmount: () => void;
    await act(async () => {
      const result = render(<LiveRunView runId="aaaa-1111" />);
      unmount = result.unmount;
    });

    await act(async () => {
      unmount!();
    });

    // Each listener should have its unlisten called
    expect(unlisten).toHaveBeenCalled();
  });
});
