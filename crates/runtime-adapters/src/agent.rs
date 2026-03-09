// Agent CLI adapter — executes external agent CLIs (e.g. claude-code, aider)
// within a workspace root, passing the node's prompt via stdin.
// Emits AgentEventKind events during execution.
// See ARCHITECTURE.md §8, DECISIONS.md (DEC-005).

use std::future::Future;
use std::pin::Pin;
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::{mpsc, oneshot, Mutex};

use event_model::agent_events::{
    AgentCompletedPayload, AgentEventKind, AgentFailedPayload, AgentOutputReceivedPayload,
    AgentRequestPreparedPayload, AgentStartedPayload,
};
use workflow_model::memory::MemoryState;
use workflow_model::node::NodeDefinition;
use workflow_model::node_config::{AgentOutputMode, NodeConfig};

use crate::{AdapterError, AdapterOutput};

/// Agent CLI adapter.
///
/// Executes an external agent CLI command in a workspace root. The agent's
/// prompt is piped via stdin. Stdout is captured and parsed according to the
/// node's `output_mode` (see DEC-005).
///
/// Emits `AgentEventKind` events through the provided channel:
/// `RequestPrepared` → `Started` → `OutputReceived`* → `Completed` or `Failed`.
pub struct AgentCliAdapter {
    abort_tx: Arc<Mutex<Option<oneshot::Sender<()>>>>,
}

impl AgentCliAdapter {
    pub fn new() -> Self {
        Self {
            abort_tx: Arc::new(Mutex::new(None)),
        }
    }

    /// Resolve the CLI command to run from the node's agent config.
    ///
    /// Priority: `config.command` > `config.provider_hint` > error.
    fn resolve_command(node: &NodeDefinition) -> Result<(String, String), AdapterError> {
        match &node.config {
            NodeConfig::Agent(cfg) => {
                let cmd = cfg
                    .command
                    .as_deref()
                    .or(cfg.provider_hint.as_deref())
                    .ok_or_else(|| {
                        AdapterError::PreparationFailed(
                            "AgentNodeConfig must have either `command` or `provider_hint` set"
                                .into(),
                        )
                    })?
                    .to_owned();
                Ok((cmd, cfg.prompt.clone()))
            }
            _ => Err(AdapterError::NodeTypeNotSupported(
                "AgentCliAdapter requires an Agent node config".into(),
            )),
        }
    }

    /// Extract the output mode from the node config.
    fn output_mode(node: &NodeDefinition) -> AgentOutputMode {
        match &node.config {
            NodeConfig::Agent(cfg) => cfg.output_mode.clone(),
            _ => AgentOutputMode::Raw,
        }
    }

    /// Extract the provider string for event payloads.
    fn provider(node: &NodeDefinition) -> String {
        match &node.config {
            NodeConfig::Agent(cfg) => cfg
                .provider_hint
                .clone()
                .or_else(|| cfg.command.clone())
                .unwrap_or_else(|| "unknown".into()),
            _ => "unknown".into(),
        }
    }

    /// Parse captured stdout according to the configured `AgentOutputMode`.
    fn parse_output(
        stdout: &str,
        mode: &AgentOutputMode,
    ) -> Result<serde_json::Value, AdapterError> {
        match mode {
            AgentOutputMode::Raw => Ok(serde_json::json!({ "raw": stdout })),
            AgentOutputMode::JsonStdout => serde_json::from_str(stdout).map_err(|e| {
                AdapterError::ExecutionFailed(format!(
                    "output_mode is json_stdout but stdout is not valid JSON: {}",
                    e
                ))
            }),
            AgentOutputMode::JsonLastLine => {
                let last_line = stdout
                    .lines()
                    .rev()
                    .find(|l| !l.trim().is_empty())
                    .unwrap_or("");
                serde_json::from_str(last_line).map_err(|e| {
                    AdapterError::ExecutionFailed(format!(
                        "output_mode is json_last_line but last non-empty line is not valid JSON: {}",
                        e
                    ))
                })
            }
        }
    }

    /// Validate that the node is an Agent node with a resolvable command and
    /// that the workspace root exists.
    pub fn prepare<'a>(
        &'a self,
        node: &'a NodeDefinition,
        workspace_root: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<(), AdapterError>> + Send + 'a>> {
        Box::pin(async move {
            Self::resolve_command(node)?;
            tokio::fs::metadata(workspace_root).await.map_err(|e| {
                AdapterError::PreparationFailed(format!(
                    "workspace_root '{}' not accessible: {}",
                    workspace_root, e
                ))
            })?;
            Ok(())
        })
    }

    /// Execute the agent CLI command.
    ///
    /// The prompt is piped to stdin of the spawned process. Stdout is streamed
    /// as `AgentEventKind::OutputReceived` events. On completion, stdout is
    /// parsed according to `output_mode`.
    pub fn execute<'a>(
        &'a self,
        node: &'a NodeDefinition,
        workspace_root: &'a str,
        _memory: &'a MemoryState,
        event_tx: mpsc::Sender<AgentEventKind>,
    ) -> Pin<Box<dyn Future<Output = Result<AdapterOutput, AdapterError>> + Send + 'a>> {
        let abort_store = Arc::clone(&self.abort_tx);
        Box::pin(async move {
            let (command, prompt) = Self::resolve_command(node)?;
            let provider = Self::provider(node);
            let mode = Self::output_mode(node);
            let timeout_ms = node.retry_policy.max_runtime_ms;
            let cwd = workspace_root.to_owned();

            // Register abort channel.
            let (abort_sender, mut abort_rx) = oneshot::channel::<()>();
            *abort_store.lock().await = Some(abort_sender);

            // Emit agent.request_prepared
            let _ = event_tx
                .send(AgentEventKind::RequestPrepared(
                    AgentRequestPreparedPayload {
                        provider: provider.clone(),
                        prompt_tokens: None,
                        memory_keys_used: vec![],
                    },
                ))
                .await;

            // Spawn the process — prompt is written to stdin.
            let mut child = Command::new("sh")
                .arg("-c")
                .arg(&command)
                .current_dir(&cwd)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|e| {
                    AdapterError::ExecutionFailed(format!("failed to spawn agent process: {}", e))
                })?;

            // Write prompt to stdin, then close.
            if let Some(mut stdin) = child.stdin.take() {
                let _ = stdin.write_all(prompt.as_bytes()).await;
                let _ = stdin.shutdown().await;
            }

            let start = Instant::now();

            // Emit agent.started
            let _ = event_tx
                .send(AgentEventKind::Started(AgentStartedPayload {
                    provider: provider.clone(),
                    run_elapsed_ms: 0,
                }))
                .await;

            // Stream stdout, emitting OutputReceived events.
            let stdout_pipe = child.stdout.take().expect("stdout is piped");
            let tx_out = event_tx.clone();
            let stdout_task = tokio::spawn(async move {
                let mut reader = BufReader::new(stdout_pipe).lines();
                let mut cumulative_chars = 0u64;
                let mut captured = String::new();
                while let Ok(Some(line)) = reader.next_line().await {
                    let chunk = format!("{}\n", line);
                    cumulative_chars += chunk.len() as u64;
                    captured.push_str(&chunk);
                    let _ = tx_out
                        .send(AgentEventKind::OutputReceived(
                            AgentOutputReceivedPayload {
                                chunk,
                                cumulative_chars,
                                is_final: false,
                            },
                        ))
                        .await;
                }
                captured
            });

            // Capture stderr in a background task (no events, just capture).
            let stderr_pipe = child.stderr.take().expect("stderr is piped");
            let stderr_task = tokio::spawn(async move {
                let mut reader = BufReader::new(stderr_pipe).lines();
                let mut captured = String::new();
                while let Ok(Some(line)) = reader.next_line().await {
                    captured.push_str(&line);
                    captured.push('\n');
                }
                captured
            });

            // Race: process exit vs timeout vs abort.
            enum WaitOutcome {
                Exited(std::io::Result<std::process::ExitStatus>),
                TimedOut,
                Aborted,
            }

            let outcome = if let Some(ms) = timeout_ms {
                let deadline = tokio::time::sleep(Duration::from_millis(ms));
                tokio::pin!(deadline);
                tokio::select! {
                    status = child.wait() => WaitOutcome::Exited(status),
                    _ = &mut deadline => WaitOutcome::TimedOut,
                    _ = &mut abort_rx => WaitOutcome::Aborted,
                }
            } else {
                tokio::select! {
                    status = child.wait() => WaitOutcome::Exited(status),
                    _ = &mut abort_rx => WaitOutcome::Aborted,
                }
            };

            // On timeout or abort, kill the child.
            match &outcome {
                WaitOutcome::TimedOut | WaitOutcome::Aborted => {
                    let _ = child.kill().await;
                }
                _ => {}
            }

            // Clear abort sender.
            *abort_store.lock().await = None;

            let duration_ms = start.elapsed().as_millis() as u64;

            // Await streaming tasks.
            let stdout_text = stdout_task.await.unwrap_or_default();
            let stderr_text = stderr_task.await.unwrap_or_default();

            match outcome {
                WaitOutcome::Exited(Ok(status)) => {
                    let exit_code = status.code().unwrap_or(-1);
                    if exit_code != 0 {
                        // Non-zero exit → agent.failed
                        let reason =
                            format!("agent process exited with code {}", exit_code);
                        let _ = event_tx
                            .send(AgentEventKind::Failed(AgentFailedPayload {
                                provider: provider.clone(),
                                reason: reason.clone(),
                                error_code: Some(exit_code.to_string()),
                                duration_ms: Some(duration_ms),
                            }))
                            .await;
                        return Err(AdapterError::ExecutionFailed(reason));
                    }

                    // Parse output according to output_mode.
                    let output = Self::parse_output(&stdout_text, &mode)?;

                    // Emit final output_received with is_final = true.
                    let _ = event_tx
                        .send(AgentEventKind::OutputReceived(
                            AgentOutputReceivedPayload {
                                chunk: String::new(),
                                cumulative_chars: stdout_text.len() as u64,
                                is_final: true,
                            },
                        ))
                        .await;

                    // Emit agent.completed
                    let _ = event_tx
                        .send(AgentEventKind::Completed(AgentCompletedPayload {
                            provider: provider.clone(),
                            duration_ms,
                            input_tokens: None,
                            output_tokens: None,
                            output_memory_key: None,
                        }))
                        .await;

                    Ok(AdapterOutput {
                        output,
                        exit_code: Some(exit_code),
                        stdout: stdout_text,
                        stderr: stderr_text,
                        duration_ms,
                    })
                }
                WaitOutcome::Exited(Err(e)) => {
                    let reason = format!("agent process wait error: {}", e);
                    let _ = event_tx
                        .send(AgentEventKind::Failed(AgentFailedPayload {
                            provider: provider.clone(),
                            reason: reason.clone(),
                            error_code: None,
                            duration_ms: Some(duration_ms),
                        }))
                        .await;
                    Err(AdapterError::ExecutionFailed(reason))
                }
                WaitOutcome::TimedOut => {
                    let reason = format!(
                        "agent process timed out after {}ms",
                        timeout_ms.unwrap_or(0)
                    );
                    let _ = event_tx
                        .send(AgentEventKind::Failed(AgentFailedPayload {
                            provider: provider.clone(),
                            reason: reason.clone(),
                            error_code: None,
                            duration_ms: Some(duration_ms),
                        }))
                        .await;
                    Err(AdapterError::ExecutionFailed(reason))
                }
                WaitOutcome::Aborted => {
                    let reason = "agent process aborted".to_string();
                    let _ = event_tx
                        .send(AgentEventKind::Failed(AgentFailedPayload {
                            provider: provider.clone(),
                            reason: reason.clone(),
                            error_code: None,
                            duration_ms: Some(duration_ms),
                        }))
                        .await;
                    Err(AdapterError::ExecutionFailed(reason))
                }
            }
        })
    }

    /// Cancel an in-progress execute call.
    pub fn abort<'a>(
        &'a self,
    ) -> Pin<Box<dyn Future<Output = Result<(), AdapterError>> + Send + 'a>> {
        let abort_store = Arc::clone(&self.abort_tx);
        Box::pin(async move {
            if let Some(tx) = abort_store.lock().await.take() {
                let _ = tx.send(());
            }
            Ok(())
        })
    }
}

impl Default for AgentCliAdapter {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::mpsc;
    use uuid::Uuid;
    use workflow_model::memory::MemoryScope;
    use workflow_model::node::{NodeDisplay, NodeKind, RetryPolicy};
    use workflow_model::node_config::{AgentNodeConfig, AgentOutputMode, NodeConfig};

    fn agent_node(cmd: &str, prompt: &str) -> NodeDefinition {
        NodeDefinition {
            node_id: Uuid::new_v4(),
            node_type: NodeKind::Agent,
            label: "test-agent".into(),
            config: NodeConfig::Agent(AgentNodeConfig {
                prompt: prompt.to_owned(),
                command: Some(cmd.to_owned()),
                provider_hint: Some("test-provider".into()),
                output_mode: AgentOutputMode::Raw,
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

    fn agent_node_with_mode(cmd: &str, prompt: &str, mode: AgentOutputMode) -> NodeDefinition {
        let mut node = agent_node(cmd, prompt);
        if let NodeConfig::Agent(ref mut cfg) = node.config {
            cfg.output_mode = mode;
        }
        node
    }

    fn agent_node_with_timeout(cmd: &str, prompt: &str, timeout_ms: u64) -> NodeDefinition {
        let mut node = agent_node(cmd, prompt);
        node.retry_policy.max_runtime_ms = Some(timeout_ms);
        node
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
    async fn prepare_succeeds_with_valid_agent_config() {
        let adapter = AgentCliAdapter::new();
        let node = agent_node("echo hello", "test prompt");
        adapter
            .prepare(&node, "/tmp")
            .await
            .expect("prepare should succeed");
    }

    #[tokio::test]
    async fn prepare_fails_for_tool_node() {
        let adapter = AgentCliAdapter::new();
        let mut node = agent_node("echo", "test");
        node.config = NodeConfig::Tool(workflow_model::node_config::ToolNodeConfig {
            command: "echo".into(),
            shell: None,
            timeout_ms: None,
        });
        let err = adapter.prepare(&node, "/tmp").await.unwrap_err();
        assert!(matches!(err, AdapterError::NodeTypeNotSupported(_)));
    }

    #[tokio::test]
    async fn prepare_fails_no_command_or_provider() {
        let adapter = AgentCliAdapter::new();
        let mut node = agent_node("echo", "test");
        if let NodeConfig::Agent(ref mut cfg) = node.config {
            cfg.command = None;
            cfg.provider_hint = None;
        }
        let err = adapter.prepare(&node, "/tmp").await.unwrap_err();
        assert!(matches!(err, AdapterError::PreparationFailed(_)));
    }

    #[tokio::test]
    async fn prepare_fails_nonexistent_workspace() {
        let adapter = AgentCliAdapter::new();
        let node = agent_node("echo", "test");
        let err = adapter
            .prepare(&node, "/nonexistent_path_xyz_abc")
            .await
            .unwrap_err();
        assert!(matches!(err, AdapterError::PreparationFailed(_)));
    }

    #[tokio::test]
    async fn execute_captures_stdout_and_succeeds() {
        let adapter = AgentCliAdapter::new();
        // cat reads stdin and echoes it to stdout
        let node = agent_node("cat", "hello agent");
        let memory = dummy_memory();
        let (tx, _rx) = mpsc::channel(32);
        let out = adapter
            .execute(&node, "/tmp", &memory, tx)
            .await
            .unwrap();
        assert_eq!(out.exit_code, Some(0));
        assert!(out.stdout.contains("hello agent"));
        // Raw mode → output is {"raw": "<stdout>"}
        assert!(out.output["raw"].as_str().unwrap().contains("hello agent"));
    }

    #[tokio::test]
    async fn execute_emits_agent_event_sequence() {
        let adapter = AgentCliAdapter::new();
        let node = agent_node("cat", "hi");
        let memory = dummy_memory();
        let (tx, mut rx) = mpsc::channel(32);
        adapter
            .execute(&node, "/tmp", &memory, tx)
            .await
            .unwrap();
        let mut events = vec![];
        while let Ok(e) = rx.try_recv() {
            events.push(e);
        }
        assert!(
            events
                .iter()
                .any(|e| matches!(e, AgentEventKind::RequestPrepared(_)))
        );
        assert!(
            events
                .iter()
                .any(|e| matches!(e, AgentEventKind::Started(_)))
        );
        assert!(
            events
                .iter()
                .any(|e| matches!(e, AgentEventKind::OutputReceived(_)))
        );
        assert!(
            events
                .iter()
                .any(|e| matches!(e, AgentEventKind::Completed(_)))
        );
    }

    #[tokio::test]
    async fn execute_nonzero_exit_emits_failed() {
        let adapter = AgentCliAdapter::new();
        let node = agent_node("exit 1", "test");
        let memory = dummy_memory();
        let (tx, mut rx) = mpsc::channel(32);
        let result = adapter.execute(&node, "/tmp", &memory, tx).await;
        assert!(result.is_err());
        let mut events = vec![];
        while let Ok(e) = rx.try_recv() {
            events.push(e);
        }
        assert!(
            events
                .iter()
                .any(|e| matches!(e, AgentEventKind::Failed(_)))
        );
        // Verify the failed event has the right provider
        let failed = events.iter().find_map(|e| {
            if let AgentEventKind::Failed(p) = e {
                Some(p)
            } else {
                None
            }
        });
        assert_eq!(failed.unwrap().provider, "test-provider");
    }

    #[tokio::test]
    async fn execute_json_stdout_mode_parses_output() {
        let adapter = AgentCliAdapter::new();
        let node = agent_node_with_mode(
            r#"echo '{"result": "ok"}'"#,
            "",
            AgentOutputMode::JsonStdout,
        );
        let memory = dummy_memory();
        let (tx, _rx) = mpsc::channel(32);
        let out = adapter
            .execute(&node, "/tmp", &memory, tx)
            .await
            .unwrap();
        assert_eq!(out.output["result"], "ok");
    }

    #[tokio::test]
    async fn execute_json_last_line_mode_parses_output() {
        let adapter = AgentCliAdapter::new();
        let node = agent_node_with_mode(
            r#"echo 'verbose line 1'; echo 'verbose line 2'; echo '{"summary": 42}'"#,
            "",
            AgentOutputMode::JsonLastLine,
        );
        let memory = dummy_memory();
        let (tx, _rx) = mpsc::channel(32);
        let out = adapter
            .execute(&node, "/tmp", &memory, tx)
            .await
            .unwrap();
        assert_eq!(out.output["summary"], 42);
    }

    #[tokio::test]
    async fn execute_json_stdout_mode_fails_on_invalid_json() {
        let adapter = AgentCliAdapter::new();
        let node = agent_node_with_mode("echo 'not json'", "", AgentOutputMode::JsonStdout);
        let memory = dummy_memory();
        let (tx, _rx) = mpsc::channel(32);
        let result = adapter.execute(&node, "/tmp", &memory, tx).await;
        assert!(result.is_err());
        let err_msg = format!("{}", result.unwrap_err());
        assert!(err_msg.contains("json_stdout"));
    }

    #[tokio::test]
    async fn execute_uses_provider_hint_as_fallback_command() {
        let adapter = AgentCliAdapter::new();
        let mut node = agent_node("echo", "test");
        if let NodeConfig::Agent(ref mut cfg) = node.config {
            cfg.command = None;
            cfg.provider_hint = Some("echo".into());
        }
        let memory = dummy_memory();
        let (tx, _rx) = mpsc::channel(32);
        let out = adapter
            .execute(&node, "/tmp", &memory, tx)
            .await
            .unwrap();
        assert_eq!(out.exit_code, Some(0));
    }

    #[tokio::test]
    async fn execute_times_out_and_emits_failed() {
        let adapter = AgentCliAdapter::new();
        let node = agent_node_with_timeout("sleep 10", "", 100);
        let memory = dummy_memory();
        let (tx, mut rx) = mpsc::channel(32);
        let result = adapter.execute(&node, "/tmp", &memory, tx).await;
        assert!(result.is_err());
        let mut events = vec![];
        while let Ok(e) = rx.try_recv() {
            events.push(e);
        }
        assert!(
            events
                .iter()
                .any(|e| matches!(e, AgentEventKind::Failed(_)))
        );
        let failed = events.iter().find_map(|e| {
            if let AgentEventKind::Failed(p) = e {
                Some(p)
            } else {
                None
            }
        });
        assert!(failed.unwrap().reason.contains("timed out"));
    }

    #[tokio::test]
    async fn abort_no_op_when_not_running() {
        let adapter = AgentCliAdapter::new();
        adapter
            .abort()
            .await
            .expect("abort should succeed even when idle");
    }

    #[test]
    fn parse_output_raw() {
        let result = AgentCliAdapter::parse_output("hello world\n", &AgentOutputMode::Raw);
        assert!(result.is_ok());
        assert_eq!(result.unwrap()["raw"], "hello world\n");
    }

    #[test]
    fn parse_output_json_stdout_valid() {
        let result =
            AgentCliAdapter::parse_output(r#"{"key": "val"}"#, &AgentOutputMode::JsonStdout);
        assert!(result.is_ok());
        assert_eq!(result.unwrap()["key"], "val");
    }

    #[test]
    fn parse_output_json_stdout_invalid() {
        let result = AgentCliAdapter::parse_output("not json", &AgentOutputMode::JsonStdout);
        assert!(result.is_err());
    }

    #[test]
    fn parse_output_json_last_line_valid() {
        let stdout = "line 1\nline 2\n{\"x\": 1}\n";
        let result = AgentCliAdapter::parse_output(stdout, &AgentOutputMode::JsonLastLine);
        assert!(result.is_ok());
        assert_eq!(result.unwrap()["x"], 1);
    }

    #[test]
    fn parse_output_json_last_line_skips_empty_trailing() {
        let stdout = "verbose\n{\"ok\": true}\n\n";
        let result = AgentCliAdapter::parse_output(stdout, &AgentOutputMode::JsonLastLine);
        assert!(result.is_ok());
        assert_eq!(result.unwrap()["ok"], true);
    }

    #[test]
    fn parse_output_json_last_line_invalid() {
        let result =
            AgentCliAdapter::parse_output("no json here\n", &AgentOutputMode::JsonLastLine);
        assert!(result.is_err());
    }
}
