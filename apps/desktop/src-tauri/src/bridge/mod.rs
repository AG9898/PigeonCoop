// Tauri event bridge — emits engine events to the frontend via app.emit().
// The UI subscribes via listen(); it never polls or invents state.
// See TAURI_IPC_CONTRACT.md §Events.
//
// Design: the bridge is thin. It forwards every RunEvent as-is via
// `run_event_appended`, plus convenience events (`run_status_changed`,
// `node_status_changed`, `human_review_requested`) derived from the event
// payload. No engine state is mutated or derived here.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use uuid::Uuid;

use tauri::Emitter;

use core_engine::coordinator::EventLog;
use event_model::event::RunEvent;
use persistence::{repositories::events::EventRepository, sqlite::Db};
use workflow_model::run::{NodeStatus, RunStatus};

// ---------------------------------------------------------------------------
// Tauri event payload types (see TAURI_IPC_CONTRACT.md §Events)
// ---------------------------------------------------------------------------

/// Payload for the `run_status_changed` Tauri event.
#[derive(Clone, Serialize, Deserialize)]
pub struct RunStatusChangedPayload {
    pub run_id: String,
    pub old_status: String,
    pub new_status: String,
    pub timestamp: String,
}

/// Payload for the `node_status_changed` Tauri event.
#[derive(Clone, Serialize, Deserialize)]
pub struct NodeStatusChangedPayload {
    pub run_id: String,
    pub node_id: String,
    pub old_status: String,
    pub new_status: String,
    pub attempt: u32,
    pub timestamp: String,
}

/// Payload for the `run_event_appended` Tauri event.
#[derive(Clone, Serialize, Deserialize)]
pub struct RunEventAppendedPayload {
    pub event: RunEvent,
}

/// Payload for the `human_review_requested` Tauri event.
/// Emitted when a `review.required` event is appended to the log.
#[derive(Clone, Serialize, Deserialize)]
pub struct HumanReviewRequestedPayload {
    pub run_id: String,
    pub node_id: String,
    pub node_label: String,
    pub reason: String,
    pub available_actions: Vec<String>,
    pub timestamp: String,
}

// ---------------------------------------------------------------------------
// TauriEventLog
// ---------------------------------------------------------------------------

/// An `EventLog` implementation that persists events to SQLite and emits
/// Tauri frontend events (`run_event_appended`, `run_status_changed`,
/// `node_status_changed`) on every append.
///
/// Implements `core_engine::coordinator::EventLog` so it can be injected
/// into `RunCoordinator`.
pub struct TauriEventLog {
    app: AppHandle,
    db: Arc<Mutex<Db>>,
    /// In-memory cache required by the `events()` method.
    events: Vec<RunEvent>,
    /// Tracked node statuses used to compute deltas for `node_status_changed`.
    node_statuses: HashMap<Uuid, NodeStatus>,
}

impl TauriEventLog {
    pub fn new(app: AppHandle, db: Arc<Mutex<Db>>) -> Self {
        Self {
            app,
            db,
            events: Vec::new(),
            node_statuses: HashMap::new(),
        }
    }
}

impl EventLog for TauriEventLog {
    fn append(&mut self, event: RunEvent) -> Result<(), String> {
        // 1. Persist to SQLite.
        {
            let db = self.db.lock().map_err(|e| e.to_string())?;
            EventRepository::new(&db)
                .append_event(&event)
                .map_err(|e| e.to_string())?;
        }

        // 2. Emit `run_event_appended` for every event.
        let _ = self
            .app
            .emit("run_event_appended", RunEventAppendedPayload { event: event.clone() });

        // 3. Emit `run_status_changed` for run lifecycle events.
        if let Some((old, new)) = run_status_from_event(&event.event_type) {
            let _ = self.app.emit(
                "run_status_changed",
                RunStatusChangedPayload {
                    run_id: event.run_id.to_string(),
                    old_status: run_status_str(&old).to_owned(),
                    new_status: run_status_str(&new).to_owned(),
                    timestamp: event.timestamp.to_rfc3339(),
                },
            );
        }

        // 4. Emit `node_status_changed` for node lifecycle events.
        if let (Some(new_node_status), Some(node_id)) =
            (node_status_from_event(&event.event_type), event.node_id)
        {
            let old_status = self
                .node_statuses
                .get(&node_id)
                .cloned()
                .unwrap_or(NodeStatus::Ready);

            // Extract attempt from the event payload if present; default 1.
            let attempt = event
                .payload
                .get("attempt")
                .and_then(|v| v.as_u64())
                .map(|v| v as u32)
                .unwrap_or(1);

            let _ = self.app.emit(
                "node_status_changed",
                NodeStatusChangedPayload {
                    run_id: event.run_id.to_string(),
                    node_id: node_id.to_string(),
                    old_status: node_status_str(&old_status).to_owned(),
                    new_status: node_status_str(&new_node_status).to_owned(),
                    attempt,
                    timestamp: event.timestamp.to_rfc3339(),
                },
            );

            self.node_statuses.insert(node_id, new_node_status);
        }

        // 5. Emit `human_review_requested` for review.required events.
        if event.event_type == "review.required" {
            if let Some(node_id) = event.node_id {
                let reason = event
                    .payload
                    .get("reason")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_owned();
                let available_actions = event
                    .payload
                    .get("available_actions")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_str().map(String::from))
                            .collect()
                    })
                    .unwrap_or_default();

                let _ = self.app.emit(
                    "human_review_requested",
                    HumanReviewRequestedPayload {
                        run_id: event.run_id.to_string(),
                        node_id: node_id.to_string(),
                        // The bridge doesn't hold the workflow definition;
                        // the frontend maps node_id → label from its own state.
                        node_label: node_id.to_string(),
                        reason,
                        available_actions,
                        timestamp: event.timestamp.to_rfc3339(),
                    },
                );
            }
        }

        // 6. Cache in memory so `events()` can return a slice.
        self.events.push(event);
        Ok(())
    }

    fn events(&self) -> &[RunEvent] {
        &self.events
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Map a run-lifecycle event type string to its (old, new) RunStatus pair.
/// Returns `None` for non-run-lifecycle events.
fn run_status_from_event(event_type: &str) -> Option<(RunStatus, RunStatus)> {
    match event_type {
        "run.validation_started" => Some((RunStatus::Created, RunStatus::Validating)),
        "run.validation_passed" => Some((RunStatus::Validating, RunStatus::Ready)),
        "run.validation_failed" => Some((RunStatus::Validating, RunStatus::Failed)),
        "run.started" => Some((RunStatus::Ready, RunStatus::Running)),
        "run.paused" => Some((RunStatus::Running, RunStatus::Paused)),
        "run.resumed" => Some((RunStatus::Paused, RunStatus::Running)),
        "run.succeeded" => Some((RunStatus::Running, RunStatus::Succeeded)),
        "run.failed" => Some((RunStatus::Running, RunStatus::Failed)),
        "run.cancelled" => Some((RunStatus::Running, RunStatus::Cancelled)),
        _ => None,
    }
}

/// Map a node-lifecycle event type string to the resulting NodeStatus.
/// Returns `None` for non-node-lifecycle events.
fn node_status_from_event(event_type: &str) -> Option<NodeStatus> {
    match event_type {
        "node.queued" | "node.retry_scheduled" => Some(NodeStatus::Queued),
        "node.started" => Some(NodeStatus::Running),
        "node.waiting" => Some(NodeStatus::Waiting),
        "node.succeeded" => Some(NodeStatus::Succeeded),
        "node.failed" => Some(NodeStatus::Failed),
        "node.cancelled" => Some(NodeStatus::Cancelled),
        "node.skipped" => Some(NodeStatus::Skipped),
        _ => None,
    }
}

fn run_status_str(s: &RunStatus) -> &'static str {
    match s {
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

fn node_status_str(s: &NodeStatus) -> &'static str {
    match s {
        NodeStatus::Draft => "draft",
        NodeStatus::Validated => "validated",
        NodeStatus::Ready => "ready",
        NodeStatus::Queued => "queued",
        NodeStatus::Running => "running",
        NodeStatus::Waiting => "waiting",
        NodeStatus::Succeeded => "succeeded",
        NodeStatus::Failed => "failed",
        NodeStatus::Cancelled => "cancelled",
        NodeStatus::Skipped => "skipped",
    }
}
