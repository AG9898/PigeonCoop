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
use core_engine::validation::{ValidationResult, WorkflowValidator};
use event_model::event::RunEvent;
use persistence::{
    repositories::{
        events::EventRepository,
        runs::RunRepository,
        settings::SettingsRepository,
        workflows::{
            delete_workflow as repo_delete_workflow, get_workflow_by_id,
            list_workflows as repo_list_workflows, save_workflow,
        },
    },
    sqlite::Db,
};
use runtime_adapters::agent::AgentCliAdapter;
use runtime_adapters::cli::CliAdapter;
use runtime_adapters::Adapter;
use workflow_model::{
    memory::{MemoryScope, MemoryState},
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

/// Validate a workflow definition and return a list of validation errors.
///
/// Returns a `ValidationResult` with `is_valid` and `errors` fields.
/// No persistence side-effects — pure structural check.
#[tauri::command]
pub fn validate_workflow(workflow: WorkflowDefinition) -> ValidationResult {
    WorkflowValidator::new().validate_to_result(&workflow)
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
// Event log query commands (UI-RPL-001)
// ---------------------------------------------------------------------------

/// IPC-facing event envelope. Mirrors `RunEvent` but uses String UUIDs for JSON
/// compatibility and adds `sequence` (1-based position in the run's event stream).
#[derive(Debug, Serialize)]
pub struct RunEventDto {
    pub event_id: String,
    pub run_id: String,
    pub workflow_id: String,
    pub node_id: Option<String>,
    pub event_type: String,
    pub timestamp: String,
    pub payload: serde_json::Value,
    pub causation_id: Option<String>,
    pub correlation_id: Option<String>,
    pub sequence: u32,
}

/// Return up to `limit` events for a run starting at `offset`, in chronological order.
///
/// Sequence numbers are 1-based and relative to the run. The frontend Replay view
/// uses these to drive the timeline scrubber.
#[tauri::command]
pub fn list_events_for_run(
    state: State<AppState>,
    run_id: String,
    offset: u32,
    limit: u32,
) -> CmdResult<Vec<RunEventDto>> {
    let run_uuid = Uuid::parse_str(&run_id).map_err(cmd_err)?;
    let db = state.db.lock().unwrap();
    let events = EventRepository::new(&db)
        .list_events_for_run(run_uuid, offset, limit)
        .map_err(cmd_err)?;

    Ok(events
        .into_iter()
        .enumerate()
        .map(|(i, e)| RunEventDto {
            event_id: e.event_id.to_string(),
            run_id: e.run_id.to_string(),
            workflow_id: e.workflow_id.to_string(),
            node_id: e.node_id.map(|id| id.to_string()),
            event_type: e.event_type,
            timestamp: e.timestamp.to_rfc3339(),
            payload: e.payload,
            causation_id: e.causation_id.map(|id| id.to_string()),
            correlation_id: e.correlation_id.map(|id| id.to_string()),
            sequence: offset + i as u32 + 1,
        })
        .collect())
}

// ---------------------------------------------------------------------------
// Background execution task
// ---------------------------------------------------------------------------

/// Drive a workflow run to completion in a background tokio task.
///
/// Tool nodes are dispatched through `CliAdapter`; Agent nodes through
/// `AgentCliAdapter`. Start, End, Router, and Memory nodes complete
/// immediately with success (no real execution in v1). HumanReview nodes
/// pause the run and wait on `review_rx` for a decision.
///
/// Adapter exit codes and errors drive node/run failure states. All
/// CommandEventKind and AgentEventKind events are forwarded to the Tauri
/// event bridge via the coordinator's event log.
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

            // Dispatch through the appropriate runtime adapter.
            dispatch_node_execution(&mut coordinator, &workflow, node_id).await;
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
// Adapter dispatch
// ---------------------------------------------------------------------------

/// Dispatch a single node to the appropriate runtime adapter and update the
/// coordinator based on the result.
///
/// - `Tool` nodes → `CliAdapter` (shell command in workspace_root)
/// - `Agent` nodes → `AgentCliAdapter` (agent CLI with prompt via stdin)
/// - All other node types (Start, End, Router, Memory) → immediate success
///
/// Command and agent events from adapters are forwarded to the coordinator's
/// event log, making them available to the Tauri event bridge in real time.
async fn dispatch_node_execution(
    coordinator: &mut RunCoordinator<crate::bridge::TauriEventLog>,
    workflow: &WorkflowDefinition,
    node_id: Uuid,
) {
    let node_def = match workflow.nodes.iter().find(|n| n.node_id == node_id) {
        Some(n) => n,
        None => {
            let _ = coordinator.complete_node_success(node_id, 0);
            return;
        }
    };

    let workspace_root = coordinator.run.workspace_root.clone();
    let run_id = coordinator.run.run_id;
    let workflow_id = coordinator.run.workflow_id;

    // Build a minimal run-shared MemoryState for adapters that need memory context.
    let memory = MemoryState {
        run_id,
        node_id: Some(node_id),
        scope: MemoryScope::RunShared,
        data: serde_json::Value::Null,
    };

    let max_retries = node_def.retry_policy.max_retries;
    let attempt = coordinator
        .node_snapshots
        .get(&node_id)
        .map(|s| s.attempt)
        .unwrap_or(1);
    let retries_remaining = max_retries.saturating_sub(attempt.saturating_sub(1));

    match node_def.node_type {
        NodeKind::Tool => {
            let adapter = CliAdapter::new();
            // Use a large buffer so adapter streaming tasks never block.
            let (tx, mut rx) = mpsc::channel::<event_model::command_events::CommandEventKind>(4096);
            let start = std::time::Instant::now();
            let result = adapter.execute(node_def, &workspace_root, &memory, tx).await;
            let duration_ms = start.elapsed().as_millis() as u64;

            // Forward accumulated CommandEventKind events as RunEvents.
            while let Ok(kind) = rx.try_recv() {
                if let Some(event) = command_kind_to_run_event(run_id, workflow_id, node_id, &kind) {
                    coordinator.emit_event(event);
                }
            }

            match result {
                Ok(output) => {
                    let success = output.exit_code.map(|c| c == 0).unwrap_or(true);
                    if success {
                        let _ = coordinator.complete_node_success(node_id, duration_ms);
                    } else {
                        let reason = format!(
                            "command exited with non-zero code {:?}",
                            output.exit_code
                        );
                        let _ = coordinator.fail_node(node_id, reason, retries_remaining);
                    }
                }
                Err(e) => {
                    let _ = coordinator.fail_node(node_id, e.to_string(), retries_remaining);
                }
            }
        }

        NodeKind::Agent => {
            let adapter = AgentCliAdapter::new();
            let (tx, mut rx) = mpsc::channel::<event_model::agent_events::AgentEventKind>(4096);
            let start = std::time::Instant::now();
            let result = adapter.execute(node_def, &workspace_root, &memory, tx).await;
            let duration_ms = start.elapsed().as_millis() as u64;

            // Forward accumulated AgentEventKind events as RunEvents.
            while let Ok(kind) = rx.try_recv() {
                if let Some(event) = agent_kind_to_run_event(run_id, workflow_id, node_id, &kind) {
                    coordinator.emit_event(event);
                }
            }

            match result {
                Ok(_output) => {
                    let _ = coordinator.complete_node_success(node_id, duration_ms);
                }
                Err(e) => {
                    let _ = coordinator.fail_node(node_id, e.to_string(), retries_remaining);
                }
            }
        }

        // Start, End, Router, Memory: no real execution in v1 — succeed immediately.
        _ => {
            let _ = coordinator.complete_node_success(node_id, 0);
        }
    }
}

/// Convert a `CommandEventKind` to a `RunEvent` envelope for the event log.
///
/// Uses the serde `event_type`/`payload` tags to build the envelope without
/// requiring a dedicated constructor per variant.
fn command_kind_to_run_event(
    run_id: Uuid,
    workflow_id: Uuid,
    node_id: Uuid,
    kind: &event_model::command_events::CommandEventKind,
) -> Option<RunEvent> {
    let v = serde_json::to_value(kind).ok()?;
    let event_type = v.get("event_type")?.as_str()?.to_owned();
    let payload = v.get("payload")?.clone();
    Some(RunEvent {
        event_id: Uuid::new_v4(),
        run_id,
        workflow_id,
        node_id: Some(node_id),
        event_type,
        timestamp: Utc::now(),
        payload,
        causation_id: None,
        correlation_id: None,
    })
}

/// Convert an `AgentEventKind` to a `RunEvent` envelope for the event log.
fn agent_kind_to_run_event(
    run_id: Uuid,
    workflow_id: Uuid,
    node_id: Uuid,
    kind: &event_model::agent_events::AgentEventKind,
) -> Option<RunEvent> {
    let v = serde_json::to_value(kind).ok()?;
    let event_type = v.get("event_type")?.as_str()?.to_owned();
    let payload = v.get("payload")?.clone();
    Some(RunEvent {
        event_id: Uuid::new_v4(),
        run_id,
        workflow_id,
        node_id: Some(node_id),
        event_type,
        timestamp: Utc::now(),
        payload,
        causation_id: None,
        correlation_id: None,
    })
}

// ---------------------------------------------------------------------------
// Settings commands (TAURI-005)
// ---------------------------------------------------------------------------

/// Single key-value setting entry returned to the frontend.
#[derive(Debug, Serialize)]
pub struct SettingEntry {
    pub key: String,
    pub value: serde_json::Value,
}

/// Return all stored settings as an ordered list of key-value pairs.
#[tauri::command]
pub fn get_settings(state: State<AppState>) -> CmdResult<Vec<SettingEntry>> {
    let db = state.db.lock().unwrap();
    let entries = SettingsRepository::new(&db).list_settings().map_err(cmd_err)?;
    Ok(entries
        .into_iter()
        .map(|(key, value)| SettingEntry { key, value })
        .collect())
}

/// Insert or replace the JSON value stored under `key`.
#[tauri::command]
pub fn set_setting(
    state: State<AppState>,
    key: String,
    value: serde_json::Value,
) -> CmdResult<()> {
    let db = state.db.lock().unwrap();
    SettingsRepository::new(&db)
        .set_setting(&key, &value)
        .map_err(cmd_err)
}

/// Open the native OS directory picker, store the selected path as `workspace_root`
/// in settings, and return the path to the frontend.
///
/// Returns `None` if the user cancels without selecting a directory.
#[tauri::command]
pub async fn open_workspace_picker(
    app: AppHandle,
    state: State<'_, AppState>,
) -> CmdResult<Option<String>> {
    use tauri_plugin_dialog::DialogExt;
    use tokio::sync::oneshot;

    let (tx, rx) = oneshot::channel::<Option<tauri_plugin_dialog::FilePath>>();
    app.dialog()
        .file()
        .set_title("Select Workspace Directory")
        .pick_folder(move |folder_path| {
            let _ = tx.send(folder_path);
        });

    let folder = rx
        .await
        .map_err(|_| cmd_err("dialog channel closed unexpectedly"))?;

    match folder {
        Some(path) => {
            let path_str = path.to_string();
            let db = state.db.lock().unwrap();
            SettingsRepository::new(&db)
                .set_setting("workspace_root", &serde_json::Value::String(path_str.clone()))
                .map_err(cmd_err)?;
            Ok(Some(path_str))
        }
        None => Ok(None),
    }
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
