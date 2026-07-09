// Interactive (headed) claude agent sessions — DEC-009.
//
// Spawns `claude` inside a PTY so it runs as a genuinely interactive session,
// streams raw terminal bytes to/from the frontend via `TerminalIo`, detects
// turn completion through a Stop hook injected via `--settings`, and extracts
// the final output from the hook payload / live transcript instead of scraping
// TUI stdout. See ARCHITECTURE.md §8 and DECISIONS.md DEC-009.

use std::io::Read;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use tokio::sync::{mpsc, oneshot, watch, Mutex};
use uuid::Uuid;

use event_model::agent_events::{
    AgentAwaitingUserPayload, AgentCompletedPayload, AgentEventKind, AgentFailedPayload,
    AgentOutputReceivedPayload, AgentRequestPreparedPayload, AgentStartedPayload,
};
use workflow_model::node::NodeDefinition;
use workflow_model::node_config::{AgentNodeConfig, AgentOutputMode, NodeConfig};

use crate::{AdapterError, AdapterOutput};

/// Default permission mode when `AgentNodeConfig.permission_mode` is unset.
/// Chosen so unattended runs don't stall on routine file-edit prompts (DEC-009).
const DEFAULT_PERMISSION_MODE: &str = "acceptEdits";

/// Poll interval for the Stop-hook sentinel file.
const SENTINEL_POLL: Duration = Duration::from_millis(300);

/// Grace period for the CLI to exit after `/exit` before it is killed.
const EXIT_GRACE: Duration = Duration::from_secs(10);

/// Channel set bridging the PTY to the frontend terminal (xterm.js).
///
/// The Tauri layer owns the other ends: `output_tx` chunks become
/// `agent_terminal_output` window events; `input_rx` receives keystrokes from
/// `agent_terminal_input`; `resize_rx` receives `(cols, rows)` from
/// `agent_terminal_resize`. Raw bytes never enter the run event log.
pub struct TerminalIo {
    pub output_tx: mpsc::Sender<Vec<u8>>,
    pub input_rx: mpsc::Receiver<Vec<u8>>,
    pub resize_rx: mpsc::Receiver<(u16, u16)>,
}

/// Result of a completed turn (Stop hook fired).
#[derive(Debug, Clone)]
struct TurnResult {
    /// `last_assistant_message` from the hook payload (primary output source).
    last_assistant_message: Option<String>,
    /// `transcript_path` from the hook payload (fallback output source; only
    /// valid while the session is alive — the CLI rotates files on exit).
    transcript_path: Option<PathBuf>,
}

/// A live interactive claude session between turn-end and finalization.
///
/// Produced by [`crate::agent::AgentCliAdapter::start_interactive`]; consumed
/// by [`InteractiveSession::finalize`]. Between the two calls the PTY stays
/// alive and the user may keep interacting through the terminal (manual
/// completion mode, DEC-009).
pub struct InteractiveSession {
    pub session_id: String,
    pub provider: String,
    started: Instant,
    sentinel_path: PathBuf,
    /// Bytes-in channel to the PTY writer task (used to send `/exit`).
    writer_tx: mpsc::Sender<Vec<u8>>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    /// Resolved when the child process exits.
    exited_rx: oneshot::Receiver<Option<u32>>,
    /// Keeps the PTY master (and thus reader/writer/resize tasks) alive.
    _master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    /// Turn result observed when the first Stop sentinel appeared.
    turn: TurnResult,
    output_mode: AgentOutputMode,
}

/// Outcome of waiting for the first turn to complete.
pub enum TurnOutcome {
    /// Turn ended normally (Stop hook fired). Session is still alive.
    TurnEnded(Box<InteractiveSession>),
    /// The CLI exited before any turn completed (startup error, `/exit`,
    /// crash). `agent.failed` has already been emitted.
    ExitedEarly { exit_code: Option<u32> },
}

/// Extract the agent config or fail.
fn agent_config(node: &NodeDefinition) -> Result<&AgentNodeConfig, AdapterError> {
    match &node.config {
        NodeConfig::Agent(cfg) => Ok(cfg),
        _ => Err(AdapterError::NodeTypeNotSupported(
            "interactive execution requires an Agent node config".into(),
        )),
    }
}

/// True when this node should take the interactive PTY path (DEC-009):
/// claude provider, no explicit command override.
pub fn is_interactive_claude(node: &NodeDefinition) -> bool {
    matches!(
        &node.config,
        NodeConfig::Agent(cfg)
            if cfg.command.is_none() && cfg.provider_hint.as_deref() == Some("claude")
    )
}

/// Build the Stop-hook settings JSON. The hook writes its stdin (which carries
/// `last_assistant_message` and `transcript_path`) to the sentinel file.
fn stop_hook_settings(sentinel: &std::path::Path) -> String {
    serde_json::json!({
        "hooks": {
            "Stop": [
                { "hooks": [ { "type": "command", "command": format!("cat > {}", shell_quote_path(sentinel)) } ] }
            ]
        }
    })
    .to_string()
}

/// Quote a path for embedding in the hook's shell command line.
fn shell_quote_path(p: &std::path::Path) -> String {
    format!("'{}'", p.to_string_lossy().replace('\'', r"'\''"))
}

/// Read and parse the sentinel file into a `TurnResult`.
fn read_sentinel(path: &std::path::Path) -> Option<TurnResult> {
    let raw = std::fs::read_to_string(path).ok()?;
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
    Some(TurnResult {
        last_assistant_message: v
            .get("last_assistant_message")
            .and_then(|m| m.as_str())
            .map(str::to_owned),
        transcript_path: v
            .get("transcript_path")
            .and_then(|t| t.as_str())
            .map(PathBuf::from),
    })
}

/// Extract the final assistant text from a session transcript JSONL.
///
/// Entries with `type: "assistant"` carry `message.content[]` blocks; the
/// last entry with non-empty text blocks wins.
pub(crate) fn last_assistant_text_from_transcript(raw: &str) -> Option<String> {
    let mut last: Option<String> = None;
    for line in raw.lines() {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        if v.get("type").and_then(|t| t.as_str()) != Some("assistant") {
            continue;
        }
        let Some(content) = v.pointer("/message/content").and_then(|c| c.as_array()) else {
            continue;
        };
        let text: String = content
            .iter()
            .filter(|b| b.get("type").and_then(|t| t.as_str()) == Some("text"))
            .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
            .collect();
        if !text.is_empty() {
            last = Some(text);
        }
    }
    last
}

/// Parse the final assistant text according to `AgentOutputMode`
/// (DEC-005 as amended by DEC-009: modes apply to the transcript text).
pub(crate) fn parse_interactive_output(
    text: &str,
    mode: &AgentOutputMode,
) -> Result<serde_json::Value, AdapterError> {
    match mode {
        AgentOutputMode::Raw => Ok(serde_json::json!({ "raw": text })),
        AgentOutputMode::JsonStdout => serde_json::from_str(text).map_err(|e| {
            AdapterError::ExecutionFailed(format!(
                "output_mode is json_stdout but the final assistant message is not valid JSON: {}",
                e
            ))
        }),
        AgentOutputMode::JsonLastLine => {
            let last_line = text
                .lines()
                .rev()
                .find(|l| !l.trim().is_empty())
                .unwrap_or("");
            serde_json::from_str(last_line).map_err(|e| {
                AdapterError::ExecutionFailed(format!(
                    "output_mode is json_last_line but the last non-empty line is not valid JSON: {}",
                    e
                ))
            })
        }
    }
}

impl crate::agent::AgentCliAdapter {
    /// Spawn an interactive claude session in a PTY and wait for the first
    /// turn to complete (DEC-009 phase A).
    ///
    /// Emits `RequestPrepared` and `Started` (with `session_id`) immediately,
    /// then waits until the Stop hook fires, the process exits, the timeout
    /// (`retry_policy.max_runtime_ms`) elapses, or `abort()` is called.
    ///
    /// On `TurnEnded` the session is still live: in `completion_mode: auto`
    /// call [`InteractiveSession::finalize`] immediately; in `manual` keep it
    /// open (the user may keep typing) and finalize on the completion signal.
    pub async fn start_interactive(
        &self,
        node: &NodeDefinition,
        workspace_root: &str,
        event_tx: mpsc::Sender<AgentEventKind>,
        mut io: TerminalIo,
    ) -> Result<TurnOutcome, AdapterError> {
        let cfg = agent_config(node)?;
        let prompt = cfg.prompt.clone();
        let model = cfg.model.clone();
        let permission_mode = cfg
            .permission_mode
            .clone()
            .unwrap_or_else(|| DEFAULT_PERMISSION_MODE.to_owned());
        let output_mode = cfg.output_mode.clone();
        let timeout_ms = node.retry_policy.max_runtime_ms;

        let session_id = Uuid::new_v4().to_string();
        let provider = match &model {
            Some(m) => format!("claude/{}", m),
            None => "claude".to_owned(),
        };

        // Sentinel file for the Stop hook.
        let sentinel_dir = std::env::temp_dir().join("agent-arcade");
        tokio::fs::create_dir_all(&sentinel_dir).await.map_err(|e| {
            AdapterError::PreparationFailed(format!("cannot create sentinel dir: {}", e))
        })?;
        let sentinel_path = sentinel_dir.join(format!("stop-{}.json", session_id));
        let _ = tokio::fs::remove_file(&sentinel_path).await;

        let _ = event_tx
            .send(AgentEventKind::RequestPrepared(
                AgentRequestPreparedPayload {
                    provider: provider.clone(),
                    prompt_tokens: None,
                    memory_keys_used: vec![],
                },
            ))
            .await;

        // Build the claude argv (no shell — argv array avoids quoting issues).
        let mut cmd = CommandBuilder::new("claude");
        cmd.arg("--session-id");
        cmd.arg(&session_id);
        if let Some(m) = &model {
            cmd.arg("--model");
            cmd.arg(m);
        }
        cmd.arg("--permission-mode");
        cmd.arg(&permission_mode);
        cmd.arg("--settings");
        cmd.arg(stop_hook_settings(&sentinel_path));
        cmd.arg(&prompt);
        cmd.cwd(workspace_root);
        cmd.env("TERM", "xterm-256color");

        // Open the PTY and spawn.
        let pty = native_pty_system()
            .openpty(PtySize {
                rows: 30,
                cols: 120,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| AdapterError::ExecutionFailed(format!("failed to open PTY: {}", e)))?;

        let mut child = pty.slave.spawn_command(cmd).map_err(|e| {
            AdapterError::ExecutionFailed(format!("failed to spawn claude in PTY: {}", e))
        })?;
        drop(pty.slave);

        let mut killer = child.clone_killer();
        let started = Instant::now();

        let _ = event_tx
            .send(AgentEventKind::Started(AgentStartedPayload {
                provider: provider.clone(),
                run_elapsed_ms: 0,
                session_id: Some(session_id.clone()),
            }))
            .await;

        // Reader: PTY master -> output_tx (blocking reads on a dedicated thread).
        let mut reader = pty
            .master
            .try_clone_reader()
            .map_err(|e| AdapterError::ExecutionFailed(format!("PTY reader: {}", e)))?;
        let output_tx = io.output_tx.clone();
        tokio::task::spawn_blocking(move || {
            let mut buf = [0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        // If the frontend receiver is gone, keep draining so the
                        // child never blocks on a full PTY buffer.
                        let _ = output_tx.blocking_send(buf[..n].to_vec());
                    }
                }
            }
        });

        // Writer: single channel into the PTY; `/exit` and user keystrokes
        // both go through it.
        let mut writer = pty
            .master
            .take_writer()
            .map_err(|e| AdapterError::ExecutionFailed(format!("PTY writer: {}", e)))?;
        let (writer_tx, mut writer_rx) = mpsc::channel::<Vec<u8>>(256);
        tokio::task::spawn_blocking(move || {
            use std::io::Write;
            while let Some(bytes) = writer_rx.blocking_recv() {
                if writer.write_all(&bytes).is_err() {
                    break;
                }
                let _ = writer.flush();
            }
        });
        let user_writer_tx = writer_tx.clone();
        tokio::spawn(async move {
            while let Some(bytes) = io.input_rx.recv().await {
                if user_writer_tx.send(bytes).await.is_err() {
                    break;
                }
            }
        });

        // Child exit watcher: blocking wait() -> watch channel (+ oneshot for
        // the finalize phase).
        let (exited_tx, exited_rx) = oneshot::channel::<Option<u32>>();
        let (exit_watch_tx, mut exit_watch_rx) = watch::channel::<Option<Option<u32>>>(None);
        tokio::task::spawn_blocking(move || {
            let code = child.wait().ok().map(|s| s.exit_code());
            let _ = exit_watch_tx.send(Some(code));
            let _ = exited_tx.send(code);
        });

        // Master handle: kept alive in an Arc shared with the resize task and
        // the returned session.
        let master: Arc<Mutex<Box<dyn MasterPty + Send>>> = Arc::new(Mutex::new(pty.master));
        {
            let master = Arc::clone(&master);
            tokio::spawn(async move {
                while let Some((cols, rows)) = io.resize_rx.recv().await {
                    let m = master.lock().await;
                    let _ = m.resize(PtySize {
                        rows,
                        cols,
                        pixel_width: 0,
                        pixel_height: 0,
                    });
                }
            });
        }

        // Wait for: Stop sentinel | child exit | timeout | abort.
        let mut abort_rx = self.register_abort().await;
        let deadline =
            timeout_ms.map(|ms| tokio::time::Instant::now() + Duration::from_millis(ms));
        let mut child_exit: Option<Option<u32>> = None;

        let sentinel_or_exit = loop {
            if let Some(turn) = read_sentinel(&sentinel_path) {
                break Ok(turn);
            }
            if let Some(code) = child_exit {
                // Child is gone and no sentinel (checked above, post-exit).
                break Err(code);
            }
            if let Some(d) = deadline {
                if tokio::time::Instant::now() >= d {
                    let _ = killer.kill();
                    let reason = format!(
                        "interactive claude session timed out after {}ms without completing a turn \
                         (no Stop hook sentinel — check for blocking dialogs in the session terminal)",
                        timeout_ms.unwrap_or(0)
                    );
                    let _ = event_tx
                        .send(AgentEventKind::Failed(AgentFailedPayload {
                            provider: provider.clone(),
                            reason: reason.clone(),
                            error_code: None,
                            duration_ms: Some(started.elapsed().as_millis() as u64),
                        }))
                        .await;
                    return Err(AdapterError::ExecutionFailed(reason));
                }
            }

            tokio::select! {
                _ = tokio::time::sleep(SENTINEL_POLL) => {}
                changed = exit_watch_rx.changed() => {
                    if changed.is_ok() {
                        child_exit = *exit_watch_rx.borrow();
                    } else {
                        child_exit = Some(None);
                    }
                }
                _ = &mut abort_rx => {
                    let _ = killer.kill();
                    let reason = "agent session aborted".to_owned();
                    let _ = event_tx
                        .send(AgentEventKind::Failed(AgentFailedPayload {
                            provider: provider.clone(),
                            reason: reason.clone(),
                            error_code: None,
                            duration_ms: Some(started.elapsed().as_millis() as u64),
                        }))
                        .await;
                    return Err(AdapterError::ExecutionFailed(reason));
                }
            }
        };

        match sentinel_or_exit {
            Ok(turn) => Ok(TurnOutcome::TurnEnded(Box::new(InteractiveSession {
                session_id,
                provider,
                started,
                sentinel_path,
                writer_tx,
                killer,
                exited_rx,
                _master: master,
                turn,
                output_mode,
            }))),
            Err(code) => {
                let reason = format!(
                    "claude session exited before completing a turn (exit code {:?})",
                    code
                );
                let _ = event_tx
                    .send(AgentEventKind::Failed(AgentFailedPayload {
                        provider: provider.clone(),
                        reason,
                        error_code: code.map(|c| c.to_string()),
                        duration_ms: Some(started.elapsed().as_millis() as u64),
                    }))
                    .await;
                let _ = tokio::fs::remove_file(&sentinel_path).await;
                Ok(TurnOutcome::ExitedEarly { exit_code: code })
            }
        }
    }
}

impl InteractiveSession {
    /// Emit `agent.awaiting_user` (manual completion mode) — the turn ended
    /// and the session is held open for user steering.
    pub async fn emit_awaiting_user(&self, event_tx: &mpsc::Sender<AgentEventKind>) {
        let _ = event_tx
            .send(AgentEventKind::AwaitingUser(AgentAwaitingUserPayload {
                provider: self.provider.clone(),
                session_id: self.session_id.clone(),
                turn_elapsed_ms: self.started.elapsed().as_millis() as u64,
            }))
            .await;
    }

    /// Finalize the session (DEC-009 phase B): refresh the turn result from
    /// the latest sentinel, capture the transcript while the session is still
    /// alive, send `/exit`, await process exit (killing after a grace period),
    /// parse the output, and emit `OutputReceived` + `Completed`.
    pub async fn finalize(
        mut self,
        event_tx: &mpsc::Sender<AgentEventKind>,
    ) -> Result<AdapterOutput, AdapterError> {
        // Latest sentinel wins (manual mode may have run more turns).
        if let Some(turn) = read_sentinel(&self.sentinel_path) {
            self.turn = turn;
        }

        // Capture output sources BEFORE exiting — the CLI rotates transcript
        // files on exit (verified empirically; see DEC-009).
        let transcript_raw = match &self.turn.transcript_path {
            Some(p) => tokio::fs::read_to_string(p).await.ok(),
            None => None,
        };
        let final_text = self
            .turn
            .last_assistant_message
            .clone()
            .or_else(|| {
                transcript_raw
                    .as_deref()
                    .and_then(last_assistant_text_from_transcript)
            })
            .unwrap_or_default();

        // Graceful exit, then kill after grace.
        let _ = self.writer_tx.send(b"/exit\r".to_vec()).await;
        let exit_code = match tokio::time::timeout(EXIT_GRACE, &mut self.exited_rx).await {
            Ok(Ok(code)) => code.map(|c| c as i32),
            _ => {
                let _ = self.killer.kill();
                match tokio::time::timeout(Duration::from_secs(5), &mut self.exited_rx).await {
                    Ok(Ok(code)) => code.map(|c| c as i32),
                    _ => None,
                }
            }
        };

        let duration_ms = self.started.elapsed().as_millis() as u64;
        let _ = tokio::fs::remove_file(&self.sentinel_path).await;

        if final_text.is_empty() {
            let reason = "interactive session ended without any assistant output".to_owned();
            let _ = event_tx
                .send(AgentEventKind::Failed(AgentFailedPayload {
                    provider: self.provider.clone(),
                    reason: reason.clone(),
                    error_code: None,
                    duration_ms: Some(duration_ms),
                }))
                .await;
            return Err(AdapterError::ExecutionFailed(reason));
        }

        let output = parse_interactive_output(&final_text, &self.output_mode)?;

        let _ = event_tx
            .send(AgentEventKind::OutputReceived(AgentOutputReceivedPayload {
                chunk: final_text.clone(),
                cumulative_chars: final_text.len() as u64,
                is_final: true,
            }))
            .await;
        let _ = event_tx
            .send(AgentEventKind::Completed(AgentCompletedPayload {
                provider: self.provider.clone(),
                duration_ms,
                input_tokens: None,
                output_tokens: None,
                output_memory_key: None,
            }))
            .await;

        Ok(AdapterOutput {
            output,
            exit_code,
            stdout: final_text,
            stderr: String::new(),
            duration_ms,
        })
    }

    /// Kill the session without finalizing (cancellation path).
    pub async fn kill(mut self) {
        let _ = self.killer.kill();
        let _ = tokio::fs::remove_file(&self.sentinel_path).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stop_hook_settings_shape() {
        let s = stop_hook_settings(std::path::Path::new("/tmp/agent-arcade/stop-x.json"));
        let v: serde_json::Value = serde_json::from_str(&s).unwrap();
        let cmd = v["hooks"]["Stop"][0]["hooks"][0]["command"].as_str().unwrap();
        assert!(cmd.starts_with("cat > '"));
        assert!(cmd.contains("stop-x.json"));
        assert_eq!(v["hooks"]["Stop"][0]["hooks"][0]["type"], "command");
    }

    #[test]
    fn transcript_extraction_takes_last_assistant_text() {
        let jsonl = concat!(
            r#"{"type":"user","message":{"content":"hi"}}"#, "\n",
            r#"{"type":"assistant","message":{"content":[{"type":"text","text":"first"}]}}"#, "\n",
            r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash"}]}}"#, "\n",
            r#"{"type":"assistant","message":{"content":[{"type":"text","text":"final "},{"type":"text","text":"answer"}]}}"#, "\n",
            "not json\n",
        );
        assert_eq!(
            last_assistant_text_from_transcript(jsonl).as_deref(),
            Some("final answer")
        );
    }

    #[test]
    fn transcript_extraction_none_when_no_assistant_text() {
        assert!(last_assistant_text_from_transcript(r#"{"type":"user"}"#).is_none());
    }

    #[test]
    fn parse_interactive_output_modes() {
        let raw = parse_interactive_output("hello", &AgentOutputMode::Raw).unwrap();
        assert_eq!(raw["raw"], "hello");

        let js = parse_interactive_output(r#"{"ok":true}"#, &AgentOutputMode::JsonStdout).unwrap();
        assert_eq!(js["ok"], true);

        let last =
            parse_interactive_output("blah\n{\"n\":1}\n", &AgentOutputMode::JsonLastLine).unwrap();
        assert_eq!(last["n"], 1);

        assert!(parse_interactive_output("not json", &AgentOutputMode::JsonStdout).is_err());
    }

    #[test]
    fn interactive_routing_predicate() {
        use uuid::Uuid;
        use workflow_model::node::{NodeDisplay, NodeKind, RetryPolicy};

        let mk = |command: Option<&str>, hint: Option<&str>| NodeDefinition {
            node_id: Uuid::new_v4(),
            node_type: NodeKind::Agent,
            label: "n".into(),
            config: NodeConfig::Agent(AgentNodeConfig {
                prompt: "p".into(),
                command: command.map(str::to_owned),
                provider_hint: hint.map(str::to_owned),
                model: None,
                output_mode: AgentOutputMode::Raw,
                completion_mode: Default::default(),
                permission_mode: None,
            }),
            input_contract: serde_json::Value::Null,
            output_contract: serde_json::Value::Null,
            memory_access: serde_json::Value::Null,
            retry_policy: RetryPolicy {
                max_retries: 0,
                max_runtime_ms: None,
            },
            display: NodeDisplay { x: 0.0, y: 0.0 },
        };

        assert!(is_interactive_claude(&mk(None, Some("claude"))));
        assert!(!is_interactive_claude(&mk(Some("claude -x"), Some("claude"))));
        assert!(!is_interactive_claude(&mk(None, Some("openai"))));
        assert!(!is_interactive_claude(&mk(None, None)));
    }
}
