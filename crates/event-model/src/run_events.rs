use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Payload structs
// ---------------------------------------------------------------------------

/// Payload for `run.created` — a new RunInstance has been initialised.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunCreatedPayload {
    /// ID of the workflow definition being executed.
    pub workflow_id: Uuid,
    pub workflow_version: u32,
    /// Filesystem path the run operates against.
    pub workspace_root: String,
}

/// Payload for `run.validation_started` — pre-flight validation has begun.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunValidationStartedPayload {
    /// Number of nodes being validated.
    pub node_count: u32,
}

/// Payload for `run.validation_passed` — validation completed successfully.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunValidationPassedPayload {
    pub node_count: u32,
}

/// Payload for `run.validation_failed` — validation found errors; run will not start.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunValidationFailedPayload {
    pub reason: String,
    /// Individual validation error messages, if any.
    pub errors: Vec<String>,
}

/// Payload for `run.started` — execution has begun after successful validation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunStartedPayload {
    pub node_count: u32,
}

/// Payload for `run.paused` — execution paused, e.g. at a human-review gate.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunPausedPayload {
    pub reason: Option<String>,
    /// IDs of nodes that are currently waiting (e.g. in review state).
    pub waiting_node_ids: Vec<Uuid>,
}

/// Payload for `run.resumed` — a paused run has been resumed.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunResumedPayload {
    pub resumed_by: Option<String>,
}

/// Payload for `run.succeeded` — all nodes completed successfully.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunSucceededPayload {
    pub duration_ms: u64,
    pub steps_executed: u32,
}

/// Payload for `run.failed` — run terminated due to an unrecoverable error.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunFailedPayload {
    pub reason: String,
    /// Node that caused the failure, if determinable.
    pub failed_node_id: Option<Uuid>,
    pub duration_ms: Option<u64>,
}

/// Payload for `run.cancelled` — run was stopped before completion.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunCancelledPayload {
    pub reason: Option<String>,
    pub duration_ms: Option<u64>,
}

// ---------------------------------------------------------------------------
// Typed discriminant enum
// ---------------------------------------------------------------------------

/// Typed discriminant for all run lifecycle events. See EVENT_SCHEMA.md §3.2.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "event_type", content = "payload", rename_all = "snake_case")]
pub enum RunEventKind {
    #[serde(rename = "run.created")]
    Created(RunCreatedPayload),
    #[serde(rename = "run.validation_started")]
    ValidationStarted(RunValidationStartedPayload),
    #[serde(rename = "run.validation_passed")]
    ValidationPassed(RunValidationPassedPayload),
    #[serde(rename = "run.validation_failed")]
    ValidationFailed(RunValidationFailedPayload),
    #[serde(rename = "run.started")]
    Started(RunStartedPayload),
    #[serde(rename = "run.paused")]
    Paused(RunPausedPayload),
    #[serde(rename = "run.resumed")]
    Resumed(RunResumedPayload),
    #[serde(rename = "run.succeeded")]
    Succeeded(RunSucceededPayload),
    #[serde(rename = "run.failed")]
    Failed(RunFailedPayload),
    #[serde(rename = "run.cancelled")]
    Cancelled(RunCancelledPayload),
}

impl RunEventKind {
    /// Returns the canonical event_type string for this variant.
    pub fn event_type_str(&self) -> &'static str {
        match self {
            RunEventKind::Created(_) => "run.created",
            RunEventKind::ValidationStarted(_) => "run.validation_started",
            RunEventKind::ValidationPassed(_) => "run.validation_passed",
            RunEventKind::ValidationFailed(_) => "run.validation_failed",
            RunEventKind::Started(_) => "run.started",
            RunEventKind::Paused(_) => "run.paused",
            RunEventKind::Resumed(_) => "run.resumed",
            RunEventKind::Succeeded(_) => "run.succeeded",
            RunEventKind::Failed(_) => "run.failed",
            RunEventKind::Cancelled(_) => "run.cancelled",
        }
    }

    /// Serialise the inner payload to a `serde_json::Value`.
    pub fn payload_value(&self) -> serde_json::Value {
        match self {
            RunEventKind::Created(p) => serde_json::to_value(p),
            RunEventKind::ValidationStarted(p) => serde_json::to_value(p),
            RunEventKind::ValidationPassed(p) => serde_json::to_value(p),
            RunEventKind::ValidationFailed(p) => serde_json::to_value(p),
            RunEventKind::Started(p) => serde_json::to_value(p),
            RunEventKind::Paused(p) => serde_json::to_value(p),
            RunEventKind::Resumed(p) => serde_json::to_value(p),
            RunEventKind::Succeeded(p) => serde_json::to_value(p),
            RunEventKind::Failed(p) => serde_json::to_value(p),
            RunEventKind::Cancelled(p) => serde_json::to_value(p),
        }
        .unwrap_or(serde_json::Value::Null)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_ten_variants_serialize() {
        let run_id = Uuid::new_v4();
        let wf_id = Uuid::new_v4();

        let variants: Vec<RunEventKind> = vec![
            RunEventKind::Created(RunCreatedPayload {
                workflow_id: wf_id,
                workflow_version: 1,
                workspace_root: "/repo".into(),
            }),
            RunEventKind::ValidationStarted(RunValidationStartedPayload { node_count: 4 }),
            RunEventKind::ValidationPassed(RunValidationPassedPayload { node_count: 4 }),
            RunEventKind::ValidationFailed(RunValidationFailedPayload {
                reason: "missing start node".into(),
                errors: vec!["no start node found".into()],
            }),
            RunEventKind::Started(RunStartedPayload { node_count: 4 }),
            RunEventKind::Paused(RunPausedPayload {
                reason: Some("human review required".into()),
                waiting_node_ids: vec![run_id],
            }),
            RunEventKind::Resumed(RunResumedPayload {
                resumed_by: Some("user@example.com".into()),
            }),
            RunEventKind::Succeeded(RunSucceededPayload {
                duration_ms: 12_345,
                steps_executed: 4,
            }),
            RunEventKind::Failed(RunFailedPayload {
                reason: "tool node exited with code 1".into(),
                failed_node_id: Some(run_id),
                duration_ms: Some(5_000),
            }),
            RunEventKind::Cancelled(RunCancelledPayload {
                reason: Some("user requested cancel".into()),
                duration_ms: Some(1_000),
            }),
        ];

        assert_eq!(variants.len(), 10);
        for v in &variants {
            serde_json::to_string(v).expect("variant should serialize");
        }
    }

    #[test]
    fn run_event_kind_serializes_with_tag() {
        let kind = RunEventKind::Started(RunStartedPayload { node_count: 3 });
        let v: serde_json::Value = serde_json::to_value(&kind).unwrap();
        assert_eq!(v["event_type"], "run.started");
        assert_eq!(v["payload"]["node_count"], 3);
    }

    #[test]
    fn run_event_kind_round_trip() {
        let wf_id = Uuid::new_v4();
        let kind = RunEventKind::Created(RunCreatedPayload {
            workflow_id: wf_id,
            workflow_version: 2,
            workspace_root: "/workspace".into(),
        });
        let json = serde_json::to_string(&kind).unwrap();
        let back: RunEventKind = serde_json::from_str(&json).unwrap();
        match back {
            RunEventKind::Created(p) => {
                assert_eq!(p.workflow_id, wf_id);
                assert_eq!(p.workflow_version, 2);
                assert_eq!(p.workspace_root, "/workspace");
            }
            other => panic!("unexpected variant: {:?}", other),
        }
    }

    #[test]
    fn event_type_str_matches_serde_tag() {
        let kind = RunEventKind::ValidationFailed(RunValidationFailedPayload {
            reason: "bad".into(),
            errors: vec![],
        });
        let v: serde_json::Value = serde_json::to_value(&kind).unwrap();
        assert_eq!(v["event_type"].as_str().unwrap(), kind.event_type_str());
    }

    #[test]
    fn payload_value_matches_inner_payload() {
        let kind = RunEventKind::Succeeded(RunSucceededPayload {
            duration_ms: 999,
            steps_executed: 7,
        });
        let payload = kind.payload_value();
        assert_eq!(payload["duration_ms"], 999);
        assert_eq!(payload["steps_executed"], 7);
    }
}
