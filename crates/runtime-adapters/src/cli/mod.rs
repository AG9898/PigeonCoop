// CLI shell adapter — executes arbitrary shell commands within a workspace root.
// Commands run via `sh -c <command>`. All commands are approved for v1.
// See ARCHITECTURE.md §8, DECISIONS.md.

use std::future::Future;
use std::pin::Pin;
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::{mpsc, oneshot, Mutex};

use event_model::command_events::{
    CommandCompletedPayload, CommandEventKind, CommandFailedPayload, CommandPreparedPayload,
    CommandStartedPayload, CommandStderrPayload, CommandStdoutPayload,
};
use workflow_model::memory::MemoryState;
use workflow_model::node::NodeDefinition;
use workflow_model::node_config::NodeConfig;

use crate::{Adapter, AdapterError, AdapterOutput};

/// CLI shell adapter.
///
/// Executes arbitrary shell commands in a workspace root via `sh -c`.
/// Streams stdout/stderr as `CommandEventKind` events while running, then
/// emits `Completed` or `Failed` at the end.
///
/// Timeout is read from `node.retry_policy.max_runtime_ms`. Abort is
/// signalled via the `abort()` method, which cancels the in-progress `execute`.
pub struct CliAdapter {
    abort_tx: Arc<Mutex<Option<oneshot::Sender<()>>>>,
}

impl CliAdapter {
    pub fn new() -> Self {
        Self {
            abort_tx: Arc::new(Mutex::new(None)),
        }
    }

    /// Extract the shell command string from the node's typed `ToolNodeConfig`.
    fn extract_command(node: &NodeDefinition) -> Result<String, AdapterError> {
        match &node.config {
            NodeConfig::Tool(cfg) => Ok(cfg.command.clone()),
            _ => Err(AdapterError::PreparationFailed(
                "node config must be a Tool variant with a \"command\" field".into(),
            )),
        }
    }
}

impl Default for CliAdapter {
    fn default() -> Self {
        Self::new()
    }
}

impl Adapter for CliAdapter {
    fn prepare<'a>(
        &'a self,
        node: &'a NodeDefinition,
        workspace_root: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<(), AdapterError>> + Send + 'a>> {
        Box::pin(async move {
            Self::extract_command(node)?;
            tokio::fs::metadata(workspace_root).await.map_err(|e| {
                AdapterError::PreparationFailed(format!(
                    "workspace_root '{}' not accessible: {}",
                    workspace_root, e
                ))
            })?;
            Ok(())
        })
    }

    fn execute<'a>(
        &'a self,
        node: &'a NodeDefinition,
        workspace_root: &'a str,
        _memory: &'a MemoryState,
        event_tx: mpsc::Sender<CommandEventKind>,
    ) -> Pin<Box<dyn Future<Output = Result<AdapterOutput, AdapterError>> + Send + 'a>> {
        let abort_store = Arc::clone(&self.abort_tx);
        Box::pin(async move {
            let command = Self::extract_command(node)?;
            let shell = "sh".to_owned();
            let cwd = workspace_root.to_owned();
            let timeout_ms = node.retry_policy.max_runtime_ms;

            // Register abort channel so abort() can cancel this execute call.
            let (abort_sender, mut abort_rx) = oneshot::channel::<()>();
            *abort_store.lock().await = Some(abort_sender);

            // Emit command.prepared
            let _ = event_tx
                .send(CommandEventKind::Prepared(CommandPreparedPayload {
                    command: command.clone(),
                    shell: shell.clone(),
                    cwd: cwd.clone(),
                    timeout_ms,
                }))
                .await;

            // Spawn the process
            let mut child = Command::new("sh")
                .arg("-c")
                .arg(&command)
                .current_dir(&cwd)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|e| {
                    AdapterError::ExecutionFailed(format!("failed to spawn process: {}", e))
                })?;

            // Emit command.started
            let _ = event_tx
                .send(CommandEventKind::Started(CommandStartedPayload {
                    command: command.clone(),
                    shell: shell.clone(),
                    cwd: cwd.clone(),
                    timeout_ms,
                }))
                .await;

            let start = Instant::now();

            // Stream stdout in a background task, emitting Stdout events.
            let stdout = child.stdout.take().expect("stdout is piped");
            let tx_out = event_tx.clone();
            let stdout_task = tokio::spawn(async move {
                let mut reader = BufReader::new(stdout).lines();
                let mut total_bytes = 0u64;
                let mut captured = String::new();
                while let Ok(Some(line)) = reader.next_line().await {
                    let chunk = format!("{}\n", line);
                    let offset = total_bytes;
                    total_bytes += chunk.len() as u64;
                    captured.push_str(&chunk);
                    let _ = tx_out
                        .send(CommandEventKind::Stdout(CommandStdoutPayload {
                            chunk,
                            byte_offset: offset,
                        }))
                        .await;
                }
                (captured, total_bytes)
            });

            // Stream stderr in a background task, emitting Stderr events.
            let stderr = child.stderr.take().expect("stderr is piped");
            let tx_err = event_tx.clone();
            let stderr_task = tokio::spawn(async move {
                let mut reader = BufReader::new(stderr).lines();
                let mut total_bytes = 0u64;
                let mut captured = String::new();
                while let Ok(Some(line)) = reader.next_line().await {
                    let chunk = format!("{}\n", line);
                    let offset = total_bytes;
                    total_bytes += chunk.len() as u64;
                    captured.push_str(&chunk);
                    let _ = tx_err
                        .send(CommandEventKind::Stderr(CommandStderrPayload {
                            chunk,
                            byte_offset: offset,
                        }))
                        .await;
                }
                (captured, total_bytes)
            });

            // Race between: process exits, timeout fires, or abort is signalled.
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

            // On timeout or abort, kill the child. Pipes will close, ending streaming tasks.
            match &outcome {
                WaitOutcome::TimedOut | WaitOutcome::Aborted => {
                    let _ = child.kill().await;
                }
                _ => {}
            }

            // Clear abort sender — no longer needed.
            *abort_store.lock().await = None;

            let duration_ms = start.elapsed().as_millis() as u64;

            // Await streaming tasks (finish quickly once pipes are closed).
            let (stdout_text, stdout_bytes) = stdout_task.await.unwrap_or_default();
            let (stderr_text, stderr_bytes) = stderr_task.await.unwrap_or_default();

            match outcome {
                WaitOutcome::Exited(Ok(status)) => {
                    let exit_code = status.code().unwrap_or(-1);
                    let _ = event_tx
                        .send(CommandEventKind::Completed(CommandCompletedPayload {
                            exit_code,
                            duration_ms,
                            stdout_bytes,
                            stderr_bytes,
                        }))
                        .await;
                    Ok(AdapterOutput {
                        output: serde_json::Value::Null,
                        exit_code: Some(exit_code),
                        stdout: stdout_text,
                        stderr: stderr_text,
                        duration_ms,
                    })
                }
                WaitOutcome::Exited(Err(e)) => {
                    let reason = format!("process wait error: {}", e);
                    let _ = event_tx
                        .send(CommandEventKind::Failed(CommandFailedPayload {
                            reason: reason.clone(),
                            exit_code: None,
                            duration_ms: Some(duration_ms),
                            stdout_bytes,
                            stderr_bytes,
                        }))
                        .await;
                    Err(AdapterError::ExecutionFailed(reason))
                }
                WaitOutcome::TimedOut => {
                    let reason = format!("command timed out after {}ms", timeout_ms.unwrap_or(0));
                    let _ = event_tx
                        .send(CommandEventKind::Failed(CommandFailedPayload {
                            reason: reason.clone(),
                            exit_code: None,
                            duration_ms: Some(duration_ms),
                            stdout_bytes,
                            stderr_bytes,
                        }))
                        .await;
                    Err(AdapterError::ExecutionFailed(reason))
                }
                WaitOutcome::Aborted => {
                    let reason = "command aborted".to_string();
                    let _ = event_tx
                        .send(CommandEventKind::Failed(CommandFailedPayload {
                            reason: reason.clone(),
                            exit_code: None,
                            duration_ms: Some(duration_ms),
                            stdout_bytes,
                            stderr_bytes,
                        }))
                        .await;
                    Err(AdapterError::ExecutionFailed(reason))
                }
            }
        })
    }

    fn abort<'a>(&'a self) -> Pin<Box<dyn Future<Output = Result<(), AdapterError>> + Send + 'a>> {
        let abort_store = Arc::clone(&self.abort_tx);
        Box::pin(async move {
            if let Some(tx) = abort_store.lock().await.take() {
                let _ = tx.send(());
            }
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::mpsc;
    use uuid::Uuid;
    use workflow_model::memory::MemoryScope;
    use workflow_model::node::{NodeDisplay, NodeKind, RetryPolicy};
    use workflow_model::node_config::{NodeConfig, ToolNodeConfig};

    fn node_with_command(cmd: &str) -> NodeDefinition {
        NodeDefinition {
            node_id: Uuid::new_v4(),
            node_type: NodeKind::Tool,
            label: "test".into(),
            config: NodeConfig::Tool(ToolNodeConfig {
                command: cmd.to_owned(),
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

    fn node_with_timeout(cmd: &str, timeout_ms: u64) -> NodeDefinition {
        let mut node = node_with_command(cmd);
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
    async fn prepare_succeeds_with_valid_config() {
        let adapter = CliAdapter::new();
        let node = node_with_command("echo hello");
        adapter.prepare(&node, "/tmp").await.expect("prepare should succeed");
    }

    #[tokio::test]
    async fn prepare_fails_missing_command_field() {
        let adapter = CliAdapter::new();
        let mut node = node_with_command("echo hello");
        node.config = workflow_model::node_config::NodeConfig::Start(
            workflow_model::node_config::StartNodeConfig {},
        );
        let err = adapter.prepare(&node, "/tmp").await.unwrap_err();
        assert!(matches!(err, AdapterError::PreparationFailed(_)));
    }

    #[tokio::test]
    async fn prepare_fails_nonexistent_workspace() {
        let adapter = CliAdapter::new();
        let node = node_with_command("echo hello");
        let err = adapter
            .prepare(&node, "/nonexistent_path_xyz_abc")
            .await
            .unwrap_err();
        assert!(matches!(err, AdapterError::PreparationFailed(_)));
    }

    #[tokio::test]
    async fn execute_captures_stdout_and_exit_code() {
        let adapter = CliAdapter::new();
        let node = node_with_command("echo hello");
        let memory = dummy_memory();
        let (tx, _rx) = mpsc::channel(32);
        let out = adapter.execute(&node, "/tmp", &memory, tx).await.unwrap();
        assert_eq!(out.exit_code, Some(0));
        assert!(out.stdout.contains("hello"));
    }

    #[tokio::test]
    async fn execute_emits_event_sequence() {
        let adapter = CliAdapter::new();
        let node = node_with_command("echo hi");
        let memory = dummy_memory();
        let (tx, mut rx) = mpsc::channel(32);
        adapter.execute(&node, "/tmp", &memory, tx).await.unwrap();
        let mut events = vec![];
        while let Ok(e) = rx.try_recv() {
            events.push(e);
        }
        assert!(events.iter().any(|e| matches!(e, CommandEventKind::Prepared(_))));
        assert!(events.iter().any(|e| matches!(e, CommandEventKind::Started(_))));
        assert!(events.iter().any(|e| matches!(e, CommandEventKind::Stdout(_))));
        assert!(events.iter().any(|e| matches!(e, CommandEventKind::Completed(_))));
    }

    #[tokio::test]
    async fn execute_captures_nonzero_exit_code() {
        let adapter = CliAdapter::new();
        // `exit 42` causes the shell to exit with code 42
        let node = node_with_command("exit 42");
        let memory = dummy_memory();
        let (tx, _rx) = mpsc::channel(32);
        let out = adapter.execute(&node, "/tmp", &memory, tx).await.unwrap();
        assert_eq!(out.exit_code, Some(42));
    }

    #[tokio::test]
    async fn execute_captures_stderr() {
        let adapter = CliAdapter::new();
        let node = node_with_command("echo errormsg 1>&2");
        let memory = dummy_memory();
        let (tx, _rx) = mpsc::channel(32);
        let out = adapter.execute(&node, "/tmp", &memory, tx).await.unwrap();
        assert!(out.stderr.contains("errormsg"));
    }

    #[tokio::test]
    async fn execute_times_out_and_emits_failed_event() {
        let adapter = CliAdapter::new();
        let node = node_with_timeout("sleep 10", 100);
        let memory = dummy_memory();
        let (tx, mut rx) = mpsc::channel(32);
        let result = adapter.execute(&node, "/tmp", &memory, tx).await;
        assert!(result.is_err());
        let mut events = vec![];
        while let Ok(e) = rx.try_recv() {
            events.push(e);
        }
        assert!(events.iter().any(|e| matches!(e, CommandEventKind::Failed(_))));
        // Verify the reason mentions timeout
        let failed = events.iter().find_map(|e| {
            if let CommandEventKind::Failed(p) = e {
                Some(p)
            } else {
                None
            }
        });
        assert!(failed.unwrap().reason.contains("timed out"));
    }

    #[tokio::test]
    async fn abort_no_op_when_not_running() {
        let adapter = CliAdapter::new();
        adapter.abort().await.expect("abort should succeed even when idle");
    }
}
