//! Integration-level unit tests for workflow-model.
//!
//! Tests are organised by the type they exercise.  Each section covers:
//! - construction / defaults
//! - JSON round-trip serialization
//! - enum variant coverage

use uuid::Uuid;
use chrono::Utc;
use serde_json::json;

use crate::constraints::RunConstraints;
use crate::edge::{ConditionKind, EdgeDefinition};
use crate::memory::{MemoryScope, MemoryState};
use crate::node::{NodeDefinition, NodeKind, NodeDisplay, RetryPolicy};
use crate::node_config::{AgentNodeConfig, NodeConfig, StartNodeConfig, EndNodeConfig};
use crate::workflow::{WorkflowDefinition, CURRENT_SCHEMA_VERSION};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn minimal_workflow() -> WorkflowDefinition {
    WorkflowDefinition {
        workflow_id: Uuid::new_v4(),
        name: "test-workflow".to_string(),
        schema_version: CURRENT_SCHEMA_VERSION,
        version: 1,
        metadata: json!({}),
        nodes: vec![],
        edges: vec![],
        default_constraints: RunConstraints::default(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
    }
}

fn agent_node_definition() -> NodeDefinition {
    NodeDefinition {
        node_id: Uuid::new_v4(),
        node_type: NodeKind::Agent,
        label: "Plan".to_string(),
        config: NodeConfig::Agent(AgentNodeConfig {
            prompt: "Analyze the task.".to_string(),
            command: None,
            provider_hint: None,
            model: None,
            output_mode: Default::default(),
        }),
        input_contract: json!({"task": "string"}),
        output_contract: json!({"plan": "string"}),
        memory_access: json!({}),
        retry_policy: RetryPolicy { max_retries: 1, max_runtime_ms: None },
        display: NodeDisplay { x: 100.0, y: 200.0 },
    }
}

// ---------------------------------------------------------------------------
// WorkflowDefinition tests
// ---------------------------------------------------------------------------

#[test]
fn workflow_definition_roundtrip_empty() {
    let wf = minimal_workflow();
    let json = serde_json::to_string(&wf).expect("serialize failed");
    let back: WorkflowDefinition = serde_json::from_str(&json).expect("deserialize failed");

    assert_eq!(wf.workflow_id, back.workflow_id);
    assert_eq!(wf.name, back.name);
    assert_eq!(wf.schema_version, back.schema_version);
    assert_eq!(wf.version, back.version);
    assert!(back.nodes.is_empty());
    assert!(back.edges.is_empty());
}

#[test]
fn workflow_definition_roundtrip_with_nodes_and_edges() {
    let src = Uuid::new_v4();
    let tgt = Uuid::new_v4();
    let mut wf = minimal_workflow();
    wf.nodes.push(agent_node_definition());
    wf.edges.push(EdgeDefinition {
        edge_id: Uuid::new_v4(),
        source_node_id: src,
        target_node_id: tgt,
        condition_kind: ConditionKind::OnSuccess,
        condition_payload: None,
        label: Some("ok".to_string()),
    });

    let json = serde_json::to_string(&wf).expect("serialize failed");
    let back: WorkflowDefinition = serde_json::from_str(&json).expect("deserialize failed");

    assert_eq!(back.nodes.len(), 1);
    assert_eq!(back.edges.len(), 1);
    assert_eq!(back.edges[0].source_node_id, src);
    assert_eq!(back.edges[0].target_node_id, tgt);
}

#[test]
fn workflow_definition_schema_version_defaults_when_absent() {
    // Hand-authored JSON without schema_version — should default to CURRENT_SCHEMA_VERSION.
    let json = format!(
        r#"{{
            "workflow_id": "00000000-0000-0000-0000-000000000001",
            "name": "hand-authored",
            "version": 1,
            "metadata": null,
            "nodes": [],
            "edges": [],
            "created_at": "2025-01-01T00:00:00Z",
            "updated_at": "2025-01-01T00:00:00Z"
        }}"#
    );
    let wf: WorkflowDefinition = serde_json::from_str(&json).expect("deserialize failed");
    assert_eq!(wf.schema_version, CURRENT_SCHEMA_VERSION);
}

#[test]
fn workflow_definition_constraints_default_when_absent() {
    // JSON without default_constraints — field carries RunConstraints::default().
    let json = r#"{
        "workflow_id": "00000000-0000-0000-0000-000000000002",
        "name": "no-constraints",
        "version": 1,
        "metadata": null,
        "nodes": [],
        "edges": [],
        "created_at": "2025-01-01T00:00:00Z",
        "updated_at": "2025-01-01T00:00:00Z"
    }"#;
    let wf: WorkflowDefinition = serde_json::from_str(json).expect("deserialize failed");
    assert_eq!(wf.default_constraints, RunConstraints::default());
}

// ---------------------------------------------------------------------------
// NodeKind all-variants tests
// ---------------------------------------------------------------------------

#[test]
fn node_kind_all_variants_roundtrip() {
    let kinds = [
        NodeKind::Start,
        NodeKind::End,
        NodeKind::Agent,
        NodeKind::Tool,
        NodeKind::Router,
        NodeKind::Memory,
        NodeKind::HumanReview,
    ];
    for kind in &kinds {
        let json = serde_json::to_string(kind).expect("serialize failed");
        let back: NodeKind = serde_json::from_str(&json).expect("deserialize failed");
        assert_eq!(kind, &back, "round-trip failed for {:?}", kind);
    }
}

#[test]
fn node_kind_snake_case_serialization() {
    assert_eq!(serde_json::to_string(&NodeKind::HumanReview).unwrap(), r#""human_review""#);
    assert_eq!(serde_json::to_string(&NodeKind::Start).unwrap(), r#""start""#);
    assert_eq!(serde_json::to_string(&NodeKind::End).unwrap(), r#""end""#);
    assert_eq!(serde_json::to_string(&NodeKind::Agent).unwrap(), r#""agent""#);
    assert_eq!(serde_json::to_string(&NodeKind::Tool).unwrap(), r#""tool""#);
    assert_eq!(serde_json::to_string(&NodeKind::Router).unwrap(), r#""router""#);
    assert_eq!(serde_json::to_string(&NodeKind::Memory).unwrap(), r#""memory""#);
}

// ---------------------------------------------------------------------------
// EdgeDefinition / ConditionKind tests
// ---------------------------------------------------------------------------

#[test]
fn condition_kind_all_variants_roundtrip() {
    let kinds = [
        ConditionKind::Always,
        ConditionKind::OnSuccess,
        ConditionKind::OnFailure,
        ConditionKind::Expression,
    ];
    for kind in &kinds {
        let json = serde_json::to_string(kind).expect("serialize failed");
        let back: ConditionKind = serde_json::from_str(&json).expect("deserialize failed");
        assert_eq!(kind, &back, "round-trip failed for {:?}", kind);
    }
}

#[test]
fn edge_definition_always_condition_roundtrip() {
    let edge = EdgeDefinition {
        edge_id: Uuid::new_v4(),
        source_node_id: Uuid::new_v4(),
        target_node_id: Uuid::new_v4(),
        condition_kind: ConditionKind::Always,
        condition_payload: None,
        label: None,
    };
    let json = serde_json::to_string(&edge).unwrap();
    let back: EdgeDefinition = serde_json::from_str(&json).unwrap();
    assert_eq!(edge.edge_id, back.edge_id);
    assert_eq!(back.condition_kind, ConditionKind::Always);
    assert!(back.condition_payload.is_none());
    assert!(back.label.is_none());
}

#[test]
fn edge_definition_expression_with_payload_roundtrip() {
    let edge = EdgeDefinition {
        edge_id: Uuid::new_v4(),
        source_node_id: Uuid::new_v4(),
        target_node_id: Uuid::new_v4(),
        condition_kind: ConditionKind::Expression,
        condition_payload: Some(json!({"expr": "passed == true"})),
        label: Some("pass".to_string()),
    };
    let json = serde_json::to_string(&edge).unwrap();
    let back: EdgeDefinition = serde_json::from_str(&json).unwrap();
    assert_eq!(back.condition_kind, ConditionKind::Expression);
    assert!(back.condition_payload.is_some());
    assert_eq!(back.label.as_deref(), Some("pass"));
}

#[test]
fn edge_definition_on_failure_roundtrip() {
    let edge = EdgeDefinition {
        edge_id: Uuid::new_v4(),
        source_node_id: Uuid::new_v4(),
        target_node_id: Uuid::new_v4(),
        condition_kind: ConditionKind::OnFailure,
        condition_payload: None,
        label: Some("retry".to_string()),
    };
    let json = serde_json::to_string(&edge).unwrap();
    let back: EdgeDefinition = serde_json::from_str(&json).unwrap();
    assert_eq!(back.condition_kind, ConditionKind::OnFailure);
}

// ---------------------------------------------------------------------------
// MemoryScope / MemoryState tests
// ---------------------------------------------------------------------------

#[test]
fn memory_scope_all_variants_roundtrip() {
    let scopes = [MemoryScope::RunShared, MemoryScope::NodeLocal];
    for scope in &scopes {
        let json = serde_json::to_string(scope).expect("serialize failed");
        let back: MemoryScope = serde_json::from_str(&json).expect("deserialize failed");
        assert_eq!(scope, &back, "round-trip failed for {:?}", scope);
    }
}

#[test]
fn memory_scope_snake_case_serialization() {
    assert_eq!(serde_json::to_string(&MemoryScope::RunShared).unwrap(), r#""run_shared""#);
    assert_eq!(serde_json::to_string(&MemoryScope::NodeLocal).unwrap(), r#""node_local""#);
}

#[test]
fn memory_state_run_shared_roundtrip() {
    let state = MemoryState {
        run_id: Uuid::new_v4(),
        node_id: None,
        scope: MemoryScope::RunShared,
        data: json!({"plan": "step 1, step 2"}),
    };
    let json = serde_json::to_string(&state).unwrap();
    let back: MemoryState = serde_json::from_str(&json).unwrap();
    assert_eq!(state.run_id, back.run_id);
    assert!(back.node_id.is_none());
    assert_eq!(back.scope, MemoryScope::RunShared);
    assert_eq!(back.data, json!({"plan": "step 1, step 2"}));
}

#[test]
fn memory_state_node_local_roundtrip() {
    let nid = Uuid::new_v4();
    let state = MemoryState {
        run_id: Uuid::new_v4(),
        node_id: Some(nid),
        scope: MemoryScope::NodeLocal,
        data: json!({"scratch": 42}),
    };
    let json = serde_json::to_string(&state).unwrap();
    let back: MemoryState = serde_json::from_str(&json).unwrap();
    assert_eq!(back.node_id, Some(nid));
    assert_eq!(back.scope, MemoryScope::NodeLocal);
}

#[test]
fn memory_state_empty_data_roundtrip() {
    let state = MemoryState {
        run_id: Uuid::new_v4(),
        node_id: None,
        scope: MemoryScope::RunShared,
        data: json!({}),
    };
    let json = serde_json::to_string(&state).unwrap();
    let back: MemoryState = serde_json::from_str(&json).unwrap();
    assert_eq!(back.data, json!({}));
}

// ---------------------------------------------------------------------------
// NodeDefinition start/end nodes
// ---------------------------------------------------------------------------

#[test]
fn start_node_definition_roundtrip() {
    let json = r#"{
        "node_id": "20000000-0000-0000-0000-000000000001",
        "node_type": "start",
        "label": "Start",
        "config": {},
        "input_contract": {},
        "output_contract": {},
        "memory_access": {},
        "retry_policy": {"max_retries": 0},
        "display": {"x": 0.0, "y": 0.0}
    }"#;
    let node: NodeDefinition = serde_json::from_str(json).expect("deserialize failed");
    assert_eq!(node.node_type, NodeKind::Start);
    assert!(matches!(node.config, NodeConfig::Start(StartNodeConfig {})));
    let back_json = serde_json::to_string(&node).unwrap();
    let back: NodeDefinition = serde_json::from_str(&back_json).unwrap();
    assert_eq!(back.node_type, NodeKind::Start);
}

#[test]
fn end_node_definition_roundtrip() {
    let json = r#"{
        "node_id": "20000000-0000-0000-0000-000000000002",
        "node_type": "end",
        "label": "End",
        "config": {},
        "input_contract": {},
        "output_contract": {},
        "memory_access": {},
        "retry_policy": {"max_retries": 0},
        "display": {"x": 1200.0, "y": 200.0}
    }"#;
    let node: NodeDefinition = serde_json::from_str(json).expect("deserialize failed");
    assert_eq!(node.node_type, NodeKind::End);
    assert!(matches!(node.config, NodeConfig::End(EndNodeConfig {})));
}
