use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MemoryScope {
    RunShared,
    NodeLocal,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryState {
    pub run_id: Uuid,
    pub node_id: Option<Uuid>,
    pub scope: MemoryScope,
    pub data: serde_json::Value,
}
