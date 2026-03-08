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
            if self.steps_executed >= max {
                if self.run.status == RunStatus::Running {
                    self.transition_run(RunTransitionInput::Fail {
                        reason: format!(
                            "guardrail exceeded: steps_executed={} >= max_steps={}",
                            self.steps_executed, max
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
    /// run to Paused, and emits HumanReviewRequested.
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
            reason,
            waiting_node_ids: vec![node_id],
        })?;

        Ok(())
    }

    /// Approve a paused review node. Transitions node back to Running and
    /// run to Running.
    pub fn approve_review(&mut self, node_id: Uuid) -> Result<(), StateTransitionError> {
        let workspace_root = self.run.workspace_root.clone();

        self.transition_node(
            node_id,
            NodeTransitionInput::Resume {
                node_type: "human_review".to_owned(),
                input_refs: vec![],
                workspace_root,
            },
        )?;

        self.transition_run(RunTransitionInput::Resume { resumed_by: None })?;

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
}
