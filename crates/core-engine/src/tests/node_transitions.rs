// Exhaustive NodeStatus state machine transition tests.
// Tests every (NodeStatus, NodeTransitionInput) pair to ensure valid
// transitions produce the correct new state and invalid transitions are rejected.

use workflow_model::run::NodeStatus;
use crate::state_machine::node::{try_node_transition, NodeTransitionInput, NodeTransitionError};

// ---------------------------------------------------------------------------
// Data: all statuses and all trigger constructors
// ---------------------------------------------------------------------------

fn all_statuses() -> Vec<NodeStatus> {
    vec![
        NodeStatus::Draft,
        NodeStatus::Validated,
        NodeStatus::Ready,
        NodeStatus::Queued,
        NodeStatus::Running,
        NodeStatus::Waiting,
        NodeStatus::Succeeded,
        NodeStatus::Failed,
        NodeStatus::Cancelled,
        NodeStatus::Skipped,
    ]
}

fn all_triggers() -> Vec<(&'static str, NodeTransitionInput)> {
    vec![
        ("Queue", NodeTransitionInput::Queue { node_type: "tool".into() }),
        (
            "Start",
            NodeTransitionInput::Start {
                node_type: "tool".into(),
                input_refs: vec![],
                workspace_root: "/tmp".into(),
            },
        ),
        (
            "WaitForReview",
            NodeTransitionInput::WaitForReview {
                reason: Some("review needed".into()),
            },
        ),
        (
            "Resume",
            NodeTransitionInput::Resume {
                node_type: "human_review".into(),
                input_refs: vec![],
                workspace_root: "/tmp".into(),
            },
        ),
        ("Succeed", NodeTransitionInput::Succeed { duration_ms: 100 }),
        (
            "Fail",
            NodeTransitionInput::Fail {
                reason: "error".into(),
                duration_ms: Some(50),
            },
        ),
        (
            "ScheduleRetry",
            NodeTransitionInput::ScheduleRetry {
                reason: "retry".into(),
                delay_ms: 1000,
            },
        ),
        (
            "Cancel",
            NodeTransitionInput::Cancel {
                reason: Some("user cancelled".into()),
            },
        ),
        (
            "Skip",
            NodeTransitionInput::Skip {
                reason: Some("condition not met".into()),
            },
        ),
    ]
}

/// Map of (from_status, trigger_name) → expected new status.
fn expected_result(from: &NodeStatus, trigger: &str) -> Option<NodeStatus> {
    match (from, trigger) {
        (NodeStatus::Ready, "Queue") => Some(NodeStatus::Queued),
        (NodeStatus::Queued, "Start") => Some(NodeStatus::Running),
        (NodeStatus::Running, "WaitForReview") => Some(NodeStatus::Waiting),
        (NodeStatus::Waiting, "Resume") => Some(NodeStatus::Running),
        (NodeStatus::Running, "Succeed") => Some(NodeStatus::Succeeded),
        (NodeStatus::Running, "Fail") => Some(NodeStatus::Failed),
        (NodeStatus::Failed, "ScheduleRetry") => Some(NodeStatus::Queued),
        (NodeStatus::Running, "Cancel") => Some(NodeStatus::Cancelled),
        (NodeStatus::Queued, "Cancel") => Some(NodeStatus::Cancelled),
        (NodeStatus::Waiting, "Cancel") => Some(NodeStatus::Cancelled),
        (NodeStatus::Ready, "Skip") => Some(NodeStatus::Skipped),
        (NodeStatus::Queued, "Skip") => Some(NodeStatus::Skipped),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Exhaustive tests
// ---------------------------------------------------------------------------

/// Every valid (status, trigger) pair must produce the expected new status.
#[test]
fn exhaustive_valid_node_transitions() {
    let mut valid_count = 0;
    for from in all_statuses() {
        for (trigger_name, trigger) in all_triggers() {
            if let Some(expected_status) = expected_result(&from, trigger_name) {
                let result = try_node_transition(&from, 1, trigger);
                match result {
                    Ok((new_status, _attempt, _event)) => {
                        assert_eq!(
                            new_status, expected_status,
                            "{:?} + {} should produce {:?}, got {:?}",
                            from, trigger_name, expected_status, new_status
                        );
                        valid_count += 1;
                    }
                    Err(e) => {
                        panic!(
                            "valid transition {:?} + {} returned error: {}",
                            from, trigger_name, e
                        );
                    }
                }
            }
        }
    }
    // 12 valid node transitions.
    assert_eq!(valid_count, 12, "expected 12 valid node transitions");
}

/// Every invalid (status, trigger) pair must return NodeTransitionError.
#[test]
fn exhaustive_invalid_node_transitions() {
    let mut invalid_count = 0;
    for from in all_statuses() {
        for (trigger_name, trigger) in all_triggers() {
            if expected_result(&from, trigger_name).is_none() {
                let result = try_node_transition(&from, 1, trigger);
                assert!(
                    result.is_err(),
                    "invalid transition {:?} + {} should return error, got {:?}",
                    from,
                    trigger_name,
                    result.ok()
                );
                match result.unwrap_err() {
                    NodeTransitionError::InvalidTransition { .. } => {}
                }
                invalid_count += 1;
            }
        }
    }
    // 10 states × 9 triggers = 90 total − 12 valid = 78 invalid.
    assert_eq!(invalid_count, 78, "expected 78 invalid node transitions");
}

// ---------------------------------------------------------------------------
// Attempt counter semantics
// ---------------------------------------------------------------------------

/// ScheduleRetry must increment the attempt counter.
#[test]
fn schedule_retry_increments_attempt() {
    let (_, new_attempt, _) = try_node_transition(
        &NodeStatus::Failed,
        1,
        NodeTransitionInput::ScheduleRetry {
            reason: "flaky".into(),
            delay_ms: 500,
        },
    )
    .unwrap();
    assert_eq!(new_attempt, 2);
}

/// All transitions other than ScheduleRetry must preserve the attempt counter.
#[test]
fn non_retry_transitions_preserve_attempt() {
    let attempt = 3u32;

    // Queue from Ready
    let (_, a, _) = try_node_transition(
        &NodeStatus::Ready,
        attempt,
        NodeTransitionInput::Queue { node_type: "tool".into() },
    )
    .unwrap();
    assert_eq!(a, attempt);

    // Start from Queued
    let (_, a, _) = try_node_transition(
        &NodeStatus::Queued,
        attempt,
        NodeTransitionInput::Start {
            node_type: "tool".into(),
            input_refs: vec![],
            workspace_root: "/tmp".into(),
        },
    )
    .unwrap();
    assert_eq!(a, attempt);

    // Succeed from Running
    let (_, a, _) = try_node_transition(
        &NodeStatus::Running,
        attempt,
        NodeTransitionInput::Succeed { duration_ms: 100 },
    )
    .unwrap();
    assert_eq!(a, attempt);

    // Fail from Running
    let (_, a, _) = try_node_transition(
        &NodeStatus::Running,
        attempt,
        NodeTransitionInput::Fail {
            reason: "err".into(),
            duration_ms: None,
        },
    )
    .unwrap();
    assert_eq!(a, attempt);

    // Cancel from Running
    let (_, a, _) = try_node_transition(
        &NodeStatus::Running,
        attempt,
        NodeTransitionInput::Cancel { reason: None },
    )
    .unwrap();
    assert_eq!(a, attempt);

    // Skip from Ready
    let (_, a, _) = try_node_transition(
        &NodeStatus::Ready,
        attempt,
        NodeTransitionInput::Skip { reason: None },
    )
    .unwrap();
    assert_eq!(a, attempt);
}

/// ScheduleRetry carries the incremented attempt in the event payload.
#[test]
fn retry_event_payload_carries_new_attempt() {
    let (_, new_attempt, event) = try_node_transition(
        &NodeStatus::Failed,
        2,
        NodeTransitionInput::ScheduleRetry {
            reason: "timeout".into(),
            delay_ms: 2000,
        },
    )
    .unwrap();
    assert_eq!(new_attempt, 3);
    match event {
        event_model::node_events::NodeEventKind::RetryScheduled(p) => {
            assert_eq!(p.attempt, 3);
            assert_eq!(p.delay_ms, 2000);
            assert_eq!(p.reason, "timeout");
        }
        other => panic!("expected RetryScheduled, got {:?}", other),
    }
}

// ---------------------------------------------------------------------------
// Event kind verification for key transitions
// ---------------------------------------------------------------------------

#[test]
fn queue_emits_queued_event() {
    let (_, _, event) = try_node_transition(
        &NodeStatus::Ready,
        1,
        NodeTransitionInput::Queue { node_type: "agent".into() },
    )
    .unwrap();
    match event {
        event_model::node_events::NodeEventKind::Queued(p) => {
            assert_eq!(p.node_type, "agent");
        }
        other => panic!("expected Queued, got {:?}", other),
    }
}

#[test]
fn start_emits_started_with_correct_attempt() {
    let (_, _, event) = try_node_transition(
        &NodeStatus::Queued,
        3,
        NodeTransitionInput::Start {
            node_type: "tool".into(),
            input_refs: vec!["input_a".into()],
            workspace_root: "/workspace".into(),
        },
    )
    .unwrap();
    match event {
        event_model::node_events::NodeEventKind::Started(p) => {
            assert_eq!(p.attempt, 3);
            assert_eq!(p.node_type, "tool");
            assert_eq!(p.input_refs, vec!["input_a"]);
            assert_eq!(p.workspace_root, "/workspace");
        }
        other => panic!("expected Started, got {:?}", other),
    }
}

#[test]
fn succeed_emits_succeeded_with_duration() {
    let (_, _, event) = try_node_transition(
        &NodeStatus::Running,
        2,
        NodeTransitionInput::Succeed { duration_ms: 4500 },
    )
    .unwrap();
    match event {
        event_model::node_events::NodeEventKind::Succeeded(p) => {
            assert_eq!(p.attempt, 2);
            assert_eq!(p.duration_ms, 4500);
        }
        other => panic!("expected Succeeded, got {:?}", other),
    }
}

#[test]
fn fail_emits_failed_with_reason() {
    let (_, _, event) = try_node_transition(
        &NodeStatus::Running,
        1,
        NodeTransitionInput::Fail {
            reason: "segfault".into(),
            duration_ms: Some(10),
        },
    )
    .unwrap();
    match event {
        event_model::node_events::NodeEventKind::Failed(p) => {
            assert_eq!(p.reason, "segfault");
            assert_eq!(p.duration_ms, Some(10));
        }
        other => panic!("expected Failed, got {:?}", other),
    }
}

#[test]
fn wait_emits_waiting_with_reason() {
    let (_, _, event) = try_node_transition(
        &NodeStatus::Running,
        1,
        NodeTransitionInput::WaitForReview {
            reason: Some("needs approval".into()),
        },
    )
    .unwrap();
    match event {
        event_model::node_events::NodeEventKind::Waiting(p) => {
            assert_eq!(p.reason, Some("needs approval".into()));
        }
        other => panic!("expected Waiting, got {:?}", other),
    }
}

#[test]
fn cancel_emits_cancelled_with_reason() {
    let (_, _, event) = try_node_transition(
        &NodeStatus::Running,
        1,
        NodeTransitionInput::Cancel {
            reason: Some("aborted".into()),
        },
    )
    .unwrap();
    match event {
        event_model::node_events::NodeEventKind::Cancelled(p) => {
            assert_eq!(p.reason, Some("aborted".into()));
        }
        other => panic!("expected Cancelled, got {:?}", other),
    }
}

#[test]
fn skip_emits_skipped_with_reason() {
    let (_, _, event) = try_node_transition(
        &NodeStatus::Ready,
        0,
        NodeTransitionInput::Skip {
            reason: Some("router bypassed".into()),
        },
    )
    .unwrap();
    match event {
        event_model::node_events::NodeEventKind::Skipped(p) => {
            assert_eq!(p.reason, Some("router bypassed".into()));
        }
        other => panic!("expected Skipped, got {:?}", other),
    }
}

// ---------------------------------------------------------------------------
// Terminal states reject all transitions
// ---------------------------------------------------------------------------

#[test]
fn succeeded_is_terminal() {
    for (name, trigger) in all_triggers() {
        let result = try_node_transition(&NodeStatus::Succeeded, 1, trigger);
        assert!(
            result.is_err(),
            "Succeeded should reject {}, but accepted",
            name
        );
    }
}

#[test]
fn cancelled_is_terminal() {
    for (name, trigger) in all_triggers() {
        let result = try_node_transition(&NodeStatus::Cancelled, 1, trigger);
        assert!(
            result.is_err(),
            "Cancelled should reject {}, but accepted",
            name
        );
    }
}

#[test]
fn skipped_is_terminal() {
    for (name, trigger) in all_triggers() {
        let result = try_node_transition(&NodeStatus::Skipped, 1, trigger);
        assert!(
            result.is_err(),
            "Skipped should reject {}, but accepted",
            name
        );
    }
}

/// Draft and Validated are pre-execution states; only Draft is used in the
/// state machine code but both should reject all triggers since there are no
/// outgoing transitions defined from them.
#[test]
fn draft_rejects_all_transitions() {
    for (name, trigger) in all_triggers() {
        let result = try_node_transition(&NodeStatus::Draft, 0, trigger);
        assert!(
            result.is_err(),
            "Draft should reject {}, but accepted",
            name
        );
    }
}

#[test]
fn validated_rejects_all_transitions() {
    for (name, trigger) in all_triggers() {
        let result = try_node_transition(&NodeStatus::Validated, 0, trigger);
        assert!(
            result.is_err(),
            "Validated should reject {}, but accepted",
            name
        );
    }
}

// ---------------------------------------------------------------------------
// Full lifecycle walkthroughs
// ---------------------------------------------------------------------------

/// Ready → Queued → Running → Waiting → Running → Succeeded
#[test]
fn human_review_lifecycle() {
    let mut status = NodeStatus::Ready;
    let mut attempt = 1u32;

    let (s, a, _) = try_node_transition(
        &status,
        attempt,
        NodeTransitionInput::Queue { node_type: "human_review".into() },
    )
    .unwrap();
    status = s;
    attempt = a;
    assert_eq!(status, NodeStatus::Queued);

    let (s, a, _) = try_node_transition(
        &status,
        attempt,
        NodeTransitionInput::Start {
            node_type: "human_review".into(),
            input_refs: vec![],
            workspace_root: "/tmp".into(),
        },
    )
    .unwrap();
    status = s;
    attempt = a;
    assert_eq!(status, NodeStatus::Running);

    let (s, a, _) = try_node_transition(
        &status,
        attempt,
        NodeTransitionInput::WaitForReview {
            reason: Some("approval needed".into()),
        },
    )
    .unwrap();
    status = s;
    attempt = a;
    assert_eq!(status, NodeStatus::Waiting);

    let (s, a, _) = try_node_transition(
        &status,
        attempt,
        NodeTransitionInput::Resume {
            node_type: "human_review".into(),
            input_refs: vec![],
            workspace_root: "/tmp".into(),
        },
    )
    .unwrap();
    status = s;
    attempt = a;
    assert_eq!(status, NodeStatus::Running);

    let (s, _, _) = try_node_transition(
        &status,
        attempt,
        NodeTransitionInput::Succeed { duration_ms: 5000 },
    )
    .unwrap();
    assert_eq!(s, NodeStatus::Succeeded);
}

/// Ready → Queued → Running → Failed → Queued (retry) → Running → Succeeded
#[test]
fn retry_lifecycle() {
    let mut status = NodeStatus::Ready;
    let mut attempt = 1u32;

    // Queue
    let (s, a, _) = try_node_transition(
        &status,
        attempt,
        NodeTransitionInput::Queue { node_type: "tool".into() },
    )
    .unwrap();
    status = s;
    attempt = a;

    // Start
    let (s, a, _) = try_node_transition(
        &status,
        attempt,
        NodeTransitionInput::Start {
            node_type: "tool".into(),
            input_refs: vec![],
            workspace_root: "/repo".into(),
        },
    )
    .unwrap();
    status = s;
    attempt = a;

    // Fail
    let (s, a, _) = try_node_transition(
        &status,
        attempt,
        NodeTransitionInput::Fail {
            reason: "exit code 1".into(),
            duration_ms: Some(200),
        },
    )
    .unwrap();
    status = s;
    attempt = a;
    assert_eq!(status, NodeStatus::Failed);
    assert_eq!(attempt, 1);

    // Retry
    let (s, a, _) = try_node_transition(
        &status,
        attempt,
        NodeTransitionInput::ScheduleRetry {
            reason: "auto-retry".into(),
            delay_ms: 0,
        },
    )
    .unwrap();
    status = s;
    attempt = a;
    assert_eq!(status, NodeStatus::Queued);
    assert_eq!(attempt, 2);

    // Start again
    let (s, a, _) = try_node_transition(
        &status,
        attempt,
        NodeTransitionInput::Start {
            node_type: "tool".into(),
            input_refs: vec![],
            workspace_root: "/repo".into(),
        },
    )
    .unwrap();
    status = s;
    attempt = a;
    assert_eq!(status, NodeStatus::Running);
    assert_eq!(attempt, 2);

    // Succeed
    let (s, _, _) = try_node_transition(
        &status,
        attempt,
        NodeTransitionInput::Succeed { duration_ms: 100 },
    )
    .unwrap();
    assert_eq!(s, NodeStatus::Succeeded);
}

/// Waiting → Cancelled (review node cancelled while waiting for human input)
#[test]
fn cancel_from_waiting() {
    let (status, _, _) = try_node_transition(
        &NodeStatus::Waiting,
        1,
        NodeTransitionInput::Cancel {
            reason: Some("run cancelled".into()),
        },
    )
    .unwrap();
    assert_eq!(status, NodeStatus::Cancelled);
}

/// Queued → Skipped (node skipped before it starts executing)
#[test]
fn skip_from_queued() {
    let (status, _, _) = try_node_transition(
        &NodeStatus::Queued,
        1,
        NodeTransitionInput::Skip {
            reason: Some("branch not taken".into()),
        },
    )
    .unwrap();
    assert_eq!(status, NodeStatus::Skipped);
}
