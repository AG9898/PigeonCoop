use serde::{Deserialize, Serialize};

/// Payload for `command.prepared` — command has been built and is ready to dispatch.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandPreparedPayload {
    pub command: String,
    pub shell: String,
    pub cwd: String,
    pub timeout_ms: Option<u64>,
}

/// Payload for `command.started` — command process has been launched.
/// See EVENT_SCHEMA.md §4.2.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandStartedPayload {
    pub command: String,
    pub shell: String,
    pub cwd: String,
    pub timeout_ms: Option<u64>,
}

/// Payload for `command.stdout` — a chunk of stdout was received.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandStdoutPayload {
    /// Raw stdout chunk as a UTF-8 string (lossy). May be partial line.
    pub chunk: String,
    pub byte_offset: u64,
}

/// Payload for `command.stderr` — a chunk of stderr was received.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandStderrPayload {
    /// Raw stderr chunk as a UTF-8 string (lossy). May be partial line.
    pub chunk: String,
    pub byte_offset: u64,
}

/// Payload for `command.completed` — command exited successfully (exit_code == 0)
/// or with a non-zero code that was not treated as a fatal error.
/// See EVENT_SCHEMA.md §4.3.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandCompletedPayload {
    pub exit_code: i32,
    pub duration_ms: u64,
    pub stdout_bytes: u64,
    pub stderr_bytes: u64,
}

/// Payload for `command.failed` — command could not be started, timed out, or
/// was killed before producing a clean exit.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandFailedPayload {
    pub reason: String,
    /// Exit code if the process did exit; None if it was killed or never started.
    pub exit_code: Option<i32>,
    pub duration_ms: Option<u64>,
    pub stdout_bytes: u64,
    pub stderr_bytes: u64,
}

/// Typed discriminant for all command/tool execution events.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "event_type", content = "payload", rename_all = "snake_case")]
pub enum CommandEventKind {
    #[serde(rename = "command.prepared")]
    Prepared(CommandPreparedPayload),
    #[serde(rename = "command.started")]
    Started(CommandStartedPayload),
    #[serde(rename = "command.stdout")]
    Stdout(CommandStdoutPayload),
    #[serde(rename = "command.stderr")]
    Stderr(CommandStderrPayload),
    #[serde(rename = "command.completed")]
    Completed(CommandCompletedPayload),
    #[serde(rename = "command.failed")]
    Failed(CommandFailedPayload),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_prepared_round_trip() {
        let p = CommandPreparedPayload {
            command: "npm test".into(),
            shell: "bash".into(),
            cwd: "/repo".into(),
            timeout_ms: Some(300_000),
        };
        let json = serde_json::to_string(&p).unwrap();
        let back: CommandPreparedPayload = serde_json::from_str(&json).unwrap();
        assert_eq!(back.command, "npm test");
        assert_eq!(back.timeout_ms, Some(300_000));
    }

    #[test]
    fn command_started_payload_fields() {
        let p = CommandStartedPayload {
            command: "cargo build".into(),
            shell: "bash".into(),
            cwd: "/workspace".into(),
            timeout_ms: Some(60_000),
        };
        let v: serde_json::Value = serde_json::to_value(&p).unwrap();
        assert_eq!(v["command"], "cargo build");
        assert_eq!(v["shell"], "bash");
        assert_eq!(v["cwd"], "/workspace");
        assert_eq!(v["timeout_ms"], 60_000);
    }

    #[test]
    fn command_completed_payload_fields() {
        let p = CommandCompletedPayload {
            exit_code: 0,
            duration_ms: 4_123,
            stdout_bytes: 12_044,
            stderr_bytes: 0,
        };
        let v: serde_json::Value = serde_json::to_value(&p).unwrap();
        assert_eq!(v["exit_code"], 0);
        assert_eq!(v["duration_ms"], 4_123);
        assert_eq!(v["stdout_bytes"], 12_044);
        assert_eq!(v["stderr_bytes"], 0);
    }

    #[test]
    fn command_failed_optional_exit_code() {
        let p = CommandFailedPayload {
            reason: "timed out".into(),
            exit_code: None,
            duration_ms: Some(300_001),
            stdout_bytes: 0,
            stderr_bytes: 0,
        };
        let json = serde_json::to_string(&p).unwrap();
        let back: CommandFailedPayload = serde_json::from_str(&json).unwrap();
        assert!(back.exit_code.is_none());
        assert_eq!(back.reason, "timed out");
    }

    #[test]
    fn command_event_kind_serializes_with_tag() {
        let event = CommandEventKind::Completed(CommandCompletedPayload {
            exit_code: 0,
            duration_ms: 100,
            stdout_bytes: 50,
            stderr_bytes: 0,
        });
        let v: serde_json::Value = serde_json::to_value(&event).unwrap();
        assert_eq!(v["event_type"], "command.completed");
        assert_eq!(v["payload"]["exit_code"], 0);
    }

    #[test]
    fn all_six_variants_serialize() {
        let variants: Vec<CommandEventKind> = vec![
            CommandEventKind::Prepared(CommandPreparedPayload {
                command: "ls".into(),
                shell: "sh".into(),
                cwd: "/".into(),
                timeout_ms: None,
            }),
            CommandEventKind::Started(CommandStartedPayload {
                command: "ls".into(),
                shell: "sh".into(),
                cwd: "/".into(),
                timeout_ms: None,
            }),
            CommandEventKind::Stdout(CommandStdoutPayload {
                chunk: "output".into(),
                byte_offset: 0,
            }),
            CommandEventKind::Stderr(CommandStderrPayload {
                chunk: "err".into(),
                byte_offset: 0,
            }),
            CommandEventKind::Completed(CommandCompletedPayload {
                exit_code: 0,
                duration_ms: 10,
                stdout_bytes: 6,
                stderr_bytes: 3,
            }),
            CommandEventKind::Failed(CommandFailedPayload {
                reason: "killed".into(),
                exit_code: Some(137),
                duration_ms: None,
                stdout_bytes: 0,
                stderr_bytes: 0,
            }),
        ];
        assert_eq!(variants.len(), 6);
        for v in &variants {
            serde_json::to_string(v).expect("variant should serialize");
        }
    }
}
