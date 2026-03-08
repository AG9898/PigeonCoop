use serde::{Deserialize, Serialize};

/// Guardrail limits applied to a workflow run.
///
/// These values are stored on `WorkflowDefinition.default_constraints` and
/// copied onto `RunInstance.constraints` when a run is created.  The engine
/// reads these fields at runtime to enforce execution limits.
///
/// All fields either carry sensible defaults via `serde(default)` or are
/// `Option`-typed, so a partial JSON object still deserializes correctly.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct RunConstraints {
    /// Maximum number of node-level retries allowed across the entire run.
    /// A value of 0 disables retries.  Default: 3.
    pub max_retries: u32,

    /// Wall-clock time limit for the whole run in milliseconds.
    /// `None` means no limit.
    pub max_runtime_ms: Option<u64>,

    /// Maximum number of node executions (steps) before the run is
    /// forcefully terminated.  `None` means no limit.
    pub max_steps: Option<u32>,

    /// Optional token/cost budget ceiling.  The engine checks this when an
    /// agent node reports token usage.  `None` means no budget cap.
    pub max_tokens: Option<u64>,
}

impl Default for RunConstraints {
    fn default() -> Self {
        Self {
            max_retries: 3,
            max_runtime_ms: None,
            max_steps: None,
            max_tokens: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_values() {
        let c = RunConstraints::default();
        assert_eq!(c.max_retries, 3);
        assert!(c.max_runtime_ms.is_none());
        assert!(c.max_steps.is_none());
        assert!(c.max_tokens.is_none());
    }

    #[test]
    fn roundtrip_full() {
        let c = RunConstraints {
            max_retries: 2,
            max_runtime_ms: Some(300_000),
            max_steps: Some(50),
            max_tokens: Some(100_000),
        };
        let json = serde_json::to_string(&c).unwrap();
        let back: RunConstraints = serde_json::from_str(&json).unwrap();
        assert_eq!(c, back);
    }

    #[test]
    fn partial_json_uses_defaults() {
        // Only max_retries and max_runtime_ms are present (like the example workflow).
        let json = r#"{"max_retries": 2, "max_runtime_ms": 300000}"#;
        let c: RunConstraints = serde_json::from_str(json).unwrap();
        assert_eq!(c.max_retries, 2);
        assert_eq!(c.max_runtime_ms, Some(300_000));
        assert!(c.max_steps.is_none());
        assert!(c.max_tokens.is_none());
    }

    #[test]
    fn empty_json_object_uses_defaults() {
        let c: RunConstraints = serde_json::from_str("{}").unwrap();
        assert_eq!(c, RunConstraints::default());
    }
}
