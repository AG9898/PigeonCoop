/// Tests for the RunEvent envelope (event.rs).
///
/// Covers:
/// - Required envelope fields (event_id, run_id, workflow_id, timestamp) always present
/// - Optional fields (node_id, causation_id, correlation_id) handled as Option
/// - All `from_*_kind()` constructors populate event_type and payload from the typed kind
/// - Full round-trip JSON serialization through the RunEvent envelope for every family
use crate::agent_events::{AgentCompletedPayload, AgentEventKind};
use crate::command_events::{CommandCompletedPayload, CommandEventKind};
use crate::event::RunEvent;
use crate::guardrail_events::{
    BudgetResource, BudgetUpdatedPayload, GuardrailEventKind, GuardrailExceededPayload,
    GuardrailSeverity, GuardrailWarningPayload,
};
use crate::human_review_events::{HumanReviewEventKind, ReviewApprovedPayload};
use crate::memory_events::{MemoryEventKind, MemoryReadPayload, MemoryScope};
use crate::node_events::{NodeEventKind, NodeSucceededPayload};
use crate::routing_events::{RoutingEventKind, RouterBranchSelectedPayload};
use crate::run_events::{RunCreatedPayload, RunEventKind, RunSucceededPayload};
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn ids() -> (Uuid, Uuid, Uuid) {
    (Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4())
}

// ---------------------------------------------------------------------------
// Envelope field contract tests
// ---------------------------------------------------------------------------

#[test]
fn run_event_required_fields_always_present() {
    let (run_id, workflow_id, wf_id2) = ids();
    let kind = RunEventKind::Created(RunCreatedPayload {
        workflow_id: wf_id2,
        workflow_version: 1,
        workspace_root: "/repo".into(),
    });
    let ev = RunEvent::from_run_kind(run_id, workflow_id, &kind, None, None);

    // event_id is a fresh Uuid (not nil)
    assert_ne!(ev.event_id, Uuid::nil());
    // run_id and workflow_id are preserved
    assert_eq!(ev.run_id, run_id);
    assert_eq!(ev.workflow_id, workflow_id);
    // event_type is populated
    assert!(!ev.event_type.is_empty());
    // timestamp is not the epoch (i.e. it was set to Utc::now())
    assert!(ev.timestamp.timestamp() > 0);
    // payload is not null
    assert!(!ev.payload.is_null());
}

#[test]
fn run_event_optional_fields_default_to_none() {
    let (run_id, workflow_id, _) = ids();
    let kind = RunEventKind::Started(crate::run_events::RunStartedPayload { node_count: 3 });
    let ev = RunEvent::from_run_kind(run_id, workflow_id, &kind, None, None);

    assert!(ev.node_id.is_none());
    assert!(ev.causation_id.is_none());
    assert!(ev.correlation_id.is_none());
}

#[test]
fn run_event_causation_and_correlation_propagated() {
    let (run_id, workflow_id, _) = ids();
    let causation = Uuid::new_v4();
    let correlation = Uuid::new_v4();
    let kind = RunEventKind::Succeeded(RunSucceededPayload {
        duration_ms: 1000,
        steps_executed: 4,
    });
    let ev = RunEvent::from_run_kind(run_id, workflow_id, &kind, Some(causation), Some(correlation));

    assert_eq!(ev.causation_id, Some(causation));
    assert_eq!(ev.correlation_id, Some(correlation));
}

#[test]
fn from_node_kind_sets_node_id() {
    let (run_id, workflow_id, node_id) = ids();
    let kind = NodeEventKind::Succeeded(NodeSucceededPayload {
        attempt: 1,
        duration_ms: 500,
    });
    let ev = RunEvent::from_node_kind(run_id, workflow_id, node_id, &kind, None, None);

    assert_eq!(ev.node_id, Some(node_id));
    assert_eq!(ev.event_type, "node.succeeded");
}

#[test]
fn from_review_kind_sets_node_id() {
    let (run_id, workflow_id, node_id) = ids();
    let kind = HumanReviewEventKind::Approved(ReviewApprovedPayload { comment: None });
    let ev = RunEvent::from_review_kind(run_id, workflow_id, node_id, &kind, None, None);

    assert_eq!(ev.node_id, Some(node_id));
    assert_eq!(ev.event_type, "review.approved");
}

#[test]
fn from_routing_kind_without_node_id() {
    let (run_id, workflow_id, _) = ids();
    let kind = RoutingEventKind::RouterBranchSelected(RouterBranchSelectedPayload {
        router_node_id: "n1".into(),
        selected_edge_ids: vec!["e1".into()],
        reason: "always".into(),
    });
    let ev = RunEvent::from_routing_kind(run_id, workflow_id, None, &kind, None, None);

    assert!(ev.node_id.is_none());
    assert_eq!(ev.event_type, "router.branch_selected");
}

#[test]
fn from_guardrail_kind_with_node_id() {
    let (run_id, workflow_id, node_id) = ids();
    let kind = GuardrailEventKind::Warning(GuardrailWarningPayload {
        guardrail: "max_steps".into(),
        severity: GuardrailSeverity::Medium,
        message: "80% of limit".into(),
        current_value: 8.0,
        threshold: 10.0,
    });
    let ev = RunEvent::from_guardrail_kind(run_id, workflow_id, Some(node_id), &kind, None, None);

    assert_eq!(ev.node_id, Some(node_id));
    assert_eq!(ev.event_type, "guardrail.warning");
}

// ---------------------------------------------------------------------------
// event_type string matches payload tag — all families
// ---------------------------------------------------------------------------

#[test]
fn event_type_matches_kind_for_all_families() {
    let (run_id, workflow_id, node_id) = ids();

    // run family
    let run_kind = RunEventKind::Succeeded(RunSucceededPayload {
        duration_ms: 999,
        steps_executed: 5,
    });
    let ev = RunEvent::from_run_kind(run_id, workflow_id, &run_kind, None, None);
    assert_eq!(ev.event_type, run_kind.event_type_str());

    // node family
    let node_kind = NodeEventKind::Succeeded(NodeSucceededPayload {
        attempt: 1,
        duration_ms: 100,
    });
    let ev = RunEvent::from_node_kind(run_id, workflow_id, node_id, &node_kind, None, None);
    assert_eq!(ev.event_type, node_kind.event_type_str());

    // routing family
    let routing_kind = RoutingEventKind::RouterBranchSelected(RouterBranchSelectedPayload {
        router_node_id: "r1".into(),
        selected_edge_ids: vec!["e1".into()],
        reason: "always".into(),
    });
    let ev = RunEvent::from_routing_kind(run_id, workflow_id, Some(node_id), &routing_kind, None, None);
    assert_eq!(ev.event_type, routing_kind.event_type_str());

    // review family
    let review_kind = HumanReviewEventKind::Approved(ReviewApprovedPayload { comment: None });
    let ev = RunEvent::from_review_kind(run_id, workflow_id, node_id, &review_kind, None, None);
    assert_eq!(ev.event_type, review_kind.event_type_str());

    // guardrail family
    let guardrail_kind = GuardrailEventKind::BudgetUpdated(BudgetUpdatedPayload {
        resource: BudgetResource::Tokens,
        consumed: 100.0,
        limit: 1000.0,
        remaining: 900.0,
    });
    let ev = RunEvent::from_guardrail_kind(run_id, workflow_id, None, &guardrail_kind, None, None);
    assert_eq!(ev.event_type, guardrail_kind.event_type_str());
}

// ---------------------------------------------------------------------------
// Full RunEvent envelope round-trip for all families
// ---------------------------------------------------------------------------

#[test]
fn run_event_envelope_round_trip_run_family() {
    let (run_id, workflow_id, wf_id2) = ids();
    let kind = RunEventKind::Created(RunCreatedPayload {
        workflow_id: wf_id2,
        workflow_version: 3,
        workspace_root: "/projects/myapp".into(),
    });
    let ev = RunEvent::from_run_kind(run_id, workflow_id, &kind, None, None);

    let json = serde_json::to_string(&ev).expect("envelope serializes");
    let back: RunEvent = serde_json::from_str(&json).expect("envelope deserializes");

    assert_eq!(back.event_id, ev.event_id);
    assert_eq!(back.run_id, run_id);
    assert_eq!(back.workflow_id, workflow_id);
    assert_eq!(back.event_type, "run.created");
    assert_eq!(back.payload["workspace_root"], "/projects/myapp");
    assert_eq!(back.payload["workflow_version"], 3);
    assert!(back.node_id.is_none());
    assert!(back.causation_id.is_none());
    assert!(back.correlation_id.is_none());
}

#[test]
fn run_event_envelope_round_trip_node_family() {
    let (run_id, workflow_id, node_id) = ids();
    let kind = NodeEventKind::Succeeded(NodeSucceededPayload {
        attempt: 2,
        duration_ms: 4_321,
    });
    let causation = Uuid::new_v4();
    let ev = RunEvent::from_node_kind(run_id, workflow_id, node_id, &kind, Some(causation), None);

    let json = serde_json::to_string(&ev).unwrap();
    let back: RunEvent = serde_json::from_str(&json).unwrap();

    assert_eq!(back.event_id, ev.event_id);
    assert_eq!(back.node_id, Some(node_id));
    assert_eq!(back.causation_id, Some(causation));
    assert_eq!(back.event_type, "node.succeeded");
    assert_eq!(back.payload["attempt"], 2);
    assert_eq!(back.payload["duration_ms"], 4_321);
}

#[test]
fn run_event_envelope_round_trip_routing_family() {
    let (run_id, workflow_id, node_id) = ids();
    let kind = RoutingEventKind::RouterBranchSelected(RouterBranchSelectedPayload {
        router_node_id: "router_1".into(),
        selected_edge_ids: vec!["edge_success".into()],
        reason: "exit_code == 0".into(),
    });
    let ev = RunEvent::from_routing_kind(run_id, workflow_id, Some(node_id), &kind, None, None);

    let json = serde_json::to_string(&ev).unwrap();
    let back: RunEvent = serde_json::from_str(&json).unwrap();

    assert_eq!(back.event_type, "router.branch_selected");
    assert_eq!(back.payload["router_node_id"], "router_1");
    assert_eq!(back.payload["reason"], "exit_code == 0");
}

#[test]
fn run_event_envelope_round_trip_review_family() {
    let (run_id, workflow_id, node_id) = ids();
    let kind = HumanReviewEventKind::Approved(ReviewApprovedPayload {
        comment: Some("Looks good".into()),
    });
    let ev = RunEvent::from_review_kind(run_id, workflow_id, node_id, &kind, None, None);

    let json = serde_json::to_string(&ev).unwrap();
    let back: RunEvent = serde_json::from_str(&json).unwrap();

    assert_eq!(back.event_type, "review.approved");
    assert_eq!(back.payload["comment"], "Looks good");
    assert_eq!(back.node_id, Some(node_id));
}

#[test]
fn run_event_envelope_round_trip_guardrail_family() {
    let (run_id, workflow_id, _) = ids();
    let kind = GuardrailEventKind::Exceeded(GuardrailExceededPayload {
        guardrail: "max_steps".into(),
        message: "Step limit reached".into(),
        final_value: 50.0,
        threshold: 50.0,
        enforcement_action: "fail_run".into(),
    });
    let ev = RunEvent::from_guardrail_kind(run_id, workflow_id, None, &kind, None, None);

    let json = serde_json::to_string(&ev).unwrap();
    let back: RunEvent = serde_json::from_str(&json).unwrap();

    assert_eq!(back.event_type, "guardrail.exceeded");
    assert_eq!(back.payload["enforcement_action"], "fail_run");
    assert!(back.node_id.is_none());
}

#[test]
fn run_event_envelope_round_trip_command_family() {
    // CommandEventKind doesn't have a from_*_kind constructor on RunEvent,
    // so test the CommandEventKind round-trip directly via JSON to confirm
    // no lossy transformation.
    let kind = CommandEventKind::Completed(CommandCompletedPayload {
        exit_code: 0,
        duration_ms: 2_048,
        stdout_bytes: 1_024,
        stderr_bytes: 0,
    });
    let json = serde_json::to_string(&kind).unwrap();
    let back: CommandEventKind = serde_json::from_str(&json).unwrap();
    match back {
        CommandEventKind::Completed(p) => {
            assert_eq!(p.exit_code, 0);
            assert_eq!(p.duration_ms, 2_048);
            assert_eq!(p.stdout_bytes, 1_024);
        }
        other => panic!("unexpected variant: {:?}", other),
    }
}

#[test]
fn run_event_envelope_round_trip_memory_family() {
    let kind = MemoryEventKind::Read(MemoryReadPayload {
        scope: MemoryScope::RunShared,
        key: "task_brief".into(),
        found: true,
    });
    let json = serde_json::to_string(&kind).unwrap();
    let back: MemoryEventKind = serde_json::from_str(&json).unwrap();
    match back {
        MemoryEventKind::Read(p) => {
            assert_eq!(p.key, "task_brief");
            assert!(p.found);
        }
        other => panic!("unexpected variant: {:?}", other),
    }
}

#[test]
fn run_event_envelope_round_trip_agent_family() {
    let kind = AgentEventKind::Completed(AgentCompletedPayload {
        provider: "claude-sonnet-4-6".into(),
        duration_ms: 3_000,
        input_tokens: Some(800),
        output_tokens: Some(200),
        output_memory_key: Some("plan".into()),
    });
    let json = serde_json::to_string(&kind).unwrap();
    let back: AgentEventKind = serde_json::from_str(&json).unwrap();
    match back {
        AgentEventKind::Completed(p) => {
            assert_eq!(p.provider, "claude-sonnet-4-6");
            assert_eq!(p.input_tokens, Some(800));
            assert_eq!(p.output_memory_key.as_deref(), Some("plan"));
        }
        other => panic!("unexpected variant: {:?}", other),
    }
}

// ---------------------------------------------------------------------------
// No lossy transformation: integer/float/bool fields survive round-trip
// ---------------------------------------------------------------------------

#[test]
fn no_lossy_transformation_numeric_fields() {
    let (run_id, workflow_id, _) = ids();
    let kind = RunEventKind::Succeeded(RunSucceededPayload {
        duration_ms: u64::MAX,
        steps_executed: u32::MAX,
    });
    let ev = RunEvent::from_run_kind(run_id, workflow_id, &kind, None, None);

    let json = serde_json::to_string(&ev).unwrap();
    let back: RunEvent = serde_json::from_str(&json).unwrap();

    assert_eq!(back.payload["duration_ms"], u64::MAX);
    assert_eq!(back.payload["steps_executed"], u32::MAX);
}

#[test]
fn no_lossy_transformation_uuid_fields() {
    let (run_id, workflow_id, wf_id2) = ids();
    let kind = RunEventKind::Created(RunCreatedPayload {
        workflow_id: wf_id2,
        workflow_version: 1,
        workspace_root: "/".into(),
    });
    let ev = RunEvent::from_run_kind(run_id, workflow_id, &kind, None, None);

    let json = serde_json::to_string(&ev).unwrap();
    let back: RunEvent = serde_json::from_str(&json).unwrap();

    // UUIDs must survive the round-trip without truncation or reformatting
    assert_eq!(back.event_id, ev.event_id);
    assert_eq!(back.run_id, run_id);
    assert_eq!(back.workflow_id, workflow_id);
}

#[test]
fn no_lossy_transformation_optional_none_preserved() {
    use crate::node_events::NodeWaitingPayload;
    let (run_id, workflow_id, node_id) = ids();
    let kind = NodeEventKind::Waiting(NodeWaitingPayload { reason: None });
    let ev = RunEvent::from_node_kind(run_id, workflow_id, node_id, &kind, None, None);

    let json = serde_json::to_string(&ev).unwrap();
    let back: RunEvent = serde_json::from_str(&json).unwrap();

    assert!(back.payload["reason"].is_null());
}
