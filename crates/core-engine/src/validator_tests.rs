// Test-first spec for WorkflowValidator.
// These tests define the contract ENGINE-003 must satisfy.
// All tests are expected to FAIL until ENGINE-003 is implemented —
// that is correct and intentional. See QA-002.

#[cfg(test)]
mod tests {
    use uuid::Uuid;
    use chrono::Utc;
    use workflow_model::workflow::{WorkflowDefinition, CURRENT_SCHEMA_VERSION};
    use workflow_model::node::{NodeDefinition, NodeKind, RetryPolicy, NodeDisplay};
    use workflow_model::edge::{EdgeDefinition, ConditionKind};
    use crate::validation::{WorkflowValidator, ValidationError};

    // -----------------------------------------------------------------------
    // Test helpers
    // -----------------------------------------------------------------------

    fn make_node(kind: NodeKind) -> NodeDefinition {
        NodeDefinition {
            node_id: Uuid::new_v4(),
            node_type: kind,
            label: "test-node".into(),
            config: serde_json::Value::Null,
            input_contract: serde_json::Value::Null,
            output_contract: serde_json::Value::Null,
            memory_access: serde_json::Value::Null,
            retry_policy: RetryPolicy { max_retries: 0, max_runtime_ms: None },
            display: NodeDisplay { x: 0.0, y: 0.0 },
        }
    }

    fn make_node_with_id(kind: NodeKind, id: Uuid) -> NodeDefinition {
        let mut n = make_node(kind);
        n.node_id = id;
        n
    }

    fn make_edge(source: Uuid, target: Uuid) -> EdgeDefinition {
        EdgeDefinition {
            edge_id: Uuid::new_v4(),
            source_node_id: source,
            target_node_id: target,
            condition_kind: ConditionKind::Always,
            condition_payload: None,
            label: None,
        }
    }

    fn minimal_workflow(nodes: Vec<NodeDefinition>, edges: Vec<EdgeDefinition>) -> WorkflowDefinition {
        WorkflowDefinition {
            workflow_id: Uuid::new_v4(),
            name: "test-workflow".into(),
            schema_version: CURRENT_SCHEMA_VERSION,
            version: 1,
            metadata: serde_json::Value::Null,
            nodes,
            edges,
            default_constraints: serde_json::Value::Null,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    // -----------------------------------------------------------------------
    // Happy-path
    // -----------------------------------------------------------------------

    /// A workflow with one Start node, one End node, and a connecting edge
    /// must pass validation.
    #[test]
    #[should_panic(expected = "ENGINE-003")]
    fn validate_passes_on_valid_minimal_workflow() {
        let start = make_node(NodeKind::Start);
        let end = make_node(NodeKind::End);
        let edge = make_edge(start.node_id, end.node_id);
        let wf = minimal_workflow(vec![start, end], vec![edge]);
        let validator = WorkflowValidator::new();
        // Should return Ok(()) — not panic
        validator.validate(&wf).expect("valid workflow must pass validation");
    }

    /// All v1 NodeKind variants must be accepted by the validator when used
    /// in a structurally valid graph.
    #[test]
    #[should_panic(expected = "ENGINE-003")]
    fn validate_accepts_all_v1_node_kinds() {
        let start_id = Uuid::new_v4();
        let agent_id = Uuid::new_v4();
        let tool_id = Uuid::new_v4();
        let router_id = Uuid::new_v4();
        let memory_id = Uuid::new_v4();
        let review_id = Uuid::new_v4();
        let end_id = Uuid::new_v4();

        let nodes = vec![
            make_node_with_id(NodeKind::Start, start_id),
            make_node_with_id(NodeKind::Agent, agent_id),
            make_node_with_id(NodeKind::Tool, tool_id),
            make_node_with_id(NodeKind::Router, router_id),
            make_node_with_id(NodeKind::Memory, memory_id),
            make_node_with_id(NodeKind::HumanReview, review_id),
            make_node_with_id(NodeKind::End, end_id),
        ];
        let edges = vec![
            make_edge(start_id, agent_id),
            make_edge(agent_id, tool_id),
            make_edge(tool_id, router_id),
            make_edge(router_id, memory_id),
            make_edge(memory_id, review_id),
            make_edge(review_id, end_id),
        ];
        let wf = minimal_workflow(nodes, edges);
        let validator = WorkflowValidator::new();
        validator.validate(&wf).expect("all v1 node kinds must be accepted");
    }

    // -----------------------------------------------------------------------
    // Missing structural nodes
    // -----------------------------------------------------------------------

    /// A workflow with no Start node must fail with NoStartNode.
    #[test]
    #[should_panic(expected = "ENGINE-003")]
    fn validate_fails_on_missing_start_node() {
        let end = make_node(NodeKind::End);
        let wf = minimal_workflow(vec![end], vec![]);
        let validator = WorkflowValidator::new();

        let errors = validator.validate(&wf).expect_err("missing start node must fail");
        assert!(
            errors.iter().any(|e| matches!(e, ValidationError::NoStartNode)),
            "expected NoStartNode in errors: {:?}",
            errors
        );
    }

    /// A workflow with no End node must fail with NoEndNode.
    #[test]
    #[should_panic(expected = "ENGINE-003")]
    fn validate_fails_on_missing_end_node() {
        let start = make_node(NodeKind::Start);
        let wf = minimal_workflow(vec![start], vec![]);
        let validator = WorkflowValidator::new();

        let errors = validator.validate(&wf).expect_err("missing end node must fail");
        assert!(
            errors.iter().any(|e| matches!(e, ValidationError::NoEndNode)),
            "expected NoEndNode in errors: {:?}",
            errors
        );
    }

    /// A workflow with more than one Start node must fail with
    /// MultipleStartNodes.
    #[test]
    #[should_panic(expected = "ENGINE-003")]
    fn validate_fails_on_multiple_start_nodes() {
        let start1 = make_node(NodeKind::Start);
        let start2 = make_node(NodeKind::Start);
        let end = make_node(NodeKind::End);
        let wf = minimal_workflow(vec![start1, start2, end], vec![]);
        let validator = WorkflowValidator::new();

        let errors = validator.validate(&wf).expect_err("multiple start nodes must fail");
        assert!(
            errors.iter().any(|e| matches!(e, ValidationError::MultipleStartNodes { count: 2 })),
            "expected MultipleStartNodes(2) in errors: {:?}",
            errors
        );
    }

    // -----------------------------------------------------------------------
    // Graph structure violations
    // -----------------------------------------------------------------------

    /// A workflow whose edges form a cycle must fail with CycleDetected.
    #[test]
    #[should_panic(expected = "ENGINE-003")]
    fn validate_fails_on_cycle_detected() {
        let start_id = Uuid::new_v4();
        let a_id = Uuid::new_v4();
        let b_id = Uuid::new_v4();
        let end_id = Uuid::new_v4();

        let nodes = vec![
            make_node_with_id(NodeKind::Start, start_id),
            make_node_with_id(NodeKind::Agent, a_id),
            make_node_with_id(NodeKind::Tool, b_id),
            make_node_with_id(NodeKind::End, end_id),
        ];
        // Introduce a cycle: a → b → a
        let edges = vec![
            make_edge(start_id, a_id),
            make_edge(a_id, b_id),
            make_edge(b_id, a_id), // cycle
            make_edge(b_id, end_id),
        ];
        let wf = minimal_workflow(nodes, edges);
        let validator = WorkflowValidator::new();

        let errors = validator.validate(&wf).expect_err("cycle must fail validation");
        assert!(
            errors.iter().any(|e| matches!(e, ValidationError::CycleDetected { .. })),
            "expected CycleDetected in errors: {:?}",
            errors
        );
    }

    /// An edge whose source or target references a node_id not in the node
    /// list must fail with InvalidEdgeReference.
    #[test]
    #[should_panic(expected = "ENGINE-003")]
    fn validate_fails_on_invalid_edge_reference() {
        let start_id = Uuid::new_v4();
        let end_id = Uuid::new_v4();
        let ghost_id = Uuid::new_v4(); // does not appear in nodes list

        let nodes = vec![
            make_node_with_id(NodeKind::Start, start_id),
            make_node_with_id(NodeKind::End, end_id),
        ];
        let bad_edge = make_edge(start_id, ghost_id); // target doesn't exist
        let edges = vec![bad_edge.clone(), make_edge(start_id, end_id)];
        let wf = minimal_workflow(nodes, edges);
        let validator = WorkflowValidator::new();

        let errors = validator.validate(&wf).expect_err("bad edge reference must fail");
        assert!(
            errors.iter().any(|e| matches!(
                e,
                ValidationError::InvalidEdgeReference { edge_id, missing_node_id }
                    if *edge_id == bad_edge.edge_id && *missing_node_id == ghost_id
            )),
            "expected InvalidEdgeReference in errors: {:?}",
            errors
        );
    }

    /// A node that exists in the node list but cannot be reached from the
    /// Start node via forward edges must fail with UnreachableNode.
    ///
    /// Policy: unreachable nodes are a hard validation error in v1.
    /// See DECISIONS.md — "Unreachable node policy".
    #[test]
    #[should_panic(expected = "ENGINE-003")]
    fn validate_fails_on_unreachable_node() {
        let start_id = Uuid::new_v4();
        let end_id = Uuid::new_v4();
        let orphan_id = Uuid::new_v4(); // in nodes list but has no incoming edges from start

        let nodes = vec![
            make_node_with_id(NodeKind::Start, start_id),
            make_node_with_id(NodeKind::End, end_id),
            make_node_with_id(NodeKind::Agent, orphan_id), // unreachable
        ];
        let edges = vec![make_edge(start_id, end_id)]; // orphan_id not connected
        let wf = minimal_workflow(nodes, edges);
        let validator = WorkflowValidator::new();

        let errors = validator.validate(&wf).expect_err("unreachable node must fail");
        assert!(
            errors.iter().any(|e| matches!(
                e,
                ValidationError::UnreachableNode { node_id } if *node_id == orphan_id
            )),
            "expected UnreachableNode({orphan_id}) in errors: {:?}",
            errors
        );
    }

    /// A workflow with zero nodes must fail with both NoStartNode and NoEndNode.
    #[test]
    #[should_panic(expected = "ENGINE-003")]
    fn validate_fails_on_empty_workflow() {
        let wf = minimal_workflow(vec![], vec![]);
        let validator = WorkflowValidator::new();

        let errors = validator.validate(&wf).expect_err("empty workflow must fail");
        assert!(
            errors.iter().any(|e| matches!(e, ValidationError::NoStartNode)),
            "expected NoStartNode in errors: {:?}",
            errors
        );
        assert!(
            errors.iter().any(|e| matches!(e, ValidationError::NoEndNode)),
            "expected NoEndNode in errors: {:?}",
            errors
        );
    }
}
