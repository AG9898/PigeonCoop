use serde::{Deserialize, Serialize};

/// Memory scope — matches the v1 scopes defined in CLAUDE.md.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryScope {
    RunShared,
    NodeLocal,
}

/// Payload for `memory.read` — a key was read from the shared memory store.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryReadPayload {
    pub scope: MemoryScope,
    pub key: String,
    /// True if the key was present; false if a miss.
    pub found: bool,
}

/// Payload for `memory.write` — a key was written to the shared memory store.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryWritePayload {
    pub scope: MemoryScope,
    pub key: String,
    /// Human-readable description of the value type, e.g. "string", "json".
    pub value_type: String,
    /// Approximate size of the written value in bytes.
    pub value_bytes: u64,
}

/// Payload for `memory.snapshot_created` — a full memory snapshot was captured
/// for replay or checkpoint purposes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemorySnapshotCreatedPayload {
    pub scope: MemoryScope,
    /// Number of keys in the snapshot.
    pub key_count: usize,
    /// Total size of all values in the snapshot.
    pub total_bytes: u64,
}

/// Typed discriminant for all memory events.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "event_type", content = "payload", rename_all = "snake_case")]
pub enum MemoryEventKind {
    #[serde(rename = "memory.read")]
    Read(MemoryReadPayload),
    #[serde(rename = "memory.write")]
    Write(MemoryWritePayload),
    #[serde(rename = "memory.snapshot_created")]
    SnapshotCreated(MemorySnapshotCreatedPayload),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn memory_read_hit_round_trip() {
        let p = MemoryReadPayload {
            scope: MemoryScope::RunShared,
            key: "task_brief".into(),
            found: true,
        };
        let json = serde_json::to_string(&p).unwrap();
        let back: MemoryReadPayload = serde_json::from_str(&json).unwrap();
        assert_eq!(back.key, "task_brief");
        assert!(back.found);
    }

    #[test]
    fn memory_read_miss() {
        let p = MemoryReadPayload {
            scope: MemoryScope::NodeLocal,
            key: "missing_key".into(),
            found: false,
        };
        let v: serde_json::Value = serde_json::to_value(&p).unwrap();
        assert_eq!(v["found"], false);
        assert_eq!(v["key"], "missing_key");
    }

    #[test]
    fn memory_write_round_trip() {
        let p = MemoryWritePayload {
            scope: MemoryScope::RunShared,
            key: "plan_output".into(),
            value_type: "json".into(),
            value_bytes: 1024,
        };
        let json = serde_json::to_string(&p).unwrap();
        let back: MemoryWritePayload = serde_json::from_str(&json).unwrap();
        assert_eq!(back.key, "plan_output");
        assert_eq!(back.value_bytes, 1024);
    }

    #[test]
    fn memory_snapshot_created_round_trip() {
        let p = MemorySnapshotCreatedPayload {
            scope: MemoryScope::RunShared,
            key_count: 5,
            total_bytes: 8192,
        };
        let json = serde_json::to_string(&p).unwrap();
        let back: MemorySnapshotCreatedPayload = serde_json::from_str(&json).unwrap();
        assert_eq!(back.key_count, 5);
        assert_eq!(back.total_bytes, 8192);
    }

    #[test]
    fn memory_event_kind_serializes_with_tag() {
        let event = MemoryEventKind::Write(MemoryWritePayload {
            scope: MemoryScope::RunShared,
            key: "output".into(),
            value_type: "string".into(),
            value_bytes: 42,
        });
        let v: serde_json::Value = serde_json::to_value(&event).unwrap();
        assert_eq!(v["event_type"], "memory.write");
        assert_eq!(v["payload"]["key"], "output");
    }

    #[test]
    fn all_three_variants_serialize() {
        let variants: Vec<MemoryEventKind> = vec![
            MemoryEventKind::Read(MemoryReadPayload {
                scope: MemoryScope::RunShared,
                key: "k".into(),
                found: true,
            }),
            MemoryEventKind::Write(MemoryWritePayload {
                scope: MemoryScope::NodeLocal,
                key: "k".into(),
                value_type: "string".into(),
                value_bytes: 10,
            }),
            MemoryEventKind::SnapshotCreated(MemorySnapshotCreatedPayload {
                scope: MemoryScope::RunShared,
                key_count: 3,
                total_bytes: 300,
            }),
        ];
        assert_eq!(variants.len(), 3);
        for v in &variants {
            serde_json::to_string(v).expect("variant should serialize");
        }
    }
}
