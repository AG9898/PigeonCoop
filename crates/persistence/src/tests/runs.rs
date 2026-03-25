// Dedicated run repository tests.
// Supplements the inline tests in repositories/runs.rs with scenarios covering
// status progression, cross-workflow isolation, and list ordering.

use chrono::Utc;
use uuid::Uuid;
use workflow_model::run::{RunInstance, RunStatus};
use workflow_model::workflow::WorkflowDefinition;
use workflow_model::constraints::RunConstraints;
use workflow_model::workflow::CURRENT_SCHEMA_VERSION;

use crate::repositories::runs::RunRepository;
use crate::sqlite::Db;
use rusqlite::params;

fn db() -> Db {
    Db::open_in_memory().expect("in-memory db")
}

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

fn make_workflow_def(workflow_id: Uuid) -> WorkflowDefinition {
    WorkflowDefinition {
        workflow_id,
        name: "test-wf".into(),
        schema_version: CURRENT_SCHEMA_VERSION,
        version: 1,
        metadata: serde_json::Value::Null,
        nodes: vec![],
        edges: vec![],
        default_constraints: RunConstraints::default(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
    }
}

fn make_run(workflow_id: Uuid) -> RunInstance {
    let wf = make_workflow_def(workflow_id);
    RunInstance::from_workflow(&wf, "/tmp/workspace")
}

// ── Status progression through the full lifecycle ────────────────────────────

#[test]
fn run_status_progresses_through_full_lifecycle() {
    let db = db();
    let workflow_id = Uuid::new_v4();
    insert_workflow(&db, workflow_id);

    let repo = RunRepository::new(&db);
    let run = make_run(workflow_id);
    let run_id = run.run_id;
    repo.create_run(&run).unwrap();

    // Created → Validating
    repo.update_run_status(run_id, &RunStatus::Validating, None, None).unwrap();
    assert_eq!(repo.get_run_by_id(run_id).unwrap().unwrap().status, RunStatus::Validating);

    // Validating → Running
    let started_at = Utc::now();
    repo.update_run_status(run_id, &RunStatus::Running, Some(started_at), None).unwrap();
    let r = repo.get_run_by_id(run_id).unwrap().unwrap();
    assert_eq!(r.status, RunStatus::Running);
    assert!(r.started_at.is_some());

    // Running → Paused
    repo.update_run_status(run_id, &RunStatus::Paused, Some(started_at), None).unwrap();
    assert_eq!(repo.get_run_by_id(run_id).unwrap().unwrap().status, RunStatus::Paused);

    // Paused → Succeeded (terminal)
    let ended_at = Utc::now();
    repo.update_run_status(run_id, &RunStatus::Succeeded, Some(started_at), Some(ended_at)).unwrap();
    let terminal = repo.get_run_by_id(run_id).unwrap().unwrap();
    assert_eq!(terminal.status, RunStatus::Succeeded);
    assert!(terminal.ended_at.is_some());
}

// ── Cancelled and Failed terminal states ─────────────────────────────────────

#[test]
fn run_can_reach_cancelled_terminal_state() {
    let db = db();
    let workflow_id = Uuid::new_v4();
    insert_workflow(&db, workflow_id);

    let repo = RunRepository::new(&db);
    let run = make_run(workflow_id);
    let run_id = run.run_id;
    repo.create_run(&run).unwrap();

    repo.update_run_status(run_id, &RunStatus::Running, Some(Utc::now()), None).unwrap();
    repo.update_run_status(run_id, &RunStatus::Cancelled, Some(Utc::now()), Some(Utc::now())).unwrap();

    let r = repo.get_run_by_id(run_id).unwrap().unwrap();
    assert_eq!(r.status, RunStatus::Cancelled);
    assert!(r.ended_at.is_some());
}

#[test]
fn run_can_reach_failed_terminal_state() {
    let db = db();
    let workflow_id = Uuid::new_v4();
    insert_workflow(&db, workflow_id);

    let repo = RunRepository::new(&db);
    let run = make_run(workflow_id);
    let run_id = run.run_id;
    repo.create_run(&run).unwrap();

    repo.update_run_status(run_id, &RunStatus::Running, Some(Utc::now()), None).unwrap();
    repo.update_run_status(run_id, &RunStatus::Failed, Some(Utc::now()), Some(Utc::now())).unwrap();

    let r = repo.get_run_by_id(run_id).unwrap().unwrap();
    assert_eq!(r.status, RunStatus::Failed);
}

// ── Runs from different workflows don't cross-contaminate ─────────────────────

#[test]
fn list_runs_scoped_to_workflow_id() {
    let db = db();
    let wf_id_a = Uuid::new_v4();
    let wf_id_b = Uuid::new_v4();
    insert_workflow(&db, wf_id_a);
    insert_workflow(&db, wf_id_b);

    let repo = RunRepository::new(&db);

    // Two runs for wf_a, one for wf_b
    repo.create_run(&make_run(wf_id_a)).unwrap();
    repo.create_run(&make_run(wf_id_a)).unwrap();
    repo.create_run(&make_run(wf_id_b)).unwrap();

    let runs_a = repo.list_runs_for_workflow(wf_id_a).unwrap();
    let runs_b = repo.list_runs_for_workflow(wf_id_b).unwrap();

    assert_eq!(runs_a.len(), 2);
    assert!(runs_a.iter().all(|r| r.workflow_id == wf_id_a));

    assert_eq!(runs_b.len(), 1);
    assert_eq!(runs_b[0].workflow_id, wf_id_b);
}

// ── get_active_runs excludes all terminal statuses ────────────────────────────

#[test]
fn get_active_runs_excludes_all_terminal_statuses() {
    let db = db();
    let workflow_id = Uuid::new_v4();
    insert_workflow(&db, workflow_id);

    let repo = RunRepository::new(&db);

    let active_run = make_run(workflow_id);   // stays Created
    let succeeded_run = make_run(workflow_id);
    let failed_run = make_run(workflow_id);
    let cancelled_run = make_run(workflow_id);

    let succ_id = succeeded_run.run_id;
    let fail_id = failed_run.run_id;
    let canc_id = cancelled_run.run_id;

    repo.create_run(&active_run).unwrap();
    repo.create_run(&succeeded_run).unwrap();
    repo.create_run(&failed_run).unwrap();
    repo.create_run(&cancelled_run).unwrap();

    repo.update_run_status(succ_id, &RunStatus::Succeeded, Some(Utc::now()), Some(Utc::now())).unwrap();
    repo.update_run_status(fail_id, &RunStatus::Failed, Some(Utc::now()), Some(Utc::now())).unwrap();
    repo.update_run_status(canc_id, &RunStatus::Cancelled, Some(Utc::now()), Some(Utc::now())).unwrap();

    let active = repo.get_active_runs().unwrap();
    assert_eq!(active.len(), 1);
    assert_eq!(active[0].run_id, active_run.run_id);
    assert_eq!(active[0].status, RunStatus::Created);
}

// ── workspace_root is preserved verbatim ─────────────────────────────────────

#[test]
fn workspace_root_preserved_on_roundtrip() {
    let db = db();
    let workflow_id = Uuid::new_v4();
    insert_workflow(&db, workflow_id);

    let repo = RunRepository::new(&db);
    let wf = make_workflow_def(workflow_id);
    let run = RunInstance::from_workflow(&wf, "/home/user/my project/repo");
    let run_id = run.run_id;

    repo.create_run(&run).unwrap();

    let loaded = repo.get_run_by_id(run_id).unwrap().unwrap();
    assert_eq!(loaded.workspace_root, "/home/user/my project/repo");
}

// ── All active statuses are returned by get_active_runs ──────────────────────

#[test]
fn get_active_runs_includes_all_non_terminal_statuses() {
    let db = db();
    let workflow_id = Uuid::new_v4();
    insert_workflow(&db, workflow_id);

    let repo = RunRepository::new(&db);

    // Insert one run for each non-terminal status
    let statuses = [
        RunStatus::Created,
        RunStatus::Validating,
        RunStatus::Ready,
        RunStatus::Running,
        RunStatus::Paused,
    ];

    let mut ids = Vec::new();
    for _ in &statuses {
        let run = make_run(workflow_id);
        ids.push(run.run_id);
        repo.create_run(&run).unwrap();
    }

    // Manually set each status (Created is already set by create_run)
    repo.update_run_status(ids[1], &RunStatus::Validating, None, None).unwrap();
    repo.update_run_status(ids[2], &RunStatus::Ready, None, None).unwrap();
    repo.update_run_status(ids[3], &RunStatus::Running, Some(Utc::now()), None).unwrap();
    repo.update_run_status(ids[4], &RunStatus::Paused, Some(Utc::now()), None).unwrap();

    let active = repo.get_active_runs().unwrap();
    assert_eq!(active.len(), 5, "all non-terminal statuses must appear in get_active_runs");
}
