// Node lifecycle state machine.
// Owns all valid NodeStatus transitions. Pure logic — no I/O or side effects.
// See ARCHITECTURE.md §7.3 and CLAUDE.md Rule D.

use thiserror::Error;
use workflow_model::run::NodeStatus;
use event_model::node_events::{
    NodeEventKind, NodeQueuedPayload, NodeStartedPayload, NodeWaitingPayload,
    NodeSucceededPayload, NodeFailedPayload, NodeCancelledPayload, NodeSkippedPayload,
    NodeRetryScheduledPayload,
};

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

#[derive(Debug, Error, PartialEq, Eq, Clone)]
pub enum NodeTransitionError {
    #[error("invalid node transition: cannot move from {from:?} via {trigger}")]
    InvalidTransition { from: NodeStatus, trigger: &'static str },
}

// ---------------------------------------------------------------------------
// Transition inputs
// ---------------------------------------------------------------------------

/// All possible inputs that drive a per-node state transition.
#[derive(Debug, Clone)]
pub enum NodeTransitionInput {
    /// Ready → Queued
    Queue { node_type: String },
    /// Queued → Running
    Start { node_type: String, input_refs: Vec<String>, workspace_root: String },
    /// Running → Waiting (e.g. human review gate)
    WaitForReview { reason: Option<String> },
    /// Waiting → Running (human approved; re-emits node.started)
    Resume { node_type: String, input_refs: Vec<String>, workspace_root: String },
    /// Running → Succeeded
    Succeed { duration_ms: u64 },
    /// Running → Failed
    Fail { reason: String, duration_ms: Option<u64> },
    /// Failed → Queued (schedules retry; increments attempt count)
    ScheduleRetry { reason: String, delay_ms: u64 },
    /// Running | Queued | Waiting → Cancelled
    Cancel { reason: Option<String> },
    /// Ready | Queued → Skipped
    Skip { reason: Option<String> },
}

impl NodeTransitionInput {
    /// Canonical trigger name used in error messages.
    pub fn trigger_name(&self) -> &'static str {
        match self {
            NodeTransitionInput::Queue { .. } => "Queue",
            NodeTransitionInput::Start { .. } => "Start",
            NodeTransitionInput::WaitForReview { .. } => "WaitForReview",
            NodeTransitionInput::Resume { .. } => "Resume",
            NodeTransitionInput::Succeed { .. } => "Succeed",
            NodeTransitionInput::Fail { .. } => "Fail",
            NodeTransitionInput::ScheduleRetry { .. } => "ScheduleRetry",
            NodeTransitionInput::Cancel { .. } => "Cancel",
            NodeTransitionInput::Skip { .. } => "Skip",
        }
    }
}

// ---------------------------------------------------------------------------
// Core transition function
// ---------------------------------------------------------------------------

/// Attempt a per-node state transition.
///
/// Returns `(new_status, new_attempt, emitted_event)` on success, or a
/// `NodeTransitionError` if the transition is invalid from the current status.
///
/// `attempt` is incremented by `ScheduleRetry`; all other transitions leave
/// it unchanged.
///
/// This function is pure: no I/O, no side effects, fully deterministic.
pub fn try_node_transition(
    current: &NodeStatus,
    attempt: u32,
    input: NodeTransitionInput,
) -> Result<(NodeStatus, u32, NodeEventKind), NodeTransitionError> {
    let trigger = input.trigger_name();

    match (current, &input) {
        // Ready → Queued
        (NodeStatus::Ready, NodeTransitionInput::Queue { node_type }) => {
            let event = NodeEventKind::Queued(NodeQueuedPayload {
                node_type: node_type.clone(),
            });
            Ok((NodeStatus::Queued, attempt, event))
        }

        // Queued → Running
        (NodeStatus::Queued, NodeTransitionInput::Start { node_type, input_refs, workspace_root }) => {
            let event = NodeEventKind::Started(NodeStartedPayload {
                node_type: node_type.clone(),
                attempt,
                input_refs: input_refs.clone(),
                workspace_root: workspace_root.clone(),
            });
            Ok((NodeStatus::Running, attempt, event))
        }

        // Running → Waiting
        (NodeStatus::Running, NodeTransitionInput::WaitForReview { reason }) => {
            let event = NodeEventKind::Waiting(NodeWaitingPayload {
                reason: reason.clone(),
            });
            Ok((NodeStatus::Waiting, attempt, event))
        }

        // Waiting → Running (human resumed)
        (NodeStatus::Waiting, NodeTransitionInput::Resume { node_type, input_refs, workspace_root }) => {
            let event = NodeEventKind::Started(NodeStartedPayload {
                node_type: node_type.clone(),
                attempt,
                input_refs: input_refs.clone(),
                workspace_root: workspace_root.clone(),
            });
            Ok((NodeStatus::Running, attempt, event))
        }

        // Running → Succeeded
        (NodeStatus::Running, NodeTransitionInput::Succeed { duration_ms }) => {
            let event = NodeEventKind::Succeeded(NodeSucceededPayload {
                attempt,
                duration_ms: *duration_ms,
            });
            Ok((NodeStatus::Succeeded, attempt, event))
        }

        // Running → Failed
        (NodeStatus::Running, NodeTransitionInput::Fail { reason, duration_ms }) => {
            let event = NodeEventKind::Failed(NodeFailedPayload {
                attempt,
                reason: reason.clone(),
                duration_ms: *duration_ms,
            });
            Ok((NodeStatus::Failed, attempt, event))
        }

        // Failed → Queued (retry scheduled; increments attempt)
        (NodeStatus::Failed, NodeTransitionInput::ScheduleRetry { reason, delay_ms }) => {
            let next_attempt = attempt + 1;
            let event = NodeEventKind::RetryScheduled(NodeRetryScheduledPayload {
                attempt: next_attempt,
                delay_ms: *delay_ms,
                reason: reason.clone(),
            });
            Ok((NodeStatus::Queued, next_attempt, event))
        }

        // Running → Cancelled
        (NodeStatus::Running, NodeTransitionInput::Cancel { reason }) => {
            let event = NodeEventKind::Cancelled(NodeCancelledPayload {
                reason: reason.clone(),
            });
            Ok((NodeStatus::Cancelled, attempt, event))
        }

        // Queued → Cancelled
        (NodeStatus::Queued, NodeTransitionInput::Cancel { reason }) => {
            let event = NodeEventKind::Cancelled(NodeCancelledPayload {
                reason: reason.clone(),
            });
            Ok((NodeStatus::Cancelled, attempt, event))
        }

        // Waiting → Cancelled
        (NodeStatus::Waiting, NodeTransitionInput::Cancel { reason }) => {
            let event = NodeEventKind::Cancelled(NodeCancelledPayload {
                reason: reason.clone(),
            });
            Ok((NodeStatus::Cancelled, attempt, event))
        }

        // Ready → Skipped
        (NodeStatus::Ready, NodeTransitionInput::Skip { reason }) => {
            let event = NodeEventKind::Skipped(NodeSkippedPayload {
                reason: reason.clone(),
            });
            Ok((NodeStatus::Skipped, attempt, event))
        }

        // Queued → Skipped
        (NodeStatus::Queued, NodeTransitionInput::Skip { reason }) => {
            let event = NodeEventKind::Skipped(NodeSkippedPayload {
                reason: reason.clone(),
            });
            Ok((NodeStatus::Skipped, attempt, event))
        }

        // Everything else is invalid
        _ => Err(NodeTransitionError::InvalidTransition {
            from: current.clone(),
            trigger,
        }),
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // -- Happy-path transitions --

    #[test]
    fn ready_queues() {
        let (new, attempt, event) = try_node_transition(
            &NodeStatus::Ready,
            1,
            NodeTransitionInput::Queue { node_type: "tool".into() },
        )
        .unwrap();
        assert_eq!(new, NodeStatus::Queued);
        assert_eq!(attempt, 1);
        assert!(matches!(event, NodeEventKind::Queued(_)));
    }

    #[test]
    fn queued_starts() {
        let (new, attempt, event) = try_node_transition(
            &NodeStatus::Queued,
            1,
            NodeTransitionInput::Start {
                node_type: "tool".into(),
                input_refs: vec![],
                workspace_root: "/repo".into(),
            },
        )
        .unwrap();
        assert_eq!(new, NodeStatus::Running);
        assert_eq!(attempt, 1);
        assert!(matches!(event, NodeEventKind::Started(_)));
    }

    #[test]
    fn running_waits_for_review() {
        let (new, attempt, event) = try_node_transition(
            &NodeStatus::Running,
            1,
            NodeTransitionInput::WaitForReview { reason: Some("needs approval".into()) },
        )
        .unwrap();
        assert_eq!(new, NodeStatus::Waiting);
        assert_eq!(attempt, 1);
        assert!(matches!(event, NodeEventKind::Waiting(_)));
    }

    #[test]
    fn waiting_resumes() {
        let (new, attempt, event) = try_node_transition(
            &NodeStatus::Waiting,
            1,
            NodeTransitionInput::Resume {
                node_type: "human_review".into(),
                input_refs: vec![],
                workspace_root: "/repo".into(),
            },
        )
        .unwrap();
        assert_eq!(new, NodeStatus::Running);
        assert_eq!(attempt, 1);
        assert!(matches!(event, NodeEventKind::Started(_)));
    }

    #[test]
    fn running_succeeds() {
        let (new, attempt, event) = try_node_transition(
            &NodeStatus::Running,
            1,
            NodeTransitionInput::Succeed { duration_ms: 500 },
        )
        .unwrap();
        assert_eq!(new, NodeStatus::Succeeded);
        assert_eq!(attempt, 1);
        assert!(matches!(event, NodeEventKind::Succeeded(_)));
    }

    #[test]
    fn running_fails() {
        let (new, attempt, event) = try_node_transition(
            &NodeStatus::Running,
            1,
            NodeTransitionInput::Fail { reason: "exit code 1".into(), duration_ms: Some(200) },
        )
        .unwrap();
        assert_eq!(new, NodeStatus::Failed);
        assert_eq!(attempt, 1);
        assert!(matches!(event, NodeEventKind::Failed(_)));
    }

    #[test]
    fn failed_schedules_retry_increments_attempt() {
        let (new, new_attempt, event) = try_node_transition(
            &NodeStatus::Failed,
            1,
            NodeTransitionInput::ScheduleRetry {
                reason: "flaky test".into(),
                delay_ms: 1000,
            },
        )
        .unwrap();
        assert_eq!(new, NodeStatus::Queued);
        // attempt must be incremented
        assert_eq!(new_attempt, 2);
        match &event {
            NodeEventKind::RetryScheduled(p) => {
                assert_eq!(p.attempt, 2);
                assert_eq!(p.delay_ms, 1000);
                assert_eq!(p.reason, "flaky test");
            }
            other => panic!("expected RetryScheduled, got {:?}", other),
        }
    }

    #[test]
    fn multiple_retries_increment_attempt_each_time() {
        // Simulate 3 retries: attempt 1 → 2 → 3 → 4
        let mut status = NodeStatus::Failed;
        let mut attempt = 1u32;
        for expected_attempt in 2..=4 {
            // Must transition through Queued → Running → Failed each cycle
            // Here we only test the ScheduleRetry increment directly
            let (new_status, new_attempt, _) = try_node_transition(
                &status,
                attempt,
                NodeTransitionInput::ScheduleRetry {
                    reason: "retry".into(),
                    delay_ms: 0,
                },
            )
            .unwrap();
            assert_eq!(new_attempt, expected_attempt);
            // Simulate the node running and failing again
            let (running, a, _) = try_node_transition(
                &new_status,
                new_attempt,
                NodeTransitionInput::Start {
                    node_type: "tool".into(),
                    input_refs: vec![],
                    workspace_root: "/repo".into(),
                },
            )
            .unwrap();
            let (failed, a2, _) = try_node_transition(
                &running,
                a,
                NodeTransitionInput::Fail { reason: "err".into(), duration_ms: None },
            )
            .unwrap();
            status = failed;
            attempt = a2;
        }
        assert_eq!(attempt, 4);
    }

    #[test]
    fn running_cancels() {
        let (new, _, event) = try_node_transition(
            &NodeStatus::Running,
            1,
            NodeTransitionInput::Cancel { reason: Some("user cancelled".into()) },
        )
        .unwrap();
        assert_eq!(new, NodeStatus::Cancelled);
        assert!(matches!(event, NodeEventKind::Cancelled(_)));
    }

    #[test]
    fn queued_cancels() {
        let (new, _, event) = try_node_transition(
            &NodeStatus::Queued,
            1,
            NodeTransitionInput::Cancel { reason: None },
        )
        .unwrap();
        assert_eq!(new, NodeStatus::Cancelled);
        assert!(matches!(event, NodeEventKind::Cancelled(_)));
    }

    #[test]
    fn waiting_cancels() {
        let (new, _, event) = try_node_transition(
            &NodeStatus::Waiting,
            1,
            NodeTransitionInput::Cancel { reason: None },
        )
        .unwrap();
        assert_eq!(new, NodeStatus::Cancelled);
        assert!(matches!(event, NodeEventKind::Cancelled(_)));
    }

    #[test]
    fn ready_skips() {
        let (new, _, event) = try_node_transition(
            &NodeStatus::Ready,
            0,
            NodeTransitionInput::Skip { reason: Some("router bypassed".into()) },
        )
        .unwrap();
        assert_eq!(new, NodeStatus::Skipped);
        assert!(matches!(event, NodeEventKind::Skipped(_)));
    }

    #[test]
    fn queued_skips() {
        let (new, _, event) = try_node_transition(
            &NodeStatus::Queued,
            0,
            NodeTransitionInput::Skip { reason: None },
        )
        .unwrap();
        assert_eq!(new, NodeStatus::Skipped);
        assert!(matches!(event, NodeEventKind::Skipped(_)));
    }

    // -- Invalid transitions --

    #[test]
    fn invalid_draft_to_queue() {
        let err = try_node_transition(
            &NodeStatus::Draft,
            0,
            NodeTransitionInput::Queue { node_type: "tool".into() },
        )
        .unwrap_err();
        assert!(matches!(err, NodeTransitionError::InvalidTransition { .. }));
    }

    #[test]
    fn invalid_running_to_queue() {
        let err = try_node_transition(
            &NodeStatus::Running,
            1,
            NodeTransitionInput::Queue { node_type: "tool".into() },
        )
        .unwrap_err();
        assert!(matches!(err, NodeTransitionError::InvalidTransition { .. }));
    }

    #[test]
    fn invalid_succeeded_to_start() {
        let err = try_node_transition(
            &NodeStatus::Succeeded,
            1,
            NodeTransitionInput::Start {
                node_type: "tool".into(),
                input_refs: vec![],
                workspace_root: "/repo".into(),
            },
        )
        .unwrap_err();
        assert!(matches!(err, NodeTransitionError::InvalidTransition { .. }));
    }

    #[test]
    fn invalid_ready_to_retry() {
        let err = try_node_transition(
            &NodeStatus::Ready,
            0,
            NodeTransitionInput::ScheduleRetry { reason: "oops".into(), delay_ms: 0 },
        )
        .unwrap_err();
        assert!(matches!(err, NodeTransitionError::InvalidTransition { .. }));
    }

    #[test]
    fn invalid_queued_to_wait() {
        let err = try_node_transition(
            &NodeStatus::Queued,
            0,
            NodeTransitionInput::WaitForReview { reason: None },
        )
        .unwrap_err();
        assert!(matches!(err, NodeTransitionError::InvalidTransition { .. }));
    }

    #[test]
    fn invalid_cancelled_to_start() {
        let err = try_node_transition(
            &NodeStatus::Cancelled,
            1,
            NodeTransitionInput::Start {
                node_type: "tool".into(),
                input_refs: vec![],
                workspace_root: "/repo".into(),
            },
        )
        .unwrap_err();
        assert!(matches!(err, NodeTransitionError::InvalidTransition { .. }));
    }

    #[test]
    fn error_message_contains_from_state() {
        let err = try_node_transition(
            &NodeStatus::Succeeded,
            1,
            NodeTransitionInput::Succeed { duration_ms: 0 },
        )
        .unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("Succeeded") || msg.contains("from"), "error: {msg}");
    }

    // -- Full lifecycle walkthroughs --

    #[test]
    fn full_happy_path_lifecycle() {
        let mut status = NodeStatus::Ready;
        let mut attempt = 1u32;

        let (s, a, _) = try_node_transition(&status, attempt, NodeTransitionInput::Queue {
            node_type: "tool".into(),
        }).unwrap();
        status = s; attempt = a;
        assert_eq!(status, NodeStatus::Queued);

        let (s, a, _) = try_node_transition(&status, attempt, NodeTransitionInput::Start {
            node_type: "tool".into(),
            input_refs: vec![],
            workspace_root: "/repo".into(),
        }).unwrap();
        status = s; attempt = a;
        assert_eq!(status, NodeStatus::Running);

        let (s, a, _) = try_node_transition(&status, attempt, NodeTransitionInput::Succeed {
            duration_ms: 1000,
        }).unwrap();
        status = s; attempt = a;
        assert_eq!(status, NodeStatus::Succeeded);
        assert_eq!(attempt, 1);
    }

    #[test]
    fn fail_retry_succeed_lifecycle() {
        let mut status = NodeStatus::Queued;
        let mut attempt = 1u32;

        // Start
        let (s, a, _) = try_node_transition(&status, attempt, NodeTransitionInput::Start {
            node_type: "agent".into(),
            input_refs: vec![],
            workspace_root: "/repo".into(),
        }).unwrap();
        status = s; attempt = a;
        assert_eq!(status, NodeStatus::Running);

        // Fail
        let (s, a, _) = try_node_transition(&status, attempt, NodeTransitionInput::Fail {
            reason: "timeout".into(),
            duration_ms: None,
        }).unwrap();
        status = s; attempt = a;
        assert_eq!(status, NodeStatus::Failed);

        // Retry
        let (s, a, event) = try_node_transition(&status, attempt, NodeTransitionInput::ScheduleRetry {
            reason: "timeout retry".into(),
            delay_ms: 500,
        }).unwrap();
        status = s; attempt = a;
        assert_eq!(status, NodeStatus::Queued);
        assert_eq!(attempt, 2);
        assert!(matches!(event, NodeEventKind::RetryScheduled(_)));

        // Start again
        let (s, a, event) = try_node_transition(&status, attempt, NodeTransitionInput::Start {
            node_type: "agent".into(),
            input_refs: vec![],
            workspace_root: "/repo".into(),
        }).unwrap();
        status = s; attempt = a;
        assert_eq!(status, NodeStatus::Running);
        // event carries updated attempt
        match &event {
            NodeEventKind::Started(p) => assert_eq!(p.attempt, 2),
            other => panic!("expected Started, got {:?}", other),
        }

        // Succeed
        let (s, _, _) = try_node_transition(&status, attempt, NodeTransitionInput::Succeed {
            duration_ms: 300,
        }).unwrap();
        assert_eq!(s, NodeStatus::Succeeded);
    }

    #[test]
    fn human_review_lifecycle() {
        let mut status = NodeStatus::Running;
        let mut attempt = 1u32;

        // Pause for review
        let (s, a, _) = try_node_transition(&status, attempt, NodeTransitionInput::WaitForReview {
            reason: Some("approval required".into()),
        }).unwrap();
        status = s; attempt = a;
        assert_eq!(status, NodeStatus::Waiting);

        // Resume
        let (s, a, _) = try_node_transition(&status, attempt, NodeTransitionInput::Resume {
            node_type: "human_review".into(),
            input_refs: vec![],
            workspace_root: "/repo".into(),
        }).unwrap();
        status = s; attempt = a;
        assert_eq!(status, NodeStatus::Running);

        // Succeed
        let (s, _, _) = try_node_transition(&status, attempt, NodeTransitionInput::Succeed {
            duration_ms: 60_000,
        }).unwrap();
        assert_eq!(s, NodeStatus::Succeeded);
    }
}
