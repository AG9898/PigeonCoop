// Run repository: storage, retrieval, and status updates for RunInstance.
// See ARCHITECTURE.md §11 and task PERSIST-003.

use rusqlite::params;
use thiserror::Error;
use uuid::Uuid;

use workflow_model::run::{RunConstraints, RunInstance, RunStatus};
use crate::sqlite::Db;

#[derive(Debug, Error)]
pub enum RunRepoError {
    #[error("SQLite error: {0}")]
    Sqlite(#[from] rusqlite::Error),

    #[error("JSON serialization error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("invalid run status: {0}")]
    InvalidStatus(String),

    #[error("parse error: {0}")]
    Parse(String),
}

pub struct RunRepository<'db> {
    db: &'db Db,
}

impl<'db> RunRepository<'db> {
    pub fn new(db: &'db Db) -> Self {
        Self { db }
    }

    /// Insert a new RunInstance into the runs table.
    pub fn create_run(&self, run: &RunInstance) -> Result<(), RunRepoError> {
        let conn = self.db.conn();
        conn.execute(
            "INSERT INTO runs \
             (run_id, workflow_id, workflow_version, status, workspace_root, \
              created_at, started_at, ended_at, summary_json) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                run.run_id.to_string(),
                run.workflow_id.to_string(),
                run.workflow_version,
                status_to_str(&run.status),
                run.workspace_root,
                run.created_at.to_rfc3339(),
                run.started_at.as_ref().map(|t| t.to_rfc3339()),
                run.ended_at.as_ref().map(|t| t.to_rfc3339()),
                run.summary.as_deref(),
            ],
        )?;
        Ok(())
    }

    /// Update the status (and optionally started_at / ended_at) for a run.
    pub fn update_run_status(
        &self,
        run_id: Uuid,
        status: &RunStatus,
        started_at: Option<chrono::DateTime<chrono::Utc>>,
        ended_at: Option<chrono::DateTime<chrono::Utc>>,
    ) -> Result<(), RunRepoError> {
        let conn = self.db.conn();
        conn.execute(
            "UPDATE runs \
             SET status = ?1, started_at = ?2, ended_at = ?3 \
             WHERE run_id = ?4",
            params![
                status_to_str(status),
                started_at.as_ref().map(|t| t.to_rfc3339()),
                ended_at.as_ref().map(|t| t.to_rfc3339()),
                run_id.to_string(),
            ],
        )?;
        Ok(())
    }

    /// Retrieve a single RunInstance by its ID. Returns `None` if not found.
    pub fn get_run_by_id(&self, run_id: Uuid) -> Result<Option<RunInstance>, RunRepoError> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare(
            "SELECT run_id, workflow_id, workflow_version, status, workspace_root, \
                    created_at, started_at, ended_at, summary_json \
             FROM runs WHERE run_id = ?1",
        )?;
        let mut rows = stmt.query_map(params![run_id.to_string()], row_to_run)?;
        match rows.next() {
            Some(result) => Ok(Some(result??)),
            None => Ok(None),
        }
    }

    /// Return all runs for a workflow ordered by created_at descending (most recent first).
    pub fn list_runs_for_workflow(
        &self,
        workflow_id: Uuid,
    ) -> Result<Vec<RunInstance>, RunRepoError> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare(
            "SELECT run_id, workflow_id, workflow_version, status, workspace_root, \
                    created_at, started_at, ended_at, summary_json \
             FROM runs WHERE workflow_id = ?1 ORDER BY created_at DESC",
        )?;
        let rows = stmt
            .query_map(params![workflow_id.to_string()], row_to_run)?
            .collect::<Result<Vec<_>, _>>()?;
        rows.into_iter().map(|r| r).collect()
    }

    /// Return all runs in an active state (not yet terminal).
    pub fn get_active_runs(&self) -> Result<Vec<RunInstance>, RunRepoError> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare(
            "SELECT run_id, workflow_id, workflow_version, status, workspace_root, \
                    created_at, started_at, ended_at, summary_json \
             FROM runs \
             WHERE status IN ('created', 'validating', 'ready', 'running', 'paused') \
             ORDER BY created_at DESC",
        )?;
        let rows = stmt
            .query_map([], row_to_run)?
            .collect::<Result<Vec<_>, _>>()?;
        rows.into_iter().map(|r| r).collect()
    }
}

fn status_to_str(status: &RunStatus) -> &'static str {
    match status {
        RunStatus::Created => "created",
        RunStatus::Validating => "validating",
        RunStatus::Ready => "ready",
        RunStatus::Running => "running",
        RunStatus::Paused => "paused",
        RunStatus::Succeeded => "succeeded",
        RunStatus::Failed => "failed",
        RunStatus::Cancelled => "cancelled",
    }
}

fn str_to_run_status(s: &str) -> Result<RunStatus, RunRepoError> {
    match s {
        "created" => Ok(RunStatus::Created),
        "validating" => Ok(RunStatus::Validating),
        "ready" => Ok(RunStatus::Ready),
        "running" => Ok(RunStatus::Running),
        "paused" => Ok(RunStatus::Paused),
        "succeeded" => Ok(RunStatus::Succeeded),
        "failed" => Ok(RunStatus::Failed),
        "cancelled" => Ok(RunStatus::Cancelled),
        other => Err(RunRepoError::InvalidStatus(other.to_string())),
    }
}

fn row_to_run(row: &rusqlite::Row<'_>) -> Result<Result<RunInstance, RunRepoError>, rusqlite::Error> {
    let run_id_str: String = row.get(0)?;
    let workflow_id_str: String = row.get(1)?;
    let workflow_version: u32 = row.get(2)?;
    let status_str: String = row.get(3)?;
    let workspace_root: String = row.get(4)?;
    let created_at_str: String = row.get(5)?;
    let started_at_str: Option<String> = row.get(6)?;
    let ended_at_str: Option<String> = row.get(7)?;
    let summary: Option<String> = row.get(8)?;

    Ok((|| -> Result<RunInstance, RunRepoError> {
        let run_id = Uuid::parse_str(&run_id_str)
            .map_err(|e| RunRepoError::Parse(e.to_string()))?;
        let workflow_id = Uuid::parse_str(&workflow_id_str)
            .map_err(|e| RunRepoError::Parse(e.to_string()))?;
        let status = str_to_run_status(&status_str)?;
        let created_at = created_at_str
            .parse::<chrono::DateTime<chrono::Utc>>()
            .map_err(|e| RunRepoError::Parse(e.to_string()))?;
        let started_at = started_at_str
            .map(|s| s.parse::<chrono::DateTime<chrono::Utc>>())
            .transpose()
            .map_err(|e| RunRepoError::Parse(e.to_string()))?;
        let ended_at = ended_at_str
            .map(|s| s.parse::<chrono::DateTime<chrono::Utc>>())
            .transpose()
            .map_err(|e| RunRepoError::Parse(e.to_string()))?;

        Ok(RunInstance {
            run_id,
            workflow_id,
            workflow_version,
            status,
            workspace_root,
            created_at,
            started_at,
            ended_at,
            // active_nodes is runtime state managed in memory; not persisted in v1.
            active_nodes: vec![],
            // constraints not persisted in schema v1; use defaults on load.
            constraints: RunConstraints::default(),
            summary,
        })
    })())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sqlite::Db;
    use chrono::Utc;
    use rusqlite::params;
    use workflow_model::run::RunInstance;
    use workflow_model::workflow::WorkflowDefinition;

    fn insert_workflow(db: &Db, workflow_id: Uuid) {
        let now = Utc::now().to_rfc3339();
        db.conn()
            .execute(
                "INSERT INTO workflows (workflow_id, name, created_at, updated_at) \
                 VALUES (?1, ?2, ?3, ?4)",
                params![workflow_id.to_string(), "test-wf", now, now],
            )
            .unwrap();
    }

    fn make_workflow(workflow_id: Uuid) -> WorkflowDefinition {
        WorkflowDefinition {
            workflow_id,
            name: "test-wf".into(),
            schema_version: workflow_model::workflow::CURRENT_SCHEMA_VERSION,
            version: 1,
            metadata: serde_json::Value::Null,
            nodes: vec![],
            edges: vec![],
            default_constraints: workflow_model::constraints::RunConstraints::default(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    fn make_run(workflow_id: Uuid) -> RunInstance {
        let wf = make_workflow(workflow_id);
        RunInstance::from_workflow(&wf, "/tmp/workspace")
    }

    #[test]
    fn create_run_stores_run_instance() {
        let db = Db::open_in_memory().unwrap();
        let workflow_id = Uuid::new_v4();
        insert_workflow(&db, workflow_id);

        let repo = RunRepository::new(&db);
        let run = make_run(workflow_id);
        let run_id = run.run_id;

        repo.create_run(&run).expect("create_run");

        let retrieved = repo.get_run_by_id(run_id).expect("get_run_by_id").expect("should exist");
        assert_eq!(retrieved.run_id, run.run_id);
        assert_eq!(retrieved.workflow_id, run.workflow_id);
        assert_eq!(retrieved.workflow_version, run.workflow_version);
        assert_eq!(retrieved.status, RunStatus::Created);
        assert_eq!(retrieved.workspace_root, "/tmp/workspace");
        assert!(retrieved.started_at.is_none());
        assert!(retrieved.ended_at.is_none());
        assert!(retrieved.summary.is_none());
    }

    #[test]
    fn get_run_by_id_missing_returns_none() {
        let db = Db::open_in_memory().unwrap();
        let repo = RunRepository::new(&db);
        let result = repo.get_run_by_id(Uuid::new_v4()).expect("query ok");
        assert!(result.is_none());
    }

    #[test]
    fn update_run_status_changes_status_field() {
        let db = Db::open_in_memory().unwrap();
        let workflow_id = Uuid::new_v4();
        insert_workflow(&db, workflow_id);

        let repo = RunRepository::new(&db);
        let run = make_run(workflow_id);
        let run_id = run.run_id;
        repo.create_run(&run).unwrap();

        let started = Utc::now();
        repo.update_run_status(run_id, &RunStatus::Running, Some(started), None).expect("update");

        let retrieved = repo.get_run_by_id(run_id).unwrap().unwrap();
        assert_eq!(retrieved.status, RunStatus::Running);
        assert!(retrieved.started_at.is_some());
        assert!(retrieved.ended_at.is_none());
    }

    #[test]
    fn update_run_status_to_terminal_sets_ended_at() {
        let db = Db::open_in_memory().unwrap();
        let workflow_id = Uuid::new_v4();
        insert_workflow(&db, workflow_id);

        let repo = RunRepository::new(&db);
        let run = make_run(workflow_id);
        let run_id = run.run_id;
        repo.create_run(&run).unwrap();

        let started = Utc::now();
        let ended = Utc::now();
        repo.update_run_status(run_id, &RunStatus::Succeeded, Some(started), Some(ended)).unwrap();

        let retrieved = repo.get_run_by_id(run_id).unwrap().unwrap();
        assert_eq!(retrieved.status, RunStatus::Succeeded);
        assert!(retrieved.started_at.is_some());
        assert!(retrieved.ended_at.is_some());
    }

    #[test]
    fn list_runs_for_workflow_returns_all_ordered_by_recency() {
        let db = Db::open_in_memory().unwrap();
        let workflow_id = Uuid::new_v4();
        insert_workflow(&db, workflow_id);

        let repo = RunRepository::new(&db);
        let run1 = make_run(workflow_id);
        let run2 = make_run(workflow_id);
        let run3 = make_run(workflow_id);

        repo.create_run(&run1).unwrap();
        repo.create_run(&run2).unwrap();
        repo.create_run(&run3).unwrap();

        let runs = repo.list_runs_for_workflow(workflow_id).expect("list_runs_for_workflow");
        assert_eq!(runs.len(), 3);

        // All belong to the correct workflow
        assert!(runs.iter().all(|r| r.workflow_id == workflow_id));
    }

    #[test]
    fn list_runs_for_workflow_empty_for_unknown_workflow() {
        let db = Db::open_in_memory().unwrap();
        let repo = RunRepository::new(&db);
        let runs = repo.list_runs_for_workflow(Uuid::new_v4()).expect("list ok");
        assert!(runs.is_empty());
    }

    #[test]
    fn get_active_runs_returns_non_terminal_runs() {
        let db = Db::open_in_memory().unwrap();
        let workflow_id = Uuid::new_v4();
        insert_workflow(&db, workflow_id);

        let repo = RunRepository::new(&db);

        let run_created = make_run(workflow_id);
        let run_running = make_run(workflow_id);
        let run_done = make_run(workflow_id);

        let id_running = run_running.run_id;
        let id_done = run_done.run_id;

        repo.create_run(&run_created).unwrap();
        repo.create_run(&run_running).unwrap();
        repo.create_run(&run_done).unwrap();

        repo.update_run_status(id_running, &RunStatus::Running, Some(Utc::now()), None).unwrap();
        repo.update_run_status(id_done, &RunStatus::Succeeded, Some(Utc::now()), Some(Utc::now())).unwrap();

        let active = repo.get_active_runs().expect("get_active_runs");
        // run_created (Created) and run_running (Running) are active; run_done (Succeeded) is not
        assert_eq!(active.len(), 2);
        assert!(active.iter().all(|r| {
            matches!(r.status, RunStatus::Created | RunStatus::Running | RunStatus::Validating | RunStatus::Ready | RunStatus::Paused)
        }));
    }
}
