// Dedicated workflow repository tests.
// Supplements the inline tests in repositories/workflows.rs with scenarios that
// exercise full serialization, version ordering, and edge-case behaviour.

use chrono::Utc;
use uuid::Uuid;
use workflow_model::constraints::RunConstraints;
use workflow_model::node::{NodeDefinition, NodeDisplay, NodeKind, RetryPolicy};
use workflow_model::node_config::{AgentNodeConfig, AgentOutputMode, NodeConfig, ToolNodeConfig};
use workflow_model::workflow::{WorkflowDefinition, CURRENT_SCHEMA_VERSION};

use crate::repositories::workflows::{
    delete_workflow, get_workflow_by_id, get_workflow_version, list_workflows, save_workflow,
    save_workflow_version,
};
use crate::sqlite::Db;

fn db() -> Db {
    Db::open_in_memory().expect("in-memory db")
}

fn simple_workflow(name: &str) -> WorkflowDefinition {
    WorkflowDefinition {
        workflow_id: Uuid::new_v4(),
        name: name.to_string(),
        schema_version: CURRENT_SCHEMA_VERSION,
        version: 1,
        metadata: serde_json::Value::Null,
        nodes: vec![],
        edges: vec![],
        default_constraints: RunConstraints::default(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
    }
}

fn make_node(kind: NodeKind, config: NodeConfig, label: &str) -> NodeDefinition {
    NodeDefinition {
        node_id: Uuid::new_v4(),
        node_type: kind,
        label: label.to_string(),
        config,
        input_contract: serde_json::Value::Null,
        output_contract: serde_json::Value::Null,
        memory_access: serde_json::Value::Null,
        retry_policy: RetryPolicy {
            max_retries: 0,
            max_runtime_ms: None,
        },
        display: NodeDisplay { x: 0.0, y: 0.0 },
    }
}

// ── Full serialization roundtrip ──────────────────────────────────────────────

#[test]
fn roundtrip_workflow_with_nodes_and_metadata() {
    let db = db();

    let start = make_node(
        NodeKind::Start,
        NodeConfig::Start(workflow_model::node_config::StartNodeConfig {}),
        "Start",
    );
    let end = make_node(
        NodeKind::End,
        NodeConfig::End(workflow_model::node_config::EndNodeConfig {}),
        "End",
    );

    let wf = WorkflowDefinition {
        workflow_id: Uuid::new_v4(),
        name: "wf-with-nodes".into(),
        schema_version: CURRENT_SCHEMA_VERSION,
        version: 1,
        metadata: serde_json::json!({ "description": "workflow with nodes" }),
        nodes: vec![start, end],
        edges: vec![],
        default_constraints: RunConstraints::default(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
    };

    save_workflow(&db, &wf).expect("save");

    let loaded = get_workflow_by_id(&db, wf.workflow_id)
        .expect("query")
        .expect("should exist");

    assert_eq!(loaded.workflow_id, wf.workflow_id);
    assert_eq!(loaded.nodes.len(), 2);
    assert_eq!(
        loaded.metadata,
        serde_json::json!({ "description": "workflow with nodes" })
    );
}

// ── Upsert: save_workflow updates metadata row ────────────────────────────────

#[test]
fn save_workflow_twice_upserts_metadata_row() {
    let db = db();
    let wf = simple_workflow("alpha");
    save_workflow(&db, &wf).expect("first save");

    let mut updated = wf.clone();
    updated.name = "alpha-renamed".into();
    updated.version = 2;
    save_workflow(&db, &updated).expect("second save");

    let list = list_workflows(&db).expect("list");
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].version, 2);
    assert_eq!(list[0].name, "alpha-renamed");
}

// ── list_workflows returns latest version per workflow ────────────────────────

#[test]
fn list_workflows_returns_only_latest_version_per_workflow() {
    let db = db();
    let wf = simple_workflow("multi-version");
    save_workflow(&db, &wf).expect("save v1");

    let mut v2 = wf.clone();
    v2.version = 2;
    save_workflow_version(&db, &v2).expect("save v2 snapshot");

    let mut v3 = wf.clone();
    v3.version = 3;
    save_workflow_version(&db, &v3).expect("save v3 snapshot");

    // One workflow_id → one list entry, should be v3
    let list = list_workflows(&db).expect("list");
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].version, 3);
}

// ── get_workflow_version returns exact snapshot ───────────────────────────────

#[test]
fn get_workflow_version_returns_exact_snapshot() {
    let db = db();
    let wf = simple_workflow("snap");
    save_workflow(&db, &wf).expect("save v1");

    let mut v2 = wf.clone();
    v2.version = 2;
    v2.name = "snap-v2".into();
    save_workflow_version(&db, &v2).expect("save v2");

    let snap1 = get_workflow_version(&db, wf.workflow_id, 1)
        .expect("query")
        .expect("v1 exists");
    assert_eq!(snap1.name, "snap");

    let snap2 = get_workflow_version(&db, wf.workflow_id, 2)
        .expect("query")
        .expect("v2 exists");
    assert_eq!(snap2.name, "snap-v2");
}

// ── delete_workflow on unknown ID is a no-op ─────────────────────────────────

#[test]
fn delete_nonexistent_workflow_is_no_op() {
    let db = db();
    delete_workflow(&db, Uuid::new_v4()).expect("delete nonexistent");
    let list = list_workflows(&db).expect("list");
    assert!(list.is_empty());
}

// ── Multiple independent workflows ───────────────────────────────────────────

#[test]
fn multiple_workflows_are_independent() {
    let db = db();
    let wf_a = simple_workflow("wf-a");
    let wf_b = simple_workflow("wf-b");
    let wf_c = simple_workflow("wf-c");

    save_workflow(&db, &wf_a).expect("save a");
    save_workflow(&db, &wf_b).expect("save b");
    save_workflow(&db, &wf_c).expect("save c");

    let a = get_workflow_by_id(&db, wf_a.workflow_id).unwrap().unwrap();
    let b = get_workflow_by_id(&db, wf_b.workflow_id).unwrap().unwrap();
    let c = get_workflow_by_id(&db, wf_c.workflow_id).unwrap().unwrap();
    assert_eq!(a.name, "wf-a");
    assert_eq!(b.name, "wf-b");
    assert_eq!(c.name, "wf-c");

    let list = list_workflows(&db).unwrap();
    assert_eq!(list.len(), 3);

    delete_workflow(&db, wf_b.workflow_id).expect("delete b");
    let list_after = list_workflows(&db).unwrap();
    assert_eq!(list_after.len(), 2);
    assert!(list_after.iter().all(|w| w.name != "wf-b"));
}

// ── Agent and Tool node configs round-trip ────────────────────────────────────

#[test]
fn agent_and_tool_nodes_round_trip_config() {
    let db = db();

    let agent = make_node(
        NodeKind::Agent,
        NodeConfig::Agent(AgentNodeConfig {
            prompt: "Analyze the repo.".into(),
            command: Some("claude".into()),
            provider_hint: Some("claude-sonnet-4-6".into()),
            output_mode: AgentOutputMode::Raw,
        }),
        "Plan",
    );
    let tool = make_node(
        NodeKind::Tool,
        NodeConfig::Tool(ToolNodeConfig {
            command: "cargo test".into(),
            shell: Some("bash".into()),
            timeout_ms: Some(30_000),
        }),
        "Build",
    );

    let wf = WorkflowDefinition {
        workflow_id: Uuid::new_v4(),
        name: "agent-tool".into(),
        schema_version: CURRENT_SCHEMA_VERSION,
        version: 1,
        metadata: serde_json::Value::Null,
        nodes: vec![agent, tool],
        edges: vec![],
        default_constraints: RunConstraints::default(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
    };

    save_workflow(&db, &wf).expect("save");

    let loaded = get_workflow_by_id(&db, wf.workflow_id).unwrap().unwrap();
    assert_eq!(loaded.nodes.len(), 2);

    let loaded_agent = &loaded.nodes[0];
    assert_eq!(loaded_agent.node_type, NodeKind::Agent);
    match &loaded_agent.config {
        NodeConfig::Agent(cfg) => {
            assert_eq!(cfg.prompt, "Analyze the repo.");
            assert_eq!(cfg.command, Some("claude".into()));
        }
        other => panic!("expected Agent config, got: {:?}", other),
    }

    let loaded_tool = &loaded.nodes[1];
    assert_eq!(loaded_tool.node_type, NodeKind::Tool);
    match &loaded_tool.config {
        NodeConfig::Tool(cfg) => {
            assert_eq!(cfg.command, "cargo test");
            assert_eq!(cfg.timeout_ms, Some(30_000));
        }
        other => panic!("expected Tool config, got: {:?}", other),
    }
}
