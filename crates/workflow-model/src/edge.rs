use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConditionKind {
    Always,
    OnSuccess,
    OnFailure,
    Expression,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EdgeDefinition {
    pub edge_id: Uuid,
    pub source_node_id: Uuid,
    pub target_node_id: Uuid,
    pub condition_kind: ConditionKind,
    pub condition_payload: Option<serde_json::Value>,
    pub label: Option<String>,
}
