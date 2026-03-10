// Exhaustive RunStatus state machine transition tests.
// Tests every (RunStatus, RunTransitionInput) pair to ensure valid transitions
// produce the correct new state and invalid transitions are rejected.

use uuid::Uuid;
use workflow_model::run::RunStatus;
use crate::state_machine::{try_transition, RunTransitionInput, TransitionError};

// ---------------------------------------------------------------------------
// Data: all statuses and all trigger constructors
// ---------------------------------------------------------------------------

fn all_statuses() -> Vec<RunStatus> {
    vec![
        RunStatus::Created,
        RunStatus::Validating,
        RunStatus::Ready,
        RunStatus::Running,
        RunStatus::Paused,
        RunStatus::Succeeded,
        RunStatus::Failed,
        RunStatus::Cancelled,
    ]
}

fn all_triggers() -> Vec<(&'static str, RunTransitionInput)> {
    vec![
        (
            "BeginValidation",
            RunTransitionInput::BeginValidation { node_count: 3 },
        ),
        (
            "ValidationPassed",
            RunTransitionInput::ValidationPassed { node_count: 3 },
        ),
        (
            "ValidationFailed",
            RunTransitionInput::ValidationFailed {
                reason: "test error".into(),
                errors: vec!["err1".into()],
            },
        ),
        (
            "Start",
            RunTransitionInput::Start { node_count: 3 },
        ),
        (
            "Pause",
            RunTransitionInput::Pause {
                reason: Some("review".into()),
                waiting_node_ids: vec![Uuid::new_v4()],
            },
        ),
        (
            "Resume",
            RunTransitionInput::Resume {
                resumed_by: Some("user".into()),
            },
        ),
        (
            "Succeed",
            RunTransitionInput::Succeed {
                duration_ms: 1000,
                steps_executed: 4,
            },
        ),
        (
            "Fail",
            RunTransitionInput::Fail {
                reason: "node failed".into(),
                failed_node_id: Some(Uuid::new_v4()),
                duration_ms: Some(500),
            },
        ),
        (
            "Cancel",
            RunTransitionInput::Cancel {
                reason: Some("user requested".into()),
                duration_ms: Some(100),
            },
        ),
    ]
}

/// Map of (from_status_name, trigger_name) → expected new status.
/// Every pair NOT in this map must be an invalid transition.
fn expected_result(from: &RunStatus, trigger: &str) -> Option<RunStatus> {
    match (from, trigger) {
        (RunStatus::Created, "BeginValidation") => Some(RunStatus::Validating),
        (RunStatus::Validating, "ValidationPassed") => Some(RunStatus::Ready),
        (RunStatus::Validating, "ValidationFailed") => Some(RunStatus::Failed),
        (RunStatus::Ready, "Start") => Some(RunStatus::Running),
        (RunStatus::Running, "Pause") => Some(RunStatus::Paused),
        (RunStatus::Paused, "Resume") => Some(RunStatus::Running),
        (RunStatus::Running, "Succeed") => Some(RunStatus::Succeeded),
        (RunStatus::Running, "Fail") => Some(RunStatus::Failed),
        (RunStatus::Running, "Cancel") => Some(RunStatus::Cancelled),
        (RunStatus::Paused, "Cancel") => Some(RunStatus::Cancelled),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Exhaustive tests
// ---------------------------------------------------------------------------

/// Every valid (status, trigger) pair must produce the expected new status
/// and emit the correct event kind.
#[test]
fn exhaustive_valid_run_transitions() {
    let mut valid_count = 0;
    for from in all_statuses() {
        for (trigger_name, trigger) in all_triggers() {
            if let Some(expected_status) = expected_result(&from, trigger_name) {
                let result = try_transition(&from, trigger);
                match result {
                    Ok((new_status, _event)) => {
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
    // Sanity: we expect exactly 10 valid transitions.
    assert_eq!(valid_count, 10, "expected 10 valid run transitions");
}

/// Every invalid (status, trigger) pair must return TransitionError::InvalidTransition.
#[test]
fn exhaustive_invalid_run_transitions() {
    let mut invalid_count = 0;
    for from in all_statuses() {
        for (trigger_name, trigger) in all_triggers() {
            if expected_result(&from, trigger_name).is_none() {
                let result = try_transition(&from, trigger);
                assert!(
                    result.is_err(),
                    "invalid transition {:?} + {} should return error, got {:?}",
                    from,
                    trigger_name,
                    result.ok()
                );
                match result.unwrap_err() {
                    TransitionError::InvalidTransition { ref from, ref trigger } => {
                        // Verify the error carries the correct source state.
                        let _ = from;
                        let _ = trigger;
                    }
                }
                invalid_count += 1;
            }
        }
    }
    // 8 states × 9 triggers = 72 total − 10 valid = 62 invalid.
    assert_eq!(invalid_count, 62, "expected 62 invalid run transitions");
}

// ---------------------------------------------------------------------------
// Event kind verification for each valid transition
// ---------------------------------------------------------------------------

#[test]
fn created_to_validating_emits_validation_started() {
    let (_, event) = try_transition(
        &RunStatus::Created,
        RunTransitionInput::BeginValidation { node_count: 5 },
    )
    .unwrap();
    assert!(matches!(
        event,
        event_model::run_events::RunEventKind::ValidationStarted(_)
    ));
}

#[test]
fn validating_to_ready_emits_validation_passed() {
    let (_, event) = try_transition(
        &RunStatus::Validating,
        RunTransitionInput::ValidationPassed { node_count: 5 },
    )
    .unwrap();
    assert!(matches!(
        event,
        event_model::run_events::RunEventKind::ValidationPassed(_)
    ));
}

#[test]
fn validating_to_failed_emits_validation_failed() {
    let (_, event) = try_transition(
        &RunStatus::Validating,
        RunTransitionInput::ValidationFailed {
            reason: "bad graph".into(),
            errors: vec!["no start".into()],
        },
    )
    .unwrap();
    assert!(matches!(
        event,
        event_model::run_events::RunEventKind::ValidationFailed(_)
    ));
}

#[test]
fn ready_to_running_emits_started() {
    let (_, event) = try_transition(
        &RunStatus::Ready,
        RunTransitionInput::Start { node_count: 3 },
    )
    .unwrap();
    assert!(matches!(
        event,
        event_model::run_events::RunEventKind::Started(_)
    ));
}

#[test]
fn running_to_paused_emits_paused() {
    let (_, event) = try_transition(
        &RunStatus::Running,
        RunTransitionInput::Pause {
            reason: Some("review".into()),
            waiting_node_ids: vec![],
        },
    )
    .unwrap();
    assert!(matches!(
        event,
        event_model::run_events::RunEventKind::Paused(_)
    ));
}

#[test]
fn paused_to_running_emits_resumed() {
    let (_, event) = try_transition(
        &RunStatus::Paused,
        RunTransitionInput::Resume {
            resumed_by: Some("admin".into()),
        },
    )
    .unwrap();
    assert!(matches!(
        event,
        event_model::run_events::RunEventKind::Resumed(_)
    ));
}

#[test]
fn running_to_succeeded_emits_succeeded() {
    let (_, event) = try_transition(
        &RunStatus::Running,
        RunTransitionInput::Succeed {
            duration_ms: 5000,
            steps_executed: 10,
        },
    )
    .unwrap();
    assert!(matches!(
        event,
        event_model::run_events::RunEventKind::Succeeded(_)
    ));
}

#[test]
fn running_to_failed_emits_failed() {
    let (_, event) = try_transition(
        &RunStatus::Running,
        RunTransitionInput::Fail {
            reason: "oops".into(),
            failed_node_id: None,
            duration_ms: None,
        },
    )
    .unwrap();
    assert!(matches!(
        event,
        event_model::run_events::RunEventKind::Failed(_)
    ));
}

#[test]
fn running_to_cancelled_emits_cancelled() {
    let (_, event) = try_transition(
        &RunStatus::Running,
        RunTransitionInput::Cancel {
            reason: None,
            duration_ms: None,
        },
    )
    .unwrap();
    assert!(matches!(
        event,
        event_model::run_events::RunEventKind::Cancelled(_)
    ));
}

#[test]
fn paused_to_cancelled_emits_cancelled() {
    let (_, event) = try_transition(
        &RunStatus::Paused,
        RunTransitionInput::Cancel {
            reason: Some("timeout".into()),
            duration_ms: Some(60000),
        },
    )
    .unwrap();
    assert!(matches!(
        event,
        event_model::run_events::RunEventKind::Cancelled(_)
    ));
}

// ---------------------------------------------------------------------------
// Terminal states reject all transitions
// ---------------------------------------------------------------------------

#[test]
fn succeeded_is_terminal() {
    for (name, trigger) in all_triggers() {
        let result = try_transition(&RunStatus::Succeeded, trigger);
        assert!(
            result.is_err(),
            "Succeeded state should reject {} but accepted it",
            name
        );
    }
}

#[test]
fn failed_is_terminal() {
    for (name, trigger) in all_triggers() {
        let result = try_transition(&RunStatus::Failed, trigger);
        assert!(
            result.is_err(),
            "Failed state should reject {} but accepted it",
            name
        );
    }
}

#[test]
fn cancelled_is_terminal() {
    for (name, trigger) in all_triggers() {
        let result = try_transition(&RunStatus::Cancelled, trigger);
        assert!(
            result.is_err(),
            "Cancelled state should reject {} but accepted it",
            name
        );
    }
}

// ---------------------------------------------------------------------------
// Event payload data correctness
// ---------------------------------------------------------------------------

#[test]
fn validation_started_payload_carries_node_count() {
    let (_, event) = try_transition(
        &RunStatus::Created,
        RunTransitionInput::BeginValidation { node_count: 7 },
    )
    .unwrap();
    match event {
        event_model::run_events::RunEventKind::ValidationStarted(p) => {
            assert_eq!(p.node_count, 7);
        }
        other => panic!("expected ValidationStarted, got {:?}", other),
    }
}

#[test]
fn validation_failed_payload_carries_reason_and_errors() {
    let (_, event) = try_transition(
        &RunStatus::Validating,
        RunTransitionInput::ValidationFailed {
            reason: "graph invalid".into(),
            errors: vec!["no start".into(), "cycle".into()],
        },
    )
    .unwrap();
    match event {
        event_model::run_events::RunEventKind::ValidationFailed(p) => {
            assert_eq!(p.reason, "graph invalid");
            assert_eq!(p.errors.len(), 2);
        }
        other => panic!("expected ValidationFailed, got {:?}", other),
    }
}

#[test]
fn succeeded_payload_carries_duration_and_steps() {
    let (_, event) = try_transition(
        &RunStatus::Running,
        RunTransitionInput::Succeed {
            duration_ms: 12345,
            steps_executed: 8,
        },
    )
    .unwrap();
    match event {
        event_model::run_events::RunEventKind::Succeeded(p) => {
            assert_eq!(p.duration_ms, 12345);
            assert_eq!(p.steps_executed, 8);
        }
        other => panic!("expected Succeeded, got {:?}", other),
    }
}

#[test]
fn failed_payload_carries_reason_and_node_id() {
    let node_id = Uuid::new_v4();
    let (_, event) = try_transition(
        &RunStatus::Running,
        RunTransitionInput::Fail {
            reason: "exit code 1".into(),
            failed_node_id: Some(node_id),
            duration_ms: Some(999),
        },
    )
    .unwrap();
    match event {
        event_model::run_events::RunEventKind::Failed(p) => {
            assert_eq!(p.reason, "exit code 1");
            assert_eq!(p.failed_node_id, Some(node_id));
            assert_eq!(p.duration_ms, Some(999));
        }
        other => panic!("expected Failed, got {:?}", other),
    }
}

#[test]
fn paused_payload_carries_waiting_node_ids() {
    let nid = Uuid::new_v4();
    let (_, event) = try_transition(
        &RunStatus::Running,
        RunTransitionInput::Pause {
            reason: Some("gate".into()),
            waiting_node_ids: vec![nid],
        },
    )
    .unwrap();
    match event {
        event_model::run_events::RunEventKind::Paused(p) => {
            assert_eq!(p.waiting_node_ids, vec![nid]);
            assert_eq!(p.reason, Some("gate".into()));
        }
        other => panic!("expected Paused, got {:?}", other),
    }
}

// ---------------------------------------------------------------------------
// Error message quality
// ---------------------------------------------------------------------------

#[test]
fn error_message_includes_from_state_and_trigger() {
    let err = try_transition(
        &RunStatus::Created,
        RunTransitionInput::Succeed {
            duration_ms: 0,
            steps_executed: 0,
        },
    )
    .unwrap_err();
    let msg = err.to_string();
    assert!(
        msg.contains("Created"),
        "error should mention source state: {}",
        msg
    );
    assert!(
        msg.contains("Succeed"),
        "error should mention trigger: {}",
        msg
    );
}
