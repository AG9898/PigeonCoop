import { describe, it, expect } from "vitest";
import { deriveNodeStates } from "../state/deriveNodeStates";
import type { RunEvent } from "../types/workflow";

function makeEvent(
  seq: number,
  eventType: string,
  nodeId?: string
): RunEvent {
  return {
    event_id: `evt-${seq}`,
    run_id: "run-1",
    workflow_id: "wf-1",
    event_type: eventType,
    timestamp: "2026-03-18T00:00:00.000Z",
    payload: {},
    sequence: seq,
    node_id: nodeId,
  };
}

const EVENTS: RunEvent[] = [
  makeEvent(1, "run.started"),
  makeEvent(2, "node.queued", "n1"),
  makeEvent(3, "node.running", "n1"),
  makeEvent(4, "node.queued", "n2"),
  makeEvent(5, "node.succeeded", "n1"),
  makeEvent(6, "node.failed", "n2"),
];

describe("deriveNodeStates", () => {
  it("returns empty object for empty event list", () => {
    expect(deriveNodeStates([], 0)).toEqual({});
  });

  it("returns empty object when no events have node_id", () => {
    const events = [makeEvent(1, "run.started")];
    expect(deriveNodeStates(events, 0)).toEqual({});
  });

  it("returns queued state after first node event", () => {
    const states = deriveNodeStates(EVENTS, 1);
    expect(states).toEqual({ n1: "queued" });
  });

  it("reflects running state at index 2", () => {
    const states = deriveNodeStates(EVENTS, 2);
    expect(states.n1).toBe("running");
  });

  it("tracks multiple nodes independently", () => {
    const states = deriveNodeStates(EVENTS, 3);
    expect(states.n1).toBe("running");
    expect(states.n2).toBe("queued");
  });

  it("advances n1 to succeeded at index 4", () => {
    const states = deriveNodeStates(EVENTS, 4);
    expect(states.n1).toBe("succeeded");
    expect(states.n2).toBe("queued");
  });

  it("shows final states at last index", () => {
    const states = deriveNodeStates(EVENTS, 5);
    expect(states.n1).toBe("succeeded");
    expect(states.n2).toBe("failed");
  });

  it("clamps upToIndex to events.length - 1", () => {
    // Passing an index beyond the array should not throw and should return all events
    const states = deriveNodeStates(EVENTS, 999);
    expect(states.n1).toBe("succeeded");
    expect(states.n2).toBe("failed");
  });

  it("ignores non-node event types", () => {
    const events = [
      makeEvent(1, "run.started"),
      makeEvent(2, "routing.decision", "n1"),
    ];
    expect(deriveNodeStates(events, 1)).toEqual({});
  });
});
