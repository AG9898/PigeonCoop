// CommandOutputPanel — accumulates and renders stdout/stderr chunks from command events.
// Self-contained: given a filtered RunEvent[] list, it derives the stdout and stderr
// streams by concatenating each event's payload.chunk in byte_offset order. Has no
// dependency on LiveRunView internals; wiring into LiveRunView happens in UI-RUN-009.
// See DESIGN_SPEC.md §9 (Terminal and output design) and DEC-004.

import { useMemo, useState } from "react";
import type { RunEvent } from "../../types/workflow";

interface Props {
  events: RunEvent[];
}

/** Outputs longer than this many lines are collapsed by default. */
const COLLAPSE_LINE_THRESHOLD = 20;

interface ChunkPayload {
  chunk?: unknown;
  byte_offset?: unknown;
}

function asChunkPayload(payload: unknown): ChunkPayload {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return payload as ChunkPayload;
  }
  return {};
}

/** Concatenate chunk strings from events matching eventType, ordered by byte_offset. */
function buildStream(events: RunEvent[], eventType: string): string {
  return events
    .filter((e) => e.event_type === eventType)
    .map((e) => asChunkPayload(e.payload))
    .filter(
      (p): p is { chunk: string; byte_offset: number } =>
        typeof p.chunk === "string" && typeof p.byte_offset === "number"
    )
    .sort((a, b) => a.byte_offset - b.byte_offset)
    .map((p) => p.chunk)
    .join("");
}

type StreamVariant = "stdout" | "stderr";

interface StreamSectionProps {
  label: string;
  content: string;
  variant: StreamVariant;
}

function StreamSection({ label, content, variant }: StreamSectionProps) {
  const lines = useMemo(() => content.split("\n"), [content]);
  const isLong = lines.length > COLLAPSE_LINE_THRESHOLD;
  const [collapsed, setCollapsed] = useState(isLong);

  const displayed = collapsed ? lines.slice(0, COLLAPSE_LINE_THRESHOLD).join("\n") : content;

  return (
    <div className={`cop-section cop-section--${variant}`} data-testid={`cop-section-${variant}`}>
      <div className="cop-section-header">
        <span className="cop-section-label">{label}</span>
        {isLong && (
          <button
            type="button"
            className="cop-toggle"
            onClick={() => setCollapsed((c) => !c)}
            data-testid={`cop-toggle-${variant}`}
          >
            {collapsed ? `Show all (${lines.length} lines)` : "Collapse"}
          </button>
        )}
      </div>
      <pre className={`cop-pre cop-pre--${variant}`} data-testid={`cop-pre-${variant}`}>
        {displayed}
      </pre>
    </div>
  );
}

export function CommandOutputPanel({ events }: Props) {
  const stdout = useMemo(() => buildStream(events, "command.stdout"), [events]);
  const stderr = useMemo(() => buildStream(events, "command.stderr"), [events]);

  const hasStdout = stdout.length > 0;
  const hasStderr = stderr.length > 0;

  if (!hasStdout && !hasStderr) {
    return (
      <div className="cop-root cop-root--empty" data-testid="command-output-panel">
        <span className="cop-empty">No command output for this run.</span>
      </div>
    );
  }

  return (
    <div className="cop-root" data-testid="command-output-panel">
      {hasStdout && <StreamSection label="STDOUT" content={stdout} variant="stdout" />}
      {hasStderr && <StreamSection label="STDERR" content={stderr} variant="stderr" />}
    </div>
  );
}
