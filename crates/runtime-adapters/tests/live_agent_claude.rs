// Live integration tests for AgentCliAdapter against a real installed agent CLI.
//
// These tests spawn the actual `claude` binary (network + credentials required),
// so they are #[ignore]d by default and excluded from normal CI runs. Run them
// explicitly with:
//
//     cargo test -p runtime-adapters --test live_agent_claude -- --ignored --nocapture
//
// They exercise the same resolve → spawn → stream → parse path the Tauri engine
// uses in dispatch_node_execution (apps/desktop/src-tauri/src/commands/mod.rs).

use tokio::sync::mpsc;
use uuid::Uuid;

use event_model::agent_events::AgentEventKind;
use runtime_adapters::agent::AgentCliAdapter;
use runtime_adapters::agent_interactive::{TerminalIo, TurnOutcome};
use workflow_model::memory::{MemoryScope, MemoryState};
use workflow_model::node::{NodeDefinition, NodeDisplay, NodeKind, RetryPolicy};
use workflow_model::node_config::{AgentNodeConfig, AgentOutputMode, NodeConfig};

fn claude_node(model: &str, prompt: &str, timeout_ms: u64) -> NodeDefinition {
    NodeDefinition {
        node_id: Uuid::new_v4(),
        node_type: NodeKind::Agent,
        label: "live-claude".into(),
        config: NodeConfig::Agent(AgentNodeConfig {
            prompt: prompt.to_owned(),
            command: None,
            provider_hint: Some("claude".into()),
            model: Some(model.to_owned()),
            output_mode: AgentOutputMode::Raw,
                completion_mode: Default::default(),
                permission_mode: None,
        }),
        input_contract: serde_json::Value::Null,
        output_contract: serde_json::Value::Null,
        memory_access: serde_json::Value::Null,
        retry_policy: RetryPolicy {
            max_retries: 0,
            max_runtime_ms: Some(timeout_ms),
        },
        display: NodeDisplay { x: 0.0, y: 0.0 },
    }
}

fn run_shared_memory() -> MemoryState {
    MemoryState {
        run_id: Uuid::new_v4(),
        node_id: None,
        scope: MemoryScope::RunShared,
        data: serde_json::Value::Null,
    }
}

/// Happy path: provider_hint="claude" + a current model spins up the real CLI,
/// streams output, and completes with the expected event sequence.
#[tokio::test]
#[ignore = "spawns the real claude CLI (network + credentials required)"]
async fn live_claude_provider_resolution_executes_end_to_end() {
    let adapter = AgentCliAdapter::new();
    let node = claude_node(
        "claude-haiku-4-5",
        "Reply with exactly the word PONG and nothing else.",
        120_000,
    );
    let memory = run_shared_memory();
    let (tx, mut rx) = mpsc::channel(4096);

    let out = adapter
        .execute(&node, "/tmp", &memory, tx)
        .await
        .expect("live claude execution should succeed");

    assert_eq!(out.exit_code, Some(0));
    assert!(
        out.stdout.contains("PONG"),
        "expected PONG in stdout, got: {}",
        out.stdout
    );

    let mut events = vec![];
    while let Ok(e) = rx.try_recv() {
        events.push(e);
    }
    assert!(events
        .iter()
        .any(|e| matches!(e, AgentEventKind::RequestPrepared(_))));
    assert!(events.iter().any(|e| matches!(e, AgentEventKind::Started(_))));
    assert!(events
        .iter()
        .any(|e| matches!(e, AgentEventKind::OutputReceived(_))));
    let completed = events.iter().find_map(|e| match e {
        AgentEventKind::Completed(p) => Some(p),
        _ => None,
    });
    assert_eq!(
        completed.expect("expected Completed event").provider,
        "claude/claude-haiku-4-5"
    );
}

/// Failure path: an invalid model ID must exit non-zero and surface as
/// AgentEventKind::Failed, not hang or silently succeed.
#[tokio::test]
#[ignore = "spawns the real claude CLI (network + credentials required)"]
async fn live_claude_invalid_model_fails_cleanly() {
    let adapter = AgentCliAdapter::new();
    let node = claude_node(
        "claude-not-a-real-model",
        "Reply with exactly the word PONG.",
        120_000,
    );
    let memory = run_shared_memory();
    let (tx, mut rx) = mpsc::channel(4096);

    let result = adapter.execute(&node, "/tmp", &memory, tx).await;
    assert!(result.is_err(), "invalid model should fail: {:?}", result);

    let mut events = vec![];
    while let Ok(e) = rx.try_recv() {
        events.push(e);
    }
    assert!(events.iter().any(|e| matches!(e, AgentEventKind::Failed(_))));
}

/// Live interactive path (DEC-009): spawn a real headed claude session in a
/// PTY, wait for the Stop hook, finalize, and verify the transcript-derived
/// output and event sequence. Uses the repo root as workspace so the
/// workspace-trust dialog does not block the session.
#[tokio::test]
#[ignore = "spawns the real claude CLI interactively (network + credentials required)"]
async fn live_claude_interactive_session_end_to_end() {
    let adapter = AgentCliAdapter::new();
    let mut node = claude_node(
        "haiku",
        "Reply with exactly the word PONG and nothing else.",
        180_000,
    );
    if let NodeConfig::Agent(ref mut cfg) = node.config {
        cfg.permission_mode = Some("plan".to_owned());
    }

    let (tx, mut rx) = mpsc::channel(4096);
    let (term_out_tx, mut term_out_rx) = mpsc::channel::<Vec<u8>>(1024);
    let (input_tx, input_rx) = mpsc::channel::<Vec<u8>>(16);
    let (_resize_tx, resize_rx) = mpsc::channel::<(u16, u16)>(4);

    // Drain terminal bytes, answering one-time startup dialogs exactly as a
    // user at the embedded terminal would (workspace trust → Enter accepts
    // the default; first-time MCP server approval → "3" = continue without).
    //
    // NOTE: the TUI intersperses cursor-positioning escapes between words
    // ("New\x1b[6GMCP\x1b[10Gserver"), so detection must match single words —
    // multi-word substrings never appear contiguously in the raw stream.
    let screen_log = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
    let screen_for_drain = std::sync::Arc::clone(&screen_log);
    let drain = tokio::spawn(async move {
        let mut total = 0usize;
        let mut trust_answered = false;
        let mut mcp_answered = false;
        while let Some(chunk) = term_out_rx.recv().await {
            total += chunk.len();
            let mut screen = screen_for_drain.lock().unwrap().clone();
            screen.push_str(&String::from_utf8_lossy(&chunk));
            *screen_for_drain.lock().unwrap() = screen.clone();
            if !trust_answered && screen.contains("trust") && screen.contains("folder") {
                trust_answered = true;
                let _ = input_tx.send(b"\r".to_vec()).await;
            }
            if !mcp_answered && screen.contains("MCP") && screen.contains("found") {
                mcp_answered = true;
                let _ = input_tx.send(b"3\r".to_vec()).await;
            }
        }
        total
    });

    let workspace = env!("CARGO_MANIFEST_DIR");
    let outcome = adapter
        .start_interactive(
            &node,
            workspace,
            tx.clone(),
            TerminalIo {
                output_tx: term_out_tx,
                input_rx,
                resize_rx,
            },
        )
        .await;
    let outcome = match outcome {
        Ok(o) => o,
        Err(e) => {
            // Dump the terminal tail so a blocked dialog is diagnosable.
            let screen = screen_log.lock().unwrap();
            let tail: String = screen.chars().rev().take(1500).collect::<String>().chars().rev().collect();
            panic!("start_interactive failed: {e}\n--- terminal tail ---\n{tail}");
        }
    };

    let session = match outcome {
        TurnOutcome::TurnEnded(session) => session,
        TurnOutcome::ExitedEarly { exit_code } => {
            panic!("session exited before completing a turn: {:?}", exit_code)
        }
    };
    assert!(!session.session_id.is_empty());
    let pinned_session_id = session.session_id.clone();

    let out = session
        .finalize(&tx)
        .await
        .expect("finalize should succeed");
    assert!(
        out.stdout.contains("PONG"),
        "expected PONG in transcript-derived output, got: {}",
        out.stdout
    );
    assert_eq!(out.output["raw"].as_str().unwrap().trim(), "PONG");

    drop(tx);
    let mut events = vec![];
    while let Ok(e) = rx.try_recv() {
        events.push(e);
    }
    // Started must carry the pinned session id.
    let started = events.iter().find_map(|e| match e {
        AgentEventKind::Started(p) => Some(p),
        _ => None,
    });
    assert_eq!(
        started.expect("expected Started event").session_id.as_deref(),
        Some(pinned_session_id.as_str())
    );
    assert!(events.iter().any(|e| matches!(e, AgentEventKind::OutputReceived(p) if p.is_final)));
    assert!(events.iter().any(|e| matches!(e, AgentEventKind::Completed(_))));

    let drained = drain.await.unwrap();
    assert!(drained > 0, "expected PTY terminal output bytes");
}
