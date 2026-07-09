// RunPanel — the unified live + replay run surface (DEC-011).
// Ports the behavioral coverage of the former LiveRunView and ReplayView
// suites: event subscription, feed rendering, scrubbing, human review,
// run controls, and cleanup.

import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { RunPanel } from "../views/RunPanel";
import { vi, type Mock } from "vitest";
import type { RunEvent } from "../types/workflow";

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

function makeEvent(overrides: Partial<RunEvent> = {}): RunEvent {
  return {
    event_id: `evt-${Math.random().toString(36).slice(2)}`,
    run_id: "aaaa-1111",
    workflow_id: "wf-0001",
    event_type: "run.started",
    timestamp: "2026-03-09T10:00:01.000Z",
    payload: {},
    sequence: 1,
    ...overrides,
  } as RunEvent;
}

/** Find the captured listener callback for a given Tauri event name. */
function listenerFor(eventName: string): (ev: { payload: unknown }) => void {
  const call = mockListen.mock.calls.find((c: unknown[]) => c[0] === eventName);
  if (!call) throw new Error(`no listener registered for ${eventName}`);
  return call[1] as (ev: { payload: unknown }) => void;
}

function setupInvoke({
  run = mockRun(),
  workflow = mockWorkflow(),
  events = [] as RunEvent[],
} = {}) {
  mockInvoke.mockImplementation((cmd: string) => {
    if (cmd === "get_run") return Promise.resolve(run);
    if (cmd === "get_workflow") return Promise.resolve(workflow);
    if (cmd === "list_events_for_run") return Promise.resolve(events);
    return Promise.resolve(null);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setupInvoke();
  mockListen.mockImplementation(() => Promise.resolve(() => {}));
});

describe("RunPanel — data loading & subscriptions", () => {
  it("subscribes to run_status_changed, run_event_appended and human_review_requested", async () => {
    await act(async () => {
      render(<RunPanel runId="aaaa-1111" />);
    });

    const eventNames = mockListen.mock.calls.map((c: unknown[]) => c[0]);
    expect(eventNames).toContain("run_status_changed");
    expect(eventNames).toContain("run_event_appended");
    expect(eventNames).toContain("human_review_requested");
  });

  it("loads the persisted event log on open (backfill)", async () => {
    setupInvoke({
      events: [
        makeEvent({ event_id: "evt-a", event_type: "run.started", sequence: 1 }),
        makeEvent({ event_id: "evt-b", event_type: "node.running", node_id: "node-agent", sequence: 2 }),
      ],
    });

    await act(async () => {
      render(<RunPanel runId="aaaa-1111" />);
    });

    const feed = within(screen.getByTestId("event-list"));
    expect(feed.getByText("run.started")).toBeTruthy();
    expect(feed.getByText("node.running")).toBeTruthy();
    const listCall = mockInvoke.mock.calls.find(
      (c: unknown[]) => c[0] === "list_events_for_run"
    );
    expect(listCall).toBeTruthy();
  });

  it("shows the run strip with status, workflow name and workspace", async () => {
    await act(async () => {
      render(<RunPanel runId="aaaa-1111" />);
    });

    const hud = screen.getByTestId("run-hud");
    expect(hud.textContent).toContain("Demo Workflow");
    expect(hud.textContent).toContain("/tmp/project");
    expect(screen.getByTestId("run-status").textContent).toBe("running");
  });

  it("updates run status when run_status_changed fires", async () => {
    await act(async () => {
      render(<RunPanel runId="aaaa-1111" />);
    });

    await act(async () => {
      listenerFor("run_status_changed")({
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

  it("notifies the shell of status transitions via onRunStatusChange", async () => {
    const onChange = vi.fn();
    await act(async () => {
      render(<RunPanel runId="aaaa-1111" onRunStatusChange={onChange} />);
    });

    await act(async () => {
      listenerFor("run_status_changed")({
        payload: {
          run_id: "aaaa-1111",
          old_status: "running",
          new_status: "failed",
          timestamp: "2026-03-09T10:05:00Z",
        },
      });
    });

    expect(onChange).toHaveBeenCalledWith("aaaa-1111", "failed");
  });

  it("appends streamed events and ignores events for other runs", async () => {
    await act(async () => {
      render(<RunPanel runId="aaaa-1111" />);
    });

    await act(async () => {
      listenerFor("run_event_appended")({
        payload: { event: makeEvent({ event_id: "evt-mine", event_type: "node.queued", node_id: "node-agent", sequence: 2 }) },
      });
      listenerFor("run_event_appended")({
        payload: {
          event: makeEvent({
            event_id: "evt-other",
            run_id: "zzzz-9999",
            event_type: "node.failed",
            sequence: 3,
          }),
        },
      });
    });

    const feed = within(screen.getByTestId("event-list"));
    expect(feed.getByText("node.queued")).toBeTruthy();
    expect(feed.queryByText("node.failed")).toBeNull();
  });

  it("dedupes events that arrive both from backfill and the stream", async () => {
    const shared = makeEvent({ event_id: "evt-dup", event_type: "run.started", sequence: 1 });
    setupInvoke({ events: [shared] });

    await act(async () => {
      render(<RunPanel runId="aaaa-1111" />);
    });
    await act(async () => {
      listenerFor("run_event_appended")({ payload: { event: shared } });
    });

    const feed = within(screen.getByTestId("event-list"));
    expect(feed.getAllByText("run.started")).toHaveLength(1);
  });

  it("cleans up listeners on unmount", async () => {
    const unlisten = vi.fn();
    mockListen.mockImplementation(() => Promise.resolve(unlisten));

    let unmount: () => void = () => {};
    await act(async () => {
      ({ unmount } = render(<RunPanel runId="aaaa-1111" />));
    });
    await act(async () => {
      unmount();
    });

    expect(unlisten).toHaveBeenCalled();
  });
});

describe("RunPanel — timeline & detail", () => {
  const TIMELINE_EVENTS: RunEvent[] = [
    makeEvent({ event_id: "e1", event_type: "run.started", sequence: 1, payload: { message: "run began" } }),
    makeEvent({ event_id: "e2", event_type: "node.running", node_id: "node-agent", sequence: 2 }),
    makeEvent({
      event_id: "e3",
      event_type: "command.stdout",
      node_id: "node-agent",
      sequence: 3,
      payload: { chunk: "npm test passed\n", byte_offset: 0 },
    }),
    makeEvent({ event_id: "e4", event_type: "node.succeeded", node_id: "node-agent", sequence: 4 }),
  ];

  beforeEach(() => {
    setupInvoke({
      run: mockRun({ status: "succeeded", ended_at: "2026-03-09T10:06:00Z" }),
      events: TIMELINE_EVENTS,
    });
  });

  it("renders all events in sequence order", async () => {
    await act(async () => {
      render(<RunPanel runId="aaaa-1111" />);
    });
    const list = screen.getByTestId("event-list");
    const seqs = Array.from(list.querySelectorAll(".lr-event-seq")).map(
      (el) => el.textContent
    );
    expect(seqs).toEqual(["#1", "#2", "#3", "#4"]);
  });

  it("defaults to the latest event (live tail) and shows its detail", async () => {
    await act(async () => {
      render(<RunPanel runId="aaaa-1111" />);
    });
    const detail = screen.getByTestId("event-detail");
    expect(detail.textContent).toContain("node.succeeded");
  });

  it("clicking an earlier event rewinds the detail to that event", async () => {
    await act(async () => {
      render(<RunPanel runId="aaaa-1111" />);
    });

    fireEvent.click(within(screen.getByTestId("event-list")).getByText("run.started"));

    const detail = screen.getByTestId("event-detail");
    expect(detail.textContent).toContain("run.started");
  });

  it("scrubbing the range slider rewinds the selection", async () => {
    await act(async () => {
      render(<RunPanel runId="aaaa-1111" />);
    });

    const slider = screen.getByRole("slider") as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "1" } });

    const detail = screen.getByTestId("event-detail");
    expect(detail.textContent).toContain("node.running");
    // Not at the tail anymore: the jump-to-latest affordance appears.
    expect(screen.getByTestId("follow-live-btn")).toBeTruthy();
  });

  it("jump-to-latest returns to the tail", async () => {
    await act(async () => {
      render(<RunPanel runId="aaaa-1111" />);
    });

    const slider = screen.getByRole("slider") as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "0" } });
    fireEvent.click(screen.getByTestId("follow-live-btn"));

    const detail = screen.getByTestId("event-detail");
    expect(detail.textContent).toContain("node.succeeded");
  });

  it("OUTPUT tab shows command output up to the scrub position", async () => {
    await act(async () => {
      render(<RunPanel runId="aaaa-1111" />);
    });

    fireEvent.click(screen.getByTestId("detail-tab-output"));
    const detail = screen.getByTestId("event-detail");
    expect(detail.textContent).toContain("npm test passed");

    // Rewind to before the command event — output should be empty.
    const slider = screen.getByRole("slider") as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "1" } });
    expect(detail.textContent).not.toContain("npm test passed");
  });

  it("shows LIVE badge for active runs and not for terminal runs", async () => {
    await act(async () => {
      render(<RunPanel runId="aaaa-1111" />);
    });
    // status = succeeded (terminal): no badge
    expect(screen.queryByTestId("live-badge")).toBeNull();

    setupInvoke({ run: mockRun({ status: "running" }), events: TIMELINE_EVENTS });
    await act(async () => {
      render(<RunPanel runId="bbbb-2222" />);
    });
    // Second panel loads the running run — badge visible somewhere.
    expect(screen.queryAllByTestId("live-badge").length).toBeGreaterThan(0);
  });

  it("color-codes event feed items by event family", async () => {
    await act(async () => {
      render(<RunPanel runId="aaaa-1111" />);
    });

    const feed = screen.getByTestId("event-list");
    expect(feed.querySelector(".lr-event-item--run")).toBeTruthy();
    expect(feed.querySelector(".lr-event-item--node")).toBeTruthy();
    expect(feed.querySelector(".lr-event-item--command")).toBeTruthy();
  });
});

describe("RunPanel — run controls", () => {
  it("shows Start only for created/ready runs and calls start_run", async () => {
    setupInvoke({ run: mockRun({ status: "created", started_at: undefined }) });
    await act(async () => {
      render(<RunPanel runId="aaaa-1111" />);
    });

    const startBtn = screen.getByTestId("run-start-btn");
    await act(async () => {
      fireEvent.click(startBtn);
    });

    expect(
      mockInvoke.mock.calls.some((c: unknown[]) => c[0] === "start_run")
    ).toBe(true);
  });

  it("hides Start for running runs", async () => {
    await act(async () => {
      render(<RunPanel runId="aaaa-1111" />);
    });
    expect(screen.queryByTestId("run-start-btn")).toBeNull();
  });

  it("calls cancel_run when Cancel is clicked on an active run", async () => {
    await act(async () => {
      render(<RunPanel runId="aaaa-1111" />);
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("run-cancel-btn"));
    });

    expect(
      mockInvoke.mock.calls.some((c: unknown[]) => c[0] === "cancel_run")
    ).toBe(true);
  });

  it("disables Cancel for terminal runs and does not call cancel_run via Ctrl+.", async () => {
    setupInvoke({ run: mockRun({ status: "succeeded" }) });
    await act(async () => {
      render(<RunPanel runId="aaaa-1111" />);
    });

    const cancelBtn = screen.getByTestId("run-cancel-btn") as HTMLButtonElement;
    expect(cancelBtn.disabled).toBe(true);

    await act(async () => {
      fireEvent.keyDown(window, { key: ".", ctrlKey: true });
    });
    expect(
      mockInvoke.mock.calls.some((c: unknown[]) => c[0] === "cancel_run")
    ).toBe(false);
  });

  it("calls start_run on Ctrl+Enter for a created run", async () => {
    setupInvoke({ run: mockRun({ status: "created", started_at: undefined }) });
    await act(async () => {
      render(<RunPanel runId="aaaa-1111" />);
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
    });

    expect(
      mockInvoke.mock.calls.some((c: unknown[]) => c[0] === "start_run")
    ).toBe(true);
  });
});

describe("RunPanel — human review", () => {
  const reviewPayload = {
    run_id: "aaaa-1111",
    node_id: "node-review",
    node_label: "Approve",
    reason: "review the plan",
    available_actions: ["approve", "reject", "retry"],
    timestamp: "2026-03-09T10:03:00Z",
  };

  it("shows the HumanReviewPanel when human_review_requested fires for this run", async () => {
    await act(async () => {
      render(<RunPanel runId="aaaa-1111" />);
    });

    await act(async () => {
      listenerFor("human_review_requested")({ payload: reviewPayload });
    });

    expect(screen.getByText(/review the plan/)).toBeTruthy();
  });

  it("ignores human_review_requested for other runs", async () => {
    await act(async () => {
      render(<RunPanel runId="aaaa-1111" />);
    });

    await act(async () => {
      listenerFor("human_review_requested")({
        payload: { ...reviewPayload, run_id: "zzzz-9999" },
      });
    });

    expect(screen.queryByText(/review the plan/)).toBeNull();
  });

  it("submits an approved decision and closes the panel", async () => {
    await act(async () => {
      render(<RunPanel runId="aaaa-1111" />);
    });
    await act(async () => {
      listenerFor("human_review_requested")({ payload: reviewPayload });
    });

    const approveBtn = screen.getByRole("button", { name: /approve/i });
    await act(async () => {
      fireEvent.click(approveBtn);
    });

    const submitCall = mockInvoke.mock.calls.find(
      (c: unknown[]) => c[0] === "submit_human_review_decision"
    );
    expect(submitCall).toBeTruthy();
    expect(
      (submitCall![1] as { decision: { type: string } }).decision.type
    ).toBe("approved");
    expect(screen.queryByText(/review the plan/)).toBeNull();
  });
});
