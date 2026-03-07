-- Migration 001: initial schema
-- Creates all core tables for Agent Arcade persistence.

CREATE TABLE IF NOT EXISTS migrations (
    version     INTEGER PRIMARY KEY,
    applied_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workflows (
    workflow_id TEXT    PRIMARY KEY,
    name        TEXT    NOT NULL,
    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS workflow_versions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    workflow_id     TEXT    NOT NULL REFERENCES workflows(workflow_id),
    version         INTEGER NOT NULL,
    definition_json TEXT    NOT NULL,
    created_at      TEXT    NOT NULL,
    UNIQUE(workflow_id, version)
);

CREATE TABLE IF NOT EXISTS runs (
    run_id           TEXT PRIMARY KEY,
    workflow_id      TEXT NOT NULL REFERENCES workflows(workflow_id),
    workflow_version INTEGER NOT NULL,
    status           TEXT NOT NULL,
    workspace_root   TEXT NOT NULL,
    created_at       TEXT NOT NULL,
    started_at       TEXT,
    ended_at         TEXT,
    summary_json     TEXT
);

CREATE TABLE IF NOT EXISTS events (
    event_id        TEXT    PRIMARY KEY,
    run_id          TEXT    NOT NULL REFERENCES runs(run_id),
    workflow_id     TEXT    NOT NULL,
    node_id         TEXT,
    event_type      TEXT    NOT NULL,
    timestamp       TEXT    NOT NULL,
    payload_json    TEXT    NOT NULL,
    causation_id    TEXT,
    correlation_id  TEXT,
    sequence        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS events_run_id_sequence ON events(run_id, sequence);

CREATE TABLE IF NOT EXISTS settings (
    key         TEXT PRIMARY KEY,
    value_json  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artifacts (
    artifact_id TEXT    PRIMARY KEY,
    run_id      TEXT    NOT NULL REFERENCES runs(run_id),
    node_id     TEXT,
    kind        TEXT    NOT NULL,
    path        TEXT,
    content     BLOB,
    created_at  TEXT    NOT NULL
);
