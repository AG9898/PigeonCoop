import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ReplayView } from "../views/ReplayView";
import { LibraryView } from "../views/LibraryView";
import { App } from "../app/App";
import type { RunEvent } from "../types/workflow";

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
  it("renders Open in Replay button", () => {
    render(<LibraryView onOpenReplay={() => {}} />);
    expect(screen.getByTestId("open-replay-btn")).toBeTruthy();
  });

  it("calls onOpenReplay when button is clicked", () => {
    const handler = vi.fn();
    render(<LibraryView onOpenReplay={handler} />);
    fireEvent.click(screen.getByTestId("open-replay-btn"));
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("App — Library to Replay navigation", () => {
  it("navigates from Library to Replay when Open in Replay is clicked", async () => {
    render(<App />);
    // Go to Library
    fireEvent.click(screen.getByText("Library"));
    expect(screen.getByText("LIBRARY")).toBeTruthy();
    // Click Open in Replay
    fireEvent.click(screen.getByTestId("open-replay-btn"));
    // Should now be in Replay view
    expect(screen.getByText("REPLAY")).toBeTruthy();
  });
});
