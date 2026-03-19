// Derive node states from an event sequence up to a given index.
// Used by ReplayView to reconstruct graph state at any point in the timeline.
// See DESIGN_SPEC.md §4.3: "graph state updates to selected point in run".

import type { RunEvent, NodeStatus } from "../types/workflow";

/** Maps node-lifecycle event types to the NodeStatus they represent. */
const NODE_EVENT_TO_STATUS: Record<string, NodeStatus> = {
  "node.validated": "validated",
  "node.ready": "ready",
  "node.queued": "queued",
  "node.running": "running",
  "node.waiting": "waiting",
  "node.succeeded": "succeeded",
  "node.failed": "failed",
  "node.cancelled": "cancelled",
  "node.skipped": "skipped",
};

/**
 * Scan events[0..upToIndex] (inclusive) and return the most recent NodeStatus
 * for every node_id seen in that slice.
 *
 * Events beyond upToIndex are ignored — this lets the scrubber rewind
 * the graph to any point in the timeline.
 */
export function deriveNodeStates(
  events: RunEvent[],
  upToIndex: number
): Record<string, NodeStatus> {
  const states: Record<string, NodeStatus> = {};
  const limit = Math.min(upToIndex, events.length - 1);
  for (let i = 0; i <= limit; i++) {
    const evt = events[i];
    if (evt.node_id !== undefined && evt.event_type in NODE_EVENT_TO_STATUS) {
      states[evt.node_id] = NODE_EVENT_TO_STATUS[evt.event_type];
    }
  }
  return states;
}
