use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Payload structs
// ---------------------------------------------------------------------------

/// Payload for `node.queued` — node has been enqueued for execution.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeQueuedPayload {
    pub node_type: String,
}

/// Payload for `node.started` — node execution has begun. See EVENT_SCHEMA.md §4.1.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeStartedPayload {
    pub node_type: String,
    pub attempt: u32,
    /// References to memory/output values supplied as inputs.
    pub input_refs: Vec<String>,
    pub workspace_root: String,
}

/// Payload for `node.waiting` — node is paused awaiting an external trigger
/// (e.g. human review gate).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeWaitingPayload {
    pub reason: Option<String>,
}

/// Payload for `node.succeeded` — node completed successfully.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeSucceededPayload {
    pub attempt: u32,
    pub duration_ms: u64,
}

/// Payload for `node.failed` — node execution terminated with an error.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeFailedPayload {
    pub attempt: u32,
    pub reason: String,
    pub duration_ms: Option<u64>,
}

/// Payload for `node.cancelled` — node was cancelled before completion.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeCancelledPayload {
    pub reason: Option<String>,
}

/// Payload for `node.skipped` — node was bypassed by a routing decision.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeSkippedPayload {
    pub reason: Option<String>,
}

/// Payload for `node.retry_scheduled` — a failed node will be retried.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeRetryScheduledPayload {
    pub attempt: u32,
    pub delay_ms: u64,
    pub reason: String,
}

// ---------------------------------------------------------------------------
// Typed discriminant enum
// ---------------------------------------------------------------------------

/// Typed discriminant for all node lifecycle events. See EVENT_SCHEMA.md §3.3.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "event_type", content = "payload", rename_all = "snake_case")]
pub enum NodeEventKind {
    #[serde(rename = "node.queued")]
    Queued(NodeQueuedPayload),
    #[serde(rename = "node.started")]
    Started(NodeStartedPayload),
    #[serde(rename = "node.waiting")]
    Waiting(NodeWaitingPayload),
    #[serde(rename = "node.succeeded")]
    Succeeded(NodeSucceededPayload),
    #[serde(rename = "node.failed")]
    Failed(NodeFailedPayload),
    #[serde(rename = "node.cancelled")]
    Cancelled(NodeCancelledPayload),
    #[serde(rename = "node.skipped")]
    Skipped(NodeSkippedPayload),
    #[serde(rename = "node.retry_scheduled")]
    RetryScheduled(NodeRetryScheduledPayload),
}

impl NodeEventKind {
    /// Returns the canonical event_type string for this variant.
    pub fn event_type_str(&self) -> &'static str {
        match self {
            NodeEventKind::Queued(_) => "node.queued",
            NodeEventKind::Started(_) => "node.started",
            NodeEventKind::Waiting(_) => "node.waiting",
            NodeEventKind::Succeeded(_) => "node.succeeded",
            NodeEventKind::Failed(_) => "node.failed",
            NodeEventKind::Cancelled(_) => "node.cancelled",
            NodeEventKind::Skipped(_) => "node.skipped",
            NodeEventKind::RetryScheduled(_) => "node.retry_scheduled",
        }
    }

    /// Serialise the inner payload to a `serde_json::Value`.
    pub fn payload_value(&self) -> serde_json::Value {
        match self {
            NodeEventKind::Queued(p) => serde_json::to_value(p),
            NodeEventKind::Started(p) => serde_json::to_value(p),
            NodeEventKind::Waiting(p) => serde_json::to_value(p),
            NodeEventKind::Succeeded(p) => serde_json::to_value(p),
            NodeEventKind::Failed(p) => serde_json::to_value(p),
            NodeEventKind::Cancelled(p) => serde_json::to_value(p),
            NodeEventKind::Skipped(p) => serde_json::to_value(p),
            NodeEventKind::RetryScheduled(p) => serde_json::to_value(p),
        }
        .unwrap_or(serde_json::Value::Null)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_eight_variants_serialize() {
        let variants: Vec<NodeEventKind> = vec![
            NodeEventKind::Queued(NodeQueuedPayload {
                node_type: "tool".into(),
            }),
            NodeEventKind::Started(NodeStartedPayload {
                node_type: "tool".into(),
                attempt: 1,
                input_refs: vec!["mem:run_shared:task_brief".into()],
                workspace_root: "/repo".into(),
            }),
            NodeEventKind::Waiting(NodeWaitingPayload {
                reason: Some("human review required".into()),
            }),
            NodeEventKind::Succeeded(NodeSucceededPayload {
                attempt: 1,
                duration_ms: 4_321,
            }),
            NodeEventKind::Failed(NodeFailedPayload {
                attempt: 1,
                reason: "exit code 1".into(),
                duration_ms: Some(1_000),
            }),
            NodeEventKind::Cancelled(NodeCancelledPayload {
                reason: Some("user cancelled run".into()),
            }),
            NodeEventKind::Skipped(NodeSkippedPayload {
                reason: Some("router selected other branch".into()),
            }),
            NodeEventKind::RetryScheduled(NodeRetryScheduledPayload {
                attempt: 2,
                delay_ms: 500,
                reason: "exit code 1".into(),
            }),
        ];

        assert_eq!(variants.len(), 8);
        for v in &variants {
            serde_json::to_string(v).expect("variant should serialize");
        }
    }

    #[test]
    fn node_started_payload_fields() {
        let kind = NodeEventKind::Started(NodeStartedPayload {
            node_type: "agent".into(),
            attempt: 2,
            input_refs: vec!["mem:run_shared:plan".into()],
            workspace_root: "/workspace".into(),
        });
        let payload = kind.payload_value();
        assert_eq!(payload["node_type"], "agent");
        assert_eq!(payload["attempt"], 2);
        assert_eq!(payload["input_refs"][0], "mem:run_shared:plan");
        assert_eq!(payload["workspace_root"], "/workspace");
    }

    #[test]
    fn event_type_str_matches_serde_tag() {
        let kind = NodeEventKind::Failed(NodeFailedPayload {
            attempt: 1,
            reason: "timeout".into(),
            duration_ms: None,
        });
        let v: serde_json::Value = serde_json::to_value(&kind).unwrap();
        assert_eq!(v["event_type"].as_str().unwrap(), kind.event_type_str());
    }

    #[test]
    fn node_started_round_trip() {
        let kind = NodeEventKind::Started(NodeStartedPayload {
            node_type: "tool".into(),
            attempt: 1,
            input_refs: vec![],
            workspace_root: "/repo".into(),
        });
        let json = serde_json::to_string(&kind).unwrap();
        let back: NodeEventKind = serde_json::from_str(&json).unwrap();
        match back {
            NodeEventKind::Started(p) => {
                assert_eq!(p.node_type, "tool");
                assert_eq!(p.attempt, 1);
                assert_eq!(p.workspace_root, "/repo");
            }
            other => panic!("unexpected variant: {:?}", other),
        }
    }

    #[test]
    fn retry_scheduled_has_correct_event_type() {
        let kind = NodeEventKind::RetryScheduled(NodeRetryScheduledPayload {
            attempt: 3,
            delay_ms: 1_000,
            reason: "flaky command".into(),
        });
        assert_eq!(kind.event_type_str(), "node.retry_scheduled");
        let v: serde_json::Value = serde_json::to_value(&kind).unwrap();
        assert_eq!(v["event_type"], "node.retry_scheduled");
        assert_eq!(v["payload"]["attempt"], 3);
    }
}
