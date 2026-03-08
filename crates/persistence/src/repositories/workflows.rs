use rusqlite::params;
use thiserror::Error;
use uuid::Uuid;
use workflow_model::workflow::WorkflowDefinition;

use crate::sqlite::Db;

#[derive(Debug, Error)]
pub enum RepoError {
    #[error("SQLite error: {0}")]
    Sqlite(#[from] rusqlite::Error),

    #[error("serialization error: {0}")]
    Serde(#[from] serde_json::Error),
}

/// Persist a WorkflowDefinition.
/// Upserts the workflow metadata row and inserts (or replaces) a workflow_versions row.
pub fn save_workflow(db: &Db, wf: &WorkflowDefinition) -> Result<(), RepoError> {
    db.conn().execute(
        "INSERT INTO workflows (workflow_id, name, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(workflow_id) DO UPDATE SET
             name = excluded.name,
             updated_at = excluded.updated_at",
        params![
            wf.workflow_id.to_string(),
            wf.name,
            wf.created_at.to_rfc3339(),
            wf.updated_at.to_rfc3339(),
        ],
    )?;
    save_workflow_version(db, wf)
}

/// Insert a versioned snapshot of a WorkflowDefinition into workflow_versions.
pub fn save_workflow_version(db: &Db, wf: &WorkflowDefinition) -> Result<(), RepoError> {
    let json = serde_json::to_string(wf)?;
    db.conn().execute(
        "INSERT INTO workflow_versions (workflow_id, version, definition_json, created_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(workflow_id, version) DO UPDATE SET
             definition_json = excluded.definition_json",
        params![
            wf.workflow_id.to_string(),
            wf.version,
            json,
            wf.created_at.to_rfc3339(),
        ],
    )?;
    Ok(())
}

/// Retrieve the latest version of a workflow by its UUID.
pub fn get_workflow_by_id(db: &Db, id: Uuid) -> Result<Option<WorkflowDefinition>, RepoError> {
    let mut stmt = db.conn().prepare(
        "SELECT definition_json FROM workflow_versions
         WHERE workflow_id = ?1
         ORDER BY version DESC
         LIMIT 1",
    )?;
    let mut rows = stmt.query_map(params![id.to_string()], |row| row.get::<_, String>(0))?;
    match rows.next() {
        Some(Ok(json)) => Ok(Some(serde_json::from_str(&json)?)),
        Some(Err(e)) => Err(RepoError::Sqlite(e)),
        None => Ok(None),
    }
}

/// Retrieve all stored workflows (latest version of each), ordered by most recently created.
pub fn list_workflows(db: &Db) -> Result<Vec<WorkflowDefinition>, RepoError> {
    let mut stmt = db.conn().prepare(
        "SELECT wv.definition_json
         FROM workflow_versions wv
         INNER JOIN (
             SELECT workflow_id, MAX(version) AS max_version
             FROM workflow_versions
             GROUP BY workflow_id
         ) latest ON wv.workflow_id = latest.workflow_id AND wv.version = latest.max_version
         ORDER BY wv.created_at DESC",
    )?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    let mut result = Vec::new();
    for row in rows {
        result.push(serde_json::from_str(&row?)?);
    }
    Ok(result)
}

/// Delete a workflow and all its versions by UUID.
pub fn delete_workflow(db: &Db, id: Uuid) -> Result<(), RepoError> {
    let id_str = id.to_string();
    // Delete versions first (FK references workflows)
    db.conn().execute(
        "DELETE FROM workflow_versions WHERE workflow_id = ?1",
        params![id_str],
    )?;
    db.conn().execute(
        "DELETE FROM workflows WHERE workflow_id = ?1",
        params![id_str],
    )?;
    Ok(())
}

/// Retrieve a specific version of a workflow.
pub fn get_workflow_version(
    db: &Db,
    workflow_id: Uuid,
    version: u32,
) -> Result<Option<WorkflowDefinition>, RepoError> {
    let mut stmt = db.conn().prepare(
        "SELECT definition_json FROM workflow_versions
         WHERE workflow_id = ?1 AND version = ?2",
    )?;
    let mut rows =
        stmt.query_map(params![workflow_id.to_string(), version], |row| row.get::<_, String>(0))?;
    match rows.next() {
        Some(Ok(json)) => Ok(Some(serde_json::from_str(&json)?)),
        Some(Err(e)) => Err(RepoError::Sqlite(e)),
        None => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use workflow_model::workflow::WorkflowDefinition;

    fn make_workflow(name: &str, version: u32) -> WorkflowDefinition {
        WorkflowDefinition {
            workflow_id: Uuid::new_v4(),
            name: name.to_string(),
            schema_version: workflow_model::workflow::CURRENT_SCHEMA_VERSION,
            version,
            metadata: serde_json::Value::Null,
            nodes: vec![],
            edges: vec![],
            default_constraints: serde_json::Value::Null,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    #[test]
    fn save_and_get_workflow() {
        let db = Db::open_in_memory().expect("in-memory db");
        let wf = make_workflow("test-wf", 1);
        save_workflow(&db, &wf).expect("save_workflow");

        let retrieved = get_workflow_by_id(&db, wf.workflow_id)
            .expect("get_workflow_by_id")
            .expect("should exist");

        assert_eq!(retrieved.workflow_id, wf.workflow_id);
        assert_eq!(retrieved.name, wf.name);
        assert_eq!(retrieved.version, wf.version);
    }

    #[test]
    fn get_workflow_by_id_missing_returns_none() {
        let db = Db::open_in_memory().expect("in-memory db");
        let result = get_workflow_by_id(&db, Uuid::new_v4()).expect("query ok");
        assert!(result.is_none());
    }

    #[test]
    fn list_workflows_returns_all() {
        let db = Db::open_in_memory().expect("in-memory db");
        let wf1 = make_workflow("alpha", 1);
        let wf2 = make_workflow("beta", 1);
        save_workflow(&db, &wf1).expect("save wf1");
        save_workflow(&db, &wf2).expect("save wf2");

        let list = list_workflows(&db).expect("list_workflows");
        assert_eq!(list.len(), 2);
        let names: Vec<&str> = list.iter().map(|w| w.name.as_str()).collect();
        assert!(names.contains(&"alpha"));
        assert!(names.contains(&"beta"));
    }

    #[test]
    fn versioning_tracks_multiple_versions() {
        let db = Db::open_in_memory().expect("in-memory db");
        let wf_v1 = make_workflow("versioned", 1);
        save_workflow(&db, &wf_v1).expect("save v1");

        let mut wf_v2 = wf_v1.clone();
        wf_v2.version = 2;
        wf_v2.name = "versioned-updated".to_string();
        save_workflow_version(&db, &wf_v2).expect("save v2");

        // get_workflow_by_id returns the latest (v2)
        let latest = get_workflow_by_id(&db, wf_v1.workflow_id)
            .expect("query")
            .expect("exists");
        assert_eq!(latest.version, 2);
        assert_eq!(latest.name, "versioned-updated");

        // get_workflow_version returns v1
        let v1 = get_workflow_version(&db, wf_v1.workflow_id, 1)
            .expect("query")
            .expect("exists");
        assert_eq!(v1.version, 1);
        assert_eq!(v1.name, "versioned");

        // list_workflows returns only 1 entry (latest version)
        let list = list_workflows(&db).expect("list");
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].version, 2);
    }

    #[test]
    fn get_workflow_version_missing_returns_none() {
        let db = Db::open_in_memory().expect("in-memory db");
        let wf = make_workflow("test", 1);
        save_workflow(&db, &wf).expect("save");

        let missing = get_workflow_version(&db, wf.workflow_id, 99).expect("query");
        assert!(missing.is_none());
    }

    #[test]
    fn delete_workflow_removes_workflow_and_versions() {
        let db = Db::open_in_memory().expect("in-memory db");
        let wf = make_workflow("to-delete", 1);
        save_workflow(&db, &wf).expect("save");

        // Confirm it exists
        assert!(get_workflow_by_id(&db, wf.workflow_id).expect("query").is_some());

        delete_workflow(&db, wf.workflow_id).expect("delete");

        // Confirm it's gone
        assert!(get_workflow_by_id(&db, wf.workflow_id).expect("query").is_none());
        let list = list_workflows(&db).expect("list");
        assert!(list.is_empty());
    }
}
