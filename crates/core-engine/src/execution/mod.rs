// Run execution module.
// Connects the scheduler, coordinator, and runtime adapters to drive a full
// workflow run asynchronously.
// See ARCHITECTURE.md §7, §8 and CLAUDE.md Rules A, D, E.

use uuid::Uuid;
use workflow_model::workflow::WorkflowDefinition;
use workflow_model::edge::{ConditionKind, EdgeDefinition};
use workflow_model::run::NodeStatus;
use event_model::guardrail_events::GuardrailSeverity;
use event_model::event::RunEvent;
use event_model::routing_events::{
    EdgeRoutedPayload, RouterBranchSelectedPayload, RouterEvaluatedPayload,
    RouterNoMatchPayload, RoutingEventKind,
};
use crate::coordinator::{EventLog, RunCoordinator};
use crate::scheduler::RunScheduler;
use crate::state_machine::node::NodeTransitionInput;
use crate::state_machine::RunTransitionInput;

// ---------------------------------------------------------------------------
// RouterEvaluator
// ---------------------------------------------------------------------------

/// Result of evaluating outgoing edges for a completed node.
pub enum RouteDecision {
    /// One or more edges were active. `skipped_node_ids` are the target nodes
    /// of non-selected edges that should be transitioned to Skipped.
    Routed {
        selected_edge_ids: Vec<Uuid>,
        skipped_node_ids: Vec<Uuid>,
        reason: String,
    },
    /// There were outgoing edges but none matched the current node status.
    /// The run should be failed.
    NoMatch { reason: String },
}

/// Evaluates conditional outgoing edges to determine which downstream nodes
/// are activated and which should be skipped.
///
/// All condition evaluation is deterministic and requires no I/O.
pub struct RouterEvaluator;

impl RouterEvaluator {
    /// Evaluate `outgoing_edges` from a node that completed with `source_status`.
    ///
    /// `source_output` is the node's persisted output value, used for
    /// `Expression` condition matching.
    pub fn evaluate(
        source_status: &NodeStatus,
        source_output: Option<&serde_json::Value>,
        outgoing_edges: &[&EdgeDefinition],
    ) -> RouteDecision {
        if outgoing_edges.is_empty() {
            return RouteDecision::Routed {
                selected_edge_ids: vec![],
                skipped_node_ids: vec![],
                reason: "terminal node (no outgoing edges)".to_owned(),
            };
        }

        let mut selected: Vec<(Uuid, Uuid, String)> = Vec::new(); // (edge_id, target_node_id, reason)
        let mut skipped: Vec<Uuid> = Vec::new();

        for edge in outgoing_edges {
            if let Some(reason) = Self::eval_condition(edge, source_status, source_output) {
                selected.push((edge.edge_id, edge.target_node_id, reason));
            } else {
                skipped.push(edge.target_node_id);
            }
        }

        if selected.is_empty() {
            RouteDecision::NoMatch {
                reason: format!(
                    "no outgoing edge condition matched for source status {:?}",
                    source_status
                ),
            }
        } else {
            let reason = selected
                .iter()
                .map(|(_, _, r)| r.as_str())
                .collect::<Vec<_>>()
                .join("; ");
            RouteDecision::Routed {
                selected_edge_ids: selected.iter().map(|(eid, _, _)| *eid).collect(),
                skipped_node_ids: skipped,
                reason,
            }
        }
    }

    /// Returns `Some(reason)` if the edge condition is satisfied, `None` otherwise.
    fn eval_condition(
        edge: &EdgeDefinition,
        source_status: &NodeStatus,
        source_output: Option<&serde_json::Value>,
    ) -> Option<String> {
        match &edge.condition_kind {
            ConditionKind::Always => Some("always".to_owned()),
            ConditionKind::OnSuccess => {
                if matches!(source_status, NodeStatus::Succeeded) {
                    Some("on_success: source node succeeded".to_owned())
                } else {
                    None
                }
            }
            ConditionKind::OnFailure => {
                if matches!(source_status, NodeStatus::Failed) {
                    Some("on_failure: source node failed".to_owned())
                } else {
                    None
                }
            }
            ConditionKind::Expression => {
                Self::eval_expression(edge.condition_payload.as_ref(), source_output)
            }
        }
    }

    /// Evaluate an expression condition payload against the source node's output.
    ///
    /// Supported format: `{"key": "<key>", "equals": <value>}`
    ///
    /// Returns `Some(reason)` on match, `None` on no match or missing data.
    fn eval_expression(
        payload: Option<&serde_json::Value>,
        output: Option<&serde_json::Value>,
    ) -> Option<String> {
        let payload = payload?;
        let output = output?;

        let key = payload.get("key")?.as_str()?;
        let expected = payload.get("equals")?;

        if output.get(key).map_or(false, |v| v == expected) {
            Some(format!("expression matched: {}={}", key, expected))
        } else {
            None
        }
    }
}

// ---------------------------------------------------------------------------
// ExecutionDriver
// ---------------------------------------------------------------------------

/// Drives a workflow run from Ready state to completion.
///
/// Responsibilities:
/// - Uses `RunScheduler` to determine which nodes are eligible at each step.
/// - Calls the `NodeExecutor` trait to dispatch node work.
/// - Routes results back through `RunCoordinator` for state transitions and
///   event emission.
///
/// This struct is designed for testability: `NodeExecutor` is injected, so
/// tests can use a mock executor without spawning real subprocesses.
pub struct ExecutionDriver<'a, L: EventLog, E: NodeExecutor> {
    coordinator: &'a mut RunCoordinator<L>,
    scheduler: RunScheduler,
    executor: E,
}

impl<'a, L: EventLog, E: NodeExecutor> ExecutionDriver<'a, L, E> {
    pub fn new(coordinator: &'a mut RunCoordinator<L>, executor: E) -> Self {
        Self {
            coordinator,
            scheduler: RunScheduler::new(),
            executor,
        }
    }

    /// Advance the run by one scheduling step.
    ///
    /// Finds all nodes that are currently eligible (predecessors Succeeded),
    /// queues them, and dispatches execution. Returns the list of node IDs that
    /// were dispatched in this step.
    pub async fn step(&mut self, workflow: &WorkflowDefinition) -> Vec<Uuid> {
        // Guardrail: max_runtime_ms — checked before dispatching each step.
        if let Some(max_ms) = self.coordinator.run.constraints.max_runtime_ms {
            let elapsed = self.coordinator.elapsed_ms();
            let warn_threshold = (max_ms as f64 * 0.8) as u64;
            if elapsed >= warn_threshold && elapsed < max_ms {
                self.coordinator.emit_guardrail_warning(
                    "max_runtime_ms",
                    GuardrailSeverity::High,
                    &format!("Approaching max_runtime_ms limit: {}ms / {}ms", elapsed, max_ms),
                    elapsed as f64,
                    max_ms as f64,
                    None,
                );
            }
            if elapsed >= max_ms {
                self.coordinator.emit_guardrail_exceeded(
                    "max_runtime_ms",
                    &format!("Run exceeded max_runtime_ms limit: {}ms / {}ms", elapsed, max_ms),
                    elapsed as f64,
                    max_ms as f64,
                    "fail_run",
                    None,
                );
                use workflow_model::run::RunStatus;
                if self.coordinator.run_status() == &RunStatus::Running {
                    let _ = self.coordinator.transition_run(crate::state_machine::RunTransitionInput::Fail {
                        reason: format!(
                            "guardrail exceeded: elapsed_ms={} >= max_runtime_ms={}",
                            elapsed, max_ms
                        ),
                        failed_node_id: None,
                        duration_ms: Some(elapsed),
                    });
                }
                return vec![];
            }
        }

        let ready = self
            .scheduler
            .next_ready_nodes(workflow, &self.coordinator.node_snapshots);

        let mut dispatched = Vec::new();

        for node_id in ready {
            // Transition: Ready → Queued
            if self
                .coordinator
                .transition_node(
                    node_id,
                    NodeTransitionInput::Queue {
                        node_type: node_type_for(workflow, node_id),
                    },
                )
                .is_err()
            {
                continue;
            }

            // Transition: Queued → Running
            if self
                .coordinator
                .transition_node(
                    node_id,
                    NodeTransitionInput::Start {
                        node_type: node_type_for(workflow, node_id),
                        input_refs: vec![],
                        workspace_root: self.coordinator.run.workspace_root.clone(),
                    },
                )
                .is_err()
            {
                continue;
            }

            // Dispatch to executor
            let result = self.executor.execute(node_id).await;

            match result {
                NodeResult::Succeeded { duration_ms } => {
                    let _ = self.coordinator.complete_node_success(node_id, duration_ms);
                    let had_active_path = apply_routing(
                        self.coordinator,
                        workflow,
                        node_id,
                        &NodeStatus::Succeeded,
                    );
                    if !had_active_path {
                        // All outgoing edges failed condition check (e.g. only OnFailure edges
                        // on a node that succeeded). Fail the run.
                        let _ = self.coordinator.transition_run(RunTransitionInput::Fail {
                            reason: format!(
                                "router.no_match: no outgoing edge condition matched after node {} succeeded",
                                node_id
                            ),
                            failed_node_id: Some(node_id),
                            duration_ms: None,
                        });
                    }
                }
                NodeResult::Failed { reason, retries_remaining } => {
                    if retries_remaining > 0 {
                        // Emit guardrail.warning when on the last retry.
                        if retries_remaining == 1 {
                            let max_retries = node_max_retries(workflow, node_id);
                            self.coordinator.emit_guardrail_warning(
                                "max_retries",
                                GuardrailSeverity::High,
                                &format!(
                                    "Node {} on last retry ({}/{})",
                                    node_id, max_retries.saturating_sub(1), max_retries
                                ),
                                (max_retries.saturating_sub(1)) as f64,
                                max_retries as f64,
                                Some(node_id),
                            );
                        }
                        let _ = self
                            .coordinator
                            .fail_node(node_id, reason, retries_remaining);
                        // Retry scheduled — no routing yet; node will re-execute.
                    } else {
                        // All retries exhausted — emit guardrail.exceeded.
                        let max_retries = node_max_retries(workflow, node_id);
                        self.coordinator.emit_guardrail_exceeded(
                            "max_retries",
                            &format!("Node {} exhausted all {} retries", node_id, max_retries),
                            max_retries as f64,
                            max_retries as f64,
                            "fail_node",
                            Some(node_id),
                        );
                        // No retries left: evaluate routing before deciding to fail the run.
                        let _ = self
                            .coordinator
                            .transition_node(node_id, NodeTransitionInput::Fail {
                                reason: reason.clone(),
                                duration_ms: None,
                            });
                        let had_active_path = apply_routing(
                            self.coordinator,
                            workflow,
                            node_id,
                            &NodeStatus::Failed,
                        );
                        if !had_active_path {
                            // No OnFailure path: fail the run.
                            let _ = self.coordinator.transition_run(RunTransitionInput::Fail {
                                reason: format!("node {} failed: {}", node_id, reason),
                                failed_node_id: Some(node_id),
                                duration_ms: None,
                            });
                        }
                    }
                }
                NodeResult::WaitForReview { reason } => {
                    let _ = self.coordinator.pause_for_review(node_id, reason);
                }
            }

            dispatched.push(node_id);
        }

        dispatched
    }

    /// Run the workflow to completion (or until the run reaches a terminal state).
    ///
    /// Returns when the run status is Succeeded, Failed, or Cancelled.
    pub async fn run_to_completion(&mut self, workflow: &WorkflowDefinition) {
        use workflow_model::run::RunStatus;
        loop {
            match self.coordinator.run_status() {
                RunStatus::Succeeded | RunStatus::Failed | RunStatus::Cancelled => break,
                RunStatus::Paused => {
                    // Waiting for human review — caller must invoke approve_review.
                    break;
                }
                _ => {}
            }

            let dispatched = self.step(workflow).await;

            // If no nodes were dispatched and the run is still running, we are
            // stuck (e.g. all remaining nodes are blocked or the graph is empty).
            if dispatched.is_empty() {
                break;
            }
        }
    }
}

// ---------------------------------------------------------------------------
// NodeResult
// ---------------------------------------------------------------------------

/// The outcome of executing a single node.
pub enum NodeResult {
    Succeeded { duration_ms: u64 },
    Failed { reason: String, retries_remaining: u32 },
    WaitForReview { reason: Option<String> },
}

// ---------------------------------------------------------------------------
// NodeExecutor trait
// ---------------------------------------------------------------------------

/// Abstraction over the runtime that executes a single node.
///
/// Implementations:
/// - `StubNodeExecutor` — always succeeds; used in tests and dry-runs.
/// - `AdapterNodeExecutor` — dispatches to the appropriate `runtime-adapters`
///   adapter based on node type (see ADAPT-001, ADAPT-002).
pub trait NodeExecutor {
    fn execute(
        &self,
        node_id: Uuid,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = NodeResult> + Send + '_>>;
}

// ---------------------------------------------------------------------------
// StubNodeExecutor
// ---------------------------------------------------------------------------

/// Always returns `NodeResult::Succeeded` immediately.
/// Used for scheduler/coordinator integration tests.
pub struct StubNodeExecutor;

impl NodeExecutor for StubNodeExecutor {
    fn execute(
        &self,
        _node_id: Uuid,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = NodeResult> + Send + '_>> {
        Box::pin(async { NodeResult::Succeeded { duration_ms: 1 } })
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Evaluate routing for a node that just reached `terminal_status`, emit routing
/// events, and skip downstream nodes whose edge conditions did not match.
///
/// Returns `true` if at least one edge was active (run should continue),
/// `false` if no edge matched (caller should fail the run).
fn apply_routing<L: EventLog>(
    coordinator: &mut RunCoordinator<L>,
    workflow: &WorkflowDefinition,
    source_node_id: Uuid,
    terminal_status: &NodeStatus,
) -> bool {
    let outgoing: Vec<&EdgeDefinition> = workflow
        .edges
        .iter()
        .filter(|e| e.source_node_id == source_node_id)
        .collect();

    let source_output = coordinator
        .node_snapshots
        .get(&source_node_id)
        .and_then(|s| s.output.clone());

    let candidates_evaluated = outgoing.len() as u32;
    let router_node_id_str = source_node_id.to_string();

    let decision = RouterEvaluator::evaluate(terminal_status, source_output.as_ref(), &outgoing);

    // Always emit router.evaluated when there are outgoing edges.
    if candidates_evaluated > 0 {
        let evaluated_event = RunEvent::from_routing_kind(
            coordinator.run.run_id,
            coordinator.run.workflow_id,
            Some(source_node_id),
            &RoutingEventKind::RouterEvaluated(RouterEvaluatedPayload {
                router_node_id: router_node_id_str.clone(),
                candidates_evaluated,
            }),
            None,
            None,
        );
        coordinator.emit_event(evaluated_event);
    }

    match decision {
        RouteDecision::Routed {
            selected_edge_ids,
            skipped_node_ids,
            reason,
        } => {
            // Skip non-selected downstream nodes.
            for node_id in &skipped_node_ids {
                let _ = coordinator.skip_node(*node_id);
            }

            // Emit edge.routed for each selected edge.
            for edge_id in &selected_edge_ids {
                if let Some(edge) = workflow.edges.iter().find(|e| e.edge_id == *edge_id) {
                    let routed_event = RunEvent::from_routing_kind(
                        coordinator.run.run_id,
                        coordinator.run.workflow_id,
                        Some(source_node_id),
                        &RoutingEventKind::EdgeRouted(EdgeRoutedPayload {
                            edge_id: edge_id.to_string(),
                            source_node_id: edge.source_node_id.to_string(),
                            target_node_id: edge.target_node_id.to_string(),
                        }),
                        None,
                        None,
                    );
                    coordinator.emit_event(routed_event);
                }
            }

            // Emit router.branch_selected when there are actual edges.
            if candidates_evaluated > 0 {
                let branch_event = RunEvent::from_routing_kind(
                    coordinator.run.run_id,
                    coordinator.run.workflow_id,
                    Some(source_node_id),
                    &RoutingEventKind::RouterBranchSelected(RouterBranchSelectedPayload {
                        router_node_id: router_node_id_str,
                        selected_edge_ids: selected_edge_ids
                            .iter()
                            .map(|id| id.to_string())
                            .collect(),
                        reason,
                    }),
                    None,
                    None,
                );
                coordinator.emit_event(branch_event);
            }

            true
        }
        RouteDecision::NoMatch { reason } => {
            let no_match_event = RunEvent::from_routing_kind(
                coordinator.run.run_id,
                coordinator.run.workflow_id,
                Some(source_node_id),
                &RoutingEventKind::RouterNoMatch(RouterNoMatchPayload {
                    router_node_id: router_node_id_str,
                    reason: Some(reason),
                }),
                None,
                None,
            );
            coordinator.emit_event(no_match_event);
            false
        }
    }
}

fn node_type_for(workflow: &WorkflowDefinition, node_id: Uuid) -> String {
    workflow
        .nodes
        .iter()
        .find(|n| n.node_id == node_id)
        .map(|n| format!("{:?}", n.node_type).to_lowercase())
        .unwrap_or_else(|| "unknown".to_owned())
}

fn node_max_retries(workflow: &WorkflowDefinition, node_id: Uuid) -> u32 {
    workflow
        .nodes
        .iter()
        .find(|n| n.node_id == node_id)
        .map(|n| n.retry_policy.max_retries)
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use uuid::Uuid;
    use workflow_model::run::NodeStatus;
    use workflow_model::node::{NodeDefinition, NodeKind, RetryPolicy, NodeDisplay};
    use workflow_model::node_config::{NodeConfig, StartNodeConfig, EndNodeConfig, ToolNodeConfig};
    use workflow_model::edge::{EdgeDefinition, ConditionKind};
    use workflow_model::run::{RunInstance, RunStatus, NodeSnapshot, RunConstraints};
    use workflow_model::workflow::WorkflowDefinition;
    use event_model::event::RunEvent;
    use crate::coordinator::{RunCoordinator, EventLog};

    struct InMemoryEventLog { events: Vec<RunEvent> }
    impl InMemoryEventLog { fn new() -> Self { Self { events: vec![] } } }
    impl EventLog for InMemoryEventLog {
        fn append(&mut self, event: RunEvent) -> Result<(), String> { self.events.push(event); Ok(()) }
        fn events(&self) -> &[RunEvent] { &self.events }
    }

    fn make_run(workflow_id: Uuid) -> RunInstance {
        RunInstance {
            run_id: Uuid::new_v4(),
            workflow_id,
            workflow_version: 1,
            status: RunStatus::Running,
            workspace_root: "/tmp/workspace".into(),
            created_at: Utc::now(),
            started_at: None,
            ended_at: None,
            active_nodes: vec![],
            constraints: RunConstraints::default(),
            summary: None,
        }
    }

    fn make_snapshot(node_id: Uuid, status: NodeStatus) -> NodeSnapshot {
        NodeSnapshot { node_id, status, attempt: 1, started_at: None, ended_at: None, output: None }
    }

    fn make_node(node_id: Uuid, kind: NodeKind) -> NodeDefinition {
        let config = match kind {
            NodeKind::Start => NodeConfig::Start(StartNodeConfig {}),
            NodeKind::End => NodeConfig::End(EndNodeConfig {}),
            _ => NodeConfig::Tool(ToolNodeConfig {
                command: "echo hello".into(),
                shell: None,
                timeout_ms: None,
            }),
        };
        NodeDefinition {
            node_id,
            node_type: kind,
            label: "node".into(),
            config,
            input_contract: serde_json::Value::Null,
            output_contract: serde_json::Value::Null,
            memory_access: serde_json::Value::Null,
            retry_policy: RetryPolicy { max_retries: 0, max_runtime_ms: None },
            display: NodeDisplay { x: 0.0, y: 0.0 },
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

    fn make_edge(src: Uuid, tgt: Uuid) -> EdgeDefinition {
        EdgeDefinition {
            edge_id: Uuid::new_v4(),
            source_node_id: src,
            target_node_id: tgt,
            condition_kind: ConditionKind::Always,
            condition_payload: None,
            label: None,
        }
    }

    fn make_edge_conditional(src: Uuid, tgt: Uuid, kind: ConditionKind) -> EdgeDefinition {
        EdgeDefinition {
            edge_id: Uuid::new_v4(),
            source_node_id: src,
            target_node_id: tgt,
            condition_kind: kind,
            condition_payload: None,
            label: None,
        }
    }

    fn make_edge_expression(
        src: Uuid,
        tgt: Uuid,
        key: &str,
        equals: serde_json::Value,
    ) -> EdgeDefinition {
        EdgeDefinition {
            edge_id: Uuid::new_v4(),
            source_node_id: src,
            target_node_id: tgt,
            condition_kind: ConditionKind::Expression,
            condition_payload: Some(serde_json::json!({ "key": key, "equals": equals })),
            label: None,
        }
    }

    // -----------------------------------------------------------------------
    // RouterEvaluator unit tests
    // -----------------------------------------------------------------------

    #[test]
    fn always_edge_always_followed() {
        let src = Uuid::new_v4();
        let tgt = Uuid::new_v4();
        let edge = make_edge_conditional(src, tgt, ConditionKind::Always);
        let edges = vec![&edge];

        let decision = RouterEvaluator::evaluate(&NodeStatus::Succeeded, None, &edges);
        match decision {
            RouteDecision::Routed { selected_edge_ids, skipped_node_ids, .. } => {
                assert_eq!(selected_edge_ids, vec![edge.edge_id]);
                assert!(skipped_node_ids.is_empty());
            }
            RouteDecision::NoMatch { .. } => panic!("always edge must match"),
        }
    }

    #[test]
    fn always_edge_followed_on_failure_too() {
        let src = Uuid::new_v4();
        let tgt = Uuid::new_v4();
        let edge = make_edge_conditional(src, tgt, ConditionKind::Always);
        let edges = vec![&edge];

        let decision = RouterEvaluator::evaluate(&NodeStatus::Failed, None, &edges);
        assert!(matches!(decision, RouteDecision::Routed { .. }));
    }

    #[test]
    fn on_success_edge_follows_succeeded_source() {
        let src = Uuid::new_v4();
        let ok_id = Uuid::new_v4();
        let fail_id = Uuid::new_v4();
        let ok_edge = make_edge_conditional(src, ok_id, ConditionKind::OnSuccess);
        let fail_edge = make_edge_conditional(src, fail_id, ConditionKind::OnFailure);
        let edges = vec![&ok_edge, &fail_edge];

        let decision = RouterEvaluator::evaluate(&NodeStatus::Succeeded, None, &edges);
        match decision {
            RouteDecision::Routed { selected_edge_ids, skipped_node_ids, .. } => {
                assert!(selected_edge_ids.contains(&ok_edge.edge_id));
                assert!(!selected_edge_ids.contains(&fail_edge.edge_id));
                assert_eq!(skipped_node_ids, vec![fail_id]);
            }
            RouteDecision::NoMatch { .. } => panic!("on_success edge must match"),
        }
    }

    #[test]
    fn on_failure_edge_follows_failed_source() {
        let src = Uuid::new_v4();
        let ok_id = Uuid::new_v4();
        let fail_id = Uuid::new_v4();
        let ok_edge = make_edge_conditional(src, ok_id, ConditionKind::OnSuccess);
        let fail_edge = make_edge_conditional(src, fail_id, ConditionKind::OnFailure);
        let edges = vec![&ok_edge, &fail_edge];

        let decision = RouterEvaluator::evaluate(&NodeStatus::Failed, None, &edges);
        match decision {
            RouteDecision::Routed { selected_edge_ids, skipped_node_ids, .. } => {
                assert!(selected_edge_ids.contains(&fail_edge.edge_id));
                assert!(!selected_edge_ids.contains(&ok_edge.edge_id));
                assert_eq!(skipped_node_ids, vec![ok_id]);
            }
            RouteDecision::NoMatch { .. } => panic!("on_failure edge must match"),
        }
    }

    #[test]
    fn no_match_when_no_edge_condition_satisfied() {
        let src = Uuid::new_v4();
        let tgt = Uuid::new_v4();
        // Only OnFailure edge, but source succeeded
        let edge = make_edge_conditional(src, tgt, ConditionKind::OnFailure);
        let edges = vec![&edge];

        let decision = RouterEvaluator::evaluate(&NodeStatus::Succeeded, None, &edges);
        assert!(matches!(decision, RouteDecision::NoMatch { .. }));
    }

    #[test]
    fn expression_edge_matches_key_equals() {
        let src = Uuid::new_v4();
        let tgt = Uuid::new_v4();
        let edge = make_edge_expression(src, tgt, "exit_code", serde_json::json!(0));
        let edges = vec![&edge];
        let output = serde_json::json!({ "exit_code": 0 });

        let decision =
            RouterEvaluator::evaluate(&NodeStatus::Succeeded, Some(&output), &edges);
        match decision {
            RouteDecision::Routed { selected_edge_ids, .. } => {
                assert!(selected_edge_ids.contains(&edge.edge_id));
            }
            RouteDecision::NoMatch { .. } => panic!("expression must match"),
        }
    }

    #[test]
    fn expression_edge_no_match_wrong_value() {
        let src = Uuid::new_v4();
        let tgt = Uuid::new_v4();
        let edge = make_edge_expression(src, tgt, "exit_code", serde_json::json!(0));
        let edges = vec![&edge];
        let output = serde_json::json!({ "exit_code": 1 });

        let decision =
            RouterEvaluator::evaluate(&NodeStatus::Succeeded, Some(&output), &edges);
        assert!(matches!(decision, RouteDecision::NoMatch { .. }));
    }

    #[test]
    fn expression_edge_no_match_missing_output() {
        let src = Uuid::new_v4();
        let tgt = Uuid::new_v4();
        let edge = make_edge_expression(src, tgt, "exit_code", serde_json::json!(0));
        let edges = vec![&edge];

        let decision = RouterEvaluator::evaluate(&NodeStatus::Succeeded, None, &edges);
        assert!(matches!(decision, RouteDecision::NoMatch { .. }));
    }

    #[test]
    fn terminal_node_no_outgoing_edges_is_routed_empty() {
        let decision = RouterEvaluator::evaluate(&NodeStatus::Succeeded, None, &[]);
        match decision {
            RouteDecision::Routed { selected_edge_ids, skipped_node_ids, .. } => {
                assert!(selected_edge_ids.is_empty());
                assert!(skipped_node_ids.is_empty());
            }
            RouteDecision::NoMatch { .. } => panic!("terminal node should be Routed (empty)"),
        }
    }

    // -----------------------------------------------------------------------
    // Integration tests: routing events are emitted
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn branch_selected_event_emitted_for_conditional_workflow() {
        // start --[on_success]--> tool
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
                make_edge_conditional(start_id, tool_id, ConditionKind::OnSuccess),
                make_edge(tool_id, end_id),
            ],
        );

        let run = make_run(workflow.workflow_id);
        let mut coordinator = RunCoordinator::new(run, InMemoryEventLog::new());

        for id in [start_id, tool_id, end_id] {
            coordinator.node_snapshots.insert(id, make_snapshot(id, NodeStatus::Ready));
        }

        let executor = StubNodeExecutor;
        let mut driver = ExecutionDriver::new(&mut coordinator, executor);
        driver.run_to_completion(&workflow).await;

        assert_eq!(coordinator.run_status(), &RunStatus::Succeeded);

        let events = coordinator.emitted_events();
        let has_branch_selected = events
            .iter()
            .any(|e| e.event_type == "router.branch_selected");
        assert!(has_branch_selected, "router.branch_selected must be emitted");
    }

    #[tokio::test]
    async fn no_match_causes_run_failure() {
        // start --[on_failure]--> end  (but start succeeds → no match)
        let start_id = Uuid::new_v4();
        let end_id = Uuid::new_v4();

        let workflow = make_workflow(
            vec![
                make_node(start_id, NodeKind::Start),
                make_node(end_id, NodeKind::End),
            ],
            vec![make_edge_conditional(start_id, end_id, ConditionKind::OnFailure)],
        );

        let run = make_run(workflow.workflow_id);
        let mut coordinator = RunCoordinator::new(run, InMemoryEventLog::new());
        coordinator
            .node_snapshots
            .insert(start_id, make_snapshot(start_id, NodeStatus::Ready));
        coordinator
            .node_snapshots
            .insert(end_id, make_snapshot(end_id, NodeStatus::Ready));

        let executor = StubNodeExecutor;
        let mut driver = ExecutionDriver::new(&mut coordinator, executor);
        driver.run_to_completion(&workflow).await;

        assert_eq!(
            coordinator.run_status(),
            &RunStatus::Failed,
            "run must fail when no edge condition matches"
        );

        let events = coordinator.emitted_events();
        let has_no_match = events.iter().any(|e| e.event_type == "router.no_match");
        assert!(has_no_match, "router.no_match must be emitted");
    }

    /// A linear start → tool → end workflow should run to Succeeded using StubNodeExecutor.
    #[tokio::test]
    async fn execution_driver_linear_workflow_succeeds() {
        let start_id = Uuid::new_v4();
        let tool_id = Uuid::new_v4();
        let end_id = Uuid::new_v4();

        let workflow = make_workflow(
            vec![
                make_node(start_id, NodeKind::Start),
                make_node(tool_id, NodeKind::Tool),
                make_node(end_id, NodeKind::End),
            ],
            vec![make_edge(start_id, tool_id), make_edge(tool_id, end_id)],
        );

        let run = make_run(workflow.workflow_id);
        let mut coordinator = RunCoordinator::new(run, InMemoryEventLog::new());

        // Insert snapshots in Ready state (topology order matters for the scheduler)
        for id in [start_id, tool_id, end_id] {
            coordinator.node_snapshots.insert(id, make_snapshot(id, NodeStatus::Ready));
        }

        let executor = StubNodeExecutor;
        let mut driver = ExecutionDriver::new(&mut coordinator, executor);

        driver.run_to_completion(&workflow).await;

        assert_eq!(
            coordinator.run_status(),
            &RunStatus::Succeeded,
            "linear workflow must succeed with StubNodeExecutor"
        );
        assert_eq!(coordinator.node_status(&start_id), Some(&NodeStatus::Succeeded));
        assert_eq!(coordinator.node_status(&tool_id), Some(&NodeStatus::Succeeded));
        assert_eq!(coordinator.node_status(&end_id), Some(&NodeStatus::Succeeded));
    }

    // -----------------------------------------------------------------------
    // Guardrail enforcement tests
    // -----------------------------------------------------------------------

    /// A run with max_steps=1 on a 3-node workflow should halt with guardrail.exceeded
    /// and transition to Failed after the first step.
    #[tokio::test]
    async fn max_steps_guardrail_halts_run_with_exceeded_event() {
        let start_id = Uuid::new_v4();
        let tool_id = Uuid::new_v4();
        let end_id = Uuid::new_v4();

        let workflow = make_workflow(
            vec![
                make_node(start_id, NodeKind::Start),
                make_node(tool_id, NodeKind::Tool),
                make_node(end_id, NodeKind::End),
            ],
            vec![make_edge(start_id, tool_id), make_edge(tool_id, end_id)],
        );

        let mut run = make_run(workflow.workflow_id);
        run.constraints = RunConstraints { max_steps: Some(1), ..RunConstraints::default() };

        let mut coordinator = RunCoordinator::new(run, InMemoryEventLog::new());
        for id in [start_id, tool_id, end_id] {
            coordinator.node_snapshots.insert(id, make_snapshot(id, NodeStatus::Ready));
        }

        let executor = StubNodeExecutor;
        let mut driver = ExecutionDriver::new(&mut coordinator, executor);
        driver.run_to_completion(&workflow).await;

        assert_eq!(coordinator.run_status(), &RunStatus::Failed, "run must fail when max_steps exceeded");

        let events = coordinator.emitted_events();
        assert!(
            events.iter().any(|e| e.event_type == "guardrail.exceeded"),
            "guardrail.exceeded must be emitted"
        );
    }

    /// A run with max_steps=5 should emit guardrail.warning at step 4 (80%)
    /// and guardrail.exceeded at step 5.
    #[tokio::test]
    async fn max_steps_warning_emitted_before_exceeded() {
        let start_id = Uuid::new_v4();
        let tool_id = Uuid::new_v4();
        let end_id = Uuid::new_v4();

        let workflow = make_workflow(
            vec![
                make_node(start_id, NodeKind::Start),
                make_node(tool_id, NodeKind::Tool),
                make_node(end_id, NodeKind::End),
            ],
            vec![make_edge(start_id, tool_id), make_edge(tool_id, end_id)],
        );

        let mut run = make_run(workflow.workflow_id);
        // max_steps=5 → warn at step 4, exceed at step 5; 3-node workflow
        // won't actually hit 5 steps, but we set it low enough that warn threshold
        // (80% of 5 = 4) is below 3 nodes, so we test warn is not spuriously emitted.
        // Let's set max_steps=2 → warn at 1 (80% rounded), exceed at 2.
        run.constraints = RunConstraints { max_steps: Some(2), ..RunConstraints::default() };

        let mut coordinator = RunCoordinator::new(run, InMemoryEventLog::new());
        for id in [start_id, tool_id, end_id] {
            coordinator.node_snapshots.insert(id, make_snapshot(id, NodeStatus::Ready));
        }

        let executor = StubNodeExecutor;
        let mut driver = ExecutionDriver::new(&mut coordinator, executor);
        driver.run_to_completion(&workflow).await;

        let events = coordinator.emitted_events();
        let has_warning = events.iter().any(|e| e.event_type == "guardrail.warning");
        let has_exceeded = events.iter().any(|e| e.event_type == "guardrail.exceeded");

        // With max_steps=2, warning threshold is (2*0.8)=1, so warning at step 1,
        // exceeded at step 2. Both should be emitted.
        assert!(has_warning, "guardrail.warning must be emitted before exceeded");
        assert!(has_exceeded, "guardrail.exceeded must be emitted");

        // Warning must appear before exceeded in the event log.
        let warning_idx = events.iter().position(|e| e.event_type == "guardrail.warning").unwrap();
        let exceeded_idx = events.iter().position(|e| e.event_type == "guardrail.exceeded").unwrap();
        assert!(warning_idx < exceeded_idx, "guardrail.warning must precede guardrail.exceeded");
    }

    /// A run with max_runtime_ms=0 should halt immediately on the first step.
    #[tokio::test]
    async fn max_runtime_ms_guardrail_halts_run() {
        let start_id = Uuid::new_v4();
        let tool_id = Uuid::new_v4();
        let end_id = Uuid::new_v4();

        let workflow = make_workflow(
            vec![
                make_node(start_id, NodeKind::Start),
                make_node(tool_id, NodeKind::Tool),
                make_node(end_id, NodeKind::End),
            ],
            vec![make_edge(start_id, tool_id), make_edge(tool_id, end_id)],
        );

        let mut run = make_run(workflow.workflow_id);
        // max_runtime_ms=0 means any elapsed time exceeds the limit immediately.
        run.constraints = RunConstraints { max_runtime_ms: Some(0), ..RunConstraints::default() };

        let mut coordinator = RunCoordinator::new(run, InMemoryEventLog::new());
        for id in [start_id, tool_id, end_id] {
            coordinator.node_snapshots.insert(id, make_snapshot(id, NodeStatus::Ready));
        }

        let executor = StubNodeExecutor;
        let mut driver = ExecutionDriver::new(&mut coordinator, executor);
        driver.run_to_completion(&workflow).await;

        assert_eq!(coordinator.run_status(), &RunStatus::Failed, "run must fail when max_runtime_ms exceeded");

        let events = coordinator.emitted_events();
        assert!(
            events.iter().any(|e| e.event_type == "guardrail.exceeded"),
            "guardrail.exceeded must be emitted for max_runtime_ms"
        );
    }

    /// Node with retries=1: when the executor returns retries_remaining=0, the node is failed
    /// and guardrail.exceeded is emitted.
    #[tokio::test]
    async fn node_retry_exhausted_emits_guardrail_exceeded() {
        let start_id = Uuid::new_v4();
        let tool_id = Uuid::new_v4();
        let end_id = Uuid::new_v4();

        // Tool node with max_retries=1
        let tool_node = {
            let mut n = make_node(tool_id, NodeKind::Tool);
            n.retry_policy = workflow_model::node::RetryPolicy { max_retries: 1, max_runtime_ms: None };
            n
        };

        let workflow = make_workflow(
            vec![
                make_node(start_id, NodeKind::Start),
                tool_node,
                make_node(end_id, NodeKind::End),
            ],
            vec![
                make_edge(start_id, tool_id),
                make_edge_conditional(tool_id, end_id, ConditionKind::OnFailure),
            ],
        );

        // Executor that always fails the tool node with 0 retries remaining.
        struct AlwaysFailExecutor { tool_id: Uuid }
        impl NodeExecutor for AlwaysFailExecutor {
            fn execute(
                &self,
                node_id: Uuid,
            ) -> std::pin::Pin<Box<dyn std::future::Future<Output = NodeResult> + Send + '_>> {
                let tool_id = self.tool_id;
                Box::pin(async move {
                    if node_id == tool_id {
                        NodeResult::Failed { reason: "test failure".into(), retries_remaining: 0 }
                    } else {
                        NodeResult::Succeeded { duration_ms: 1 }
                    }
                })
            }
        }

        let run = make_run(workflow.workflow_id);
        let mut coordinator = RunCoordinator::new(run, InMemoryEventLog::new());
        for id in [start_id, tool_id, end_id] {
            coordinator.node_snapshots.insert(id, make_snapshot(id, NodeStatus::Ready));
        }

        let executor = AlwaysFailExecutor { tool_id };
        let mut driver = ExecutionDriver::new(&mut coordinator, executor);
        driver.run_to_completion(&workflow).await;

        let events = coordinator.emitted_events();
        assert!(
            events.iter().any(|e| e.event_type == "guardrail.exceeded"),
            "guardrail.exceeded must be emitted when node retries exhausted"
        );
        // The guardrail.exceeded event should reference max_retries.
        let exceeded = events.iter().find(|e| e.event_type == "guardrail.exceeded").unwrap();
        assert_eq!(exceeded.payload["guardrail"], "max_retries");
    }
}
