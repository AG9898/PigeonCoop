// Shared test helpers for core-engine tests.

use chrono::Utc;
use uuid::Uuid;
use workflow_model::edge::{ConditionKind, EdgeDefinition};
use workflow_model::node::{NodeDefinition, NodeDisplay, NodeKind, RetryPolicy};
use workflow_model::node_config::{
    EndNodeConfig, NodeConfig, StartNodeConfig, ToolNodeConfig,
    AgentNodeConfig, RouterNodeConfig, MemoryNodeConfig, HumanReviewNodeConfig,
};
use workflow_model::run::{NodeSnapshot, NodeStatus, RunConstraints, RunInstance, RunStatus};
use workflow_model::workflow::WorkflowDefinition;
use event_model::event::RunEvent;
use crate::coordinator::{EventLog, RunCoordinator};
use crate::state_machine::RunTransitionInput;

// ---------------------------------------------------------------------------
// InMemoryEventLog
// ---------------------------------------------------------------------------

pub struct InMemoryEventLog {
    pub events: Vec<RunEvent>,
}

impl InMemoryEventLog {
    pub fn new() -> Self {
        Self { events: Vec::new() }
    }
}

impl EventLog for InMemoryEventLog {
    fn append(&mut self, event: RunEvent) -> Result<(), String> {
        self.events.push(event);
        Ok(())
    }
    fn events(&self) -> &[RunEvent] {
        &self.events
    }
}

// ---------------------------------------------------------------------------
// RunInstance helpers
// ---------------------------------------------------------------------------

pub fn make_run() -> RunInstance {
    RunInstance {
        run_id: Uuid::new_v4(),
        workflow_id: Uuid::new_v4(),
        workflow_version: 1,
        status: RunStatus::Created,
        workspace_root: "/tmp/test-workspace".into(),
        created_at: Utc::now(),
        started_at: None,
        ended_at: None,
        active_nodes: vec![],
        constraints: RunConstraints::default(),
        summary: None,
    }
}

pub fn make_run_with_status(status: RunStatus) -> RunInstance {
    RunInstance {
        status,
        ..make_run()
    }
}

// ---------------------------------------------------------------------------
// NodeSnapshot helpers
// ---------------------------------------------------------------------------

pub fn make_snapshot(node_id: Uuid, status: NodeStatus) -> NodeSnapshot {
    NodeSnapshot {
        node_id,
        status,
        attempt: 1,
        started_at: None,
        ended_at: None,
        output: None,
    }
}

// ---------------------------------------------------------------------------
// Coordinator helpers
// ---------------------------------------------------------------------------

pub fn make_coordinator() -> RunCoordinator<InMemoryEventLog> {
    RunCoordinator::new(make_run(), InMemoryEventLog::new())
}

pub fn make_coordinator_with_run(run: RunInstance) -> RunCoordinator<InMemoryEventLog> {
    RunCoordinator::new(run, InMemoryEventLog::new())
}

/// Advance a coordinator from Created to Running state.
pub fn advance_to_running(coord: &mut RunCoordinator<InMemoryEventLog>, node_count: u32) {
    coord
        .transition_run(RunTransitionInput::BeginValidation { node_count })
        .unwrap();
    coord
        .transition_run(RunTransitionInput::ValidationPassed { node_count })
        .unwrap();
    coord
        .transition_run(RunTransitionInput::Start { node_count })
        .unwrap();
}

// ---------------------------------------------------------------------------
// WorkflowDefinition helpers
// ---------------------------------------------------------------------------

pub fn make_node(node_id: Uuid, kind: NodeKind) -> NodeDefinition {
    let config = match kind {
        NodeKind::Start => NodeConfig::Start(StartNodeConfig {}),
        NodeKind::End => NodeConfig::End(EndNodeConfig {}),
        NodeKind::Agent => NodeConfig::Agent(AgentNodeConfig {
            prompt: "test prompt".into(),
            command: None,
            provider_hint: None,
            output_mode: Default::default(),
        }),
        NodeKind::Tool => NodeConfig::Tool(ToolNodeConfig {
            command: "echo test".into(),
            shell: None,
            timeout_ms: None,
        }),
        NodeKind::Router => NodeConfig::Router(RouterNodeConfig { rules: vec![] }),
        NodeKind::Memory => NodeConfig::Memory(MemoryNodeConfig {
            key: "test".into(),
            scope: "run_shared".into(),
            operation: "read".into(),
        }),
        NodeKind::HumanReview => NodeConfig::HumanReview(HumanReviewNodeConfig {
            prompt: None,
            reason: None,
            available_actions: None,
        }),
    };
    NodeDefinition {
        node_id,
        node_type: kind,
        label: "test-node".into(),
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

pub fn make_node_with_retries(node_id: Uuid, kind: NodeKind, max_retries: u32) -> NodeDefinition {
    let mut node = make_node(node_id, kind);
    node.retry_policy.max_retries = max_retries;
    node
}

pub fn make_edge(source: Uuid, target: Uuid) -> EdgeDefinition {
    EdgeDefinition {
        edge_id: Uuid::new_v4(),
        source_node_id: source,
        target_node_id: target,
        condition_kind: ConditionKind::Always,
        condition_payload: None,
        label: None,
    }
}

pub fn make_edge_conditional(
    source: Uuid,
    target: Uuid,
    kind: ConditionKind,
) -> EdgeDefinition {
    EdgeDefinition {
        edge_id: Uuid::new_v4(),
        source_node_id: source,
        target_node_id: target,
        condition_kind: kind,
        condition_payload: None,
        label: None,
    }
}

pub fn make_edge_expression(
    source: Uuid,
    target: Uuid,
    key: &str,
    equals: serde_json::Value,
) -> EdgeDefinition {
    EdgeDefinition {
        edge_id: Uuid::new_v4(),
        source_node_id: source,
        target_node_id: target,
        condition_kind: ConditionKind::Expression,
        condition_payload: Some(serde_json::json!({ "key": key, "equals": equals })),
        label: None,
    }
}

pub fn make_workflow(
    nodes: Vec<NodeDefinition>,
    edges: Vec<EdgeDefinition>,
) -> WorkflowDefinition {
    WorkflowDefinition {
        workflow_id: Uuid::new_v4(),
        name: "test-workflow".into(),
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
