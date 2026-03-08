// Workflow validation.
// Validates a WorkflowDefinition before execution begins.
// See ARCHITECTURE.md §7.1 and CLAUDE.md Rule C.

use std::collections::{HashMap, HashSet, VecDeque};
use thiserror::Error;
use uuid::Uuid;
use workflow_model::node::NodeKind;
use workflow_model::workflow::WorkflowDefinition;

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/// All possible validation failures for a WorkflowDefinition.
///
/// These variants are the canonical error vocabulary for the validator.
#[derive(Debug, Clone, PartialEq, Eq, Error, serde::Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ValidationError {
    #[error("workflow has no start node; exactly one Start node is required")]
    NoStartNode,

    #[error("workflow has no end node; at least one End node is required")]
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
// ValidationResult
// ---------------------------------------------------------------------------

/// Serializable result of workflow validation, suitable for returning to the
/// frontend via the Tauri IPC bridge.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ValidationResult {
    pub is_valid: bool,
    pub errors: Vec<ValidationError>,
}

impl ValidationResult {
    pub fn ok() -> Self {
        Self { is_valid: true, errors: vec![] }
    }

    pub fn from_errors(errors: Vec<ValidationError>) -> Self {
        Self { is_valid: false, errors }
    }
}

// ---------------------------------------------------------------------------
// WorkflowValidator
// ---------------------------------------------------------------------------

/// Validates a WorkflowDefinition against the v1 graph rules.
///
/// Implemented as a stateless struct so it can be injected and tested.
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
    /// Rules checked:
    /// 1. Exactly one Start node.
    /// 2. At least one End node.
    /// 3. All edge source/target node IDs exist in the node list.
    /// 4. No cycles (DAG requirement).
    /// 5. No unreachable nodes from the Start node (forward-reachability).
    pub fn validate(&self, workflow: &WorkflowDefinition) -> Result<(), Vec<ValidationError>> {
        let mut errors = Vec::new();

        // --- Build node ID set ---
        let node_ids: HashSet<Uuid> = workflow.nodes.iter().map(|n| n.node_id).collect();

        // --- Rule 1 & 2: Start and End node counts ---
        let start_nodes: Vec<Uuid> = workflow
            .nodes
            .iter()
            .filter(|n| n.node_type == NodeKind::Start)
            .map(|n| n.node_id)
            .collect();
        let end_count = workflow
            .nodes
            .iter()
            .filter(|n| n.node_type == NodeKind::End)
            .count();

        match start_nodes.len() {
            0 => errors.push(ValidationError::NoStartNode),
            1 => {} // OK
            n => errors.push(ValidationError::MultipleStartNodes { count: n }),
        }

        if end_count == 0 {
            errors.push(ValidationError::NoEndNode);
        }

        // --- Rule 3: Edge references ---
        for edge in &workflow.edges {
            if !node_ids.contains(&edge.source_node_id) {
                errors.push(ValidationError::InvalidEdgeReference {
                    edge_id: edge.edge_id,
                    missing_node_id: edge.source_node_id,
                });
            }
            if !node_ids.contains(&edge.target_node_id) {
                errors.push(ValidationError::InvalidEdgeReference {
                    edge_id: edge.edge_id,
                    missing_node_id: edge.target_node_id,
                });
            }
        }

        // --- Build adjacency and in-degree for valid edges only ---
        let mut adj: HashMap<Uuid, Vec<Uuid>> = HashMap::new();
        let mut in_degree: HashMap<Uuid, usize> = HashMap::new();
        for &id in &node_ids {
            adj.entry(id).or_default();
            in_degree.entry(id).or_insert(0);
        }
        for edge in &workflow.edges {
            if node_ids.contains(&edge.source_node_id)
                && node_ids.contains(&edge.target_node_id)
            {
                adj.entry(edge.source_node_id)
                    .or_default()
                    .push(edge.target_node_id);
                *in_degree.entry(edge.target_node_id).or_insert(0) += 1;
            }
        }

        // --- Rule 4: Cycle detection (Kahn's algorithm) ---
        let mut queue: VecDeque<Uuid> = in_degree
            .iter()
            .filter(|(_, &d)| d == 0)
            .map(|(&id, _)| id)
            .collect();
        let mut topo_in_degree = in_degree.clone();
        let mut visited_count = 0;
        while let Some(node_id) = queue.pop_front() {
            visited_count += 1;
            if let Some(neighbors) = adj.get(&node_id) {
                for &neighbor in neighbors {
                    let deg = topo_in_degree.get_mut(&neighbor).unwrap();
                    *deg -= 1;
                    if *deg == 0 {
                        queue.push_back(neighbor);
                    }
                }
            }
        }
        if visited_count < node_ids.len() {
            let cycle_nodes: Vec<Uuid> = topo_in_degree
                .iter()
                .filter(|(_, &d)| d > 0)
                .map(|(&id, _)| id)
                .collect();
            errors.push(ValidationError::CycleDetected { node_ids: cycle_nodes });
        }

        // --- Rule 5: Unreachable nodes (BFS from start) ---
        // Only meaningful when we have exactly one start node.
        if start_nodes.len() == 1 {
            let start_id = start_nodes[0];
            let mut reachable: HashSet<Uuid> = HashSet::new();
            let mut bfs: VecDeque<Uuid> = VecDeque::new();
            bfs.push_back(start_id);
            reachable.insert(start_id);
            while let Some(current) = bfs.pop_front() {
                if let Some(neighbors) = adj.get(&current) {
                    for &neighbor in neighbors {
                        if reachable.insert(neighbor) {
                            bfs.push_back(neighbor);
                        }
                    }
                }
            }
            for &id in &node_ids {
                if !reachable.contains(&id) {
                    errors.push(ValidationError::UnreachableNode { node_id: id });
                }
            }
        }

        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors)
        }
    }

    /// Validate and return a serializable `ValidationResult` suitable for
    /// returning to the frontend via the Tauri IPC bridge.
    pub fn validate_to_result(&self, workflow: &WorkflowDefinition) -> ValidationResult {
        match self.validate(workflow) {
            Ok(()) => ValidationResult::ok(),
            Err(errors) => ValidationResult::from_errors(errors),
        }
    }
}

impl Default for WorkflowValidator {
    fn default() -> Self {
        Self::new()
    }
}
