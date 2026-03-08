// Mock adapter for use in engine tests.
// Returns configurable canned output without spawning real processes.

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use tokio::sync::{mpsc, Mutex};

use event_model::command_events::CommandEventKind;
use workflow_model::memory::MemoryState;
use workflow_model::node::NodeDefinition;

use crate::{Adapter, AdapterError, AdapterOutput};

/// Configuration supplied when constructing a `MockAdapter`.
#[derive(Debug, Clone)]
pub struct MockConfig {
    /// If set, `prepare` returns this error.
    pub prepare_error: Option<String>,
    /// If set, `execute` returns this error.
    pub execute_error: Option<String>,
    /// Output returned by a successful `execute`.
    pub output: AdapterOutput,
    /// Events emitted before `execute` returns, in order.
    pub events: Vec<CommandEventKind>,
}

impl Default for MockConfig {
    fn default() -> Self {
        Self {
            prepare_error: None,
            execute_error: None,
            output: AdapterOutput {
                output: serde_json::Value::Null,
                exit_code: Some(0),
                stdout: String::new(),
                stderr: String::new(),
                duration_ms: 0,
            },
            events: vec![],
        }
    }
}

/// A deterministic adapter for use in tests.
///
/// Emits the configured events then returns the configured output (or error)
/// without touching the filesystem or spawning any processes.
pub struct MockAdapter {
    config: Arc<Mutex<MockConfig>>,
}

impl MockAdapter {
    pub fn new(config: MockConfig) -> Self {
        Self {
            config: Arc::new(Mutex::new(config)),
        }
    }
}

impl Default for MockAdapter {
    fn default() -> Self {
        Self::new(MockConfig::default())
    }
}

impl Adapter for MockAdapter {
    fn prepare<'a>(
        &'a self,
        _node: &'a NodeDefinition,
        _workspace_root: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<(), AdapterError>> + Send + 'a>> {
        let config = Arc::clone(&self.config);
        Box::pin(async move {
            let cfg = config.lock().await;
            if let Some(ref msg) = cfg.prepare_error {
                return Err(AdapterError::PreparationFailed(msg.clone()));
            }
            Ok(())
        })
    }

    fn execute<'a>(
        &'a self,
        _node: &'a NodeDefinition,
        _workspace_root: &'a str,
        _memory: &'a MemoryState,
        event_tx: mpsc::Sender<CommandEventKind>,
    ) -> Pin<Box<dyn Future<Output = Result<AdapterOutput, AdapterError>> + Send + 'a>> {
        let config = Arc::clone(&self.config);
        Box::pin(async move {
            let cfg = config.lock().await;
            if let Some(ref msg) = cfg.execute_error {
                return Err(AdapterError::ExecutionFailed(msg.clone()));
            }
            for event in &cfg.events {
                // Ignore send errors — receiver may have been dropped in tests.
                let _ = event_tx.send(event.clone()).await;
            }
            Ok(cfg.output.clone())
        })
    }

    fn abort<'a>(
        &'a self,
    ) -> Pin<Box<dyn Future<Output = Result<(), AdapterError>> + Send + 'a>> {
        Box::pin(async move { Ok(()) })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use event_model::command_events::{CommandCompletedPayload, CommandStartedPayload};
    use uuid::Uuid;
    use workflow_model::memory::MemoryScope;
    use workflow_model::node::{NodeDisplay, NodeKind, RetryPolicy};
    use workflow_model::node_config::{NodeConfig, ToolNodeConfig};

    fn dummy_node() -> NodeDefinition {
        NodeDefinition {
            node_id: Uuid::new_v4(),
            node_type: NodeKind::Tool,
            label: "test".into(),
            config: NodeConfig::Tool(ToolNodeConfig {
                command: "echo test".into(),
                shell: None,
                timeout_ms: None,
            }),
            input_contract: serde_json::Value::Null,
            output_contract: serde_json::Value::Null,
            memory_access: serde_json::Value::Null,
            retry_policy: RetryPolicy {
                max_retries: 0,
                max_runtime_ms: None,
            },
            display: NodeDisplay { x: 0.0, y: 0.0 },
        }
    }

    fn dummy_memory() -> MemoryState {
        MemoryState {
            run_id: Uuid::new_v4(),
            node_id: None,
            scope: MemoryScope::RunShared,
            data: serde_json::Value::Null,
        }
    }

    #[tokio::test]
    async fn prepare_succeeds_by_default() {
        let adapter = MockAdapter::default();
        let node = dummy_node();
        adapter.prepare(&node, "/tmp").await.expect("should succeed");
    }

    #[tokio::test]
    async fn prepare_returns_configured_error() {
        let adapter = MockAdapter::new(MockConfig {
            prepare_error: Some("bad config".into()),
            ..Default::default()
        });
        let node = dummy_node();
        let err = adapter.prepare(&node, "/tmp").await.unwrap_err();
        assert!(matches!(err, AdapterError::PreparationFailed(_)));
    }

    #[tokio::test]
    async fn execute_returns_configured_output() {
        let adapter = MockAdapter::new(MockConfig {
            output: AdapterOutput {
                output: serde_json::json!({"result": "ok"}),
                exit_code: Some(0),
                stdout: "done\n".into(),
                stderr: String::new(),
                duration_ms: 42,
            },
            ..Default::default()
        });
        let node = dummy_node();
        let memory = dummy_memory();
        let (tx, _rx) = mpsc::channel(16);
        let out = adapter.execute(&node, "/tmp", &memory, tx).await.unwrap();
        assert_eq!(out.exit_code, Some(0));
        assert_eq!(out.duration_ms, 42);
        assert_eq!(out.stdout, "done\n");
    }

    #[tokio::test]
    async fn execute_emits_configured_events() {
        let events = vec![
            CommandEventKind::Started(CommandStartedPayload {
                command: "echo hi".into(),
                shell: "bash".into(),
                cwd: "/tmp".into(),
                timeout_ms: None,
            }),
            CommandEventKind::Completed(CommandCompletedPayload {
                exit_code: 0,
                duration_ms: 5,
                stdout_bytes: 3,
                stderr_bytes: 0,
            }),
        ];
        let adapter = MockAdapter::new(MockConfig {
            events: events.clone(),
            ..Default::default()
        });
        let node = dummy_node();
        let memory = dummy_memory();
        let (tx, mut rx) = mpsc::channel(16);
        adapter.execute(&node, "/tmp", &memory, tx).await.unwrap();

        let e1 = rx.recv().await.expect("first event");
        assert!(matches!(e1, CommandEventKind::Started(_)));
        let e2 = rx.recv().await.expect("second event");
        assert!(matches!(e2, CommandEventKind::Completed(_)));
    }

    #[tokio::test]
    async fn execute_returns_configured_error() {
        let adapter = MockAdapter::new(MockConfig {
            execute_error: Some("process killed".into()),
            ..Default::default()
        });
        let node = dummy_node();
        let memory = dummy_memory();
        let (tx, _rx) = mpsc::channel(16);
        let err = adapter.execute(&node, "/tmp", &memory, tx).await.unwrap_err();
        assert!(matches!(err, AdapterError::ExecutionFailed(_)));
    }

    #[tokio::test]
    async fn abort_always_succeeds() {
        let adapter = MockAdapter::default();
        adapter.abort().await.expect("abort should succeed");
    }
}
