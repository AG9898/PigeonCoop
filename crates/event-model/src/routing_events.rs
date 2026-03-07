use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Payload structs
// ---------------------------------------------------------------------------

/// Payload for `edge.routed` — an edge was traversed to activate a downstream node.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EdgeRoutedPayload {
    pub edge_id: String,
    pub source_node_id: String,
    pub target_node_id: String,
}

/// Payload for `router.evaluated` — a router node finished evaluating its rules.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouterEvaluatedPayload {
    pub router_node_id: String,
    /// Number of candidate edges that were tested.
    pub candidates_evaluated: u32,
}

/// Payload for `router.branch_selected` — a router chose one or more outgoing edges.
/// See EVENT_SCHEMA.md §4.4.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouterBranchSelectedPayload {
    pub router_node_id: String,
    pub selected_edge_ids: Vec<String>,
    /// Human-readable explanation of why this branch was selected.
    pub reason: String,
}

/// Payload for `router.no_match` — no edge condition matched; execution halts or fails.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouterNoMatchPayload {
    pub router_node_id: String,
    /// Optional human-readable context about why no branch matched.
    pub reason: Option<String>,
}

// ---------------------------------------------------------------------------
// Typed discriminant enum
// ---------------------------------------------------------------------------

/// Typed discriminant for all routing events. See EVENT_SCHEMA.md §3.4.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "event_type", content = "payload", rename_all = "snake_case")]
pub enum RoutingEventKind {
    #[serde(rename = "edge.routed")]
    EdgeRouted(EdgeRoutedPayload),
    #[serde(rename = "router.evaluated")]
    RouterEvaluated(RouterEvaluatedPayload),
    #[serde(rename = "router.branch_selected")]
    RouterBranchSelected(RouterBranchSelectedPayload),
    #[serde(rename = "router.no_match")]
    RouterNoMatch(RouterNoMatchPayload),
}

impl RoutingEventKind {
    /// Returns the canonical event_type string for this variant.
    pub fn event_type_str(&self) -> &'static str {
        match self {
            RoutingEventKind::EdgeRouted(_) => "edge.routed",
            RoutingEventKind::RouterEvaluated(_) => "router.evaluated",
            RoutingEventKind::RouterBranchSelected(_) => "router.branch_selected",
            RoutingEventKind::RouterNoMatch(_) => "router.no_match",
        }
    }

    /// Serialise the inner payload to a `serde_json::Value`.
    pub fn payload_value(&self) -> serde_json::Value {
        match self {
            RoutingEventKind::EdgeRouted(p) => serde_json::to_value(p),
            RoutingEventKind::RouterEvaluated(p) => serde_json::to_value(p),
            RoutingEventKind::RouterBranchSelected(p) => serde_json::to_value(p),
            RoutingEventKind::RouterNoMatch(p) => serde_json::to_value(p),
        }
        .unwrap_or(serde_json::Value::Null)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_four_variants_serialize() {
        let variants: Vec<RoutingEventKind> = vec![
            RoutingEventKind::EdgeRouted(EdgeRoutedPayload {
                edge_id: "edge_ok".into(),
                source_node_id: "node_router_1".into(),
                target_node_id: "node_tool_1".into(),
            }),
            RoutingEventKind::RouterEvaluated(RouterEvaluatedPayload {
                router_node_id: "node_router_1".into(),
                candidates_evaluated: 2,
            }),
            RoutingEventKind::RouterBranchSelected(RouterBranchSelectedPayload {
                router_node_id: "node_router_1".into(),
                selected_edge_ids: vec!["edge_ok".into()],
                reason: "exit_code == 0".into(),
            }),
            RoutingEventKind::RouterNoMatch(RouterNoMatchPayload {
                router_node_id: "node_router_1".into(),
                reason: Some("no condition matched exit_code 2".into()),
            }),
        ];

        assert_eq!(variants.len(), 4);
        for v in &variants {
            serde_json::to_string(v).expect("variant should serialize");
        }
    }

    #[test]
    fn branch_selected_payload_matches_schema() {
        // Verify §4.4 field names are present in serialized output.
        let kind = RoutingEventKind::RouterBranchSelected(RouterBranchSelectedPayload {
            router_node_id: "node_router_1".into(),
            selected_edge_ids: vec!["edge_ok".into()],
            reason: "exit_code == 0".into(),
        });
        let payload = kind.payload_value();
        assert_eq!(payload["router_node_id"], "node_router_1");
        assert_eq!(payload["selected_edge_ids"][0], "edge_ok");
        assert_eq!(payload["reason"], "exit_code == 0");
    }

    #[test]
    fn event_type_str_matches_serde_tag() {
        let variants: Vec<RoutingEventKind> = vec![
            RoutingEventKind::EdgeRouted(EdgeRoutedPayload {
                edge_id: "e1".into(),
                source_node_id: "n1".into(),
                target_node_id: "n2".into(),
            }),
            RoutingEventKind::RouterEvaluated(RouterEvaluatedPayload {
                router_node_id: "n1".into(),
                candidates_evaluated: 1,
            }),
            RoutingEventKind::RouterBranchSelected(RouterBranchSelectedPayload {
                router_node_id: "n1".into(),
                selected_edge_ids: vec!["e1".into()],
                reason: "true".into(),
            }),
            RoutingEventKind::RouterNoMatch(RouterNoMatchPayload {
                router_node_id: "n1".into(),
                reason: None,
            }),
        ];

        for kind in &variants {
            let v: serde_json::Value = serde_json::to_value(kind).unwrap();
            assert_eq!(v["event_type"].as_str().unwrap(), kind.event_type_str());
        }
    }

    #[test]
    fn branch_selected_round_trip() {
        let kind = RoutingEventKind::RouterBranchSelected(RouterBranchSelectedPayload {
            router_node_id: "node_router_1".into(),
            selected_edge_ids: vec!["edge_ok".into(), "edge_warn".into()],
            reason: "exit_code == 0".into(),
        });
        let json = serde_json::to_string(&kind).unwrap();
        let back: RoutingEventKind = serde_json::from_str(&json).unwrap();
        match back {
            RoutingEventKind::RouterBranchSelected(p) => {
                assert_eq!(p.router_node_id, "node_router_1");
                assert_eq!(p.selected_edge_ids, vec!["edge_ok", "edge_warn"]);
                assert_eq!(p.reason, "exit_code == 0");
            }
            other => panic!("unexpected variant: {:?}", other),
        }
    }

    #[test]
    fn no_match_with_none_reason_serializes() {
        let kind = RoutingEventKind::RouterNoMatch(RouterNoMatchPayload {
            router_node_id: "node_router_1".into(),
            reason: None,
        });
        let payload = kind.payload_value();
        assert!(payload["reason"].is_null());
    }
}
