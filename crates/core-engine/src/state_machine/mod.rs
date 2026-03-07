// Run lifecycle state machine.
// Owns all valid RunStatus transitions. Pure logic — no I/O or side effects.
// See ARCHITECTURE.md §7.2 and CLAUDE.md Rule D.

pub mod node;

use thiserror::Error;
use workflow_model::run::RunStatus;
use event_model::run_events::{
    RunEventKind, RunValidationStartedPayload, RunValidationPassedPayload,
    RunValidationFailedPayload, RunStartedPayload, RunPausedPayload, RunResumedPayload,
    RunSucceededPayload, RunFailedPayload, RunCancelledPayload,
};
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

#[derive(Debug, Error, PartialEq, Eq, Clone)]
pub enum TransitionError {
    #[error("invalid transition: cannot move from {from:?} via {trigger}")]
    InvalidTransition { from: RunStatus, trigger: &'static str },
}

// ---------------------------------------------------------------------------
// Transition inputs
// Carry the payload data needed to emit the typed RunEventKind for each
// transition. Structured separately from RunEventKind so the state machine
// owns the mapping from (status, trigger) → (new_status, event).
// ---------------------------------------------------------------------------

/// All possible inputs that drive a state transition.
#[derive(Debug, Clone)]
pub enum RunTransitionInput {
    /// Created → Validating
    BeginValidation { node_count: u32 },
    /// Validating → Ready
    ValidationPassed { node_count: u32 },
    /// Validating → Failed
    ValidationFailed { reason: String, errors: Vec<String> },
    /// Ready → Running
    Start { node_count: u32 },
    /// Running → Paused
    Pause { reason: Option<String>, waiting_node_ids: Vec<Uuid> },
    /// Paused → Running
    Resume { resumed_by: Option<String> },
    /// Running | Paused → Succeeded (only Running for success)
    Succeed { duration_ms: u64, steps_executed: u32 },
    /// Running → Failed
    Fail { reason: String, failed_node_id: Option<Uuid>, duration_ms: Option<u64> },
    /// Running | Paused → Cancelled
    Cancel { reason: Option<String>, duration_ms: Option<u64> },
}

impl RunTransitionInput {
    /// Canonical trigger name used in error messages.
    pub fn trigger_name(&self) -> &'static str {
        match self {
            RunTransitionInput::BeginValidation { .. } => "BeginValidation",
            RunTransitionInput::ValidationPassed { .. } => "ValidationPassed",
            RunTransitionInput::ValidationFailed { .. } => "ValidationFailed",
            RunTransitionInput::Start { .. } => "Start",
            RunTransitionInput::Pause { .. } => "Pause",
            RunTransitionInput::Resume { .. } => "Resume",
            RunTransitionInput::Succeed { .. } => "Succeed",
            RunTransitionInput::Fail { .. } => "Fail",
            RunTransitionInput::Cancel { .. } => "Cancel",
        }
    }
}

// ---------------------------------------------------------------------------
// Core transition function
// ---------------------------------------------------------------------------

/// Attempt a state transition.
///
/// Returns `(new_status, emitted_event)` on success, or a `TransitionError`
/// if the transition is not valid from the current status.
///
/// This function is pure: no I/O, no side effects, fully deterministic.
pub fn try_transition(
    current: &RunStatus,
    input: RunTransitionInput,
) -> Result<(RunStatus, RunEventKind), TransitionError> {
    let trigger = input.trigger_name();

    match (current, &input) {
        // Created → Validating
        (RunStatus::Created, RunTransitionInput::BeginValidation { node_count }) => {
            let event = RunEventKind::ValidationStarted(RunValidationStartedPayload {
                node_count: *node_count,
            });
            Ok((RunStatus::Validating, event))
        }

        // Validating → Ready
        (RunStatus::Validating, RunTransitionInput::ValidationPassed { node_count }) => {
            let event = RunEventKind::ValidationPassed(RunValidationPassedPayload {
                node_count: *node_count,
            });
            Ok((RunStatus::Ready, event))
        }

        // Validating → Failed
        (RunStatus::Validating, RunTransitionInput::ValidationFailed { reason, errors }) => {
            let event = RunEventKind::ValidationFailed(RunValidationFailedPayload {
                reason: reason.clone(),
                errors: errors.clone(),
            });
            Ok((RunStatus::Failed, event))
        }

        // Ready → Running
        (RunStatus::Ready, RunTransitionInput::Start { node_count }) => {
            let event = RunEventKind::Started(RunStartedPayload {
                node_count: *node_count,
            });
            Ok((RunStatus::Running, event))
        }

        // Running → Paused
        (RunStatus::Running, RunTransitionInput::Pause { reason, waiting_node_ids }) => {
            let event = RunEventKind::Paused(RunPausedPayload {
                reason: reason.clone(),
                waiting_node_ids: waiting_node_ids.clone(),
            });
            Ok((RunStatus::Paused, event))
        }

        // Paused → Running
        (RunStatus::Paused, RunTransitionInput::Resume { resumed_by }) => {
            let event = RunEventKind::Resumed(RunResumedPayload {
                resumed_by: resumed_by.clone(),
            });
            Ok((RunStatus::Running, event))
        }

        // Running → Succeeded
        (RunStatus::Running, RunTransitionInput::Succeed { duration_ms, steps_executed }) => {
            let event = RunEventKind::Succeeded(RunSucceededPayload {
                duration_ms: *duration_ms,
                steps_executed: *steps_executed,
            });
            Ok((RunStatus::Succeeded, event))
        }

        // Running → Failed
        (RunStatus::Running, RunTransitionInput::Fail { reason, failed_node_id, duration_ms }) => {
            let event = RunEventKind::Failed(RunFailedPayload {
                reason: reason.clone(),
                failed_node_id: *failed_node_id,
                duration_ms: *duration_ms,
            });
            Ok((RunStatus::Failed, event))
        }

        // Running → Cancelled
        (RunStatus::Running, RunTransitionInput::Cancel { reason, duration_ms }) => {
            let event = RunEventKind::Cancelled(RunCancelledPayload {
                reason: reason.clone(),
                duration_ms: *duration_ms,
            });
            Ok((RunStatus::Cancelled, event))
        }

        // Paused → Cancelled
        (RunStatus::Paused, RunTransitionInput::Cancel { reason, duration_ms }) => {
            let event = RunEventKind::Cancelled(RunCancelledPayload {
                reason: reason.clone(),
                duration_ms: *duration_ms,
            });
            Ok((RunStatus::Cancelled, event))
        }

        // Everything else is invalid
        _ => Err(TransitionError::InvalidTransition {
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
    use workflow_model::run::RunStatus;

    // -- Happy-path transitions --

    #[test]
    fn created_begin_validation() {
        let (new, event) = try_transition(
            &RunStatus::Created,
            RunTransitionInput::BeginValidation { node_count: 3 },
        )
        .unwrap();
        assert_eq!(new, RunStatus::Validating);
        assert!(matches!(event, RunEventKind::ValidationStarted(_)));
    }

    #[test]
    fn validating_passes() {
        let (new, event) = try_transition(
            &RunStatus::Validating,
            RunTransitionInput::ValidationPassed { node_count: 3 },
        )
        .unwrap();
        assert_eq!(new, RunStatus::Ready);
        assert!(matches!(event, RunEventKind::ValidationPassed(_)));
    }

    #[test]
    fn validating_fails() {
        let (new, event) = try_transition(
            &RunStatus::Validating,
            RunTransitionInput::ValidationFailed {
                reason: "no start node".into(),
                errors: vec!["missing start".into()],
            },
        )
        .unwrap();
        assert_eq!(new, RunStatus::Failed);
        assert!(matches!(event, RunEventKind::ValidationFailed(_)));
    }

    #[test]
    fn ready_starts() {
        let (new, event) = try_transition(
            &RunStatus::Ready,
            RunTransitionInput::Start { node_count: 4 },
        )
        .unwrap();
        assert_eq!(new, RunStatus::Running);
        assert!(matches!(event, RunEventKind::Started(_)));
    }

    #[test]
    fn running_pauses() {
        let (new, event) = try_transition(
            &RunStatus::Running,
            RunTransitionInput::Pause {
                reason: Some("human review".into()),
                waiting_node_ids: vec![Uuid::new_v4()],
            },
        )
        .unwrap();
        assert_eq!(new, RunStatus::Paused);
        assert!(matches!(event, RunEventKind::Paused(_)));
    }

    #[test]
    fn paused_resumes() {
        let (new, event) = try_transition(
            &RunStatus::Paused,
            RunTransitionInput::Resume { resumed_by: Some("user".into()) },
        )
        .unwrap();
        assert_eq!(new, RunStatus::Running);
        assert!(matches!(event, RunEventKind::Resumed(_)));
    }

    #[test]
    fn running_succeeds() {
        let (new, event) = try_transition(
            &RunStatus::Running,
            RunTransitionInput::Succeed { duration_ms: 1000, steps_executed: 4 },
        )
        .unwrap();
        assert_eq!(new, RunStatus::Succeeded);
        assert!(matches!(event, RunEventKind::Succeeded(_)));
    }

    #[test]
    fn running_fails() {
        let (new, event) = try_transition(
            &RunStatus::Running,
            RunTransitionInput::Fail {
                reason: "exit code 1".into(),
                failed_node_id: Some(Uuid::new_v4()),
                duration_ms: Some(500),
            },
        )
        .unwrap();
        assert_eq!(new, RunStatus::Failed);
        assert!(matches!(event, RunEventKind::Failed(_)));
    }

    #[test]
    fn running_cancels() {
        let (new, event) = try_transition(
            &RunStatus::Running,
            RunTransitionInput::Cancel { reason: Some("user cancel".into()), duration_ms: Some(200) },
        )
        .unwrap();
        assert_eq!(new, RunStatus::Cancelled);
        assert!(matches!(event, RunEventKind::Cancelled(_)));
    }

    #[test]
    fn paused_cancels() {
        let (new, event) = try_transition(
            &RunStatus::Paused,
            RunTransitionInput::Cancel { reason: None, duration_ms: None },
        )
        .unwrap();
        assert_eq!(new, RunStatus::Cancelled);
        assert!(matches!(event, RunEventKind::Cancelled(_)));
    }

    // -- Invalid transitions --

    #[test]
    fn invalid_created_to_start() {
        let err = try_transition(
            &RunStatus::Created,
            RunTransitionInput::Start { node_count: 1 },
        )
        .unwrap_err();
        assert!(matches!(err, TransitionError::InvalidTransition { .. }));
    }

    #[test]
    fn invalid_succeeded_to_running() {
        let err = try_transition(
            &RunStatus::Succeeded,
            RunTransitionInput::Start { node_count: 1 },
        )
        .unwrap_err();
        assert!(matches!(err, TransitionError::InvalidTransition { .. }));
    }

    #[test]
    fn invalid_failed_to_running() {
        let err = try_transition(
            &RunStatus::Failed,
            RunTransitionInput::Start { node_count: 1 },
        )
        .unwrap_err();
        assert!(matches!(err, TransitionError::InvalidTransition { .. }));
    }

    #[test]
    fn invalid_cancelled_to_running() {
        let err = try_transition(
            &RunStatus::Cancelled,
            RunTransitionInput::Start { node_count: 1 },
        )
        .unwrap_err();
        assert!(matches!(err, TransitionError::InvalidTransition { .. }));
    }

    #[test]
    fn invalid_ready_to_pause() {
        // Cannot pause a run that hasn't started
        let err = try_transition(
            &RunStatus::Ready,
            RunTransitionInput::Pause { reason: None, waiting_node_ids: vec![] },
        )
        .unwrap_err();
        assert!(matches!(err, TransitionError::InvalidTransition { .. }));
    }

    #[test]
    fn invalid_running_to_resume() {
        // Resume only valid from Paused
        let err = try_transition(
            &RunStatus::Running,
            RunTransitionInput::Resume { resumed_by: None },
        )
        .unwrap_err();
        assert!(matches!(err, TransitionError::InvalidTransition { .. }));
    }

    #[test]
    fn invalid_succeeded_cancel() {
        let err = try_transition(
            &RunStatus::Succeeded,
            RunTransitionInput::Cancel { reason: None, duration_ms: None },
        )
        .unwrap_err();
        assert!(matches!(err, TransitionError::InvalidTransition { .. }));
    }

    // -- Full lifecycle walkthrough --

    #[test]
    fn full_happy_path_lifecycle() {
        let mut status = RunStatus::Created;

        let (s, _) = try_transition(&status, RunTransitionInput::BeginValidation { node_count: 4 }).unwrap();
        status = s;
        assert_eq!(status, RunStatus::Validating);

        let (s, _) = try_transition(&status, RunTransitionInput::ValidationPassed { node_count: 4 }).unwrap();
        status = s;
        assert_eq!(status, RunStatus::Ready);

        let (s, _) = try_transition(&status, RunTransitionInput::Start { node_count: 4 }).unwrap();
        status = s;
        assert_eq!(status, RunStatus::Running);

        let (s, _) = try_transition(&status, RunTransitionInput::Succeed { duration_ms: 5000, steps_executed: 4 }).unwrap();
        status = s;
        assert_eq!(status, RunStatus::Succeeded);
    }

    #[test]
    fn pause_resume_lifecycle() {
        let mut status = RunStatus::Running;

        let (s, _) = try_transition(&status, RunTransitionInput::Pause {
            reason: Some("review".into()),
            waiting_node_ids: vec![],
        }).unwrap();
        status = s;
        assert_eq!(status, RunStatus::Paused);

        let (s, _) = try_transition(&status, RunTransitionInput::Resume { resumed_by: None }).unwrap();
        status = s;
        assert_eq!(status, RunStatus::Running);

        let (s, _) = try_transition(&status, RunTransitionInput::Succeed { duration_ms: 100, steps_executed: 2 }).unwrap();
        status = s;
        assert_eq!(status, RunStatus::Succeeded);
    }

    #[test]
    fn error_message_contains_from_state() {
        let err = try_transition(
            &RunStatus::Created,
            RunTransitionInput::Succeed { duration_ms: 0, steps_executed: 0 },
        )
        .unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("Created") || msg.contains("from"), "error message: {msg}");
    }
}
