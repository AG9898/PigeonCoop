use serde::{Deserialize, Serialize};

/// Payload for `agent.request_prepared` — the agent prompt/request has been
/// assembled and is ready to dispatch to the provider.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRequestPreparedPayload {
    /// Name or identifier of the agent provider/model being called.
    pub provider: String,
    /// Approximate token count of the assembled prompt.
    pub prompt_tokens: Option<u32>,
    /// Keys from run memory that were injected into the prompt.
    pub memory_keys_used: Vec<String>,
}

/// Payload for `agent.started` — the request has been dispatched; waiting for
/// the first byte of the response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentStartedPayload {
    pub provider: String,
    /// Monotonic start timestamp offset from run start, in milliseconds.
    pub run_elapsed_ms: u64,
}

/// Payload for `agent.output_received` — a chunk of agent output arrived
/// (streaming or final).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentOutputReceivedPayload {
    /// Raw text chunk from the provider.
    pub chunk: String,
    /// Cumulative character count received so far.
    pub cumulative_chars: u64,
    /// True if this is the final/complete chunk.
    pub is_final: bool,
}

/// Payload for `agent.completed` — the agent call finished successfully.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentCompletedPayload {
    pub provider: String,
    pub duration_ms: u64,
    /// Input tokens consumed, if reported by provider.
    pub input_tokens: Option<u32>,
    /// Output tokens generated, if reported by provider.
    pub output_tokens: Option<u32>,
    /// Key under which the agent output was stored in run memory, if any.
    pub output_memory_key: Option<String>,
}

/// Payload for `agent.failed` — the agent call failed.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentFailedPayload {
    pub provider: String,
    pub reason: String,
    /// HTTP status or provider error code, if applicable.
    pub error_code: Option<String>,
    pub duration_ms: Option<u64>,
}

/// Typed discriminant for all agent interaction events.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "event_type", content = "payload", rename_all = "snake_case")]
pub enum AgentEventKind {
    #[serde(rename = "agent.request_prepared")]
    RequestPrepared(AgentRequestPreparedPayload),
    #[serde(rename = "agent.started")]
    Started(AgentStartedPayload),
    #[serde(rename = "agent.output_received")]
    OutputReceived(AgentOutputReceivedPayload),
    #[serde(rename = "agent.completed")]
    Completed(AgentCompletedPayload),
    #[serde(rename = "agent.failed")]
    Failed(AgentFailedPayload),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agent_request_prepared_round_trip() {
        let p = AgentRequestPreparedPayload {
            provider: "claude-sonnet-4-6".into(),
            prompt_tokens: Some(1200),
            memory_keys_used: vec!["task_brief".into(), "repo_context".into()],
        };
        let json = serde_json::to_string(&p).unwrap();
        let back: AgentRequestPreparedPayload = serde_json::from_str(&json).unwrap();
        assert_eq!(back.provider, "claude-sonnet-4-6");
        assert_eq!(back.memory_keys_used.len(), 2);
    }

    #[test]
    fn agent_started_payload_fields() {
        let p = AgentStartedPayload {
            provider: "claude-opus-4-6".into(),
            run_elapsed_ms: 250,
        };
        let v: serde_json::Value = serde_json::to_value(&p).unwrap();
        assert_eq!(v["provider"], "claude-opus-4-6");
        assert_eq!(v["run_elapsed_ms"], 250);
    }

    #[test]
    fn agent_output_received_round_trip() {
        let p = AgentOutputReceivedPayload {
            chunk: "Here is my plan:".into(),
            cumulative_chars: 16,
            is_final: false,
        };
        let json = serde_json::to_string(&p).unwrap();
        let back: AgentOutputReceivedPayload = serde_json::from_str(&json).unwrap();
        assert_eq!(back.cumulative_chars, 16);
        assert!(!back.is_final);
    }

    #[test]
    fn agent_completed_round_trip() {
        let p = AgentCompletedPayload {
            provider: "claude-sonnet-4-6".into(),
            duration_ms: 3500,
            input_tokens: Some(1200),
            output_tokens: Some(400),
            output_memory_key: Some("plan_output".into()),
        };
        let json = serde_json::to_string(&p).unwrap();
        let back: AgentCompletedPayload = serde_json::from_str(&json).unwrap();
        assert_eq!(back.duration_ms, 3500);
        assert_eq!(back.output_memory_key.as_deref(), Some("plan_output"));
    }

    #[test]
    fn agent_failed_optional_fields() {
        let p = AgentFailedPayload {
            provider: "claude-sonnet-4-6".into(),
            reason: "rate limit exceeded".into(),
            error_code: Some("429".into()),
            duration_ms: None,
        };
        let json = serde_json::to_string(&p).unwrap();
        let back: AgentFailedPayload = serde_json::from_str(&json).unwrap();
        assert!(back.duration_ms.is_none());
        assert_eq!(back.error_code.as_deref(), Some("429"));
    }

    #[test]
    fn agent_event_kind_serializes_with_tag() {
        let event = AgentEventKind::Completed(AgentCompletedPayload {
            provider: "claude-sonnet-4-6".into(),
            duration_ms: 1000,
            input_tokens: None,
            output_tokens: None,
            output_memory_key: None,
        });
        let v: serde_json::Value = serde_json::to_value(&event).unwrap();
        assert_eq!(v["event_type"], "agent.completed");
        assert_eq!(v["payload"]["provider"], "claude-sonnet-4-6");
    }

    #[test]
    fn all_five_variants_serialize() {
        let variants: Vec<AgentEventKind> = vec![
            AgentEventKind::RequestPrepared(AgentRequestPreparedPayload {
                provider: "p".into(),
                prompt_tokens: None,
                memory_keys_used: vec![],
            }),
            AgentEventKind::Started(AgentStartedPayload {
                provider: "p".into(),
                run_elapsed_ms: 0,
            }),
            AgentEventKind::OutputReceived(AgentOutputReceivedPayload {
                chunk: "x".into(),
                cumulative_chars: 1,
                is_final: false,
            }),
            AgentEventKind::Completed(AgentCompletedPayload {
                provider: "p".into(),
                duration_ms: 100,
                input_tokens: None,
                output_tokens: None,
                output_memory_key: None,
            }),
            AgentEventKind::Failed(AgentFailedPayload {
                provider: "p".into(),
                reason: "err".into(),
                error_code: None,
                duration_ms: None,
            }),
        ];
        assert_eq!(variants.len(), 5);
        for v in &variants {
            serde_json::to_string(v).expect("variant should serialize");
        }
    }
}
