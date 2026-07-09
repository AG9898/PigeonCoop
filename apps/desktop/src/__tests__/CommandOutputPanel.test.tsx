import { render, screen, fireEvent } from "@testing-library/react";
import { CommandOutputPanel } from "../components/panels/CommandOutputPanel";
import type { RunEvent } from "../types/workflow";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let seq = 0;

function makeEvent(
  eventType: string,
  payload: unknown,
  overrides?: Partial<RunEvent>
): RunEvent {
  seq += 1;
  return {
    event_id: `evt-${seq}`,
    run_id: "run-1",
    workflow_id: "wf-1",
    node_id: "node-1",
    event_type: eventType,
    timestamp: new Date().toISOString(),
    payload,
    sequence: seq,
    ...overrides,
  };
}

function stdoutEvent(chunk: string, byte_offset: number): RunEvent {
  return makeEvent("command.stdout", { chunk, byte_offset });
}

function stderrEvent(chunk: string, byte_offset: number): RunEvent {
  return makeEvent("command.stderr", { chunk, byte_offset });
}

beforeEach(() => {
  seq = 0;
});

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

describe("CommandOutputPanel — empty state", () => {
  it("shows a placeholder when no command events are present", () => {
    render(<CommandOutputPanel events={[]} />);
    expect(screen.getByTestId("command-output-panel")).toBeTruthy();
    expect(screen.queryByTestId("cop-section-stdout")).toBeNull();
    expect(screen.queryByTestId("cop-section-stderr")).toBeNull();
    expect(screen.getByText(/no command output/i)).toBeTruthy();
  });

  it("shows a placeholder when only unrelated events are present", () => {
    render(
      <CommandOutputPanel
        events={[makeEvent("node.started", { node_id: "n1" })]}
      />
    );
    expect(screen.getByText(/no command output/i)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Chunk rendering
// ---------------------------------------------------------------------------

describe("CommandOutputPanel — chunk rendering", () => {
  it("concatenates stdout chunks in byte_offset order", () => {
    const events = [
      stdoutEvent("world", 5),
      stdoutEvent("hello ", 0),
    ];
    render(<CommandOutputPanel events={events} />);
    expect(screen.getByTestId("cop-pre-stdout").textContent).toBe("hello world");
  });

  it("concatenates stderr chunks in byte_offset order and keeps them visually distinct", () => {
    const events = [
      stderrEvent("error B\n", 8),
      stderrEvent("error A\n", 0),
    ];
    render(<CommandOutputPanel events={events} />);
    expect(screen.getByTestId("cop-pre-stderr").textContent).toBe("error A\nerror B\n");
    // stdout section absent when there is no stdout output
    expect(screen.queryByTestId("cop-section-stdout")).toBeNull();
  });

  it("renders stdout and stderr in separate, distinctly-classed sections", () => {
    const events = [stdoutEvent("out\n", 0), stderrEvent("err\n", 0)];
    render(<CommandOutputPanel events={events} />);
    const stdoutSection = screen.getByTestId("cop-section-stdout");
    const stderrSection = screen.getByTestId("cop-section-stderr");
    expect(stdoutSection.className).toContain("cop-section--stdout");
    expect(stderrSection.className).toContain("cop-section--stderr");
  });

  it("ignores non-command events and malformed payloads", () => {
    const events = [
      makeEvent("node.started", { node_id: "n1" }),
      makeEvent("command.stdout", { chunk: "ok\n", byte_offset: 0 }),
      makeEvent("command.stdout", { byte_offset: 10 }), // missing chunk
      makeEvent("command.stdout", { chunk: "bad" }), // missing byte_offset
    ];
    render(<CommandOutputPanel events={events} />);
    expect(screen.getByTestId("cop-pre-stdout").textContent).toBe("ok\n");
  });
});

// ---------------------------------------------------------------------------
// Collapse behaviour
// ---------------------------------------------------------------------------

describe("CommandOutputPanel — collapse behaviour", () => {
  function manyLines(n: number): string {
    return Array.from({ length: n }, (_, i) => `line ${i}`).join("\n");
  }

  it("does not show a toggle for short output (<= 20 lines)", () => {
    const events = [stdoutEvent(manyLines(10), 0)];
    render(<CommandOutputPanel events={events} />);
    expect(screen.queryByTestId("cop-toggle-stdout")).toBeNull();
  });

  it("collapses output beyond 20 lines by default and shows a toggle", () => {
    const events = [stdoutEvent(manyLines(30), 0)];
    render(<CommandOutputPanel events={events} />);
    const pre = screen.getByTestId("cop-pre-stdout");
    const renderedLines = (pre.textContent ?? "").split("\n");
    expect(renderedLines.length).toBe(20);
    expect(screen.getByTestId("cop-toggle-stdout")).toBeTruthy();
  });

  it("expands and re-collapses output when the toggle is clicked", () => {
    const events = [stdoutEvent(manyLines(30), 0)];
    render(<CommandOutputPanel events={events} />);
    const toggle = screen.getByTestId("cop-toggle-stdout");

    fireEvent.click(toggle);
    let pre = screen.getByTestId("cop-pre-stdout");
    expect((pre.textContent ?? "").split("\n").length).toBe(30);

    fireEvent.click(screen.getByTestId("cop-toggle-stdout"));
    pre = screen.getByTestId("cop-pre-stdout");
    expect((pre.textContent ?? "").split("\n").length).toBe(20);
  });
});
