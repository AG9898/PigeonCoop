// Key-value settings repository.
// Stores user preferences and workspace configuration as JSON values.
// Each key is unique; set_setting uses INSERT OR REPLACE (upsert).

use rusqlite::params;
use thiserror::Error;

use crate::sqlite::Db;

#[derive(Debug, Error)]
pub enum SettingsRepoError {
    #[error("SQLite error: {0}")]
    Sqlite(#[from] rusqlite::Error),

    #[error("JSON serialization error: {0}")]
    Json(#[from] serde_json::Error),
}

/// Repository for the key-value settings table.
pub struct SettingsRepository<'db> {
    db: &'db Db,
}

impl<'db> SettingsRepository<'db> {
    pub fn new(db: &'db Db) -> Self {
        Self { db }
    }

    /// Retrieve the JSON value stored under `key`.
    /// Returns `None` if the key does not exist.
    pub fn get_setting(&self, key: &str) -> Result<Option<serde_json::Value>, SettingsRepoError> {
        let conn = self.db.conn();
        let mut stmt =
            conn.prepare("SELECT value_json FROM settings WHERE key = ?1")?;

        let mut rows = stmt.query_map(params![key], |row| row.get::<_, String>(0))?;

        match rows.next() {
            Some(result) => {
                let json_str = result?;
                let value = serde_json::from_str(&json_str)?;
                Ok(Some(value))
            }
            None => Ok(None),
        }
    }

    /// Insert or replace the value for `key`.
    /// `value` is any JSON-serializable type.
    pub fn set_setting(
        &self,
        key: &str,
        value: &serde_json::Value,
    ) -> Result<(), SettingsRepoError> {
        let conn = self.db.conn();
        let json_str = serde_json::to_string(value)?;
        let now = chrono::Utc::now().to_rfc3339();

        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value_json, updated_at) \
             VALUES (?1, ?2, ?3)",
            params![key, json_str, now],
        )?;

        Ok(())
    }

    /// Return all settings as (key, value) pairs, ordered by key.
    pub fn list_settings(
        &self,
    ) -> Result<Vec<(String, serde_json::Value)>, SettingsRepoError> {
        let conn = self.db.conn();
        let mut stmt =
            conn.prepare("SELECT key, value_json FROM settings ORDER BY key ASC")?;

        let rows = stmt.query_map([], |row| {
            let key: String = row.get(0)?;
            let json_str: String = row.get(1)?;
            Ok((key, json_str))
        })?;

        let mut results = Vec::new();
        for row in rows {
            let (key, json_str) = row?;
            let value = serde_json::from_str(&json_str)?;
            results.push((key, value));
        }

        Ok(results)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sqlite::Db;
    use serde_json::json;

    #[test]
    fn get_setting_returns_none_for_unknown_key() {
        let db = Db::open_in_memory().unwrap();
        let repo = SettingsRepository::new(&db);
        let result = repo.get_setting("nonexistent").unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn set_and_get_setting_roundtrip() {
        let db = Db::open_in_memory().unwrap();
        let repo = SettingsRepository::new(&db);

        repo.set_setting("default_workspace", &json!("/home/user/projects")).unwrap();
        let value = repo.get_setting("default_workspace").unwrap();
        assert_eq!(value, Some(json!("/home/user/projects")));
    }

    #[test]
    fn set_setting_overwrites_existing_value() {
        let db = Db::open_in_memory().unwrap();
        let repo = SettingsRepository::new(&db);

        repo.set_setting("theme", &json!("dark")).unwrap();
        repo.set_setting("theme", &json!("light")).unwrap();

        let value = repo.get_setting("theme").unwrap();
        assert_eq!(value, Some(json!("light")));
    }

    #[test]
    fn list_settings_returns_all_entries_ordered_by_key() {
        let db = Db::open_in_memory().unwrap();
        let repo = SettingsRepository::new(&db);

        repo.set_setting("zoom_level", &json!(1.5)).unwrap();
        repo.set_setting("default_workspace", &json!("/projects")).unwrap();
        repo.set_setting("theme", &json!("dark")).unwrap();

        let list = repo.list_settings().unwrap();
        assert_eq!(list.len(), 3);
        // Ordered by key
        assert_eq!(list[0].0, "default_workspace");
        assert_eq!(list[1].0, "theme");
        assert_eq!(list[2].0, "zoom_level");
    }

    #[test]
    fn list_settings_empty_when_no_entries() {
        let db = Db::open_in_memory().unwrap();
        let repo = SettingsRepository::new(&db);
        let list = repo.list_settings().unwrap();
        assert!(list.is_empty());
    }

    #[test]
    fn settings_support_complex_json_values() {
        let db = Db::open_in_memory().unwrap();
        let repo = SettingsRepository::new(&db);

        let complex = json!({
            "recent_workspaces": ["/home/user/proj1", "/home/user/proj2"],
            "ui": { "sidebar_width": 280, "show_minimap": true }
        });

        repo.set_setting("app_state", &complex).unwrap();
        let result = repo.get_setting("app_state").unwrap().unwrap();
        assert_eq!(result, complex);
    }
}
