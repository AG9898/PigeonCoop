use serde::{Deserialize, Serialize};
use uuid::Uuid;
use chrono::{DateTime, Utc};
use crate::workflow::WorkflowDefinition;

/// Per-node lifecycle states. See ARCHITECTURE.md §7.3.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NodeStatus {
    Draft,
    Validated,
    Ready,
    Queued,
    Running,
    Waiting,
    Succeeded,
    Failed,
    Cancelled,
    Skipped,
}

/// Snapshot of a single node's state within a run.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeSnapshot {
    pub node_id: Uuid,
    pub status: NodeStatus,
    pub attempt: u32,
    pub started_at: Option<DateTime<Utc>>,
    pub ended_at: Option<DateTime<Utc>>,
    /// Serialized output produced by the node, if any.
    pub output: Option<serde_json::Value>,
}

/// Run lifecycle states. See ARCHITECTURE.md §7.2.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunStatus {
    Created,
    Validating,
    Ready,
    Running,
    Paused,
    Succeeded,
    Failed,
    Cancelled,
}

/// Guardrail limits applied to a run.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunConstraints {
    pub max_retries: u32,
    pub max_runtime_ms: Option<u64>,
    pub max_steps: Option<u32>,
}

impl Default for RunConstraints {
    fn default() -> Self {
        Self {
            max_retries: 3,
            max_runtime_ms: None,
            max_steps: None,
        }
    }
}

/// One execution of a WorkflowDefinition. See ARCHITECTURE.md §5.4.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunInstance {
    pub run_id: Uuid,
    pub workflow_id: Uuid,
    pub workflow_version: u32,
    pub status: RunStatus,
    pub workspace_root: String,
    pub created_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub ended_at: Option<DateTime<Utc>>,
    /// Node IDs currently executing or queued.
    pub active_nodes: Vec<Uuid>,
    pub constraints: RunConstraints,
    /// Optional human-readable summary (populated on completion).
    pub summary: Option<String>,
}

impl RunInstance {
    /// Construct a new RunInstance from a WorkflowDefinition reference.
    pub fn from_workflow(workflow: &WorkflowDefinition, workspace_root: impl Into<String>) -> Self {
        Self {
            run_id: Uuid::new_v4(),
            workflow_id: workflow.workflow_id,
            workflow_version: workflow.version,
            status: RunStatus::Created,
            workspace_root: workspace_root.into(),
            created_at: Utc::now(),
            started_at: None,
            ended_at: None,
            active_nodes: Vec::new(),
            constraints: RunConstraints::default(),
            summary: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workflow::WorkflowDefinition;

    fn make_workflow() -> WorkflowDefinition {
        WorkflowDefinition {
            workflow_id: Uuid::new_v4(),
            name: "test-workflow".into(),
            version: 1,
            metadata: serde_json::Value::Null,
            nodes: vec![],
            edges: vec![],
            default_constraints: serde_json::Value::Null,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    #[test]
    fn run_instance_from_workflow() {
        let wf = make_workflow();
        let run = RunInstance::from_workflow(&wf, "/tmp/workspace");
        assert_eq!(run.workflow_id, wf.workflow_id);
        assert_eq!(run.workflow_version, 1);
        assert_eq!(run.status, RunStatus::Created);
        assert_eq!(run.workspace_root, "/tmp/workspace");
        assert!(run.started_at.is_none());
        assert!(run.ended_at.is_none());
        assert!(run.active_nodes.is_empty());
    }

    #[test]
    fn run_status_all_variants_roundtrip() {
        let statuses = [
            RunStatus::Created,
            RunStatus::Validating,
            RunStatus::Ready,
            RunStatus::Running,
            RunStatus::Paused,
            RunStatus::Succeeded,
            RunStatus::Failed,
            RunStatus::Cancelled,
        ];
        for status in &statuses {
            let json = serde_json::to_string(status).unwrap();
            let back: RunStatus = serde_json::from_str(&json).unwrap();
            assert_eq!(status, &back);
        }
    }

    #[test]
    fn run_instance_serializes_to_json() {
        let wf = make_workflow();
        let run = RunInstance::from_workflow(&wf, "/tmp/workspace");
        let json = serde_json::to_string(&run).expect("serialization failed");
        let back: RunInstance = serde_json::from_str(&json).expect("deserialization failed");
        assert_eq!(run.run_id, back.run_id);
        assert_eq!(run.workflow_id, back.workflow_id);
        assert_eq!(run.status, back.status);
    }

    #[test]
    fn node_status_all_variants_roundtrip() {
        let statuses = [
            NodeStatus::Draft,
            NodeStatus::Validated,
            NodeStatus::Ready,
            NodeStatus::Queued,
            NodeStatus::Running,
            NodeStatus::Waiting,
            NodeStatus::Succeeded,
            NodeStatus::Failed,
            NodeStatus::Cancelled,
            NodeStatus::Skipped,
        ];
        for status in &statuses {
            let json = serde_json::to_string(status).unwrap();
            let back: NodeStatus = serde_json::from_str(&json).unwrap();
            assert_eq!(status, &back);
        }
    }

    #[test]
    fn node_snapshot_serializes_to_json() {
        let snap = NodeSnapshot {
            node_id: Uuid::new_v4(),
            status: NodeStatus::Succeeded,
            attempt: 1,
            started_at: Some(Utc::now()),
            ended_at: Some(Utc::now()),
            output: Some(serde_json::json!({"result": "ok"})),
        };
        let json = serde_json::to_string(&snap).expect("serialization failed");
        let back: NodeSnapshot = serde_json::from_str(&json).expect("deserialization failed");
        assert_eq!(snap.node_id, back.node_id);
        assert_eq!(snap.status, back.status);
        assert_eq!(snap.attempt, back.attempt);
        assert!(back.output.is_some());
    }

    #[test]
    fn node_snapshot_minimal_roundtrip() {
        let snap = NodeSnapshot {
            node_id: Uuid::new_v4(),
            status: NodeStatus::Queued,
            attempt: 0,
            started_at: None,
            ended_at: None,
            output: None,
        };
        let json = serde_json::to_string(&snap).unwrap();
        let back: NodeSnapshot = serde_json::from_str(&json).unwrap();
        assert_eq!(snap.node_id, back.node_id);
        assert_eq!(back.started_at, None);
        assert_eq!(back.output, None);
    }
}
