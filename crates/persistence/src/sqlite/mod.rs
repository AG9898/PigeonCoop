// SQLite connection setup and migrations.

use rusqlite::Connection;
use std::path::Path;
use thiserror::Error;

/// Versioned, embedded migrations. Each tuple is (version, sql).
/// Migrations run in version order and are idempotent — the `migrations` table
/// tracks which versions have already been applied.
static MIGRATIONS: &[(u32, &str)] = &[(
    1,
    include_str!("../../migrations/001_initial_schema.sql"),
)];

#[derive(Debug, Error)]
pub enum DbError {
    #[error("SQLite error: {0}")]
    Sqlite(#[from] rusqlite::Error),

    #[error("Migration error: {0}")]
    Migration(String),
}

/// Connection wrapper used by all repository modules.
pub struct Db {
    conn: Connection,
}

impl Db {
    /// Open (or create) a database file at `path` and run pending migrations.
    pub fn open<P: AsRef<Path>>(path: P) -> Result<Self, DbError> {
        let conn = Connection::open(path)?;
        let mut db = Db { conn };
        db.run_migrations()?;
        Ok(db)
    }

    /// Open an in-memory database and run all migrations.
    /// Use this in unit tests — never hit a real file.
    pub fn open_in_memory() -> Result<Self, DbError> {
        let conn = Connection::open_in_memory()?;
        let mut db = Db { conn };
        db.run_migrations()?;
        Ok(db)
    }

    /// Expose the raw connection for repository modules within this crate.
    #[allow(dead_code)]
    pub(crate) fn conn(&self) -> &Connection {
        &self.conn
    }

    /// Run all pending versioned migrations in order.
    /// Already-applied versions are skipped (idempotent).
    fn run_migrations(&mut self) -> Result<(), DbError> {
        // Bootstrap the migrations tracking table if it doesn't exist yet.
        self.conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS migrations (
                version     INTEGER PRIMARY KEY,
                applied_at  TEXT NOT NULL
            );",
        )?;

        for (version, sql) in MIGRATIONS {
            let already_applied: bool = self.conn.query_row(
                "SELECT COUNT(*) FROM migrations WHERE version = ?1",
                [version],
                |row| row.get::<_, u32>(0),
            )? > 0;

            if already_applied {
                continue;
            }

            self.conn.execute_batch(sql).map_err(|e| {
                DbError::Migration(format!("migration v{version} failed: {e}"))
            })?;

            self.conn.execute(
                "INSERT INTO migrations (version, applied_at) VALUES (?1, ?2)",
                rusqlite::params![version, chrono::Utc::now().to_rfc3339()],
            )?;
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tables(db: &Db) -> Vec<String> {
        let mut stmt = db
            .conn()
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .unwrap();
        stmt.query_map([], |row| row.get(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect()
    }

    #[test]
    fn open_in_memory_creates_all_tables() {
        let db = Db::open_in_memory().expect("in-memory db");
        let t = tables(&db);
        for name in &[
            "artifacts",
            "events",
            "migrations",
            "runs",
            "settings",
            "workflow_versions",
            "workflows",
        ] {
            assert!(t.contains(&name.to_string()), "missing table: {name}");
        }
    }

    #[test]
    fn migrations_are_idempotent() {
        let mut db = Db::open_in_memory().expect("in-memory db");
        // Running migrations a second time must not fail.
        db.run_migrations().expect("re-running migrations");

        let count: u32 = db
            .conn()
            .query_row("SELECT COUNT(*) FROM migrations", [], |r| r.get(0))
            .unwrap();
        // Each migration version recorded exactly once.
        assert_eq!(count as usize, MIGRATIONS.len());
    }

    #[test]
    fn open_file_db_creates_file() {
        let path = std::env::temp_dir().join("pigeoncoupe_test_persist_001.sqlite");
        let _ = std::fs::remove_file(&path); // clean slate
        let db = Db::open(&path).expect("file db");
        let t = tables(&db);
        assert!(t.contains(&"workflows".to_string()));
        drop(db);
        let _ = std::fs::remove_file(&path);
    }
}
