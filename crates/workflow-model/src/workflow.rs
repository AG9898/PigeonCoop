use serde::{Deserialize, Serialize};
use uuid::Uuid;
use chrono::{DateTime, Utc};
use crate::node::NodeDefinition;
use crate::edge::EdgeDefinition;

/// The schema format version this build of the engine reads and writes.
/// Increment this when the WorkflowDefinition JSON format changes in a
/// backward-incompatible way and provide a corresponding arm in `migrate`.
pub const CURRENT_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowDefinition {
    pub workflow_id: Uuid,
    pub name: String,
    /// Schema format version (set by the application). Used to detect and
    /// migrate documents written by an older engine. Not user-editable.
    pub schema_version: u32,
    /// User-controlled revision counter. Incremented by the application each
    /// time the user saves a new revision of the workflow. Used by the
    /// persistence layer to store and retrieve workflow history.
    pub version: u32,
    pub metadata: serde_json::Value,
    pub nodes: Vec<NodeDefinition>,
    pub edges: Vec<EdgeDefinition>,
    pub default_constraints: serde_json::Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Migrate a `WorkflowDefinition` loaded from disk to the current schema version.
///
/// Each arm handles one version step. The function is idempotent when
/// `wf.schema_version == CURRENT_SCHEMA_VERSION`.
///
/// Example of a future v1 → v2 migration (not yet active):
/// ```text
/// 1 => {
///     // v2 added a top-level `tags` array; back-fill it as empty.
///     if wf.metadata.get("tags").is_none() {
///         wf.metadata["tags"] = serde_json::json!([]);
///     }
///     wf.schema_version = 2;
/// }
/// ```
pub fn migrate(wf: WorkflowDefinition) -> WorkflowDefinition {
    while wf.schema_version < CURRENT_SCHEMA_VERSION {
        match wf.schema_version {
            // No migrations yet — schema_version 1 is current.
            // Future arms go here.
            _ => break,
        }
    }
    wf
}
