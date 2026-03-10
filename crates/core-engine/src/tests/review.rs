// Human review flow tests.
// Tests pause_for_review, approve_review, reject_review, and retry_review
// through the coordinator and review handler, including edge cases.

use uuid::Uuid;
use workflow_model::run::{NodeStatus, RunStatus};
use crate::coordinator::StateTransitionError;
use crate::review::{handle_review_decision, ReviewDecision};
use crate::state_machine::RunTransitionInput;
use super::helpers::*;

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

/// Create a coordinator in Running state with a review node in Running state.
fn setup_review_coordinator() -> (crate::coordinator::RunCoordinator<InMemoryEventLog>, Uuid) {
    let mut coord = make_coordinator();
    advance_to_running(&mut coord, 2);
    let review_id = Uuid::new_v4();
    coord
        .node_snapshots
        .insert(review_id, make_snapshot(review_id, NodeStatus::Running));
    (coord, review_id)
}

/// Pause coordinator at a review node.
fn pause_at_review(
    coord: &mut crate::coordinator::RunCoordinator<InMemoryEventLog>,
    node_id: Uuid,
) {
    coord
        .pause_for_review(node_id, Some("needs approval".into()))
        .unwrap();
}

// ---------------------------------------------------------------------------
// Pause for review
// ---------------------------------------------------------------------------

#[test]
fn pause_transitions_node_to_waiting_and_run_to_paused() {
    let (mut coord, node_id) = setup_review_coordinator();
    pause_at_review(&mut coord, node_id);

    assert_eq!(coord.run_status(), &RunStatus::Paused);
    assert_eq!(coord.node_status(&node_id), Some(&NodeStatus::Waiting));
}

#[test]
fn pause_emits_review_required_event() {
    let (mut coord, node_id) = setup_review_coordinator();
    pause_at_review(&mut coord, node_id);

    let review_events: Vec<_> = coord
        .emitted_events()
        .iter()
        .filter(|e| e.event_type == "review.required")
        .collect();
    assert_eq!(review_events.len(), 1);
    assert_eq!(review_events[0].payload["blocking"], true);
    assert_eq!(review_events[0].node_id, Some(node_id));
}

#[test]
fn pause_emits_review_required_with_available_actions() {
    let (mut coord, node_id) = setup_review_coordinator();
    pause_at_review(&mut coord, node_id);

    let review_event = coord
        .emitted_events()
        .iter()
        .find(|e| e.event_type == "review.required")
        .unwrap();
    let actions = review_event.payload["available_actions"]
        .as_array()
        .unwrap();
    assert!(actions.iter().any(|a| a == "approve"));
    assert!(actions.iter().any(|a| a == "reject"));
    assert!(actions.iter().any(|a| a == "retry"));
}

// ---------------------------------------------------------------------------
// Approve
// ---------------------------------------------------------------------------

#[test]
fn approve_resumes_run_and_succeeds_node() {
    let (mut coord, node_id) = setup_review_coordinator();
    pause_at_review(&mut coord, node_id);

    handle_review_decision(
        &mut coord,
        node_id,
        ReviewDecision::Approve {
            comment: Some("looks good".into()),
        },
    )
    .unwrap();

    assert_eq!(coord.node_status(&node_id), Some(&NodeStatus::Succeeded));
    // Single-node run: all nodes terminal → run succeeds.
    assert_eq!(coord.run_status(), &RunStatus::Succeeded);
}

#[test]
fn approve_emits_review_approved_event() {
    let (mut coord, node_id) = setup_review_coordinator();
    pause_at_review(&mut coord, node_id);

    handle_review_decision(
        &mut coord,
        node_id,
        ReviewDecision::Approve { comment: None },
    )
    .unwrap();

    assert!(coord
        .emitted_events()
        .iter()
        .any(|e| e.event_type == "review.approved"));
}

#[test]
fn approve_with_other_nodes_still_running() {
    let mut coord = make_coordinator();
    advance_to_running(&mut coord, 3);

    let review_id = Uuid::new_v4();
    let other_id = Uuid::new_v4();
    coord
        .node_snapshots
        .insert(review_id, make_snapshot(review_id, NodeStatus::Running));
    coord
        .node_snapshots
        .insert(other_id, make_snapshot(other_id, NodeStatus::Running));

    pause_at_review(&mut coord, review_id);
    handle_review_decision(
        &mut coord,
        review_id,
        ReviewDecision::Approve { comment: None },
    )
    .unwrap();

    // Review node succeeded, but other node still running → run is Running.
    assert_eq!(
        coord.node_status(&review_id),
        Some(&NodeStatus::Succeeded)
    );
    assert_eq!(coord.run_status(), &RunStatus::Running);
}

// ---------------------------------------------------------------------------
// Reject
// ---------------------------------------------------------------------------

#[test]
fn reject_fails_node_and_run() {
    let (mut coord, node_id) = setup_review_coordinator();
    pause_at_review(&mut coord, node_id);

    handle_review_decision(
        &mut coord,
        node_id,
        ReviewDecision::Reject {
            reason: "output is wrong".into(),
        },
    )
    .unwrap();

    assert_eq!(coord.node_status(&node_id), Some(&NodeStatus::Failed));
    assert_eq!(coord.run_status(), &RunStatus::Failed);
}

#[test]
fn reject_emits_review_rejected_event() {
    let (mut coord, node_id) = setup_review_coordinator();
    pause_at_review(&mut coord, node_id);

    handle_review_decision(
        &mut coord,
        node_id,
        ReviewDecision::Reject {
            reason: "bad output".into(),
        },
    )
    .unwrap();

    let rejected = coord
        .emitted_events()
        .iter()
        .find(|e| e.event_type == "review.rejected")
        .expect("review.rejected event must be emitted");
    assert_eq!(rejected.payload["reason"], "bad output");
}

// ---------------------------------------------------------------------------
// Retry
// ---------------------------------------------------------------------------

#[test]
fn retry_requeues_failed_target_node() {
    let (mut coord, review_id) = setup_review_coordinator();

    // Add a failed target node.
    let target_id = Uuid::new_v4();
    coord
        .node_snapshots
        .insert(target_id, make_snapshot(target_id, NodeStatus::Failed));

    pause_at_review(&mut coord, review_id);

    handle_review_decision(
        &mut coord,
        review_id,
        ReviewDecision::Retry {
            target_node_id: target_id,
            comment: Some("retry with updated params".into()),
        },
    )
    .unwrap();

    assert_eq!(
        coord.node_status(&review_id),
        Some(&NodeStatus::Succeeded)
    );
    assert_eq!(coord.node_status(&target_id), Some(&NodeStatus::Queued));
    assert_eq!(coord.run_status(), &RunStatus::Running);
}

#[test]
fn retry_emits_review_retry_requested_event() {
    let (mut coord, review_id) = setup_review_coordinator();
    let target_id = Uuid::new_v4();
    coord
        .node_snapshots
        .insert(target_id, make_snapshot(target_id, NodeStatus::Failed));
    pause_at_review(&mut coord, review_id);

    handle_review_decision(
        &mut coord,
        review_id,
        ReviewDecision::Retry {
            target_node_id: target_id,
            comment: None,
        },
    )
    .unwrap();

    assert!(coord
        .emitted_events()
        .iter()
        .any(|e| e.event_type == "review.retry_requested"));
}

#[test]
fn retry_increments_target_attempt() {
    let (mut coord, review_id) = setup_review_coordinator();
    let target_id = Uuid::new_v4();
    coord
        .node_snapshots
        .insert(target_id, make_snapshot(target_id, NodeStatus::Failed));
    pause_at_review(&mut coord, review_id);

    handle_review_decision(
        &mut coord,
        review_id,
        ReviewDecision::Retry {
            target_node_id: target_id,
            comment: None,
        },
    )
    .unwrap();

    let snap = coord.node_snapshots.get(&target_id).unwrap();
    assert_eq!(snap.attempt, 2, "retry must increment attempt counter");
}

// ---------------------------------------------------------------------------
// Error cases
// ---------------------------------------------------------------------------

#[test]
fn pause_nonexistent_node_returns_error() {
    let mut coord = make_coordinator();
    advance_to_running(&mut coord, 1);

    let missing_id = Uuid::new_v4();
    let result = coord.pause_for_review(missing_id, None);
    assert!(matches!(
        result,
        Err(StateTransitionError::NodeNotFound { .. })
    ));
}

#[test]
fn approve_nonexistent_node_returns_error() {
    let mut coord = make_coordinator();
    advance_to_running(&mut coord, 1);
    // Put run in Paused state manually.
    coord
        .transition_run(RunTransitionInput::Pause {
            reason: None,
            waiting_node_ids: vec![],
        })
        .unwrap();

    let missing_id = Uuid::new_v4();
    let result = coord.approve_review(missing_id, None);
    assert!(matches!(
        result,
        Err(StateTransitionError::NodeNotFound { .. })
    ));
}

#[test]
fn retry_with_nonexistent_target_returns_error() {
    let (mut coord, review_id) = setup_review_coordinator();
    pause_at_review(&mut coord, review_id);

    let missing_target = Uuid::new_v4();
    let result = handle_review_decision(
        &mut coord,
        review_id,
        ReviewDecision::Retry {
            target_node_id: missing_target,
            comment: None,
        },
    );

    // Should fail when looking up the target node.
    assert!(result.is_err());
}

#[test]
fn pause_non_running_node_returns_error() {
    let mut coord = make_coordinator();
    advance_to_running(&mut coord, 1);

    let node_id = Uuid::new_v4();
    coord
        .node_snapshots
        .insert(node_id, make_snapshot(node_id, NodeStatus::Succeeded));

    let result = coord.pause_for_review(node_id, None);
    assert!(matches!(
        result,
        Err(StateTransitionError::InvalidNodeTransition { .. })
    ));
}
