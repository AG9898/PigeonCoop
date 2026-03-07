use serde::{Deserialize, Serialize};
use uuid::Uuid;
use chrono::{DateTime, Utc};

/// Base envelope for all run events. See EVENT_SCHEMA.md.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunEvent {
    pub event_id: Uuid,
    pub run_id: Uuid,
    pub workflow_id: Uuid,
    pub node_id: Option<Uuid>,
    pub event_type: String,
    pub timestamp: DateTime<Utc>,
    pub payload: serde_json::Value,
    pub causation_id: Option<Uuid>,
    pub correlation_id: Option<Uuid>,
}
