use serde::{Deserialize, Deserializer, Serialize};
use uuid::Uuid;
use crate::node_config::NodeConfig;

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

#[derive(Debug, Clone, Serialize)]
pub struct NodeDefinition {
    pub node_id: Uuid,
    pub node_type: NodeKind,
    pub label: String,
    /// Typed configuration; discriminated by `node_type` during deserialisation.
    pub config: NodeConfig,
    pub input_contract: serde_json::Value,
    pub output_contract: serde_json::Value,
    pub memory_access: serde_json::Value,
    pub retry_policy: RetryPolicy,
    pub display: NodeDisplay,
}

/// Raw proxy used only during deserialisation so we can read `node_type`
/// before parsing `config`.
#[derive(Deserialize)]
struct NodeDefinitionRaw {
    node_id: Uuid,
    node_type: NodeKind,
    label: String,
    config: serde_json::Value,
    input_contract: serde_json::Value,
    output_contract: serde_json::Value,
    memory_access: serde_json::Value,
    retry_policy: RetryPolicy,
    display: NodeDisplay,
}

impl<'de> Deserialize<'de> for NodeDefinition {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let raw = NodeDefinitionRaw::deserialize(d)?;
        let config = NodeConfig::from_value(&raw.node_type, raw.config)
            .map_err(serde::de::Error::custom)?;
        Ok(NodeDefinition {
            node_id: raw.node_id,
            node_type: raw.node_type,
            label: raw.label,
            config,
            input_contract: raw.input_contract,
            output_contract: raw.output_contract,
            memory_access: raw.memory_access,
            retry_policy: raw.retry_policy,
            display: raw.display,
        })
    }
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::node_config::{AgentNodeConfig, NodeConfig, ToolNodeConfig, HumanReviewNodeConfig};

    fn example_agent_json() -> &'static str {
        r#"{
            "node_id": "10000000-0000-0000-0000-000000000002",
            "node_type": "agent",
            "label": "Plan",
            "config": { "prompt": "Analyze the repository task and produce a plan." },
            "input_contract": { "task": "string" },
            "output_contract": { "plan": "string" },
            "memory_access": { "write": ["run_shared.plan"] },
            "retry_policy": { "max_retries": 1 },
            "display": { "x": 300.0, "y": 200.0 }
        }"#
    }

    fn example_tool_json() -> &'static str {
        r#"{
            "node_id": "10000000-0000-0000-0000-000000000003",
            "node_type": "tool",
            "label": "Execute Tool",
            "config": { "command": "echo 'tool executed'" },
            "input_contract": { "plan": "string" },
            "output_contract": { "result": "string" },
            "memory_access": {},
            "retry_policy": { "max_retries": 2 },
            "display": { "x": 550.0, "y": 200.0 }
        }"#
    }

    fn example_human_review_json() -> &'static str {
        r#"{
            "node_id": "10000000-0000-0000-0000-000000000005",
            "node_type": "human_review",
            "label": "Approve",
            "config": { "prompt": "Review the critique and approve, reject, or request retry." },
            "input_contract": { "verdict": "string" },
            "output_contract": { "decision": "string" },
            "memory_access": {},
            "retry_policy": { "max_retries": 0 },
            "display": { "x": 1050.0, "y": 200.0 }
        }"#
    }

    #[test]
    fn deserialise_agent_node() {
        let node: NodeDefinition = serde_json::from_str(example_agent_json()).unwrap();
        assert_eq!(node.node_type, NodeKind::Agent);
        match &node.config {
            NodeConfig::Agent(AgentNodeConfig { prompt, .. }) => {
                assert_eq!(prompt, "Analyze the repository task and produce a plan.");
            }
            other => panic!("unexpected config: {:?}", other),
        }
    }

    #[test]
    fn deserialise_tool_node() {
        let node: NodeDefinition = serde_json::from_str(example_tool_json()).unwrap();
        assert_eq!(node.node_type, NodeKind::Tool);
        match &node.config {
            NodeConfig::Tool(ToolNodeConfig { command, .. }) => {
                assert_eq!(command, "echo 'tool executed'");
            }
            other => panic!("unexpected config: {:?}", other),
        }
    }

    #[test]
    fn deserialise_human_review_node() {
        let node: NodeDefinition = serde_json::from_str(example_human_review_json()).unwrap();
        assert_eq!(node.node_type, NodeKind::HumanReview);
        match &node.config {
            NodeConfig::HumanReview(HumanReviewNodeConfig { prompt, .. }) => {
                assert!(prompt.is_some());
            }
            other => panic!("unexpected config: {:?}", other),
        }
    }

    #[test]
    fn agent_node_roundtrip() {
        let node: NodeDefinition = serde_json::from_str(example_agent_json()).unwrap();
        let json = serde_json::to_string(&node).unwrap();
        let back: NodeDefinition = serde_json::from_str(&json).unwrap();
        assert_eq!(back.node_type, NodeKind::Agent);
        match back.config {
            NodeConfig::Agent(a) => {
                assert_eq!(a.prompt, "Analyze the repository task and produce a plan.");
            }
            other => panic!("unexpected: {:?}", other),
        }
    }
}
