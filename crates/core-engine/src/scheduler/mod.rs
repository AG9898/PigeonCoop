// Run scheduler.
// Determines which nodes are eligible for execution based on the workflow
// graph topology and current node snapshot states.
// See ARCHITECTURE.md §7.1 and CLAUDE.md Rule E.

use std::collections::{HashMap, HashSet};
use uuid::Uuid;
use workflow_model::run::{NodeSnapshot, NodeStatus};
use workflow_model::workflow::WorkflowDefinition;

// ---------------------------------------------------------------------------
// RunScheduler
// ---------------------------------------------------------------------------

/// Determines which workflow nodes are eligible to execute next.
///
/// A node is eligible when all of its predecessor nodes have `Succeeded` (or
/// are `Skipped` for branches that were not taken). The scheduler is stateless
/// — it reads the current snapshot map and the static workflow graph on every
/// call.
pub struct RunScheduler;

impl RunScheduler {
    pub fn new() -> Self {
        Self
    }

    /// Return the IDs of nodes that should be queued next.
    ///
    /// A node is ready when:
    /// 1. Its current snapshot status is `Ready` (not yet queued or running).
    /// 2. All predecessor nodes (those with an edge pointing to this node) are
    ///    in a terminal state: `Succeeded` or `Skipped`.
    ///
    /// Nodes with no predecessors (e.g. the Start node) become ready
    /// immediately when their snapshot is in `Ready` state.
    pub fn next_ready_nodes(
        &self,
        workflow: &WorkflowDefinition,
        snapshots: &HashMap<Uuid, NodeSnapshot>,
    ) -> Vec<Uuid> {
        // Build reverse adjacency: node_id → set of predecessor node_ids
        let mut predecessors: HashMap<Uuid, HashSet<Uuid>> = HashMap::new();
        for node in &workflow.nodes {
            predecessors.entry(node.node_id).or_default();
        }
        for edge in &workflow.edges {
            predecessors
                .entry(edge.target_node_id)
                .or_default()
                .insert(edge.source_node_id);
        }

        let mut ready = Vec::new();

        for (node_id, preds) in &predecessors {
            let snapshot = match snapshots.get(node_id) {
                Some(s) => s,
                None => continue,
            };

            // Only consider nodes currently in Ready state
            if snapshot.status != NodeStatus::Ready {
                continue;
            }

            // All predecessors must be in a terminal state.
            // Failed is included so that OnFailure-routed successors can be picked up
            // after the routing evaluator has already Skipped the non-matching targets.
            let all_preds_done = preds.iter().all(|pred_id| {
                snapshots.get(pred_id).map_or(false, |s| {
                    matches!(
                        s.status,
                        NodeStatus::Succeeded
                            | NodeStatus::Skipped
                            | NodeStatus::Failed
                            | NodeStatus::Cancelled
                    )
                })
            });

            if all_preds_done {
                ready.push(*node_id);
            }
        }

        ready
    }

    /// Return the topological execution order for all nodes in the workflow.
    ///
    /// Uses Kahn's algorithm. Returns `None` if the graph contains a cycle
    /// (which the validator should have already caught).
    pub fn topological_order(&self, workflow: &WorkflowDefinition) -> Option<Vec<Uuid>> {
        let mut in_degree: HashMap<Uuid, usize> = HashMap::new();
        let mut adj: HashMap<Uuid, Vec<Uuid>> = HashMap::new();

        for node in &workflow.nodes {
            in_degree.entry(node.node_id).or_insert(0);
            adj.entry(node.node_id).or_default();
        }

        for edge in &workflow.edges {
            *in_degree.entry(edge.target_node_id).or_insert(0) += 1;
            adj.entry(edge.source_node_id)
                .or_default()
                .push(edge.target_node_id);
        }

        let mut queue: std::collections::VecDeque<Uuid> = in_degree
            .iter()
            .filter(|(_, &d)| d == 0)
            .map(|(&id, _)| id)
            .collect();

        let mut order = Vec::new();
        let mut degrees = in_degree.clone();

        while let Some(node_id) = queue.pop_front() {
            order.push(node_id);
            if let Some(neighbors) = adj.get(&node_id) {
                for &neighbor in neighbors {
                    let deg = degrees.get_mut(&neighbor).unwrap();
                    *deg -= 1;
                    if *deg == 0 {
                        queue.push_back(neighbor);
                    }
                }
            }
        }

        if order.len() == workflow.nodes.len() {
            Some(order)
        } else {
            None // cycle detected
        }
    }
}

impl Default for RunScheduler {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use workflow_model::node::{NodeDefinition, NodeKind};
    use workflow_model::edge::EdgeDefinition;
    use workflow_model::workflow::WorkflowDefinition;
    use workflow_model::run::RunConstraints;
    use workflow_model::node_config::NodeConfig;

    fn make_node(node_id: Uuid, kind: NodeKind) -> NodeDefinition {
        NodeDefinition {
            node_id,
            node_type: kind,
            label: "test".into(),
            config: NodeConfig::Start(workflow_model::node_config::StartNodeConfig {}),
            input_contract: serde_json::Value::Null,
            output_contract: serde_json::Value::Null,
            memory_access: serde_json::Value::Null,
            retry_policy: workflow_model::node::RetryPolicy { max_retries: 0, max_runtime_ms: None },
            display: workflow_model::node::NodeDisplay { x: 0.0, y: 0.0 },
        }
    }

    fn make_edge(source: Uuid, target: Uuid) -> EdgeDefinition {
        EdgeDefinition {
            edge_id: Uuid::new_v4(),
            source_node_id: source,
            target_node_id: target,
            condition_kind: workflow_model::edge::ConditionKind::Always,
            condition_payload: None,
            label: None,
        }
    }

    fn make_workflow(nodes: Vec<NodeDefinition>, edges: Vec<EdgeDefinition>) -> WorkflowDefinition {
        WorkflowDefinition {
            workflow_id: Uuid::new_v4(),
            name: "test".into(),
            schema_version: workflow_model::workflow::CURRENT_SCHEMA_VERSION,
            version: 1,
            metadata: serde_json::Value::Null,
            nodes,
            edges,
            default_constraints: RunConstraints::default(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    fn snapshot(node_id: Uuid, status: NodeStatus) -> NodeSnapshot {
        NodeSnapshot {
            node_id,
            status,
            attempt: 1,
            started_at: None,
            ended_at: None,
            output: None,
        }
    }

    // -----------------------------------------------------------------------
    // next_ready_nodes
    // -----------------------------------------------------------------------

    /// Start node has no predecessors — it should be immediately ready.
    #[test]
    fn start_node_with_no_predecessors_is_ready() {
        let start_id = Uuid::new_v4();
        let workflow = make_workflow(
            vec![make_node(start_id, NodeKind::Start)],
            vec![],
        );
        let mut snapshots = HashMap::new();
        snapshots.insert(start_id, snapshot(start_id, NodeStatus::Ready));

        let scheduler = RunScheduler::new();
        let ready = scheduler.next_ready_nodes(&workflow, &snapshots);
        assert_eq!(ready, vec![start_id]);
    }

    /// A downstream node should not be ready until its predecessor has Succeeded.
    #[test]
    fn downstream_node_not_ready_until_predecessor_succeeds() {
        let start_id = Uuid::new_v4();
        let tool_id = Uuid::new_v4();
        let workflow = make_workflow(
            vec![
                make_node(start_id, NodeKind::Start),
                make_node(tool_id, NodeKind::Tool),
            ],
            vec![make_edge(start_id, tool_id)],
        );

        let mut snapshots = HashMap::new();
        snapshots.insert(start_id, snapshot(start_id, NodeStatus::Running));
        snapshots.insert(tool_id, snapshot(tool_id, NodeStatus::Ready));

        let scheduler = RunScheduler::new();
        let ready = scheduler.next_ready_nodes(&workflow, &snapshots);
        // tool_id must not be ready while start is still Running
        assert!(!ready.contains(&tool_id));
    }

    #[test]
    fn downstream_node_ready_after_predecessor_succeeds() {
        let start_id = Uuid::new_v4();
        let tool_id = Uuid::new_v4();
        let workflow = make_workflow(
            vec![
                make_node(start_id, NodeKind::Start),
                make_node(tool_id, NodeKind::Tool),
            ],
            vec![make_edge(start_id, tool_id)],
        );

        let mut snapshots = HashMap::new();
        snapshots.insert(start_id, snapshot(start_id, NodeStatus::Succeeded));
        snapshots.insert(tool_id, snapshot(tool_id, NodeStatus::Ready));

        let scheduler = RunScheduler::new();
        let ready = scheduler.next_ready_nodes(&workflow, &snapshots);
        assert!(ready.contains(&tool_id));
    }

    /// A node with multiple predecessors is only ready when ALL predecessors are done.
    #[test]
    fn node_with_two_predecessors_requires_both_to_succeed() {
        let a_id = Uuid::new_v4();
        let b_id = Uuid::new_v4();
        let c_id = Uuid::new_v4(); // depends on both a and b
        let workflow = make_workflow(
            vec![
                make_node(a_id, NodeKind::Start),
                make_node(b_id, NodeKind::Tool),
                make_node(c_id, NodeKind::End),
            ],
            vec![make_edge(a_id, c_id), make_edge(b_id, c_id)],
        );

        // Only a has succeeded; b is still running
        let mut snapshots = HashMap::new();
        snapshots.insert(a_id, snapshot(a_id, NodeStatus::Succeeded));
        snapshots.insert(b_id, snapshot(b_id, NodeStatus::Running));
        snapshots.insert(c_id, snapshot(c_id, NodeStatus::Ready));

        let scheduler = RunScheduler::new();
        let ready = scheduler.next_ready_nodes(&workflow, &snapshots);
        assert!(!ready.contains(&c_id), "c must not be ready while b is still running");

        // Now b also succeeds
        let mut snapshots2 = snapshots.clone();
        snapshots2.insert(b_id, snapshot(b_id, NodeStatus::Succeeded));
        let ready2 = scheduler.next_ready_nodes(&workflow, &snapshots2);
        assert!(ready2.contains(&c_id), "c must be ready once both predecessors succeed");
    }

    // -----------------------------------------------------------------------
    // topological_order
    // -----------------------------------------------------------------------

    /// A linear graph start → tool → end should yield that order.
    #[test]
    fn topological_order_linear_graph() {
        let start_id = Uuid::new_v4();
        let tool_id = Uuid::new_v4();
        let end_id = Uuid::new_v4();
        let workflow = make_workflow(
            vec![
                make_node(start_id, NodeKind::Start),
                make_node(tool_id, NodeKind::Tool),
                make_node(end_id, NodeKind::End),
            ],
            vec![
                make_edge(start_id, tool_id),
                make_edge(tool_id, end_id),
            ],
        );

        let scheduler = RunScheduler::new();
        let order = scheduler.topological_order(&workflow).expect("acyclic graph must produce order");
        assert_eq!(order.len(), 3);
        // start must come before tool, tool before end
        let pos: HashMap<Uuid, usize> = order.iter().enumerate().map(|(i, &id)| (id, i)).collect();
        assert!(pos[&start_id] < pos[&tool_id]);
        assert!(pos[&tool_id] < pos[&end_id]);
    }
}
