use serde::{Deserialize, Serialize};
use crate::node::NodeKind;

// ---------------------------------------------------------------------------
// Per-kind config structs
// ---------------------------------------------------------------------------

/// Config for Start nodes. Start nodes take no configuration.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct StartNodeConfig {}

/// Config for End nodes. End nodes take no configuration.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct EndNodeConfig {}

/// Config for Agent nodes.
///
/// Required:
/// - `prompt`: the instruction text sent to the agent.
///
/// Optional:
/// - `provider_hint`: preferred provider/model key (e.g. `"claude-sonnet-4-6"`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AgentNodeConfig {
    /// The instruction or prompt template for this agent step.
    pub prompt: String,
    /// Optional hint for the execution adapter about which provider/model to use.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_hint: Option<String>,
}

/// Config for Tool nodes.
///
/// Required:
/// - `command`: the shell command to execute.
///
/// Optional:
/// - `shell`: shell binary (defaults to system shell when absent).
/// - `timeout_ms`: maximum execution time in milliseconds.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ToolNodeConfig {
    /// The shell command to execute (e.g. `"cargo test"`).
    pub command: String,
    /// Shell to invoke (e.g. `"bash"`). Absent means use the system default.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shell: Option<String>,
    /// Hard timeout for the command in milliseconds.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<u64>,
}

/// A single routing rule evaluated by a Router node.
///
/// `condition` is a string expression the engine evaluates against run memory.
/// `target_key` is the output key written with `"true"` or `"false"` to drive
/// the downstream edge selector.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RoutingRule {
    /// Expression evaluated against run memory/outputs (e.g. `"passed == true"`).
    pub condition: String,
    /// The memory or output key that receives the boolean result.
    pub target_key: String,
}

/// Config for Router nodes.
///
/// Required:
/// - `rules`: ordered list of routing rules evaluated top-to-bottom.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RouterNodeConfig {
    /// Ordered routing rules. Each rule maps a condition expression to an
    /// output key. The first matching rule wins.
    pub rules: Vec<RoutingRule>,
}

/// Config for Memory nodes.
///
/// Required:
/// - `key`: the memory key to read from or write to.
/// - `scope`: one of `"run_shared"` or `"node_local"`.
/// - `operation`: one of `"read"` or `"write"`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MemoryNodeConfig {
    /// The key in the memory store to access.
    pub key: String,
    /// Memory scope: `"run_shared"` or `"node_local"`.
    pub scope: String,
    /// Operation: `"read"` or `"write"`.
    pub operation: String,
}

/// Config for Human Review nodes.
///
/// All fields are optional; a minimal human review node needs no config.
///
/// Optional:
/// - `prompt`: text shown to the reviewer describing what to evaluate.
/// - `reason`: machine-readable rationale for why review is needed.
/// - `available_actions`: list of action labels the reviewer may choose
///   (e.g. `["approve", "reject", "retry"]`). Defaults to approve/reject when absent.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct HumanReviewNodeConfig {
    /// Human-readable prompt shown to the reviewer.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    /// Machine-readable reason this review gate was inserted.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// Explicit action labels available to the reviewer.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub available_actions: Option<Vec<String>>,
}

// ---------------------------------------------------------------------------
// Unified NodeConfig enum
// ---------------------------------------------------------------------------

/// Typed configuration for a node, keyed by node kind.
///
/// Serialises as the inner struct (untagged) — the `node_type` field on
/// `NodeDefinition` is the discriminant, so no extra tag is needed in JSON.
///
/// Deserialisation is driven by `NodeConfig::from_value` which requires the
/// `NodeKind` to be known first (see `NodeDefinition`'s custom Deserialize).
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(untagged)]
pub enum NodeConfig {
    Start(StartNodeConfig),
    End(EndNodeConfig),
    Agent(AgentNodeConfig),
    Tool(ToolNodeConfig),
    Router(RouterNodeConfig),
    Memory(MemoryNodeConfig),
    HumanReview(HumanReviewNodeConfig),
}

impl NodeConfig {
    /// Parse a raw `serde_json::Value` into the correct `NodeConfig` variant
    /// using the node kind as the discriminant.
    ///
    /// Returns `serde_json::Error` on malformed payloads.
    pub fn from_value(
        kind: &NodeKind,
        v: serde_json::Value,
    ) -> Result<Self, serde_json::Error> {
        match kind {
            NodeKind::Start => Ok(NodeConfig::Start(serde_json::from_value(v)?)),
            NodeKind::End => Ok(NodeConfig::End(serde_json::from_value(v)?)),
            NodeKind::Agent => Ok(NodeConfig::Agent(serde_json::from_value(v)?)),
            NodeKind::Tool => Ok(NodeConfig::Tool(serde_json::from_value(v)?)),
            NodeKind::Router => Ok(NodeConfig::Router(serde_json::from_value(v)?)),
            NodeKind::Memory => Ok(NodeConfig::Memory(serde_json::from_value(v)?)),
            NodeKind::HumanReview => Ok(NodeConfig::HumanReview(serde_json::from_value(v)?)),
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn start_end_roundtrip() {
        let cfg = NodeConfig::Start(StartNodeConfig {});
        let json = serde_json::to_string(&cfg).unwrap();
        assert_eq!(json, "{}");
        let back = NodeConfig::from_value(&NodeKind::Start, serde_json::from_str(&json).unwrap()).unwrap();
        assert_eq!(back, cfg);
    }

    #[test]
    fn agent_roundtrip() {
        let cfg = NodeConfig::Agent(AgentNodeConfig {
            prompt: "Analyze the task".to_string(),
            provider_hint: Some("claude-sonnet-4-6".to_string()),
        });
        let json = serde_json::to_string(&cfg).unwrap();
        let back = NodeConfig::from_value(&NodeKind::Agent, serde_json::from_str(&json).unwrap()).unwrap();
        assert_eq!(back, cfg);
    }

    #[test]
    fn agent_minimal_roundtrip() {
        // Matches the example workflow.json agent config shape.
        let json = r#"{"prompt": "Analyze the repository task and produce a plan."}"#;
        let cfg = NodeConfig::from_value(&NodeKind::Agent, serde_json::from_str(json).unwrap()).unwrap();
        match cfg {
            NodeConfig::Agent(a) => {
                assert_eq!(a.prompt, "Analyze the repository task and produce a plan.");
                assert!(a.provider_hint.is_none());
            }
            _ => panic!("expected Agent variant"),
        }
    }

    #[test]
    fn tool_roundtrip() {
        let cfg = NodeConfig::Tool(ToolNodeConfig {
            command: "cargo test".to_string(),
            shell: Some("bash".to_string()),
            timeout_ms: Some(30_000),
        });
        let json = serde_json::to_string(&cfg).unwrap();
        let back = NodeConfig::from_value(&NodeKind::Tool, serde_json::from_str(&json).unwrap()).unwrap();
        assert_eq!(back, cfg);
    }

    #[test]
    fn tool_minimal_roundtrip() {
        // Matches the example workflow.json tool config shape.
        let json = r#"{"command": "echo 'tool executed'"}"#;
        let cfg = NodeConfig::from_value(&NodeKind::Tool, serde_json::from_str(json).unwrap()).unwrap();
        match cfg {
            NodeConfig::Tool(t) => {
                assert_eq!(t.command, "echo 'tool executed'");
                assert!(t.shell.is_none());
                assert!(t.timeout_ms.is_none());
            }
            _ => panic!("expected Tool variant"),
        }
    }

    #[test]
    fn router_roundtrip() {
        let cfg = NodeConfig::Router(RouterNodeConfig {
            rules: vec![RoutingRule {
                condition: "passed == true".to_string(),
                target_key: "route_ok".to_string(),
            }],
        });
        let json = serde_json::to_string(&cfg).unwrap();
        let back = NodeConfig::from_value(&NodeKind::Router, serde_json::from_str(&json).unwrap()).unwrap();
        assert_eq!(back, cfg);
    }

    #[test]
    fn memory_roundtrip() {
        let cfg = NodeConfig::Memory(MemoryNodeConfig {
            key: "run_shared.plan".to_string(),
            scope: "run_shared".to_string(),
            operation: "read".to_string(),
        });
        let json = serde_json::to_string(&cfg).unwrap();
        let back = NodeConfig::from_value(&NodeKind::Memory, serde_json::from_str(&json).unwrap()).unwrap();
        assert_eq!(back, cfg);
    }

    #[test]
    fn human_review_roundtrip() {
        let cfg = NodeConfig::HumanReview(HumanReviewNodeConfig {
            prompt: Some("Review and approve".to_string()),
            reason: None,
            available_actions: Some(vec!["approve".to_string(), "reject".to_string()]),
        });
        let json = serde_json::to_string(&cfg).unwrap();
        let back = NodeConfig::from_value(&NodeKind::HumanReview, serde_json::from_str(&json).unwrap()).unwrap();
        assert_eq!(back, cfg);
    }

    #[test]
    fn human_review_prompt_only() {
        // Matches the example workflow.json human_review config shape.
        let json = r#"{"prompt": "Review the critique and approve, reject, or request retry."}"#;
        let cfg = NodeConfig::from_value(&NodeKind::HumanReview, serde_json::from_str(json).unwrap()).unwrap();
        match cfg {
            NodeConfig::HumanReview(h) => {
                assert_eq!(h.prompt.as_deref(), Some("Review the critique and approve, reject, or request retry."));
            }
            _ => panic!("expected HumanReview variant"),
        }
    }
}
