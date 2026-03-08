// ReplayView — inspect completed runs via their stored event sequence.
// All state is derived from the persisted event log; never from live engine state.
// See ARCHITECTURE.md §10.3 and DESIGN_SPEC.md §4.3.

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { RunEvent } from "../types/workflow";

interface Props {
  runId: string | null;
}

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

  function advance(delta: number) {
    setScrubIndex((prev) => {
      const next = prev + delta;
      if (next < 0 || next >= events.length) return prev;
      return next;
    });
  }

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
        <div className="replay-scrubber">
          <span className="scrubber-label">
            EVENT {events.length > 0 ? scrubIndex + 1 : 0} / {events.length}
          </span>
          <input
            type="range"
            className="scrubber-input"
            aria-label="timeline scrubber"
            min={0}
            max={Math.max(0, events.length - 1)}
            value={scrubIndex}
            disabled={events.length === 0}
            onChange={(e) => setScrubIndex(Number(e.target.value))}
          />
          <div className="scrubber-controls">
            <button
              className="scrubber-btn"
              onClick={() => advance(-1)}
              disabled={events.length === 0 || scrubIndex === 0}
              aria-label="previous event"
            >
              ◀
            </button>
            <button
              className="scrubber-btn"
              onClick={() => advance(1)}
              disabled={events.length === 0 || scrubIndex >= events.length - 1}
              aria-label="next event"
            >
              ▶
            </button>
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
          <div className="replay-event-detail">
            <div className="panel-header">EVENT DETAIL</div>
            {currentEvent ? (
              <dl className="event-detail-list" data-testid="event-detail">
                <dt>event_id</dt>
                <dd>{currentEvent.event_id}</dd>
                <dt>event_type</dt>
                <dd>{currentEvent.event_type}</dd>
                <dt>timestamp</dt>
                <dd>{currentEvent.timestamp}</dd>
                {currentEvent.node_id && (
                  <>
                    <dt>node_id</dt>
                    <dd>{currentEvent.node_id}</dd>
                  </>
                )}
                {currentEvent.causation_id && (
                  <>
                    <dt>causation_id</dt>
                    <dd>{currentEvent.causation_id}</dd>
                  </>
                )}
                <dt>payload</dt>
                <dd>
                  <pre className="event-payload">
                    {JSON.stringify(currentEvent.payload, null, 2)}
                  </pre>
                </dd>
              </dl>
            ) : (
              <div className="replay-status">Select an event to inspect.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
