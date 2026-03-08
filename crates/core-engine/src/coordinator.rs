// Run coordinator.
// Owns the runtime state of a single run: drives both the run-level and
// node-level state machines, emits events, and enforces retry/guardrail policy.
// ENGINE-004 must implement the core methods.
// See ARCHITECTURE.md §4, §7 and CLAUDE.md Rules A, D, E.

use std::collections::HashMap;
use thiserror::Error;
use uuid::Uuid;
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
/// ENGINE-004 must return these from its transition methods.
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
/// event log. All public methods that drive state transitions are stubs until
/// ENGINE-004 implements them.
pub struct RunCoordinator<L: EventLog> {
    /// The run being coordinated. ENGINE-004 must update `run.status` on every
    /// run-level transition.
    pub run: RunInstance,

    /// Live snapshot of each node's state. ENGINE-004 must insert snapshots
    /// for all workflow nodes during initialisation and update them on every
    /// node-level transition.
    pub node_snapshots: HashMap<Uuid, NodeSnapshot>,

    event_log: L,
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
    ///
    /// ENGINE-004 must implement this.
    pub fn transition_run(
        &mut self,
        input: RunTransitionInput,
    ) -> Result<RunStatus, StateTransitionError> {
        todo!("ENGINE-004: implement run state transition with event emission")
    }

    /// Drive a node-level state transition, emitting the appropriate event.
    ///
    /// ENGINE-004 must implement this.
    pub fn transition_node(
        &mut self,
        node_id: Uuid,
        input: NodeTransitionInput,
    ) -> Result<NodeStatus, StateTransitionError> {
        todo!("ENGINE-004: implement node state transition with event emission")
    }

    /// Mark a node succeeded, emit NodeSucceeded, and advance run state if
    /// all nodes are done.
    ///
    /// ENGINE-004 must implement this.
    pub fn complete_node_success(
        &mut self,
        node_id: Uuid,
        duration_ms: u64,
    ) -> Result<(), StateTransitionError> {
        todo!("ENGINE-004: implement node completion and run advancement")
    }

    /// Handle a node failure. If `retries_remaining > 0`, schedule a retry
    /// (NodeFailed → NodeQueued). Otherwise transition the run to Failed.
    ///
    /// ENGINE-004 must implement this.
    pub fn fail_node(
        &mut self,
        node_id: Uuid,
        reason: String,
        retries_remaining: u32,
    ) -> Result<(), StateTransitionError> {
        todo!("ENGINE-004: implement node failure handling with retry policy")
    }

    /// Pause execution at a HumanReview node. Transitions node to Waiting,
    /// run to Paused, and emits HumanReviewRequested.
    ///
    /// ENGINE-004 must implement this.
    pub fn pause_for_review(
        &mut self,
        node_id: Uuid,
        reason: Option<String>,
    ) -> Result<(), StateTransitionError> {
        todo!("ENGINE-004: implement human review pause")
    }

    /// Approve a paused review node. Transitions node back to Running and
    /// run to Running.
    ///
    /// ENGINE-004 must implement this.
    pub fn approve_review(&mut self, node_id: Uuid) -> Result<(), StateTransitionError> {
        todo!("ENGINE-004: implement review approval and run resumption")
    }

    /// Cancel the run. Valid from Running or Paused states.
    ///
    /// ENGINE-004 must implement this.
    pub fn cancel(&mut self, reason: Option<String>) -> Result<(), StateTransitionError> {
        todo!("ENGINE-004: implement run cancellation")
    }
}
