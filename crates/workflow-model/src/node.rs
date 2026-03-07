use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// All valid node types in v1. See ARCHITECTURE.md §6.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NodeKind {
    Start,
    End,
    Agent,
    Tool,
    Router,
    Memory,
    HumanReview,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeDefinition {
    pub node_id: Uuid,
    pub node_type: NodeKind,
    pub label: String,
    pub config: serde_json::Value,
    pub input_contract: serde_json::Value,
    pub output_contract: serde_json::Value,
    pub memory_access: serde_json::Value,
    pub retry_policy: RetryPolicy,
    pub display: NodeDisplay,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetryPolicy {
    pub max_retries: u32,
    pub max_runtime_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeDisplay {
    pub x: f64,
    pub y: f64,
}
