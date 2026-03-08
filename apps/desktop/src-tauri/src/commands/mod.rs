// Tauri command handlers exposed to the frontend via invoke().
// Keep thin — delegate to persistence, never duplicate execution logic here.

use std::sync::Mutex;

use serde::Serialize;
use tauri::State;
use uuid::Uuid;

use persistence::{
    repositories::workflows::{
        delete_workflow as repo_delete_workflow,
        get_workflow_by_id,
        list_workflows as repo_list_workflows,
        save_workflow,
    },
    sqlite::Db,
};
use workflow_model::workflow::WorkflowDefinition;

/// Shared application state managed by Tauri.
pub struct AppState {
    pub db: Mutex<Db>,
}

/// Serializable error returned from all command handlers.
#[derive(Debug, Serialize)]
pub struct CmdError {
    pub message: String,
}

fn cmd_err(e: impl std::fmt::Display) -> CmdError {
    CmdError { message: e.to_string() }
}

type CmdResult<T> = Result<T, CmdError>;

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
