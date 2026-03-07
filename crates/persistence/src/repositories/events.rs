// Append-only event log repository.
// Events are never updated or deleted — only appended and queried.
// See ARCHITECTURE.md §11 and EVENT_SCHEMA.md.

use rusqlite::params;
use thiserror::Error;
use uuid::Uuid;

use event_model::event::RunEvent;
use crate::sqlite::Db;

#[derive(Debug, Error)]
pub enum EventRepoError {
    #[error("SQLite error: {0}")]
    Sqlite(#[from] rusqlite::Error),

    #[error("JSON serialization error: {0}")]
    Json(#[from] serde_json::Error),
}

/// Repository for the append-only event log.
///
/// Rules:
/// - `append_event` only inserts; it never updates an existing row.
/// - There are no delete or update methods — this is by design.
pub struct EventRepository<'db> {
    db: &'db Db,
}

impl<'db> EventRepository<'db> {
    pub fn new(db: &'db Db) -> Self {
        Self { db }
    }

    /// Append a single event to the log.
    ///
    /// The sequence number is assigned as `MAX(sequence) + 1` for the run,
    /// starting at 1. Safe for single-connection SQLite usage (no concurrent
    /// writers in v1).
    pub fn append_event(&self, event: &RunEvent) -> Result<(), EventRepoError> {
        let conn = self.db.conn();

        let sequence: i64 = conn.query_row(
            "SELECT COALESCE(MAX(sequence), 0) + 1 FROM events WHERE run_id = ?1",
            params![event.run_id.to_string()],
            |row| row.get(0),
        )?;

        conn.execute(
            "INSERT INTO events \
             (event_id, run_id, workflow_id, node_id, event_type, timestamp, \
              payload_json, causation_id, correlation_id, sequence) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                event.event_id.to_string(),
                event.run_id.to_string(),
                event.workflow_id.to_string(),
                event.node_id.map(|id| id.to_string()),
                event.event_type,
                event.timestamp.to_rfc3339(),
                serde_json::to_string(&event.payload)?,
                event.causation_id.map(|id| id.to_string()),
                event.correlation_id.map(|id| id.to_string()),
                sequence,
            ],
        )?;

        Ok(())
    }

    /// Return all events for a run in sequence order (ascending).
    ///
    /// Supports pagination: `offset` rows are skipped, at most `limit` rows returned.
    /// Use `offset = 0, limit = u32::MAX` to fetch everything.
    pub fn list_events_for_run(
        &self,
        run_id: Uuid,
        offset: u32,
        limit: u32,
    ) -> Result<Vec<RunEvent>, EventRepoError> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare(
            "SELECT event_id, run_id, workflow_id, node_id, event_type, timestamp, \
                    payload_json, causation_id, correlation_id \
             FROM events \
             WHERE run_id = ?1 \
             ORDER BY sequence ASC \
             LIMIT ?2 OFFSET ?3",
        )?;

        let events = stmt
            .query_map(params![run_id.to_string(), limit, offset], row_to_event)?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(events)
    }

    /// Fetch a single event by its ID. Returns `None` if not found.
    pub fn get_event_by_id(&self, event_id: Uuid) -> Result<Option<RunEvent>, EventRepoError> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare(
            "SELECT event_id, run_id, workflow_id, node_id, event_type, timestamp, \
                    payload_json, causation_id, correlation_id \
             FROM events \
             WHERE event_id = ?1",
        )?;

        let mut rows = stmt.query_map(params![event_id.to_string()], row_to_event)?;

        match rows.next() {
            Some(result) => Ok(Some(result?)),
            None => Ok(None),
        }
    }

    /// Return all events for a specific node within a run, in sequence order.
    pub fn list_events_for_node(
        &self,
        run_id: Uuid,
        node_id: Uuid,
    ) -> Result<Vec<RunEvent>, EventRepoError> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare(
            "SELECT event_id, run_id, workflow_id, node_id, event_type, timestamp, \
                    payload_json, causation_id, correlation_id \
             FROM events \
             WHERE run_id = ?1 AND node_id = ?2 \
             ORDER BY sequence ASC",
        )?;

        let events = stmt
            .query_map(
                params![run_id.to_string(), node_id.to_string()],
                row_to_event,
            )?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(events)
    }
}

/// Map a SQLite row to a `RunEvent`. Column order matches the SELECT lists above.
fn row_to_event(row: &rusqlite::Row<'_>) -> Result<RunEvent, rusqlite::Error> {
    let event_id_str: String = row.get(0)?;
    let run_id_str: String = row.get(1)?;
    let workflow_id_str: String = row.get(2)?;
    let node_id_str: Option<String> = row.get(3)?;
    let event_type: String = row.get(4)?;
    let timestamp_str: String = row.get(5)?;
    let payload_json_str: String = row.get(6)?;
    let causation_id_str: Option<String> = row.get(7)?;
    let correlation_id_str: Option<String> = row.get(8)?;

    let parse_uuid = |s: String, col: usize| {
        Uuid::parse_str(&s).map_err(|_| {
            rusqlite::Error::InvalidColumnType(
                col,
                "uuid".to_string(),
                rusqlite::types::Type::Text,
            )
        })
    };
    let parse_opt_uuid = |opt: Option<String>, col: usize| -> Result<Option<Uuid>, rusqlite::Error> {
        opt.map(|s| parse_uuid(s, col)).transpose()
    };

    let timestamp = timestamp_str.parse::<chrono::DateTime<chrono::Utc>>().map_err(|_| {
        rusqlite::Error::InvalidColumnType(5, "timestamp".to_string(), rusqlite::types::Type::Text)
    })?;

    let payload = serde_json::from_str::<serde_json::Value>(&payload_json_str).map_err(|_| {
        rusqlite::Error::InvalidColumnType(6, "payload_json".to_string(), rusqlite::types::Type::Text)
    })?;

    Ok(RunEvent {
        event_id: parse_uuid(event_id_str, 0)?,
        run_id: parse_uuid(run_id_str, 1)?,
        workflow_id: parse_uuid(workflow_id_str, 2)?,
        node_id: parse_opt_uuid(node_id_str, 3)?,
        event_type,
        timestamp,
        payload,
        causation_id: parse_opt_uuid(causation_id_str, 7)?,
        correlation_id: parse_opt_uuid(correlation_id_str, 8)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sqlite::Db;
    use chrono::Utc;
    use rusqlite::params;
    use serde_json::json;

    /// Insert the minimum parent records required to satisfy FK constraints.
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

    #[test]
    fn append_event_inserts_new_row() {
        let db = Db::open_in_memory().unwrap();
        let repo = EventRepository::new(&db);
        let run_id = Uuid::new_v4();
        let workflow_id = Uuid::new_v4();
        setup_run(&db, workflow_id, run_id);

        let ev = make_event(run_id, workflow_id, "run.started", None);
        let ev_id = ev.event_id;
        repo.append_event(&ev).unwrap();

        let found = repo.get_event_by_id(ev_id).unwrap();
        assert!(found.is_some());
        assert_eq!(found.unwrap().event_type, "run.started");
    }

    #[test]
    fn append_event_does_not_overwrite_existing() {
        // Appending a second event with the same event_id must fail (PRIMARY KEY violation),
        // demonstrating that append_event is insert-only and cannot mutate stored rows.
        let db = Db::open_in_memory().unwrap();
        let repo = EventRepository::new(&db);
        let run_id = Uuid::new_v4();
        let workflow_id = Uuid::new_v4();
        setup_run(&db, workflow_id, run_id);

        let ev = make_event(run_id, workflow_id, "run.started", None);
        repo.append_event(&ev).unwrap();

        // Attempt to append same event again — must error.
        let result = repo.append_event(&ev);
        assert!(result.is_err(), "duplicate event_id must fail");
    }

    #[test]
    fn list_events_for_run_returns_events_in_sequence_order() {
        let db = Db::open_in_memory().unwrap();
        let repo = EventRepository::new(&db);
        let run_id = Uuid::new_v4();
        let workflow_id = Uuid::new_v4();
        setup_run(&db, workflow_id, run_id);

        for event_type in &["run.started", "node.queued", "node.started", "node.succeeded"] {
            repo.append_event(&make_event(run_id, workflow_id, event_type, None)).unwrap();
        }

        let events = repo.list_events_for_run(run_id, 0, u32::MAX).unwrap();
        assert_eq!(events.len(), 4);
        assert_eq!(events[0].event_type, "run.started");
        assert_eq!(events[3].event_type, "node.succeeded");
    }

    #[test]
    fn list_events_for_run_pagination() {
        let db = Db::open_in_memory().unwrap();
        let repo = EventRepository::new(&db);
        let run_id = Uuid::new_v4();
        let workflow_id = Uuid::new_v4();
        setup_run(&db, workflow_id, run_id);

        for i in 0..10u32 {
            let mut ev = make_event(run_id, workflow_id, "run.step", None);
            ev.payload = json!({ "step": i });
            repo.append_event(&ev).unwrap();
        }

        let page1 = repo.list_events_for_run(run_id, 0, 4).unwrap();
        let page2 = repo.list_events_for_run(run_id, 4, 4).unwrap();
        let page3 = repo.list_events_for_run(run_id, 8, 4).unwrap();

        assert_eq!(page1.len(), 4);
        assert_eq!(page2.len(), 4);
        assert_eq!(page3.len(), 2);
        // No duplicates across pages
        let all_ids: Vec<_> = [page1, page2, page3].concat().into_iter().map(|e| e.event_id).collect();
        let unique: std::collections::HashSet<_> = all_ids.iter().collect();
        assert_eq!(all_ids.len(), unique.len());
    }

    #[test]
    fn get_event_by_id_returns_none_for_unknown() {
        let db = Db::open_in_memory().unwrap();
        let repo = EventRepository::new(&db);
        let result = repo.get_event_by_id(Uuid::new_v4()).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn list_events_for_node_filters_correctly() {
        let db = Db::open_in_memory().unwrap();
        let repo = EventRepository::new(&db);
        let run_id = Uuid::new_v4();
        let workflow_id = Uuid::new_v4();
        setup_run(&db, workflow_id, run_id);
        let node_a = Uuid::new_v4();
        let node_b = Uuid::new_v4();

        repo.append_event(&make_event(run_id, workflow_id, "node.queued", Some(node_a))).unwrap();
        repo.append_event(&make_event(run_id, workflow_id, "node.queued", Some(node_b))).unwrap();
        repo.append_event(&make_event(run_id, workflow_id, "node.started", Some(node_a))).unwrap();
        repo.append_event(&make_event(run_id, workflow_id, "node.succeeded", Some(node_a))).unwrap();

        let node_a_events = repo.list_events_for_node(run_id, node_a).unwrap();
        assert_eq!(node_a_events.len(), 3);
        assert!(node_a_events.iter().all(|e| e.node_id == Some(node_a)));

        let node_b_events = repo.list_events_for_node(run_id, node_b).unwrap();
        assert_eq!(node_b_events.len(), 1);
    }

    /// Verify that the demo workflow event stream (Plan → Tool → Critique → Approve)
    /// can be stored and then replayed to reconstruct per-node state transitions.
    #[test]
    fn replay_reconstructs_node_states_for_demo_workflow() {
        let db = Db::open_in_memory().unwrap();
        let repo = EventRepository::new(&db);

        let run_id = Uuid::new_v4();
        let workflow_id = Uuid::new_v4();
        setup_run(&db, workflow_id, run_id);
        let plan_node = Uuid::new_v4();
        let tool_node = Uuid::new_v4();
        let critique_node = Uuid::new_v4();
        let review_node = Uuid::new_v4();

        // Emit events matching the demo workflow: Plan → Tool → Critique → Approve
        let events = vec![
            make_event(run_id, workflow_id, "run.started", None),
            make_event(run_id, workflow_id, "node.queued", Some(plan_node)),
            make_event(run_id, workflow_id, "node.started", Some(plan_node)),
            make_event(run_id, workflow_id, "node.succeeded", Some(plan_node)),
            make_event(run_id, workflow_id, "node.queued", Some(tool_node)),
            make_event(run_id, workflow_id, "node.started", Some(tool_node)),
            make_event(run_id, workflow_id, "node.succeeded", Some(tool_node)),
            make_event(run_id, workflow_id, "node.queued", Some(critique_node)),
            make_event(run_id, workflow_id, "node.started", Some(critique_node)),
            make_event(run_id, workflow_id, "node.succeeded", Some(critique_node)),
            make_event(run_id, workflow_id, "node.queued", Some(review_node)),
            make_event(run_id, workflow_id, "node.started", Some(review_node)),
            make_event(run_id, workflow_id, "node.waiting", Some(review_node)),
            make_event(run_id, workflow_id, "node.succeeded", Some(review_node)),
            make_event(run_id, workflow_id, "run.succeeded", None),
        ];
        for ev in &events {
            repo.append_event(ev).unwrap();
        }

        // Replay: fetch all events in order
        let stream = repo.list_events_for_run(run_id, 0, u32::MAX).unwrap();
        assert_eq!(stream.len(), 15, "all events must be stored");
        assert_eq!(stream[0].event_type, "run.started");
        assert_eq!(stream[stream.len() - 1].event_type, "run.succeeded");

        // Reconstruct last known state per node by scanning in sequence order
        let nodes = [plan_node, tool_node, critique_node, review_node];
        for &nid in &nodes {
            let node_events = repo.list_events_for_node(run_id, nid).unwrap();
            // Last event for every node in the demo workflow is node.succeeded
            let last = node_events.last().unwrap();
            assert_eq!(last.event_type, "node.succeeded",
                "node {nid} final state must be node.succeeded, got {}", last.event_type);
        }
    }

    #[test]
    fn sequence_numbers_are_monotonically_increasing_per_run() {
        let db = Db::open_in_memory().unwrap();
        let repo = EventRepository::new(&db);
        let workflow_id = Uuid::new_v4();
        let run_id = Uuid::new_v4();
        let run2_id = Uuid::new_v4();
        // Insert workflow once, two runs reference it
        let now = Utc::now().to_rfc3339();
        db.conn().execute(
            "INSERT INTO workflows (workflow_id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params![workflow_id.to_string(), "seq-test-wf", now, now],
        ).unwrap();
        for &rid in &[run_id, run2_id] {
            db.conn().execute(
                "INSERT INTO runs (run_id, workflow_id, workflow_version, status, workspace_root, created_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![rid.to_string(), workflow_id.to_string(), 1, "created", "/tmp", now],
            ).unwrap();
        }

        for _ in 0..5 {
            repo.append_event(&make_event(run_id, workflow_id, "run.step", None)).unwrap();
        }
        repo.append_event(&make_event(run2_id, workflow_id, "run.started", None)).unwrap();

        // Read raw sequences from db
        let conn = db.conn();
        let mut seq_run1: Vec<i64> = conn
            .prepare("SELECT sequence FROM events WHERE run_id = ?1 ORDER BY sequence ASC")
            .unwrap()
            .query_map(params![run_id.to_string()], |r| r.get(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        seq_run1.dedup();
        assert_eq!(seq_run1, vec![1, 2, 3, 4, 5]);

        let seq_run2: Vec<i64> = conn
            .prepare("SELECT sequence FROM events WHERE run_id = ?1 ORDER BY sequence ASC")
            .unwrap()
            .query_map(params![run2_id.to_string()], |r| r.get(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        assert_eq!(seq_run2, vec![1], "second run starts its own sequence");
    }
}
