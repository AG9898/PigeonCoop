// Dedicated event repository tests.
// Supplements the inline tests in repositories/events.rs with scenarios covering
// causation/correlation ID preservation, cross-run isolation, and edge cases.

use chrono::Utc;
use serde_json::json;
use uuid::Uuid;
use rusqlite::params;

use event_model::event::RunEvent;

use crate::repositories::events::EventRepository;
use crate::sqlite::Db;

fn db() -> Db {
    Db::open_in_memory().expect("in-memory db")
}

/// Insert minimum parent records for FK constraints.
fn setup_run(db: &Db, workflow_id: Uuid, run_id: Uuid) {
    let now = Utc::now().to_rfc3339();
    db.conn()
        .execute(
            "INSERT INTO workflows (workflow_id, name, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4)",
            params![workflow_id.to_string(), "test-wf", now, now],
        )
        .unwrap();
    db.conn()
        .execute(
            "INSERT INTO runs \
             (run_id, workflow_id, workflow_version, status, workspace_root, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![run_id.to_string(), workflow_id.to_string(), 1, "created", "/tmp", now],
        )
        .unwrap();
}

fn make_event(run_id: Uuid, workflow_id: Uuid, event_type: &str, node_id: Option<Uuid>) -> RunEvent {
    RunEvent {
        event_id: Uuid::new_v4(),
        run_id,
        workflow_id,
        node_id,
        event_type: event_type.to_string(),
        timestamp: Utc::now(),
        payload: json!({}),
        causation_id: None,
        correlation_id: None,
    }
}

// ── Causation and correlation IDs are preserved ───────────────────────────────

#[test]
fn causation_and_correlation_ids_round_trip() {
    let db = db();
    let repo = EventRepository::new(&db);

    let run_id = Uuid::new_v4();
    let workflow_id = Uuid::new_v4();
    setup_run(&db, workflow_id, run_id);

    let causation_id = Uuid::new_v4();
    let correlation_id = Uuid::new_v4();

    let ev = RunEvent {
        event_id: Uuid::new_v4(),
        run_id,
        workflow_id,
        node_id: None,
        event_type: "run.started".into(),
        timestamp: Utc::now(),
        payload: json!({}),
        causation_id: Some(causation_id),
        correlation_id: Some(correlation_id),
    };

    repo.append_event(&ev).unwrap();

    let loaded = repo.get_event_by_id(ev.event_id).unwrap().unwrap();
    assert_eq!(loaded.causation_id, Some(causation_id));
    assert_eq!(loaded.correlation_id, Some(correlation_id));
}

// ── node_id Some and None both round-trip correctly ───────────────────────────

#[test]
fn node_id_some_and_none_both_round_trip() {
    let db = db();
    let repo = EventRepository::new(&db);

    let run_id = Uuid::new_v4();
    let workflow_id = Uuid::new_v4();
    setup_run(&db, workflow_id, run_id);

    let node_id = Uuid::new_v4();

    let ev_with_node = make_event(run_id, workflow_id, "node.queued", Some(node_id));
    let ev_without_node = make_event(run_id, workflow_id, "run.started", None);

    repo.append_event(&ev_with_node).unwrap();
    repo.append_event(&ev_without_node).unwrap();

    let loaded_with = repo.get_event_by_id(ev_with_node.event_id).unwrap().unwrap();
    assert_eq!(loaded_with.node_id, Some(node_id));

    let loaded_without = repo.get_event_by_id(ev_without_node.event_id).unwrap().unwrap();
    assert_eq!(loaded_without.node_id, None);
}

// ── Events for different runs do not mix ─────────────────────────────────────

#[test]
fn events_for_different_runs_are_isolated() {
    let db = db();
    let repo = EventRepository::new(&db);

    let workflow_id = Uuid::new_v4();
    let run_a = Uuid::new_v4();
    let run_b = Uuid::new_v4();
    let now = Utc::now().to_rfc3339();

    db.conn().execute(
        "INSERT INTO workflows (workflow_id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
        params![workflow_id.to_string(), "iso-wf", now, now],
    ).unwrap();
    for &rid in &[run_a, run_b] {
        db.conn().execute(
            "INSERT INTO runs (run_id, workflow_id, workflow_version, status, workspace_root, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![rid.to_string(), workflow_id.to_string(), 1, "created", "/tmp", now],
        ).unwrap();
    }

    // 3 events for run_a, 1 for run_b
    for t in &["run.started", "node.queued", "node.started"] {
        repo.append_event(&make_event(run_a, workflow_id, t, None)).unwrap();
    }
    repo.append_event(&make_event(run_b, workflow_id, "run.started", None)).unwrap();

    let events_a = repo.list_events_for_run(run_a, 0, u32::MAX).unwrap();
    let events_b = repo.list_events_for_run(run_b, 0, u32::MAX).unwrap();

    assert_eq!(events_a.len(), 3);
    assert_eq!(events_b.len(), 1);
    assert!(events_a.iter().all(|e| e.run_id == run_a));
    assert!(events_b.iter().all(|e| e.run_id == run_b));
}

// ── list_events_for_run returns empty when no events ─────────────────────────

#[test]
fn list_events_for_run_returns_empty_for_new_run() {
    let db = db();
    let repo = EventRepository::new(&db);

    let run_id = Uuid::new_v4();
    let workflow_id = Uuid::new_v4();
    setup_run(&db, workflow_id, run_id);

    let events = repo.list_events_for_run(run_id, 0, u32::MAX).unwrap();
    assert!(events.is_empty());
}

// ── Payload JSON is preserved ─────────────────────────────────────────────────

#[test]
fn complex_payload_json_is_preserved() {
    let db = db();
    let repo = EventRepository::new(&db);

    let run_id = Uuid::new_v4();
    let workflow_id = Uuid::new_v4();
    setup_run(&db, workflow_id, run_id);

    let payload = json!({
        "exit_code": 0,
        "stdout": "all tests passed",
        "stderr": "",
        "duration_ms": 1234,
        "changed_files": ["src/main.rs", "src/lib.rs"]
    });

    let ev = RunEvent {
        event_id: Uuid::new_v4(),
        run_id,
        workflow_id,
        node_id: None,
        event_type: "command.completed".into(),
        timestamp: Utc::now(),
        payload: payload.clone(),
        causation_id: None,
        correlation_id: None,
    };

    repo.append_event(&ev).unwrap();

    let loaded = repo.get_event_by_id(ev.event_id).unwrap().unwrap();
    assert_eq!(loaded.payload, payload);
}

// ── list_events_for_node returns empty when no node events ───────────────────

#[test]
fn list_events_for_node_returns_empty_when_no_node_events() {
    let db = db();
    let repo = EventRepository::new(&db);

    let run_id = Uuid::new_v4();
    let workflow_id = Uuid::new_v4();
    setup_run(&db, workflow_id, run_id);

    // Append a run-level event (no node_id)
    repo.append_event(&make_event(run_id, workflow_id, "run.started", None)).unwrap();

    // Query for a specific node — should return nothing
    let node_events = repo.list_events_for_node(run_id, Uuid::new_v4()).unwrap();
    assert!(node_events.is_empty());
}

// ── Sequence numbers restart independently for each run ───────────────────────

#[test]
fn sequence_numbers_are_independent_per_run() {
    let db = db();
    let repo = EventRepository::new(&db);

    let workflow_id = Uuid::new_v4();
    let run_x = Uuid::new_v4();
    let run_y = Uuid::new_v4();
    let now = Utc::now().to_rfc3339();

    db.conn().execute(
        "INSERT INTO workflows (workflow_id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
        params![workflow_id.to_string(), "seq-wf", now, now],
    ).unwrap();
    for &rid in &[run_x, run_y] {
        db.conn().execute(
            "INSERT INTO runs (run_id, workflow_id, workflow_version, status, workspace_root, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![rid.to_string(), workflow_id.to_string(), 1, "created", "/tmp", now],
        ).unwrap();
    }

    // 3 events for run_x, then 2 for run_y
    for _ in 0..3 {
        repo.append_event(&make_event(run_x, workflow_id, "run.step", None)).unwrap();
    }
    for _ in 0..2 {
        repo.append_event(&make_event(run_y, workflow_id, "run.step", None)).unwrap();
    }

    let seqs_x: Vec<i64> = db.conn()
        .prepare("SELECT sequence FROM events WHERE run_id = ?1 ORDER BY sequence ASC")
        .unwrap()
        .query_map(params![run_x.to_string()], |r| r.get(0))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();

    let seqs_y: Vec<i64> = db.conn()
        .prepare("SELECT sequence FROM events WHERE run_id = ?1 ORDER BY sequence ASC")
        .unwrap()
        .query_map(params![run_y.to_string()], |r| r.get(0))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();

    assert_eq!(seqs_x, vec![1, 2, 3]);
    assert_eq!(seqs_y, vec![1, 2], "each run has its own sequence starting at 1");
}
