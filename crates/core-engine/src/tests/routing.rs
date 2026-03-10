// Routing rule tests for all ConditionKind variants.
// Tests the RouterEvaluator in isolation, covering Always, OnSuccess,
// OnFailure, Expression, and edge cases.

use uuid::Uuid;
use workflow_model::edge::ConditionKind;
use workflow_model::run::NodeStatus;
use crate::execution::{RouterEvaluator, RouteDecision};
use super::helpers::*;

// ---------------------------------------------------------------------------
// Always
// ---------------------------------------------------------------------------

#[test]
fn always_matches_on_succeeded() {
    let edge = make_edge_conditional(Uuid::new_v4(), Uuid::new_v4(), ConditionKind::Always);
    let edges = vec![&edge];
    let decision = RouterEvaluator::evaluate(&NodeStatus::Succeeded, None, &edges);
    assert!(matches!(decision, RouteDecision::Routed { .. }));
}

#[test]
fn always_matches_on_failed() {
    let edge = make_edge_conditional(Uuid::new_v4(), Uuid::new_v4(), ConditionKind::Always);
    let edges = vec![&edge];
    let decision = RouterEvaluator::evaluate(&NodeStatus::Failed, None, &edges);
    assert!(matches!(decision, RouteDecision::Routed { .. }));
}

#[test]
fn always_matches_regardless_of_output() {
    let edge = make_edge_conditional(Uuid::new_v4(), Uuid::new_v4(), ConditionKind::Always);
    let edges = vec![&edge];
    let output = serde_json::json!({"foo": "bar"});
    let decision = RouterEvaluator::evaluate(&NodeStatus::Succeeded, Some(&output), &edges);
    assert!(matches!(decision, RouteDecision::Routed { .. }));
}

// ---------------------------------------------------------------------------
// OnSuccess
// ---------------------------------------------------------------------------

#[test]
fn on_success_matches_succeeded() {
    let tgt = Uuid::new_v4();
    let edge = make_edge_conditional(Uuid::new_v4(), tgt, ConditionKind::OnSuccess);
    let edges = vec![&edge];
    let decision = RouterEvaluator::evaluate(&NodeStatus::Succeeded, None, &edges);
    match decision {
        RouteDecision::Routed { selected_edge_ids, skipped_node_ids, .. } => {
            assert!(selected_edge_ids.contains(&edge.edge_id));
            assert!(skipped_node_ids.is_empty());
        }
        _ => panic!("OnSuccess should match Succeeded"),
    }
}

#[test]
fn on_success_does_not_match_failed() {
    let tgt = Uuid::new_v4();
    let edge = make_edge_conditional(Uuid::new_v4(), tgt, ConditionKind::OnSuccess);
    let edges = vec![&edge];
    let decision = RouterEvaluator::evaluate(&NodeStatus::Failed, None, &edges);
    assert!(matches!(decision, RouteDecision::NoMatch { .. }));
}

// ---------------------------------------------------------------------------
// OnFailure
// ---------------------------------------------------------------------------

#[test]
fn on_failure_matches_failed() {
    let tgt = Uuid::new_v4();
    let edge = make_edge_conditional(Uuid::new_v4(), tgt, ConditionKind::OnFailure);
    let edges = vec![&edge];
    let decision = RouterEvaluator::evaluate(&NodeStatus::Failed, None, &edges);
    match decision {
        RouteDecision::Routed { selected_edge_ids, .. } => {
            assert!(selected_edge_ids.contains(&edge.edge_id));
        }
        _ => panic!("OnFailure should match Failed"),
    }
}

#[test]
fn on_failure_does_not_match_succeeded() {
    let tgt = Uuid::new_v4();
    let edge = make_edge_conditional(Uuid::new_v4(), tgt, ConditionKind::OnFailure);
    let edges = vec![&edge];
    let decision = RouterEvaluator::evaluate(&NodeStatus::Succeeded, None, &edges);
    assert!(matches!(decision, RouteDecision::NoMatch { .. }));
}

// ---------------------------------------------------------------------------
// Expression
// ---------------------------------------------------------------------------

#[test]
fn expression_matches_exact_value() {
    let edge = make_edge_expression(Uuid::new_v4(), Uuid::new_v4(), "status", serde_json::json!("ok"));
    let edges = vec![&edge];
    let output = serde_json::json!({"status": "ok"});
    let decision = RouterEvaluator::evaluate(&NodeStatus::Succeeded, Some(&output), &edges);
    assert!(matches!(decision, RouteDecision::Routed { .. }));
}

#[test]
fn expression_no_match_wrong_value() {
    let edge = make_edge_expression(Uuid::new_v4(), Uuid::new_v4(), "status", serde_json::json!("ok"));
    let edges = vec![&edge];
    let output = serde_json::json!({"status": "error"});
    let decision = RouterEvaluator::evaluate(&NodeStatus::Succeeded, Some(&output), &edges);
    assert!(matches!(decision, RouteDecision::NoMatch { .. }));
}

#[test]
fn expression_no_match_missing_key() {
    let edge = make_edge_expression(Uuid::new_v4(), Uuid::new_v4(), "status", serde_json::json!("ok"));
    let edges = vec![&edge];
    let output = serde_json::json!({"other_key": "ok"});
    let decision = RouterEvaluator::evaluate(&NodeStatus::Succeeded, Some(&output), &edges);
    assert!(matches!(decision, RouteDecision::NoMatch { .. }));
}

#[test]
fn expression_no_match_no_output() {
    let edge = make_edge_expression(Uuid::new_v4(), Uuid::new_v4(), "status", serde_json::json!("ok"));
    let edges = vec![&edge];
    let decision = RouterEvaluator::evaluate(&NodeStatus::Succeeded, None, &edges);
    assert!(matches!(decision, RouteDecision::NoMatch { .. }));
}

#[test]
fn expression_matches_numeric_value() {
    let edge = make_edge_expression(Uuid::new_v4(), Uuid::new_v4(), "exit_code", serde_json::json!(0));
    let edges = vec![&edge];
    let output = serde_json::json!({"exit_code": 0});
    let decision = RouterEvaluator::evaluate(&NodeStatus::Succeeded, Some(&output), &edges);
    assert!(matches!(decision, RouteDecision::Routed { .. }));
}

#[test]
fn expression_no_match_type_mismatch() {
    // Expects integer 0, got string "0"
    let edge = make_edge_expression(Uuid::new_v4(), Uuid::new_v4(), "exit_code", serde_json::json!(0));
    let edges = vec![&edge];
    let output = serde_json::json!({"exit_code": "0"});
    let decision = RouterEvaluator::evaluate(&NodeStatus::Succeeded, Some(&output), &edges);
    assert!(matches!(decision, RouteDecision::NoMatch { .. }));
}

#[test]
fn expression_matches_boolean_value() {
    let edge = make_edge_expression(Uuid::new_v4(), Uuid::new_v4(), "passed", serde_json::json!(true));
    let edges = vec![&edge];
    let output = serde_json::json!({"passed": true});
    let decision = RouterEvaluator::evaluate(&NodeStatus::Succeeded, Some(&output), &edges);
    assert!(matches!(decision, RouteDecision::Routed { .. }));
}

// ---------------------------------------------------------------------------
// Mixed edges
// ---------------------------------------------------------------------------

#[test]
fn on_success_and_on_failure_edges_one_matches_one_skipped() {
    let ok_tgt = Uuid::new_v4();
    let fail_tgt = Uuid::new_v4();
    let ok_edge = make_edge_conditional(Uuid::new_v4(), ok_tgt, ConditionKind::OnSuccess);
    let fail_edge = make_edge_conditional(Uuid::new_v4(), fail_tgt, ConditionKind::OnFailure);
    let edges = vec![&ok_edge, &fail_edge];

    // Source succeeded → OnSuccess matches, OnFailure target skipped.
    let decision = RouterEvaluator::evaluate(&NodeStatus::Succeeded, None, &edges);
    match decision {
        RouteDecision::Routed {
            selected_edge_ids,
            skipped_node_ids,
            ..
        } => {
            assert!(selected_edge_ids.contains(&ok_edge.edge_id));
            assert!(!selected_edge_ids.contains(&fail_edge.edge_id));
            assert!(skipped_node_ids.contains(&fail_tgt));
            assert!(!skipped_node_ids.contains(&ok_tgt));
        }
        _ => panic!("expected Routed"),
    }
}

#[test]
fn always_plus_on_success_both_match_on_succeeded() {
    let tgt_a = Uuid::new_v4();
    let tgt_b = Uuid::new_v4();
    let always_edge = make_edge_conditional(Uuid::new_v4(), tgt_a, ConditionKind::Always);
    let ok_edge = make_edge_conditional(Uuid::new_v4(), tgt_b, ConditionKind::OnSuccess);
    let edges = vec![&always_edge, &ok_edge];

    let decision = RouterEvaluator::evaluate(&NodeStatus::Succeeded, None, &edges);
    match decision {
        RouteDecision::Routed { selected_edge_ids, skipped_node_ids, .. } => {
            assert_eq!(selected_edge_ids.len(), 2);
            assert!(skipped_node_ids.is_empty());
        }
        _ => panic!("both edges should match"),
    }
}

#[test]
fn always_plus_on_failure_always_matches_on_failure_skipped_on_succeeded() {
    let tgt_a = Uuid::new_v4();
    let tgt_fail = Uuid::new_v4();
    let always_edge = make_edge_conditional(Uuid::new_v4(), tgt_a, ConditionKind::Always);
    let fail_edge = make_edge_conditional(Uuid::new_v4(), tgt_fail, ConditionKind::OnFailure);
    let edges = vec![&always_edge, &fail_edge];

    // Source succeeded → Always matches, OnFailure skipped.
    let decision = RouterEvaluator::evaluate(&NodeStatus::Succeeded, None, &edges);
    match decision {
        RouteDecision::Routed {
            selected_edge_ids,
            skipped_node_ids,
            ..
        } => {
            assert!(selected_edge_ids.contains(&always_edge.edge_id));
            assert!(!selected_edge_ids.contains(&fail_edge.edge_id));
            assert!(skipped_node_ids.contains(&tgt_fail));
        }
        _ => panic!("expected Routed"),
    }
}

// ---------------------------------------------------------------------------
// No outgoing edges (terminal node)
// ---------------------------------------------------------------------------

#[test]
fn no_outgoing_edges_returns_routed_empty() {
    let decision = RouterEvaluator::evaluate(&NodeStatus::Succeeded, None, &[]);
    match decision {
        RouteDecision::Routed {
            selected_edge_ids,
            skipped_node_ids,
            ..
        } => {
            assert!(selected_edge_ids.is_empty());
            assert!(skipped_node_ids.is_empty());
        }
        _ => panic!("terminal node should be Routed(empty)"),
    }
}

// ---------------------------------------------------------------------------
// Expression edge with missing/malformed payload
// ---------------------------------------------------------------------------

#[test]
fn expression_with_no_payload_does_not_match() {
    // Edge with Expression kind but condition_payload = None.
    let mut edge = make_edge_conditional(Uuid::new_v4(), Uuid::new_v4(), ConditionKind::Expression);
    edge.condition_payload = None;
    let edges = vec![&edge];
    let output = serde_json::json!({"key": "val"});
    let decision = RouterEvaluator::evaluate(&NodeStatus::Succeeded, Some(&output), &edges);
    assert!(matches!(decision, RouteDecision::NoMatch { .. }));
}

#[test]
fn expression_with_empty_object_payload_does_not_match() {
    let mut edge = make_edge_conditional(Uuid::new_v4(), Uuid::new_v4(), ConditionKind::Expression);
    edge.condition_payload = Some(serde_json::json!({}));
    let edges = vec![&edge];
    let output = serde_json::json!({"key": "val"});
    let decision = RouterEvaluator::evaluate(&NodeStatus::Succeeded, Some(&output), &edges);
    assert!(matches!(decision, RouteDecision::NoMatch { .. }));
}
