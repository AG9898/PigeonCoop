// Mock adapter tests — all execution is in-process with no real processes.
// Uses MockAdapter to verify the Adapter trait contract works correctly
// when wired to a configurable in-memory backend.

use tokio::sync::mpsc;
use uuid::Uuid;

use event_model::command_events::{
    CommandCompletedPayload, CommandEventKind, CommandStartedPayload,
};
use workflow_model::memory::{MemoryScope, MemoryState};
use workflow_model::node::{NodeDisplay, NodeKind, RetryPolicy};
use workflow_model::node_config::{NodeConfig, ToolNodeConfig};
use workflow_model::node::NodeDefinition;

use crate::mock::{MockAdapter, MockConfig};
use crate::{Adapter, AdapterError, AdapterOutput};

fn dummy_node() -> NodeDefinition {
    NodeDefinition {
        node_id: Uuid::new_v4(),
        node_type: NodeKind::Tool,
        label: "mock-node".into(),
        config: NodeConfig::Tool(ToolNodeConfig {
            command: "mock".into(),
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

// ── Prepare ───────────────────────────────────────────────────────────────────

#[tokio::test]
async fn prepare_succeeds_by_default() {
    let adapter = MockAdapter::default();
    let node = dummy_node();
    adapter.prepare(&node, "/tmp").await.expect("should succeed");
}

#[tokio::test]
async fn prepare_returns_configured_error() {
    let adapter = MockAdapter::new(MockConfig {
        prepare_error: Some("workspace not found".into()),
        ..Default::default()
    });
    let node = dummy_node();
    let err = adapter.prepare(&node, "/tmp").await.unwrap_err();
    assert!(matches!(err, AdapterError::PreparationFailed(_)));
    let msg = format!("{}", err);
    assert!(msg.contains("workspace not found"));
}

// ── Execute — output ──────────────────────────────────────────────────────────

#[tokio::test]
async fn execute_returns_configured_output() {
    let adapter = MockAdapter::new(MockConfig {
        output: AdapterOutput {
            output: serde_json::json!({"status": "done"}),
            exit_code: Some(0),
            stdout: "output line\n".into(),
            stderr: String::new(),
            duration_ms: 5,
        },
        ..Default::default()
    });
    let node = dummy_node();
    let memory = dummy_memory();
    let (tx, _rx) = mpsc::channel(16);

    let out = adapter.execute(&node, "/tmp", &memory, tx).await.unwrap();
    assert_eq!(out.exit_code, Some(0));
    assert_eq!(out.duration_ms, 5);
    assert_eq!(out.stdout, "output line\n");
    assert_eq!(out.output["status"], "done");
}

#[tokio::test]
async fn execute_returns_configured_error() {
    let adapter = MockAdapter::new(MockConfig {
        execute_error: Some("disk full".into()),
        ..Default::default()
    });
    let node = dummy_node();
    let memory = dummy_memory();
    let (tx, _rx) = mpsc::channel(16);

    let err = adapter.execute(&node, "/tmp", &memory, tx).await.unwrap_err();
    assert!(matches!(err, AdapterError::ExecutionFailed(_)));
    let msg = format!("{}", err);
    assert!(msg.contains("disk full"));
}

// ── Execute — event emission order ────────────────────────────────────────────

#[tokio::test]
async fn execute_emits_events_in_configured_order() {
    let events = vec![
        CommandEventKind::Started(CommandStartedPayload {
            command: "mock-cmd".into(),
            shell: "sh".into(),
            cwd: "/tmp".into(),
            timeout_ms: None,
        }),
        CommandEventKind::Completed(CommandCompletedPayload {
            exit_code: 0,
            duration_ms: 10,
            stdout_bytes: 0,
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
    let e2 = rx.recv().await.expect("second event");

    assert!(matches!(e1, CommandEventKind::Started(_)), "first event should be Started");
    assert!(matches!(e2, CommandEventKind::Completed(_)), "second event should be Completed");
}

#[tokio::test]
async fn execute_emits_no_events_when_configured_empty() {
    let adapter = MockAdapter::new(MockConfig {
        events: vec![],
        ..Default::default()
    });
    let node = dummy_node();
    let memory = dummy_memory();
    let (tx, mut rx) = mpsc::channel(16);

    adapter.execute(&node, "/tmp", &memory, tx).await.unwrap();

    // Channel should be empty — no events
    assert!(rx.try_recv().is_err(), "no events expected when configured with empty list");
}

#[tokio::test]
async fn execute_emits_multiple_stdout_events_in_order() {
    use event_model::command_events::CommandStdoutPayload;

    let events = vec![
        CommandEventKind::Stdout(CommandStdoutPayload {
            chunk: "line 1\n".into(),
            byte_offset: 0,
        }),
        CommandEventKind::Stdout(CommandStdoutPayload {
            chunk: "line 2\n".into(),
            byte_offset: 7,
        }),
        CommandEventKind::Stdout(CommandStdoutPayload {
            chunk: "line 3\n".into(),
            byte_offset: 14,
        }),
    ];

    let adapter = MockAdapter::new(MockConfig {
        events,
        ..Default::default()
    });
    let node = dummy_node();
    let memory = dummy_memory();
    let (tx, mut rx) = mpsc::channel(16);

    adapter.execute(&node, "/tmp", &memory, tx).await.unwrap();

    let e1 = rx.recv().await.expect("event 1");
    let e2 = rx.recv().await.expect("event 2");
    let e3 = rx.recv().await.expect("event 3");

    // Verify byte offsets are in ascending order (emission order preserved)
    let offset = |e: &CommandEventKind| {
        if let CommandEventKind::Stdout(p) = e {
            p.byte_offset
        } else {
            panic!("expected Stdout event")
        }
    };
    assert!(offset(&e1) < offset(&e2));
    assert!(offset(&e2) < offset(&e3));
}

// ── Abort ─────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn abort_always_succeeds() {
    let adapter = MockAdapter::default();
    adapter.abort().await.expect("abort should succeed");
}

#[tokio::test]
async fn abort_succeeds_even_after_execute() {
    let adapter = MockAdapter::default();
    let node = dummy_node();
    let memory = dummy_memory();
    let (tx, _rx) = mpsc::channel(16);
    adapter.execute(&node, "/tmp", &memory, tx).await.unwrap();
    adapter.abort().await.expect("abort should succeed after execute");
}

// ── Adapter trait via dyn dispatch ────────────────────────────────────────────

#[tokio::test]
async fn mock_adapter_works_via_dyn_trait() {
    use crate::Adapter;

    let adapter: Box<dyn Adapter> = Box::new(MockAdapter::default());
    let node = dummy_node();
    let memory = dummy_memory();
    let (tx, _rx) = mpsc::channel(16);

    // Verify the trait object compiles and runs correctly
    let out = adapter.execute(&node, "/tmp", &memory, tx).await.unwrap();
    assert_eq!(out.exit_code, Some(0));
}
