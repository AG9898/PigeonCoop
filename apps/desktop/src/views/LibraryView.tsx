// LibraryView — browse workflows and past runs.
// Provides navigation to Replay view for completed runs.
// See ARCHITECTURE.md §10.4 and DESIGN_SPEC.md §4.4.

interface Props {
  onOpenReplay: (runId: string) => void;
}

export function LibraryView({ onOpenReplay }: Props) {
  return (
    <div className="view library-view">
      <div className="view-header">
        <span className="view-title">LIBRARY</span>
        <span className="view-subtitle">workflows &amp; run history</span>
      </div>
      <div className="view-body library-body">
        <div className="library-section">
          <div className="panel-header">WORKFLOWS</div>
          <div className="view-placeholder">
            <span className="placeholder-label">[ workflow list ]</span>
          </div>
        </div>
        <div className="library-section">
          <div className="panel-header">RUN HISTORY</div>
          <div className="view-placeholder">
            <span className="placeholder-label">[ run list ]</span>
            <button
              className="replay-open-btn"
              data-testid="open-replay-btn"
              onClick={() => onOpenReplay("")}
            >
              Open in Replay
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
