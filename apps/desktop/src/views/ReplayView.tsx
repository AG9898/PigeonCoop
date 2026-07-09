// ReplayView — inspect completed runs via their stored event sequence.
// All state is derived from the persisted event log; never from live engine state.
// See ARCHITECTURE.md §10.3 and DESIGN_SPEC.md §4.3.

import { useEffect, useState, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { RunEvent } from "../types/workflow";
import { TimelineScrubber } from "../components/panels/TimelineScrubber";
import { EventInspector } from "../components/panels/EventInspector";
import { deriveNodeStates } from "../state/deriveNodeStates";
import { CityBackdrop } from "../components/canvas/CityBackdrop";
import { agentTokenHealthStyle } from "../components/nodes/AgentNode";

interface Props {
  runId: string | null;
}

type TokenPctByNode = Map<string, number>;

export function ReplayView({ runId }: Props) {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [scrubIndex, setScrubIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) {
      setEvents([]);
      setScrubIndex(0);
      return;
    }
    setLoading(true);
    setError(null);
    invoke<RunEvent[]>("list_events_for_run", {
      runId,
      offset: 0,
      limit: 500,
    })
      .then((evts) => {
        setEvents(evts);
        setScrubIndex(0);
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [runId]);

  const currentEvent = events[scrubIndex] ?? null;

  // Derive graph state from all events up to (and including) the scrub position.
  // This updates automatically whenever scrubIndex or events change.
  const nodeStates = useMemo(
    () => deriveNodeStates(events, scrubIndex),
    [events, scrubIndex]
  );
  const tokenPcts = useMemo(
    () => deriveAgentTokenPcts(events, scrubIndex),
    [events, scrubIndex]
  );

  return (
    <div className="view replay-view">
      <div className="view-header">
        <span className="view-title">REPLAY</span>
        <span className="view-subtitle">
          {runId ? `run: ${runId}` : "run inspection & timeline"}
        </span>
      </div>

      <div className="view-body replay-body">
        {/* Timeline scrubber */}
        <TimelineScrubber
          index={scrubIndex}
          total={events.length}
          onChange={setScrubIndex}
        />

        {/* Graph state panel — node statuses at the selected timeline position */}
        <div className="replay-graph-state" data-testid="graph-state-panel">
          <CityBackdrop className="city-backdrop--replay" />
          <div className="wf-canvas-grid replay-backdrop-grid" aria-hidden="true" />
          <div className="replay-graph-content">
            <div className="panel-header">GRAPH STATE</div>
            {Object.keys(nodeStates).length === 0 ? (
              <div className="replay-status">No node events up to this point.</div>
            ) : (
              <ul className="node-state-list">
                {Object.entries(nodeStates).map(([nodeId, status]) => {
                  const tokenPct = tokenPcts.get(nodeId);
                  return (
                    <li
                      key={nodeId}
                      className={`node-state-item node-state--${status}`}
                      data-testid={`node-state-${nodeId}`}
                    >
                      <span className="node-state-id">{nodeId}</span>
                      {typeof tokenPct === "number" && (
                        <span className="replay-node-token-health">
                          <span
                            className="ag-node-health-bar"
                            data-testid={`replay-token-health-${nodeId}`}
                            aria-label={`context usage ${Math.round(tokenPct)}%`}
                            title={`Context usage ${Math.round(tokenPct)}%`}
                            style={agentTokenHealthStyle(tokenPct)}
                          />
                        </span>
                      )}
                      <span className="node-state-badge">{status}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* Main panels */}
        <div className="replay-panels">
          {/* Event list */}
          <div className="replay-event-list">
            <div className="panel-header">EVENT LOG</div>
            {loading && (
              <div className="replay-status">Loading events…</div>
            )}
            {error && (
              <div className="replay-status replay-error">{error}</div>
            )}
            {!loading && !error && !runId && (
              <div className="replay-status">
                No run selected. Open a run from Library.
              </div>
            )}
            {!loading && !error && runId && events.length === 0 && (
              <div className="replay-status">No events found for this run.</div>
            )}
            <ol className="event-list" data-testid="event-list">
              {events.map((evt, idx) => (
                <li
                  key={evt.event_id}
                  className={`event-item${
                    idx === scrubIndex ? " event-item--active" : ""
                  }`}
                  onClick={() => setScrubIndex(idx)}
                  role="option"
                  aria-selected={idx === scrubIndex}
                >
                  <span className="event-seq">{evt.sequence}</span>
                  <span className="event-type">{evt.event_type}</span>
                  {evt.node_id && (
                    <span className="event-node">{evt.node_id}</span>
                  )}
                  <span className="event-ts">
                    {evt.timestamp.slice(0, 23)}
                  </span>
                </li>
              ))}
            </ol>
          </div>

          {/* Event detail inspector */}
          <div className="replay-event-detail" data-testid="event-detail">
            <div className="panel-header">EVENT DETAIL</div>
            <EventInspector event={currentEvent} />
          </div>
        </div>
      </div>
    </div>
  );
}

function deriveAgentTokenPcts(
  events: RunEvent[],
  scrubIndex: number
): TokenPctByNode {
  const tokenPcts: TokenPctByNode = new Map();
  const end = Math.min(scrubIndex, events.length - 1);
  for (let i = 0; i <= end; i += 1) {
    const event = events[i];
    if (!event?.node_id) continue;
    if (
      event.event_type !== "agent.completed" &&
      event.event_type !== "agent.response"
    ) {
      continue;
    }

    const pct = tokenPctFromPayload(event.payload);
    if (pct !== null) {
      tokenPcts.set(event.node_id, pct);
    }
  }
  return tokenPcts;
}

function tokenPctFromPayload(payload: unknown): number | null {
  const record = asRecord(payload);
  if (!record) return null;

  const usage = asRecord(record.usage);
  const tokensUsed =
    readNumber(record.tokens_used) ??
    readNumber(record.tokensUsed) ??
    readNumber(usage?.tokens_used) ??
    readNumber(usage?.tokensUsed);
  const contextLimit =
    readNumber(record.context_limit) ??
    readNumber(record.contextLimit) ??
    readNumber(usage?.context_limit) ??
    readNumber(usage?.contextLimit);
  const inputTokens =
    readNumber(record.input_tokens) ??
    readNumber(record.inputTokens) ??
    readNumber(usage?.input_tokens) ??
    readNumber(usage?.inputTokens);
  const outputTokens =
    readNumber(record.output_tokens) ??
    readNumber(record.outputTokens) ??
    readNumber(usage?.output_tokens) ??
    readNumber(usage?.outputTokens);
  const derivedUsed =
    inputTokens !== null || outputTokens !== null
      ? (inputTokens ?? 0) + (outputTokens ?? 0)
      : null;
  const used = tokensUsed ?? derivedUsed;

  if (used === null || contextLimit === null || contextLimit <= 0) return null;
  return Math.min(100, Math.max(0, (used / contextLimit) * 100));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}
