use serde::{Deserialize, Serialize};
use uuid::Uuid;
use chrono::{DateTime, Utc};

use crate::guardrail_events::GuardrailEventKind;
use crate::human_review_events::HumanReviewEventKind;
use crate::node_events::NodeEventKind;
use crate::run_events::RunEventKind;
use crate::routing_events::RoutingEventKind;

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

impl RunEvent {
    /// Construct a `RunEvent` envelope from a typed `RunEventKind`, automatically
    /// populating `event_type` and `payload` from the variant.
    pub fn from_run_kind(
        run_id: Uuid,
        workflow_id: Uuid,
        kind: &RunEventKind,
        causation_id: Option<Uuid>,
        correlation_id: Option<Uuid>,
    ) -> Self {
        Self {
            event_id: Uuid::new_v4(),
            run_id,
            workflow_id,
            node_id: None,
            event_type: kind.event_type_str().to_owned(),
            timestamp: Utc::now(),
            payload: kind.payload_value(),
            causation_id,
            correlation_id,
        }
    }

    /// Construct a `RunEvent` envelope from a typed `RoutingEventKind`.
    pub fn from_routing_kind(
        run_id: Uuid,
        workflow_id: Uuid,
        node_id: Option<Uuid>,
        kind: &RoutingEventKind,
        causation_id: Option<Uuid>,
        correlation_id: Option<Uuid>,
    ) -> Self {
        Self {
            event_id: Uuid::new_v4(),
            run_id,
            workflow_id,
            node_id,
            event_type: kind.event_type_str().to_owned(),
            timestamp: Utc::now(),
            payload: kind.payload_value(),
            causation_id,
            correlation_id,
        }
    }

    /// Construct a `RunEvent` envelope from a typed `HumanReviewEventKind`.
    pub fn from_review_kind(
        run_id: Uuid,
        workflow_id: Uuid,
        node_id: Uuid,
        kind: &HumanReviewEventKind,
        causation_id: Option<Uuid>,
        correlation_id: Option<Uuid>,
    ) -> Self {
        Self {
            event_id: Uuid::new_v4(),
            run_id,
            workflow_id,
            node_id: Some(node_id),
            event_type: kind.event_type_str().to_owned(),
            timestamp: Utc::now(),
            payload: kind.payload_value(),
            causation_id,
            correlation_id,
        }
    }

    /// Construct a `RunEvent` envelope from a typed `GuardrailEventKind`.
    pub fn from_guardrail_kind(
        run_id: Uuid,
        workflow_id: Uuid,
        node_id: Option<Uuid>,
        kind: &GuardrailEventKind,
        causation_id: Option<Uuid>,
        correlation_id: Option<Uuid>,
    ) -> Self {
        Self {
            event_id: Uuid::new_v4(),
            run_id,
            workflow_id,
            node_id,
            event_type: kind.event_type_str().to_owned(),
            timestamp: Utc::now(),
            payload: kind.payload_value(),
            causation_id,
            correlation_id,
        }
    }

    /// Construct a `RunEvent` envelope from a typed `NodeEventKind`.
    pub fn from_node_kind(
        run_id: Uuid,
        workflow_id: Uuid,
        node_id: Uuid,
        kind: &NodeEventKind,
        causation_id: Option<Uuid>,
        correlation_id: Option<Uuid>,
    ) -> Self {
        Self {
            event_id: Uuid::new_v4(),
            run_id,
            workflow_id,
            node_id: Some(node_id),
            event_type: kind.event_type_str().to_owned(),
            timestamp: Utc::now(),
            payload: kind.payload_value(),
            causation_id,
            correlation_id,
        }
    }
}
