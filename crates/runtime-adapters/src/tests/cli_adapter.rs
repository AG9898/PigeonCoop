// CLI adapter tests — uses only `echo`, `exit`, `sleep`, and shell redirections.
// No real agent CLIs or network calls.
//
// Documented event flow for a successful command:
//   command.prepared → command.started → command.stdout* → command.completed
//
// For timeout/abort:
//   command.prepared → command.started → command.failed

use tokio::sync::mpsc;
use uuid::Uuid;

use event_model::command_events::CommandEventKind;
use workflow_model::memory::{MemoryScope, MemoryState};
use workflow_model::node::{NodeDisplay, NodeKind, RetryPolicy};
use workflow_model::node_config::{NodeConfig, ToolNodeConfig};
use workflow_model::node::NodeDefinition;

use crate::cli::CliAdapter;
use crate::{Adapter, AdapterError};

fn tool_node(cmd: &str) -> NodeDefinition {
    NodeDefinition {
        node_id: Uuid::new_v4(),
        node_type: NodeKind::Tool,
        label: "test-tool".into(),
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

fn tool_node_with_timeout(cmd: &str, timeout_ms: u64) -> NodeDefinition {
    let mut node = tool_node(cmd);
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

// Collect all events from the receiver after execute returns.
async fn collect_events(mut rx: mpsc::Receiver<CommandEventKind>) -> Vec<CommandEventKind> {
    let mut events = vec![];
    while let Ok(e) = rx.try_recv() {
        events.push(e);
    }
    events
}

// ── Prepare ──────────────────────────────────────────────────────────────────

#[tokio::test]
async fn prepare_ok_with_tool_config_and_valid_root() {
    let adapter = CliAdapter::new();
    let node = tool_node("echo test");
    adapter.prepare(&node, "/tmp").await.expect("prepare should succeed");
}

#[tokio::test]
async fn prepare_fails_non_tool_config() {
    let adapter = CliAdapter::new();
    let mut node = tool_node("echo test");
    node.config = NodeConfig::Start(workflow_model::node_config::StartNodeConfig {});
    let err = adapter.prepare(&node, "/tmp").await.unwrap_err();
    assert!(matches!(err, AdapterError::PreparationFailed(_)));
}

#[tokio::test]
async fn prepare_fails_missing_workspace() {
    let adapter = CliAdapter::new();
    let node = tool_node("echo test");
    let err = adapter.prepare(&node, "/nonexistent_xyz_abc_123").await.unwrap_err();
    assert!(matches!(err, AdapterError::PreparationFailed(_)));
}

// ── Event ordering — success path ────────────────────────────────────────────

#[tokio::test]
async fn event_order_success_prepared_started_stdout_completed() {
    let adapter = CliAdapter::new();
    let node = tool_node("echo hello");
    let memory = dummy_memory();
    let (tx, rx) = mpsc::channel(32);

    adapter.execute(&node, "/tmp", &memory, tx).await.unwrap();
    let events = collect_events(rx).await;

    // Verify minimum required events are present
    assert!(!events.is_empty(), "expected at least one event");

    // Verify strict order: Prepared must come before Started
    let prepared_idx = events
        .iter()
        .position(|e| matches!(e, CommandEventKind::Prepared(_)))
        .expect("Prepared event missing");
    let started_idx = events
        .iter()
        .position(|e| matches!(e, CommandEventKind::Started(_)))
        .expect("Started event missing");
    let completed_idx = events
        .iter()
        .position(|e| matches!(e, CommandEventKind::Completed(_)))
        .expect("Completed event missing");

    assert!(prepared_idx < started_idx, "Prepared must come before Started");
    assert!(started_idx < completed_idx, "Started must come before Completed");

    // Stdout events (if any) must appear before Completed
    for (i, event) in events.iter().enumerate() {
        if matches!(event, CommandEventKind::Stdout(_)) {
            assert!(i < completed_idx, "Stdout events must appear before Completed");
        }
    }

    // No Failed event in a success run
    assert!(
        !events.iter().any(|e| matches!(e, CommandEventKind::Failed(_))),
        "no Failed event expected on success"
    );
}

#[tokio::test]
async fn event_order_no_stdout_emitted_for_silent_command() {
    let adapter = CliAdapter::new();
    let node = tool_node("true"); // exits 0, produces no stdout
    let memory = dummy_memory();
    let (tx, rx) = mpsc::channel(32);

    adapter.execute(&node, "/tmp", &memory, tx).await.unwrap();
    let events = collect_events(rx).await;

    // Prepared, Started, Completed must still be present
    assert!(events.iter().any(|e| matches!(e, CommandEventKind::Prepared(_))));
    assert!(events.iter().any(|e| matches!(e, CommandEventKind::Started(_))));
    assert!(events.iter().any(|e| matches!(e, CommandEventKind::Completed(_))));
}

// ── Stdout / stderr capture ───────────────────────────────────────────────────

#[tokio::test]
async fn stdout_captured_in_output() {
    let adapter = CliAdapter::new();
    let node = tool_node("echo captured_output_text");
    let memory = dummy_memory();
    let (tx, _rx) = mpsc::channel(32);

    let out = adapter.execute(&node, "/tmp", &memory, tx).await.unwrap();
    assert!(out.stdout.contains("captured_output_text"));
    assert_eq!(out.exit_code, Some(0));
}

#[tokio::test]
async fn stderr_captured_in_output() {
    let adapter = CliAdapter::new();
    let node = tool_node("echo captured_error_text 1>&2");
    let memory = dummy_memory();
    let (tx, _rx) = mpsc::channel(32);

    let out = adapter.execute(&node, "/tmp", &memory, tx).await.unwrap();
    assert!(out.stderr.contains("captured_error_text"), "stderr should contain the message");
    // stdout should be empty, exit code 0
    assert_eq!(out.exit_code, Some(0));
}

#[tokio::test]
async fn stderr_events_emitted() {
    let adapter = CliAdapter::new();
    let node = tool_node("echo err_line 1>&2");
    let memory = dummy_memory();
    let (tx, rx) = mpsc::channel(32);

    adapter.execute(&node, "/tmp", &memory, tx).await.unwrap();
    let events = collect_events(rx).await;

    assert!(
        events.iter().any(|e| matches!(e, CommandEventKind::Stderr(_))),
        "expected Stderr event"
    );
}

// ── Non-zero exit code ────────────────────────────────────────────────────────

#[tokio::test]
async fn nonzero_exit_captured_in_output() {
    let adapter = CliAdapter::new();
    let node = tool_node("exit 7");
    let memory = dummy_memory();
    let (tx, _rx) = mpsc::channel(32);

    let out = adapter.execute(&node, "/tmp", &memory, tx).await.unwrap();
    assert_eq!(out.exit_code, Some(7));
}

#[tokio::test]
async fn nonzero_exit_still_emits_completed_event() {
    let adapter = CliAdapter::new();
    // CLI adapter emits Completed even for non-zero exits (caller decides on success)
    let node = tool_node("exit 3");
    let memory = dummy_memory();
    let (tx, rx) = mpsc::channel(32);

    adapter.execute(&node, "/tmp", &memory, tx).await.unwrap();
    let events = collect_events(rx).await;

    assert!(
        events.iter().any(|e| matches!(e, CommandEventKind::Completed(_))),
        "Completed event should be emitted even for non-zero exit"
    );
    assert!(
        !events.iter().any(|e| matches!(e, CommandEventKind::Failed(_))),
        "Failed should NOT be emitted for non-zero exit (it's a normal process exit)"
    );
}

// ── Timeout ───────────────────────────────────────────────────────────────────

#[tokio::test]
async fn timeout_returns_err() {
    let adapter = CliAdapter::new();
    let node = tool_node_with_timeout("sleep 30", 100);
    let memory = dummy_memory();
    let (tx, _rx) = mpsc::channel(32);

    let result = adapter.execute(&node, "/tmp", &memory, tx).await;
    assert!(result.is_err(), "execute should fail on timeout");
}

#[tokio::test]
async fn timeout_emits_failed_event() {
    let adapter = CliAdapter::new();
    let node = tool_node_with_timeout("sleep 30", 100);
    let memory = dummy_memory();
    let (tx, rx) = mpsc::channel(32);

    let _ = adapter.execute(&node, "/tmp", &memory, tx).await;
    let events = collect_events(rx).await;

    assert!(
        events.iter().any(|e| matches!(e, CommandEventKind::Failed(_))),
        "Failed event must be emitted on timeout"
    );
}

#[tokio::test]
async fn timeout_failed_reason_contains_timed_out() {
    let adapter = CliAdapter::new();
    let node = tool_node_with_timeout("sleep 30", 100);
    let memory = dummy_memory();
    let (tx, rx) = mpsc::channel(32);

    let _ = adapter.execute(&node, "/tmp", &memory, tx).await;
    let events = collect_events(rx).await;

    let failed_payload = events.iter().find_map(|e| {
        if let CommandEventKind::Failed(p) = e {
            Some(p)
        } else {
            None
        }
    });

    let payload = failed_payload.expect("Failed event must be present");
    assert!(
        payload.reason.contains("timed out"),
        "timeout reason must contain 'timed out', got: {}",
        payload.reason
    );
}

#[tokio::test]
async fn timeout_failed_reason_includes_timeout_ms() {
    let adapter = CliAdapter::new();
    let node = tool_node_with_timeout("sleep 30", 150);
    let memory = dummy_memory();
    let (tx, rx) = mpsc::channel(32);

    let _ = adapter.execute(&node, "/tmp", &memory, tx).await;
    let events = collect_events(rx).await;

    let failed_payload = events.iter().find_map(|e| {
        if let CommandEventKind::Failed(p) = e {
            Some(p)
        } else {
            None
        }
    });

    let payload = failed_payload.expect("Failed event must be present");
    assert!(
        payload.reason.contains("150"),
        "timeout reason should include the configured ms value, got: {}",
        payload.reason
    );
}

// ── Event ordering — timeout path ─────────────────────────────────────────────

#[tokio::test]
async fn event_order_timeout_prepared_started_failed() {
    let adapter = CliAdapter::new();
    let node = tool_node_with_timeout("sleep 30", 100);
    let memory = dummy_memory();
    let (tx, rx) = mpsc::channel(32);

    let _ = adapter.execute(&node, "/tmp", &memory, tx).await;
    let events = collect_events(rx).await;

    let prepared_idx = events
        .iter()
        .position(|e| matches!(e, CommandEventKind::Prepared(_)))
        .expect("Prepared event missing on timeout path");
    let started_idx = events
        .iter()
        .position(|e| matches!(e, CommandEventKind::Started(_)))
        .expect("Started event missing on timeout path");
    let failed_idx = events
        .iter()
        .position(|e| matches!(e, CommandEventKind::Failed(_)))
        .expect("Failed event missing on timeout path");

    assert!(prepared_idx < started_idx, "Prepared before Started");
    assert!(started_idx < failed_idx, "Started before Failed");

    // No Completed event on timeout
    assert!(
        !events.iter().any(|e| matches!(e, CommandEventKind::Completed(_))),
        "Completed must not be emitted on timeout"
    );
}
