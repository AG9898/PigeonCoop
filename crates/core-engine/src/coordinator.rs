// Run coordinator.
// Owns the runtime state of a single run: drives both the run-level and
// node-level state machines, emits events, and enforces retry/guardrail policy.
// See ARCHITECTURE.md §4, §7 and CLAUDE.md Rules A, D, E.

use std::collections::HashMap;
use thiserror::Error;
use uuid::Uuid;
use chrono::Utc;
use workflow_model::run::{RunInstance, RunStatus, NodeSnapshot, NodeStatus};
use event_model::event::RunEvent;
use event_model::guardrail_events::{
    GuardrailEventKind, GuardrailExceededPayload, GuardrailSeverity, GuardrailWarningPayload,
};
use event_model::human_review_events::{
    HumanReviewEventKind, ReviewRequiredPayload, ReviewApprovedPayload,
    ReviewRejectedPayload, ReviewRetryRequestedPayload,
};
use crate::state_machine::{RunTransitionInput, TransitionError};
use crate::state_machine::node::{NodeTransitionInput, NodeTransitionError};

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/// Errors produced by the coordinator when a state transition is invalid or
/// the target node is not tracked.
///
/// These variants are the canonical error vocabulary for coordinator callers.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum StateTransitionError {
    /// The requested run-level transition is not valid from the current state.
    #[error("invalid run transition: {0}")]
    InvalidRunTransition(#[from] TransitionError),

    /// The requested node-level transition is not valid from the node's
    /// current state.
    #[error("invalid node transition for node {node_id}: {error}")]
    InvalidNodeTransition {
        node_id: Uuid,
        #[source]
        error: NodeTransitionError,
    },

    /// The coordinator has no snapshot for the given node ID.
    #[error("node {node_id} not found in run snapshot")]
    NodeNotFound { node_id: Uuid },
}

// ---------------------------------------------------------------------------
// EventLog trait
// ---------------------------------------------------------------------------

/// Append-only log of run events.
///
/// Implemented by the persistence layer in production and by `InMemoryEventLog`
/// in tests. This trait is the injection point that keeps coordinator unit
/// tests free of I/O.
pub trait EventLog: Send {
    /// Append one event to the log.
    fn append(&mut self, event: RunEvent) -> Result<(), String>;

    /// Return a slice of all events appended so far.
    fn events(&self) -> &[RunEvent];
}

// ---------------------------------------------------------------------------
// RunCoordinator
// ---------------------------------------------------------------------------

/// Coordinates execution of a single run.
///
/// Holds the live `RunInstance`, per-node `NodeSnapshot`s, and an injected
/// event log. All state transitions go through the run and node state machines.
pub struct RunCoordinator<L: EventLog> {
    /// The run being coordinated.
    pub run: RunInstance,

    /// Live snapshot of each node's state.
    pub node_snapshots: HashMap<Uuid, NodeSnapshot>,

    event_log: L,

    /// Count of node steps executed so far (used for max_steps guardrail).
    steps_executed: u32,

    /// Wall-clock time when the coordinator was created, used for max_runtime_ms checks.
    started_at: chrono::DateTime<chrono::Utc>,
}

impl<L: EventLog> RunCoordinator<L> {
    /// Create a new coordinator for the given run.
    ///
    /// The run must already be in `Created` state.
    pub fn new(run: RunInstance, event_log: L) -> Self {
        Self {
            run,
            node_snapshots: HashMap::new(),
            event_log,
            steps_executed: 0,
            started_at: Utc::now(),
        }
    }

    /// Return the current run status.
    pub fn run_status(&self) -> &RunStatus {
        &self.run.status
    }

    /// Return the current status of a tracked node, or `None` if unknown.
    pub fn node_status(&self, node_id: &Uuid) -> Option<&NodeStatus> {
        self.node_snapshots.get(node_id).map(|s| &s.status)
    }

    /// Return all events emitted so far.
    pub fn emitted_events(&self) -> &[RunEvent] {
        self.event_log.events()
    }

    /// Drive a run-level state transition, emitting the appropriate event.
    pub fn transition_run(
        &mut self,
        input: RunTransitionInput,
    ) -> Result<RunStatus, StateTransitionError> {
        let (new_status, event_kind) =
            crate::state_machine::try_transition(&self.run.status, input)?;

        self.run.status = new_status.clone();

        let event = RunEvent::from_run_kind(
            self.run.run_id,
            self.run.workflow_id,
            &event_kind,
            None,
            None,
        );
        let _ = self.event_log.append(event);

        Ok(new_status)
    }

    /// Drive a node-level state transition, emitting the appropriate event.
    pub fn transition_node(
        &mut self,
        node_id: Uuid,
        input: NodeTransitionInput,
    ) -> Result<NodeStatus, StateTransitionError> {
        let snapshot = self
            .node_snapshots
            .get(&node_id)
            .ok_or(StateTransitionError::NodeNotFound { node_id })?;

        let (new_status, new_attempt, event_kind) =
            crate::state_machine::node::try_node_transition(&snapshot.status, snapshot.attempt, input)
                .map_err(|e| StateTransitionError::InvalidNodeTransition { node_id, error: e })?;

        let snapshot = self.node_snapshots.get_mut(&node_id).unwrap();
        snapshot.status = new_status.clone();
        snapshot.attempt = new_attempt;

        let event = RunEvent::from_node_kind(
            self.run.run_id,
            self.run.workflow_id,
            node_id,
            &event_kind,
            None,
            None,
        );
        let _ = self.event_log.append(event);

        Ok(new_status)
    }

    /// Mark a node succeeded, emit NodeSucceeded, and advance run state if
    /// all nodes are done.
    pub fn complete_node_success(
        &mut self,
        node_id: Uuid,
        duration_ms: u64,
    ) -> Result<(), StateTransitionError> {
        self.transition_node(node_id, NodeTransitionInput::Succeed { duration_ms })?;

        let now = Utc::now();
        if let Some(snap) = self.node_snapshots.get_mut(&node_id) {
            snap.ended_at = Some(now);
        }

        self.steps_executed += 1;

        // Guardrail: max_steps
        if let Some(max) = self.run.constraints.max_steps {
            let steps = self.steps_executed;
            let warn_threshold = (max as f64 * 0.8) as u32;
            if steps == warn_threshold && steps < max {
                self.emit_guardrail_warning(
                    "max_steps",
                    GuardrailSeverity::High,
                    &format!("Approaching max_steps limit: {}/{}", steps, max),
                    steps as f64,
                    max as f64,
                    Some(node_id),
                );
            }
            if steps >= max {
                self.emit_guardrail_exceeded(
                    "max_steps",
                    &format!("Run exceeded max_steps limit: {}/{}", steps, max),
                    steps as f64,
                    max as f64,
                    "fail_run",
                    Some(node_id),
                );
                if self.run.status == RunStatus::Running {
                    self.transition_run(RunTransitionInput::Fail {
                        reason: format!(
                            "guardrail exceeded: steps_executed={} >= max_steps={}",
                            steps, max
                        ),
                        failed_node_id: Some(node_id),
                        duration_ms: None,
                    })?;
                }
                return Ok(());
            }
        }

        // If all nodes are in terminal states, succeed the run.
        if self.run.status == RunStatus::Running {
            let all_terminal = self.node_snapshots.values().all(|s| {
                matches!(
                    s.status,
                    NodeStatus::Succeeded
                        | NodeStatus::Failed
                        | NodeStatus::Cancelled
                        | NodeStatus::Skipped
                )
            });
            if all_terminal {
                self.transition_run(RunTransitionInput::Succeed {
                    duration_ms: 0,
                    steps_executed: self.steps_executed,
                })?;
            }
        }

        Ok(())
    }

    /// Handle a node failure. If `retries_remaining > 0`, schedule a retry
    /// (NodeFailed → NodeQueued). Otherwise transition the run to Failed.
    pub fn fail_node(
        &mut self,
        node_id: Uuid,
        reason: String,
        retries_remaining: u32,
    ) -> Result<(), StateTransitionError> {
        self.transition_node(
            node_id,
            NodeTransitionInput::Fail {
                reason: reason.clone(),
                duration_ms: None,
            },
        )?;

        if retries_remaining > 0 {
            self.transition_node(
                node_id,
                NodeTransitionInput::ScheduleRetry {
                    reason,
                    delay_ms: 0,
                },
            )?;
        } else if self.run.status == RunStatus::Running {
            self.transition_run(RunTransitionInput::Fail {
                reason: format!("node {} failed: {}", node_id, reason),
                failed_node_id: Some(node_id),
                duration_ms: None,
            })?;
        }

        Ok(())
    }

    /// Pause execution at a HumanReview node. Transitions node to Waiting,
    /// run to Paused, and emits `review.required` with `blocking=true`.
    pub fn pause_for_review(
        &mut self,
        node_id: Uuid,
        reason: Option<String>,
    ) -> Result<(), StateTransitionError> {
        self.transition_node(
            node_id,
            NodeTransitionInput::WaitForReview { reason: reason.clone() },
        )?;

        self.transition_run(RunTransitionInput::Pause {
            reason: reason.clone(),
            waiting_node_ids: vec![node_id],
        })?;

        // Emit review.required event
        let review_event = RunEvent::from_review_kind(
            self.run.run_id,
            self.run.workflow_id,
            node_id,
            &HumanReviewEventKind::Required(ReviewRequiredPayload {
                reason: reason.unwrap_or_else(|| "human review required".to_owned()),
                blocking: true,
                available_actions: vec![
                    "approve".to_owned(),
                    "reject".to_owned(),
                    "retry".to_owned(),
                    "edit_memory".to_owned(),
                ],
            }),
            None,
            None,
        );
        let _ = self.event_log.append(review_event);

        Ok(())
    }

    /// Approve a paused review node. Emits `review.approved`, transitions
    /// node Waiting→Running→Succeeded, and resumes the run.
    pub fn approve_review(
        &mut self,
        node_id: Uuid,
        comment: Option<String>,
    ) -> Result<(), StateTransitionError> {
        // Emit review.approved event
        let review_event = RunEvent::from_review_kind(
            self.run.run_id,
            self.run.workflow_id,
            node_id,
            &HumanReviewEventKind::Approved(ReviewApprovedPayload {
                comment: comment.clone(),
            }),
            None,
            None,
        );
        let _ = self.event_log.append(review_event);

        let workspace_root = self.run.workspace_root.clone();

        // Waiting → Running
        self.transition_node(
            node_id,
            NodeTransitionInput::Resume {
                node_type: "human_review".to_owned(),
                input_refs: vec![],
                workspace_root,
            },
        )?;

        // Resume the run (Paused → Running)
        self.transition_run(RunTransitionInput::Resume {
            resumed_by: comment,
        })?;

        // Running → Succeeded (the review node's work is complete)
        self.complete_node_success(node_id, 0)?;

        Ok(())
    }

    /// Reject a paused review node. Emits `review.rejected`, transitions
    /// node to Failed, and fails the run.
    pub fn reject_review(
        &mut self,
        node_id: Uuid,
        reason: String,
    ) -> Result<(), StateTransitionError> {
        // Emit review.rejected event
        let review_event = RunEvent::from_review_kind(
            self.run.run_id,
            self.run.workflow_id,
            node_id,
            &HumanReviewEventKind::Rejected(ReviewRejectedPayload {
                reason: reason.clone(),
            }),
            None,
            None,
        );
        let _ = self.event_log.append(review_event);

        // Resume run first so we can fail from Running state
        self.transition_run(RunTransitionInput::Resume { resumed_by: None })?;

        // Waiting → Running → Failed
        let workspace_root = self.run.workspace_root.clone();
        self.transition_node(
            node_id,
            NodeTransitionInput::Resume {
                node_type: "human_review".to_owned(),
                input_refs: vec![],
                workspace_root,
            },
        )?;

        // Fail the node (no retries for rejection)
        self.fail_node(node_id, reason, 0)?;

        Ok(())
    }

    /// Retry: emits `review.retry_requested`, resumes the run, and
    /// re-queues the target node for another execution attempt.
    pub fn retry_review(
        &mut self,
        review_node_id: Uuid,
        target_node_id: Uuid,
        comment: Option<String>,
    ) -> Result<(), StateTransitionError> {
        // Emit review.retry_requested event
        let review_event = RunEvent::from_review_kind(
            self.run.run_id,
            self.run.workflow_id,
            review_node_id,
            &HumanReviewEventKind::RetryRequested(ReviewRetryRequestedPayload {
                target_node_id: target_node_id.to_string(),
                comment,
            }),
            None,
            None,
        );
        let _ = self.event_log.append(review_event);

        // Resume the run (Paused → Running)
        self.transition_run(RunTransitionInput::Resume { resumed_by: None })?;

        // Resume the review node (Waiting → Running) then succeed it
        let workspace_root = self.run.workspace_root.clone();
        self.transition_node(
            review_node_id,
            NodeTransitionInput::Resume {
                node_type: "human_review".to_owned(),
                input_refs: vec![],
                workspace_root,
            },
        )?;
        self.transition_node(
            review_node_id,
            NodeTransitionInput::Succeed { duration_ms: 0 },
        )?;

        // Re-queue the target node: Failed → Queued via ScheduleRetry
        let target_snapshot = self
            .node_snapshots
            .get(&target_node_id)
            .ok_or(StateTransitionError::NodeNotFound { node_id: target_node_id })?;

        if target_snapshot.status == NodeStatus::Failed {
            self.transition_node(
                target_node_id,
                NodeTransitionInput::ScheduleRetry {
                    reason: "retry requested via human review".to_owned(),
                    delay_ms: 0,
                },
            )?;
        }

        Ok(())
    }

    /// Transition a node to Skipped. Valid from Ready or Queued states.
    pub fn skip_node(&mut self, node_id: Uuid) -> Result<(), StateTransitionError> {
        self.transition_node(node_id, NodeTransitionInput::Skip { reason: None }).map(|_| ())
    }

    /// Append a pre-built event to the event log (used for routing events).
    pub fn emit_event(&mut self, event: RunEvent) {
        let _ = self.event_log.append(event);
    }

    /// Cancel the run. Valid from Running or Paused states.
    pub fn cancel(&mut self, reason: Option<String>) -> Result<(), StateTransitionError> {
        self.transition_run(RunTransitionInput::Cancel {
            reason,
            duration_ms: None,
        })?;

        Ok(())
    }

    /// Returns the elapsed milliseconds since the coordinator was created.
    pub fn elapsed_ms(&self) -> u64 {
        let elapsed = Utc::now().signed_duration_since(self.started_at);
        elapsed.num_milliseconds().max(0) as u64
    }

    /// Emit a `guardrail.warning` event.
    pub fn emit_guardrail_warning(
        &mut self,
        guardrail: &str,
        severity: GuardrailSeverity,
        message: &str,
        current_value: f64,
        threshold: f64,
        node_id: Option<Uuid>,
    ) {
        let event = RunEvent::from_guardrail_kind(
            self.run.run_id,
            self.run.workflow_id,
            node_id,
            &GuardrailEventKind::Warning(GuardrailWarningPayload {
                guardrail: guardrail.to_owned(),
                severity,
                message: message.to_owned(),
                current_value,
                threshold,
            }),
            None,
            None,
        );
        let _ = self.event_log.append(event);
    }

    /// Emit a `guardrail.exceeded` event.
    pub fn emit_guardrail_exceeded(
        &mut self,
        guardrail: &str,
        message: &str,
        final_value: f64,
        threshold: f64,
        enforcement_action: &str,
        node_id: Option<Uuid>,
    ) {
        let event = RunEvent::from_guardrail_kind(
            self.run.run_id,
            self.run.workflow_id,
            node_id,
            &GuardrailEventKind::Exceeded(GuardrailExceededPayload {
                guardrail: guardrail.to_owned(),
                message: message.to_owned(),
                final_value,
                threshold,
                enforcement_action: enforcement_action.to_owned(),
            }),
            None,
            None,
        );
        let _ = self.event_log.append(event);
    }
}
