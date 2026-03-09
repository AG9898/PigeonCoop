// Tauri command handlers exposed to the frontend via invoke().
// Keep thin — delegate to persistence/engine, never duplicate execution logic here.
// See TAURI_IPC_CONTRACT.md for the full IPC contract.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tokio::sync::mpsc;
use uuid::Uuid;

use core_engine::coordinator::RunCoordinator;
use core_engine::review::{handle_review_decision, ReviewDecision};
use core_engine::scheduler::RunScheduler;
use core_engine::state_machine::{node::NodeTransitionInput, RunTransitionInput};
use persistence::{
    repositories::{
        runs::RunRepository,
        workflows::{
            delete_workflow as repo_delete_workflow, get_workflow_by_id,
            list_workflows as repo_list_workflows, save_workflow,
        },
    },
    sqlite::Db,
};
use workflow_model::{
    node::NodeKind,
    run::{NodeSnapshot, NodeStatus, RunInstance, RunStatus},
    workflow::WorkflowDefinition,
};

use crate::bridge::TauriEventLog;

// ---------------------------------------------------------------------------
// AppState
// ---------------------------------------------------------------------------

/// Shared application state managed by Tauri.
///
/// `db` is wrapped in `Arc` so it can be cloned into background async tasks
/// without giving up ownership of the `Mutex<Db>` managed by Tauri.
pub struct AppState {
    pub db: Arc<Mutex<Db>>,
    /// Cancellation flags for active runs. Keyed by run_id.
    pub active_runs: Mutex<HashMap<Uuid, Arc<AtomicBool>>>,
    /// Channels for sending review decisions to paused runs. Keyed by run_id.
    pub review_senders: Mutex<HashMap<Uuid, mpsc::Sender<ReviewMessage>>>,
}

impl AppState {
    pub fn new(db: Db) -> Self {
        Self {
            db: Arc::new(Mutex::new(db)),
            active_runs: Mutex::new(HashMap::new()),
            review_senders: Mutex::new(HashMap::new()),
        }
    }
}

/// Message sent through the review channel to the background execution task.
pub struct ReviewMessage {
    pub node_id: Uuid,
    pub decision: ReviewDecision,
}

/// IPC-facing review decision enum. Tagged by `type` for JSON serialization.
/// Maps to `core_engine::review::ReviewDecision` internally.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type")]
pub enum HumanReviewDecision {
    #[serde(rename = "approved")]
    Approved {
        #[serde(default)]
        comment: Option<String>,
    },
    #[serde(rename = "rejected")]
    Rejected {
        #[serde(default)]
        reason: Option<String>,
    },
    #[serde(rename = "retry_requested")]
    RetryRequested {
        #[serde(default)]
        target_node_id: Option<String>,
        #[serde(default)]
        comment: Option<String>,
    },
}

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

/// Serializable error returned from all command handlers.
#[derive(Debug, Serialize)]
pub struct CmdError {
    pub message: String,
}

fn cmd_err(e: impl std::fmt::Display) -> CmdError {
    CmdError { message: e.to_string() }
}

type CmdResult<T> = Result<T, CmdError>;

// ---------------------------------------------------------------------------
// Workflow CRUD commands (TAURI-001)
// ---------------------------------------------------------------------------

/// Persist a new workflow.
#[tauri::command]
pub fn create_workflow(state: State<AppState>, workflow: WorkflowDefinition) -> CmdResult<()> {
    let db = state.db.lock().unwrap();
    save_workflow(&db, &workflow).map_err(cmd_err)
}

/// Retrieve the latest version of a workflow by id.
#[tauri::command]
pub fn get_workflow(state: State<AppState>, id: String) -> CmdResult<Option<WorkflowDefinition>> {
    let uuid = Uuid::parse_str(&id).map_err(cmd_err)?;
    let db = state.db.lock().unwrap();
    get_workflow_by_id(&db, uuid).map_err(cmd_err)
}

/// List all stored workflows (latest version of each).
#[tauri::command]
pub fn list_workflows(state: State<AppState>) -> CmdResult<Vec<WorkflowDefinition>> {
    let db = state.db.lock().unwrap();
    repo_list_workflows(&db).map_err(cmd_err)
}

/// Update an existing workflow — upserts metadata and saves a new version snapshot.
#[tauri::command]
pub fn update_workflow(state: State<AppState>, workflow: WorkflowDefinition) -> CmdResult<()> {
    let db = state.db.lock().unwrap();
    save_workflow(&db, &workflow).map_err(cmd_err)
}

/// Delete a workflow and all its versions.
#[tauri::command]
pub fn delete_workflow(state: State<AppState>, id: String) -> CmdResult<()> {
    let uuid = Uuid::parse_str(&id).map_err(cmd_err)?;
    let db = state.db.lock().unwrap();
    repo_delete_workflow(&db, uuid).map_err(cmd_err)
}

/// Import a workflow from a JSON string and persist it.
#[tauri::command]
pub fn import_workflow(state: State<AppState>, json: String) -> CmdResult<WorkflowDefinition> {
    let workflow: WorkflowDefinition = serde_json::from_str(&json).map_err(cmd_err)?;
    let db = state.db.lock().unwrap();
    save_workflow(&db, &workflow).map_err(cmd_err)?;
    Ok(workflow)
}

/// Export a workflow as a JSON string.
#[tauri::command]
pub fn export_workflow(state: State<AppState>, id: String) -> CmdResult<String> {
    let uuid = Uuid::parse_str(&id).map_err(cmd_err)?;
    let db = state.db.lock().unwrap();
    match get_workflow_by_id(&db, uuid).map_err(cmd_err)? {
        Some(wf) => serde_json::to_string(&wf).map_err(cmd_err),
        None => Err(CmdError { message: format!("workflow {id} not found") }),
    }
}

// ---------------------------------------------------------------------------
// Human review commands (TAURI-003)
// ---------------------------------------------------------------------------

/// Submit an operator decision for a paused human-review node.
///
/// The decision is sent to the background execution task via a channel.
/// The engine applies the decision and resumes or terminates the run.
#[tauri::command]
pub async fn submit_human_review_decision(
    state: State<'_, AppState>,
    run_id: String,
    node_id: String,
    decision: HumanReviewDecision,
) -> CmdResult<()> {
    let run_uuid = Uuid::parse_str(&run_id).map_err(cmd_err)?;
    let node_uuid = Uuid::parse_str(&node_id).map_err(cmd_err)?;

    // Convert IPC decision to engine ReviewDecision.
    let engine_decision = match decision {
        HumanReviewDecision::Approved { comment } => {
            ReviewDecision::Approve { comment }
        }
        HumanReviewDecision::Rejected { reason } => {
            ReviewDecision::Reject {
                reason: reason.unwrap_or_else(|| "rejected".to_owned()),
            }
        }
        HumanReviewDecision::RetryRequested { target_node_id, comment } => {
            let target = target_node_id
                .ok_or_else(|| cmd_err("target_node_id is required for retry decisions"))?;
            let target_uuid = Uuid::parse_str(&target).map_err(cmd_err)?;
            ReviewDecision::Retry {
                target_node_id: target_uuid,
                comment,
            }
        }
    };

    // Look up the review channel for this run.
    let sender = {
        let senders = state.review_senders.lock().unwrap();
        senders.get(&run_uuid).cloned()
    };

    match sender {
        Some(tx) => {
            tx.send(ReviewMessage {
                node_id: node_uuid,
                decision: engine_decision,
            })
            .await
            .map_err(|_| cmd_err("run is no longer waiting for review"))?;
            Ok(())
        }
        None => Err(cmd_err(format!(
            "run {run_id} is not waiting for a review decision"
        ))),
    }
}

// ---------------------------------------------------------------------------
// Run lifecycle commands (TAURI-002)
// ---------------------------------------------------------------------------

/// Create a new RunInstance for a workflow and persist it. Does not start execution.
#[tauri::command]
pub fn create_run(
    state: State<AppState>,
    workflow_id: String,
    workspace_root: String,
) -> CmdResult<RunInstance> {
    let wf_uuid = Uuid::parse_str(&workflow_id).map_err(cmd_err)?;
    let db = state.db.lock().unwrap();

    let workflow = get_workflow_by_id(&db, wf_uuid)
        .map_err(cmd_err)?
        .ok_or_else(|| cmd_err(format!("workflow {workflow_id} not found")))?;

    let run = RunInstance::from_workflow(&workflow, workspace_root);
    RunRepository::new(&db).create_run(&run).map_err(cmd_err)?;
    Ok(run)
}

/// Transition a created run to running and launch engine execution asynchronously.
///
/// Returns immediately — the engine runs in a background tokio task and emits
/// `run_status_changed`, `node_status_changed`, and `run_event_appended` Tauri
/// events as execution progresses.
#[tauri::command]
pub async fn start_run(
    app: AppHandle,
    state: State<'_, AppState>,
    run_id: String,
) -> CmdResult<()> {
    let run_uuid = Uuid::parse_str(&run_id).map_err(cmd_err)?;

    // Clone Arc so the background task can share DB access.
    let db_arc = Arc::clone(&state.db);

    // Load run and workflow while holding the lock briefly.
    let (run, workflow) = {
        let db = db_arc.lock().unwrap();
        let run = RunRepository::new(&db)
            .get_run_by_id(run_uuid)
            .map_err(cmd_err)?
            .ok_or_else(|| cmd_err(format!("run {run_id} not found")))?;
        let wf_id = run.workflow_id;
        let workflow = get_workflow_by_id(&db, wf_id)
            .map_err(cmd_err)?
            .ok_or_else(|| cmd_err(format!("workflow {wf_id} not found")))?;
        (run, workflow)
    };

    // Validate the run is in a startable state.
    if !matches!(run.status, RunStatus::Created | RunStatus::Ready) {
        return Err(cmd_err(format!(
            "run {} is not in a startable state (current: {:?})",
            run_id, run.status
        )));
    }

    // Register a cancellation flag for this run.
    let cancel_flag = Arc::new(AtomicBool::new(false));
    state
        .active_runs
        .lock()
        .unwrap()
        .insert(run_uuid, Arc::clone(&cancel_flag));

    // Create a review channel so the background task can wait for decisions.
    let (review_tx, review_rx) = mpsc::channel::<ReviewMessage>(1);
    state
        .review_senders
        .lock()
        .unwrap()
        .insert(run_uuid, review_tx);

    // Spawn the engine in a background task — returns immediately to frontend.
    tokio::spawn(async move {
        run_workflow_background(app, db_arc, run, workflow, cancel_flag, review_rx).await;
    });

    Ok(())
}

/// Request cancellation of an active run. Signals the background task to stop.
#[tauri::command]
pub fn cancel_run(state: State<AppState>, run_id: String) -> CmdResult<()> {
    let run_uuid = Uuid::parse_str(&run_id).map_err(cmd_err)?;
    let active = state.active_runs.lock().unwrap();
    match active.get(&run_uuid) {
        Some(flag) => {
            flag.store(true, Ordering::SeqCst);
            Ok(())
        }
        None => Err(cmd_err(format!("run {run_id} is not active"))),
    }
}

/// Retrieve a single run by ID.
#[tauri::command]
pub fn get_run(state: State<AppState>, run_id: String) -> CmdResult<Option<RunInstance>> {
    let run_uuid = Uuid::parse_str(&run_id).map_err(cmd_err)?;
    let db = state.db.lock().unwrap();
    RunRepository::new(&db).get_run_by_id(run_uuid).map_err(cmd_err)
}

/// List all runs for a workflow ordered by created_at DESC.
#[tauri::command]
pub fn list_runs_for_workflow(
    state: State<AppState>,
    workflow_id: String,
) -> CmdResult<Vec<RunInstance>> {
    let wf_uuid = Uuid::parse_str(&workflow_id).map_err(cmd_err)?;
    let db = state.db.lock().unwrap();
    RunRepository::new(&db)
        .list_runs_for_workflow(wf_uuid)
        .map_err(cmd_err)
}

// ---------------------------------------------------------------------------
// Background execution task
// ---------------------------------------------------------------------------

/// Drive a workflow run to completion in a background tokio task.
///
/// Uses `StubNodeExecutor` semantics (all nodes succeed immediately) for v1.
/// Real adapter dispatch will be wired in a later task (ADAPT-001, ADAPT-002).
///
/// When a HumanReview node is encountered, the loop pauses the run and waits
/// on `review_rx` for a `ReviewMessage` from `submit_human_review_decision`.
async fn run_workflow_background(
    app: AppHandle,
    db: Arc<Mutex<Db>>,
    run: RunInstance,
    workflow: WorkflowDefinition,
    cancel_flag: Arc<AtomicBool>,
    mut review_rx: mpsc::Receiver<ReviewMessage>,
) {
    let run_id = run.run_id;
    let node_count = workflow.nodes.len() as u32;

    let event_log = TauriEventLog::new(app, Arc::clone(&db));
    let mut coordinator = RunCoordinator::new(run, event_log);

    // Initialize all node snapshots in Ready state.
    for node in &workflow.nodes {
        coordinator.node_snapshots.insert(
            node.node_id,
            NodeSnapshot {
                node_id: node.node_id,
                status: NodeStatus::Ready,
                attempt: 1,
                started_at: None,
                ended_at: None,
                output: None,
            },
        );
    }

    // Drive run state machine: Created → Validating → Ready → Running.
    // Errors here mean the run was already in a later state (e.g. Ready).
    let _ = coordinator
        .transition_run(RunTransitionInput::BeginValidation { node_count });
    let _ = coordinator
        .transition_run(RunTransitionInput::ValidationPassed { node_count });
    if coordinator
        .transition_run(RunTransitionInput::Start { node_count })
        .is_err()
    {
        // Could not transition to Running — persist current state and bail.
        persist_run_status(&db, run_id, coordinator.run_status());
        return;
    }

    persist_run_status_with_times(
        &db,
        run_id,
        coordinator.run_status(),
        Some(Utc::now()),
        None,
    );

    // Step-by-step execution loop with cancellation and review support.
    let scheduler = RunScheduler::new();

    loop {
        // Check for external cancellation request.
        if cancel_flag.load(Ordering::SeqCst) {
            let _ = coordinator.cancel(Some("cancelled by user".to_owned()));
            break;
        }

        // Stop when run reaches a terminal state.
        match coordinator.run_status() {
            RunStatus::Succeeded
            | RunStatus::Failed
            | RunStatus::Cancelled => break,
            _ => {}
        }

        // If paused (waiting for review), wait for a decision on the channel.
        if *coordinator.run_status() == RunStatus::Paused {
            persist_run_status(&db, run_id, coordinator.run_status());

            // Wait for either a review decision or cancellation.
            tokio::select! {
                msg = review_rx.recv() => {
                    match msg {
                        Some(review_msg) => {
                            let _ = handle_review_decision(
                                &mut coordinator,
                                review_msg.node_id,
                                review_msg.decision,
                            );
                            persist_run_status(&db, run_id, coordinator.run_status());
                            // Continue the loop — the run may have resumed or terminated.
                            continue;
                        }
                        None => {
                            // Channel closed — no one can send decisions; cancel the run.
                            let _ = coordinator.cancel(Some("review channel closed".to_owned()));
                            break;
                        }
                    }
                }
                _ = async {
                    loop {
                        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                        if cancel_flag.load(Ordering::SeqCst) {
                            break;
                        }
                    }
                } => {
                    let _ = coordinator.cancel(Some("cancelled by user".to_owned()));
                    break;
                }
            }
        }

        // Find nodes eligible to execute this step.
        let ready = scheduler.next_ready_nodes(&workflow, &coordinator.node_snapshots);
        if ready.is_empty() {
            break;
        }

        for node_id in ready {
            let node_type = node_type_label(&workflow, node_id);
            let workspace_root = coordinator.run.workspace_root.clone();

            // Ready → Queued
            if coordinator
                .transition_node(node_id, NodeTransitionInput::Queue { node_type: node_type.clone() })
                .is_err()
            {
                continue;
            }

            // Queued → Running
            if coordinator
                .transition_node(
                    node_id,
                    NodeTransitionInput::Start {
                        node_type: node_type.clone(),
                        input_refs: vec![],
                        workspace_root,
                    },
                )
                .is_err()
            {
                continue;
            }

            // Check if this is a HumanReview node — pause for review instead
            // of auto-completing.
            if is_human_review_node(&workflow, node_id) {
                let reason = human_review_reason(&workflow, node_id);
                let _ = coordinator.pause_for_review(node_id, reason);
                // The next loop iteration will detect Paused and wait on the channel.
                break;
            }

            // Stub execution: all nodes succeed in 1 ms.
            // Real adapter dispatch wired in ADAPT-001/ADAPT-002.
            let _ = coordinator.complete_node_success(node_id, 1);
        }
    }

    // Persist final run status and timestamps to SQLite.
    let final_status = coordinator.run_status().clone();
    let ended_at = match &final_status {
        RunStatus::Succeeded | RunStatus::Failed | RunStatus::Cancelled => Some(Utc::now()),
        _ => None,
    };
    persist_run_status_with_times(&db, run_id, &final_status, None, ended_at);
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/// Check if a node in the workflow is a HumanReview node.
fn is_human_review_node(workflow: &WorkflowDefinition, node_id: Uuid) -> bool {
    workflow
        .nodes
        .iter()
        .find(|n| n.node_id == node_id)
        .map(|n| n.node_type == NodeKind::HumanReview)
        .unwrap_or(false)
}

/// Extract the review reason from a HumanReview node's config, if available.
fn human_review_reason(workflow: &WorkflowDefinition, node_id: Uuid) -> Option<String> {
    workflow
        .nodes
        .iter()
        .find(|n| n.node_id == node_id)
        .and_then(|n| {
            if let workflow_model::node_config::NodeConfig::HumanReview(cfg) = &n.config {
                cfg.reason.clone().or_else(|| cfg.prompt.clone())
            } else {
                None
            }
        })
}

fn node_type_label(workflow: &WorkflowDefinition, node_id: Uuid) -> String {
    workflow
        .nodes
        .iter()
        .find(|n| n.node_id == node_id)
        .map(|n| format!("{:?}", n.node_type).to_lowercase())
        .unwrap_or_else(|| "unknown".to_owned())
}

fn persist_run_status(db: &Arc<Mutex<Db>>, run_id: Uuid, status: &RunStatus) {
    if let Ok(db) = db.lock() {
        let _ = RunRepository::new(&db).update_run_status(run_id, status, None, None);
    }
}

fn persist_run_status_with_times(
    db: &Arc<Mutex<Db>>,
    run_id: Uuid,
    status: &RunStatus,
    started_at: Option<chrono::DateTime<Utc>>,
    ended_at: Option<chrono::DateTime<Utc>>,
) {
    if let Ok(db) = db.lock() {
        let _ = RunRepository::new(&db).update_run_status(run_id, status, started_at, ended_at);
    }
}
