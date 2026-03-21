// EventInspector — renders selected event detail with typed panes per event family.
// Generic events show the full payload; node/routing/command events get specialized views.
// See DESIGN_SPEC.md §4.3 and EVENT_SCHEMA.md §4.

import type { RunEvent } from "../../types/workflow";

interface Props {
  event: RunEvent | null;
}

/** Extract the event family prefix (text before the first dot). */
function eventFamily(eventType: string): string {
  const dot = eventType.indexOf(".");
  return dot > 0 ? eventType.slice(0, dot) : eventType;
}

// ---------------------------------------------------------------------------
// Typed payload accessors — safely pull known fields from unknown payloads
// ---------------------------------------------------------------------------

function asRecord(payload: unknown): Record<string, unknown> {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return payload as Record<string, unknown>;
  }
  return {};
}

// ---------------------------------------------------------------------------
// Sub-panes for event families
// ---------------------------------------------------------------------------

function NodeContextPane({ event }: { event: RunEvent }) {
  const p = asRecord(event.payload);
  return (
    <div className="ei-pane" data-testid="ei-node-pane">
      <div className="ei-pane-header">NODE CONTEXT</div>
      <div className="ei-fields">
        {event.node_id && (
          <div className="ei-field">
            <span className="ei-label">node_id</span>
            <span className="ei-value">{event.node_id}</span>
          </div>
        )}
        {p.node_type !== undefined && (
          <div className="ei-field">
            <span className="ei-label">node_type</span>
            <span className="ei-value">{String(p.node_type)}</span>
          </div>
        )}
        {p.attempt !== undefined && (
          <div className="ei-field">
            <span className="ei-label">attempt</span>
            <span className="ei-value">{String(p.attempt)}</span>
          </div>
        )}
        {p.workspace_root !== undefined && (
          <div className="ei-field">
            <span className="ei-label">workspace</span>
            <span className="ei-value ei-value--mono">{String(p.workspace_root)}</span>
          </div>
        )}
        {Array.isArray(p.input_refs) && p.input_refs.length > 0 && (
          <div className="ei-field ei-field--col">
            <span className="ei-label">inputs</span>
            <ul className="ei-ref-list">
              {(p.input_refs as string[]).map((ref, i) => (
                <li key={i} className="ei-ref-item">{ref}</li>
              ))}
            </ul>
          </div>
        )}
        {p.output !== undefined && (
          <div className="ei-field ei-field--col">
            <span className="ei-label">output</span>
            <pre className="ei-pre">{typeof p.output === "string" ? p.output : JSON.stringify(p.output, null, 2)}</pre>
          </div>
        )}
        {p.error !== undefined && (
          <div className="ei-field ei-field--col">
            <span className="ei-label">error</span>
            <pre className="ei-pre ei-pre--error">{String(p.error)}</pre>
          </div>
        )}
      </div>
    </div>
  );
}

function RoutingPane({ event }: { event: RunEvent }) {
  const p = asRecord(event.payload);
  return (
    <div className="ei-pane" data-testid="ei-routing-pane">
      <div className="ei-pane-header">ROUTING DECISION</div>
      <div className="ei-fields">
        {p.router_node_id !== undefined && (
          <div className="ei-field">
            <span className="ei-label">router</span>
            <span className="ei-value">{String(p.router_node_id)}</span>
          </div>
        )}
        {p.reason !== undefined && (
          <div className="ei-field">
            <span className="ei-label">reason</span>
            <span className="ei-value ei-value--highlight">{String(p.reason)}</span>
          </div>
        )}
        {Array.isArray(p.selected_edge_ids) && (
          <div className="ei-field">
            <span className="ei-label">edges</span>
            <span className="ei-value">{(p.selected_edge_ids as string[]).join(", ")}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function CommandPane({ event }: { event: RunEvent }) {
  const p = asRecord(event.payload);
  return (
    <div className="ei-pane" data-testid="ei-command-pane">
      <div className="ei-pane-header">COMMAND</div>
      <div className="ei-fields">
        {p.command !== undefined && (
          <div className="ei-field">
            <span className="ei-label">command</span>
            <span className="ei-value ei-value--mono">{String(p.command)}</span>
          </div>
        )}
        {p.shell !== undefined && (
          <div className="ei-field">
            <span className="ei-label">shell</span>
            <span className="ei-value">{String(p.shell)}</span>
          </div>
        )}
        {p.cwd !== undefined && (
          <div className="ei-field">
            <span className="ei-label">cwd</span>
            <span className="ei-value ei-value--mono">{String(p.cwd)}</span>
          </div>
        )}
        {p.exit_code !== undefined && (
          <div className="ei-field">
            <span className="ei-label">exit_code</span>
            <span className={`ei-value ${Number(p.exit_code) === 0 ? "ei-value--ok" : "ei-value--fail"}`}>
              {String(p.exit_code)}
            </span>
          </div>
        )}
        {p.duration_ms !== undefined && (
          <div className="ei-field">
            <span className="ei-label">duration</span>
            <span className="ei-value">{String(p.duration_ms)}ms</span>
          </div>
        )}
        {p.stdout_bytes !== undefined && (
          <div className="ei-field">
            <span className="ei-label">stdout</span>
            <span className="ei-value">{String(p.stdout_bytes)} bytes</span>
          </div>
        )}
        {p.stderr_bytes !== undefined && (
          <div className="ei-field">
            <span className="ei-label">stderr</span>
            <span className={`ei-value ${Number(p.stderr_bytes) > 0 ? "ei-value--warn" : ""}`}>
              {String(p.stderr_bytes)} bytes
            </span>
          </div>
        )}
        {p.timeout_ms !== undefined && (
          <div className="ei-field">
            <span className="ei-label">timeout</span>
            <span className="ei-value">{String(p.timeout_ms)}ms</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function EventInspector({ event }: Props) {
  if (!event) {
    return <div className="replay-status">Select an event to inspect.</div>;
  }

  const family = eventFamily(event.event_type);

  return (
    <div className="ei-root" data-testid="event-inspector">
      {/* Always show core envelope fields */}
      <div className="ei-pane" data-testid="ei-envelope">
        <div className="ei-pane-header">EVENT</div>
        <div className="ei-fields">
          <div className="ei-field">
            <span className="ei-label">event_id</span>
            <span className="ei-value ei-value--mono">{event.event_id}</span>
          </div>
          <div className="ei-field">
            <span className="ei-label">type</span>
            <span className="ei-value">{event.event_type}</span>
          </div>
          <div className="ei-field">
            <span className="ei-label">timestamp</span>
            <span className="ei-value">{event.timestamp}</span>
          </div>
          {event.node_id && (
            <div className="ei-field">
              <span className="ei-label">node_id</span>
              <span className="ei-value">{event.node_id}</span>
            </div>
          )}
          {event.causation_id && (
            <div className="ei-field">
              <span className="ei-label">causation_id</span>
              <span className="ei-value ei-value--mono">{event.causation_id}</span>
            </div>
          )}
          {event.correlation_id && (
            <div className="ei-field">
              <span className="ei-label">correlation_id</span>
              <span className="ei-value ei-value--mono">{event.correlation_id}</span>
            </div>
          )}
        </div>
      </div>

      {/* Family-specific pane */}
      {family === "node" && <NodeContextPane event={event} />}
      {(family === "router" || family === "edge") && <RoutingPane event={event} />}
      {family === "command" && <CommandPane event={event} />}

      {/* Full payload — always shown last */}
      <div className="ei-pane" data-testid="ei-payload">
        <div className="ei-pane-header">PAYLOAD</div>
        <pre className="ei-pre ei-pre--payload">
          {JSON.stringify(event.payload, null, 2)}
        </pre>
      </div>
    </div>
  );
}
