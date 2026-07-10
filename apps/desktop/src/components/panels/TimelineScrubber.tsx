// TimelineScrubber — navigate the event sequence by position.
// Arrow keys on the slider (or while the container has focus) move backward/forward.
// The host component owns index state; this component calls onChange.
// See DESIGN_SPEC.md §4.3 and §13.

import { useCallback } from "react";
import { ChevronLeft, ChevronRight, SkipBack, SkipForward } from "lucide-react";

interface TimelineScrubberProps {
  /** Current event index (0-based). */
  index: number;
  /** Total number of events in the sequence. */
  total: number;
  /** Called when the selected index changes. */
  onChange: (index: number) => void;
}

export function TimelineScrubber({
  index,
  total,
  onChange,
}: TimelineScrubberProps) {
  const disabled = total === 0;
  const max = Math.max(0, total - 1);

  const clamp = useCallback(
    (next: number) => {
      if (next < 0 || next > max) return;
      onChange(next);
    },
    [max, onChange]
  );

  // Handle arrow keys on the container so that keyboard scrubbing works even
  // when focus is on a button rather than the range input.
  function handleKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      clamp(index - 1);
    } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      clamp(index + 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      clamp(0);
    } else if (e.key === "End") {
      e.preventDefault();
      clamp(max);
    }
  }

  const displayIndex = total > 0 ? index + 1 : 0;
  const pct = total > 1 ? Math.round((index / max) * 100) : 0;

  return (
    <div
      className="timeline-scrubber"
      onKeyDown={handleKeyDown}
      aria-label="timeline scrubber"
    >
      <div className="scrubber-track">
        <input
          type="range"
          className="scrubber-input"
          aria-label="event position"
          aria-valuemin={0}
          aria-valuemax={max}
          aria-valuenow={index}
          aria-valuetext={`Event ${displayIndex} of ${total}`}
          min={0}
          max={max}
          value={index}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </div>

      <div className="scrubber-controls">
        <button
          className="scrubber-btn"
          onClick={() => clamp(0)}
          disabled={disabled || index === 0}
          aria-label="go to first event"
          title="First (Home)"
        >
          <SkipBack size={13} />
        </button>
        <button
          className="scrubber-btn"
          onClick={() => clamp(index - 1)}
          disabled={disabled || index === 0}
          aria-label="previous event"
          title="Previous (←)"
        >
          <ChevronLeft size={14} />
        </button>

        <span className="scrubber-position" aria-live="polite">
          <span className="scrubber-current">{displayIndex}</span>
          <span className="scrubber-sep">/</span>
          <span className="scrubber-total">{total}</span>
          {total > 0 && (
            <span className="scrubber-pct">({pct}%)</span>
          )}
        </span>

        <button
          className="scrubber-btn"
          onClick={() => clamp(index + 1)}
          disabled={disabled || index >= max}
          aria-label="next event"
          title="Next (→)"
        >
          <ChevronRight size={14} />
        </button>
        <button
          className="scrubber-btn"
          onClick={() => clamp(max)}
          disabled={disabled || index >= max}
          aria-label="go to last event"
          title="Last (End)"
        >
          <SkipForward size={13} />
        </button>
      </div>
    </div>
  );
}
