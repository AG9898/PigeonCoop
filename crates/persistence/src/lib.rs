// persistence: SQLite-backed storage for workflows, runs, and events.
// Event log is append-only. See ARCHITECTURE.md §11.

pub mod sqlite;
pub mod repositories;
