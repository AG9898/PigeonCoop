// Workflow validation.
// Validates a WorkflowDefinition before execution begins.
// ENGINE-003 must implement the validate() method.
// See ARCHITECTURE.md §7.1 and CLAUDE.md Rule C.

use thiserror::Error;
use uuid::Uuid;
use workflow_model::workflow::WorkflowDefinition;

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/// All possible validation failures for a WorkflowDefinition.
///
/// These variants are the canonical error vocabulary for the validator.
/// ENGINE-003 must return these when it detects violations.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum ValidationError {
    #[error("workflow has no start node; exactly one Start node is required")]
    NoStartNode,

    #[error("workflow has no end node; exactly one End node is required")]
    NoEndNode,

    #[error("workflow has {count} start nodes; exactly one is required")]
    MultipleStartNodes { count: usize },

    #[error("workflow has {count} end nodes; exactly one is required")]
    MultipleEndNodes { count: usize },

    #[error("workflow contains a cycle involving nodes: {node_ids:?}")]
    CycleDetected { node_ids: Vec<Uuid> },

    #[error("edge {edge_id} references non-existent node {missing_node_id}")]
    InvalidEdgeReference { edge_id: Uuid, missing_node_id: Uuid },

    /// An unreachable node is one that cannot be reached from the start node
    /// following forward edges. Policy: this is a hard error in v1.
    /// See DECISIONS.md — "Unreachable node policy".
    #[error("node {node_id} is unreachable from the start node")]
    UnreachableNode { node_id: Uuid },
}

// ---------------------------------------------------------------------------
// WorkflowValidator
// ---------------------------------------------------------------------------

/// Validates a WorkflowDefinition against the v1 graph rules.
///
/// Implemented as a stateless struct so it can be injected and tested.
/// ENGINE-003 must implement `validate()`.
pub struct WorkflowValidator;

impl WorkflowValidator {
    pub fn new() -> Self {
        Self
    }

    /// Validate a workflow definition.
    ///
    /// Returns `Ok(())` if all rules pass, or `Err(Vec<ValidationError>)`
    /// containing every violation found (not just the first).
    ///
    /// ENGINE-003 must implement this method.
    pub fn validate(&self, _workflow: &WorkflowDefinition) -> Result<(), Vec<ValidationError>> {
        todo!("ENGINE-003: implement workflow validation logic")
    }
}

impl Default for WorkflowValidator {
    fn default() -> Self {
        Self::new()
    }
}
