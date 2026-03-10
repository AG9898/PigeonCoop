// Additional validation tests beyond validator_tests.rs.
// Covers edge cases: multiple end nodes, combined errors, validate_to_result,
// and large graph validation.

use uuid::Uuid;
use workflow_model::node::NodeKind;
use crate::validation::{WorkflowValidator, ValidationError};
use super::helpers::*;

// ---------------------------------------------------------------------------
// validate_to_result wrapper
// ---------------------------------------------------------------------------

#[test]
fn validate_to_result_returns_ok_for_valid_workflow() {
    let start_id = Uuid::new_v4();
    let end_id = Uuid::new_v4();
    let wf = make_workflow(
        vec![make_node(start_id, NodeKind::Start), make_node(end_id, NodeKind::End)],
        vec![make_edge(start_id, end_id)],
    );
    let result = WorkflowValidator::new().validate_to_result(&wf);
    assert!(result.is_valid);
    assert!(result.errors.is_empty());
}

#[test]
fn validate_to_result_returns_errors_for_invalid_workflow() {
    let wf = make_workflow(vec![], vec![]); // no nodes at all
    let result = WorkflowValidator::new().validate_to_result(&wf);
    assert!(!result.is_valid);
    assert!(!result.errors.is_empty());
}

// ---------------------------------------------------------------------------
// Multiple errors reported simultaneously
// ---------------------------------------------------------------------------

#[test]
fn reports_both_missing_start_and_missing_end() {
    // A workflow with only an Agent node — no Start, no End.
    let agent_id = Uuid::new_v4();
    let wf = make_workflow(vec![make_node(agent_id, NodeKind::Agent)], vec![]);
    let errors = WorkflowValidator::new().validate(&wf).unwrap_err();
    assert!(
        errors.iter().any(|e| matches!(e, ValidationError::NoStartNode)),
        "expected NoStartNode: {:?}",
        errors
    );
    assert!(
        errors.iter().any(|e| matches!(e, ValidationError::NoEndNode)),
        "expected NoEndNode: {:?}",
        errors
    );
}

#[test]
fn reports_cycle_and_unreachable_together() {
    // Graph: Start → A → B → A (cycle), plus an isolated node C.
    let start_id = Uuid::new_v4();
    let a_id = Uuid::new_v4();
    let b_id = Uuid::new_v4();
    let c_id = Uuid::new_v4(); // unreachable
    let end_id = Uuid::new_v4();

    let wf = make_workflow(
        vec![
            make_node(start_id, NodeKind::Start),
            make_node(a_id, NodeKind::Agent),
            make_node(b_id, NodeKind::Tool),
            make_node(c_id, NodeKind::Memory),
            make_node(end_id, NodeKind::End),
        ],
        vec![
            make_edge(start_id, a_id),
            make_edge(a_id, b_id),
            make_edge(b_id, a_id), // cycle
            make_edge(start_id, end_id),
        ],
    );

    let errors = WorkflowValidator::new().validate(&wf).unwrap_err();
    assert!(
        errors.iter().any(|e| matches!(e, ValidationError::CycleDetected { .. })),
        "expected CycleDetected: {:?}",
        errors
    );
    assert!(
        errors.iter().any(|e| matches!(e, ValidationError::UnreachableNode { node_id } if *node_id == c_id)),
        "expected UnreachableNode for c_id: {:?}",
        errors
    );
}

// ---------------------------------------------------------------------------
// Edge reference validation
// ---------------------------------------------------------------------------

#[test]
fn invalid_source_reference_detected() {
    let start_id = Uuid::new_v4();
    let end_id = Uuid::new_v4();
    let ghost_id = Uuid::new_v4();

    // Edge with ghost source.
    let bad_edge = make_edge(ghost_id, end_id);
    let wf = make_workflow(
        vec![make_node(start_id, NodeKind::Start), make_node(end_id, NodeKind::End)],
        vec![bad_edge, make_edge(start_id, end_id)],
    );

    let errors = WorkflowValidator::new().validate(&wf).unwrap_err();
    assert!(
        errors.iter().any(|e| matches!(
            e,
            ValidationError::InvalidEdgeReference { missing_node_id, .. }
                if *missing_node_id == ghost_id
        )),
        "expected InvalidEdgeReference for ghost source: {:?}",
        errors
    );
}

#[test]
fn both_source_and_target_invalid() {
    let start_id = Uuid::new_v4();
    let end_id = Uuid::new_v4();
    let ghost_a = Uuid::new_v4();
    let ghost_b = Uuid::new_v4();

    // Edge from ghost_a to ghost_b — both references invalid.
    let bad_edge = make_edge(ghost_a, ghost_b);
    let wf = make_workflow(
        vec![make_node(start_id, NodeKind::Start), make_node(end_id, NodeKind::End)],
        vec![bad_edge, make_edge(start_id, end_id)],
    );

    let errors = WorkflowValidator::new().validate(&wf).unwrap_err();
    let ref_errors: Vec<_> = errors
        .iter()
        .filter(|e| matches!(e, ValidationError::InvalidEdgeReference { .. }))
        .collect();
    assert!(
        ref_errors.len() >= 2,
        "expected at least 2 InvalidEdgeReference errors, got {}",
        ref_errors.len()
    );
}

// ---------------------------------------------------------------------------
// Large graph validation
// ---------------------------------------------------------------------------

#[test]
fn linear_chain_of_20_nodes_validates() {
    let ids: Vec<Uuid> = (0..20).map(|_| Uuid::new_v4()).collect();
    let mut nodes = vec![make_node(ids[0], NodeKind::Start)];
    for i in 1..19 {
        nodes.push(make_node(ids[i], NodeKind::Tool));
    }
    nodes.push(make_node(ids[19], NodeKind::End));

    let edges: Vec<_> = (0..19)
        .map(|i| make_edge(ids[i], ids[i + 1]))
        .collect();

    let wf = make_workflow(nodes, edges);
    WorkflowValidator::new()
        .validate(&wf)
        .expect("linear 20-node chain must pass validation");
}

#[test]
fn diamond_graph_validates() {
    // Start → A, Start → B, A → End, B → End
    let start_id = Uuid::new_v4();
    let a_id = Uuid::new_v4();
    let b_id = Uuid::new_v4();
    let end_id = Uuid::new_v4();

    let wf = make_workflow(
        vec![
            make_node(start_id, NodeKind::Start),
            make_node(a_id, NodeKind::Agent),
            make_node(b_id, NodeKind::Tool),
            make_node(end_id, NodeKind::End),
        ],
        vec![
            make_edge(start_id, a_id),
            make_edge(start_id, b_id),
            make_edge(a_id, end_id),
            make_edge(b_id, end_id),
        ],
    );

    WorkflowValidator::new()
        .validate(&wf)
        .expect("diamond graph must pass validation");
}

// ---------------------------------------------------------------------------
// Default trait
// ---------------------------------------------------------------------------

#[test]
fn validator_default_works() {
    let validator = WorkflowValidator::default();
    let start_id = Uuid::new_v4();
    let end_id = Uuid::new_v4();
    let wf = make_workflow(
        vec![make_node(start_id, NodeKind::Start), make_node(end_id, NodeKind::End)],
        vec![make_edge(start_id, end_id)],
    );
    validator.validate(&wf).expect("default validator must work");
}
