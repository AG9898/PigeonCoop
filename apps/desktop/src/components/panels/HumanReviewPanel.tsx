// HumanReviewPanel — surfaces when the engine pauses at a HumanReview node.
// Triggered by the `human_review_requested` Tauri event.
// See DESIGN_SPEC.md §10, §13 (keyboard-first).

import { useEffect, useCallback } from "react";
import type {
  HumanReviewDecision,
  HumanReviewRequestedPayload,
} from "../../types/ipc";

export interface HumanReviewPanelProps {
  /** The pending review request. Null means the panel is hidden. */
  request: HumanReviewRequestedPayload;
  /** Called when the user submits a decision. Parent is responsible for
   *  calling ipc.submitHumanReviewDecision and clearing the request. */
  onDecision: (decision: HumanReviewDecision) => void;
  /** Whether the panel is currently submitting (disables buttons). */
  submitting?: boolean;
}

/**
 * Full-screen modal that blocks the UI while the run waits for human input.
 * Keyboard shortcuts: A = Approve, R = Reject, T = Retry.
 */
export function HumanReviewPanel({
  request,
  onDecision,
  submitting = false,
}: HumanReviewPanelProps) {
  const canApprove = request.available_actions.includes("approve");
  const canReject = request.available_actions.includes("reject");
  const canRetry = request.available_actions.includes("retry");

  const handleApprove = useCallback(() => {
    if (!submitting && canApprove) onDecision({ type: "approved" });
  }, [submitting, canApprove, onDecision]);

  const handleReject = useCallback(() => {
    if (!submitting && canReject) onDecision({ type: "rejected" });
  }, [submitting, canReject, onDecision]);

  const handleRetry = useCallback(() => {
    if (!submitting && canRetry) onDecision({ type: "retry_requested" });
  }, [submitting, canRetry, onDecision]);

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Ignore if user is typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
      if (e.key === "a" || e.key === "A") handleApprove();
      if (e.key === "r" || e.key === "R") handleReject();
      if (e.key === "t" || e.key === "T") handleRetry();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleApprove, handleReject, handleRetry]);

  return (
    <div
      className="hr-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Human review required"
      data-testid="human-review-panel"
    >
      <div className="hr-panel">
        {/* Header */}
        <div className="hr-header">
          <span className="hr-badge">[ REVIEW REQUIRED ]</span>
          <span className="hr-node-label" data-testid="hr-node-label">
            {request.node_label}
          </span>
        </div>

        {/* Reason */}
        <div className="hr-section">
          <div className="hr-section-label">REASON</div>
          <div className="hr-reason" data-testid="hr-reason">
            {request.reason}
          </div>
        </div>

        {/* Context */}
        <div className="hr-section">
          <div className="hr-section-label">CONTEXT</div>
          <div className="hr-meta-row">
            <span className="hr-meta-key">run_id</span>
            <span className="hr-meta-val">{request.run_id}</span>
          </div>
          <div className="hr-meta-row">
            <span className="hr-meta-key">node_id</span>
            <span className="hr-meta-val">{request.node_id}</span>
          </div>
          <div className="hr-meta-row">
            <span className="hr-meta-key">timestamp</span>
            <span className="hr-meta-val">{request.timestamp}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="hr-actions" data-testid="hr-actions">
          {canApprove && (
            <button
              className="hr-btn hr-btn--approve"
              onClick={handleApprove}
              disabled={submitting}
              data-testid="hr-btn-approve"
              title="Approve [A]"
            >
              Approve <kbd>A</kbd>
            </button>
          )}
          {canReject && (
            <button
              className="hr-btn hr-btn--reject"
              onClick={handleReject}
              disabled={submitting}
              data-testid="hr-btn-reject"
              title="Reject [R]"
            >
              Reject <kbd>R</kbd>
            </button>
          )}
          {canRetry && (
            <button
              className="hr-btn hr-btn--retry"
              onClick={handleRetry}
              disabled={submitting}
              data-testid="hr-btn-retry"
              title="Retry [T]"
            >
              Retry <kbd>T</kbd>
            </button>
          )}
          {submitting && (
            <span className="hr-submitting">submitting...</span>
          )}
        </div>
      </div>
    </div>
  );
}
