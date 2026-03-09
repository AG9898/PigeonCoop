// Human review gate handler.
// Dispatches review decisions to the coordinator. Each decision maps to a
// specific combination of state transitions and review events.
// See ARCHITECTURE.md §6 (Human Review Node) and EVENT_SCHEMA.md §3.8.

use uuid::Uuid;
use crate::coordinator::{EventLog, RunCoordinator, StateTransitionError};

/// A decision made by a human reviewer at a HumanReview gate.
#[derive(Debug, Clone)]
pub enum ReviewDecision {
    /// Approve the current state — node succeeds, run resumes.
    Approve {
        comment: Option<String>,
    },
    /// Reject the current state — node fails, run fails.
    Reject {
        reason: String,
    },
    /// Retry a target node — review node succeeds, target re-queued.
    Retry {
        target_node_id: Uuid,
        comment: Option<String>,
    },
}

/// Handle a review decision by dispatching to the appropriate coordinator method.
///
/// The run must be in `Paused` state and the review node in `Waiting` state.
/// Each decision variant emits the correct `review.*` event and applies the
/// corresponding state transitions.
pub fn handle_review_decision<L: EventLog>(
    coordinator: &mut RunCoordinator<L>,
    review_node_id: Uuid,
    decision: ReviewDecision,
) -> Result<(), StateTransitionError> {
    match decision {
        ReviewDecision::Approve { comment } => {
            coordinator.approve_review(review_node_id, comment)
        }
        ReviewDecision::Reject { reason } => {
            coordinator.reject_review(review_node_id, reason)
        }
        ReviewDecision::Retry { target_node_id, comment } => {
            coordinator.retry_review(review_node_id, target_node_id, comment)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::coordinator::{EventLog, RunCoordinator};
    use event_model::event::RunEvent;
    use workflow_model::run::{RunInstance, RunStatus, NodeSnapshot, NodeStatus, RunConstraints};
    use crate::state_machine::RunTransitionInput;
    use uuid::Uuid;

    /// In-memory event log for tests.
    struct InMemoryEventLog {
        events: Vec<RunEvent>,
    }

    impl InMemoryEventLog {
        fn new() -> Self {
            Self { events: Vec::new() }
        }
    }

    impl EventLog for InMemoryEventLog {
        fn append(&mut self, event: RunEvent) -> Result<(), String> {
            self.events.push(event);
            Ok(())
        }
        fn events(&self) -> &[RunEvent] {
            &self.events
        }
    }

    /// Helper: create a coordinator with a run in Running state and a review
    /// node in Running state, ready to be paused for review.
    fn setup_running_coordinator() -> (RunCoordinator<InMemoryEventLog>, Uuid) {
        let wf_id = Uuid::new_v4();
        let run = RunInstance {
            run_id: Uuid::new_v4(),
            workflow_id: wf_id,
            workflow_version: 1,
            status: RunStatus::Created,
            workspace_root: "/tmp/test".to_owned(),
            created_at: chrono::Utc::now(),
            started_at: None,
            ended_at: None,
            active_nodes: vec![],
            constraints: RunConstraints::default(),
            summary: None,
        };

        let review_node_id = Uuid::new_v4();
        let mut coord = RunCoordinator::new(run, InMemoryEventLog::new());

        // Set up node snapshot in Running state
        coord.node_snapshots.insert(review_node_id, NodeSnapshot {
            node_id: review_node_id,
            status: NodeStatus::Running,
            attempt: 1,
            started_at: Some(chrono::Utc::now()),
            ended_at: None,
            output: None,
        });

        // Advance run: Created → Validating → Ready → Running
        coord.transition_run(RunTransitionInput::BeginValidation { node_count: 1 }).unwrap();
        coord.transition_run(RunTransitionInput::ValidationPassed { node_count: 1 }).unwrap();
        coord.transition_run(RunTransitionInput::Start { node_count: 1 }).unwrap();

        (coord, review_node_id)
    }

    /// Helper: pause coordinator at a review node.
    fn pause_at_review(coord: &mut RunCoordinator<InMemoryEventLog>, node_id: Uuid) {
        coord.pause_for_review(node_id, Some("needs approval".to_owned())).unwrap();
    }

    #[test]
    fn pause_for_review_emits_review_required_event() {
        let (mut coord, node_id) = setup_running_coordinator();
        pause_at_review(&mut coord, node_id);

        assert_eq!(coord.run_status(), &RunStatus::Paused);
        assert_eq!(coord.node_status(&node_id), Some(&NodeStatus::Waiting));

        // Find review.required event
        let review_events: Vec<_> = coord
            .emitted_events()
            .iter()
            .filter(|e| e.event_type == "review.required")
            .collect();
        assert_eq!(review_events.len(), 1);
        assert_eq!(review_events[0].payload["blocking"], true);
        assert_eq!(review_events[0].node_id, Some(node_id));
    }

    #[test]
    fn approve_resumes_run_and_succeeds_node() {
        let (mut coord, node_id) = setup_running_coordinator();
        pause_at_review(&mut coord, node_id);

        handle_review_decision(
            &mut coord,
            node_id,
            ReviewDecision::Approve { comment: Some("looks good".into()) },
        )
        .unwrap();

        assert_eq!(coord.node_status(&node_id), Some(&NodeStatus::Succeeded));
        // Run should be Succeeded because all nodes are terminal
        assert_eq!(coord.run_status(), &RunStatus::Succeeded);

        let approved_events: Vec<_> = coord
            .emitted_events()
            .iter()
            .filter(|e| e.event_type == "review.approved")
            .collect();
        assert_eq!(approved_events.len(), 1);
    }

    #[test]
    fn reject_fails_run() {
        let (mut coord, node_id) = setup_running_coordinator();
        pause_at_review(&mut coord, node_id);

        handle_review_decision(
            &mut coord,
            node_id,
            ReviewDecision::Reject { reason: "output quality too low".into() },
        )
        .unwrap();

        assert_eq!(coord.node_status(&node_id), Some(&NodeStatus::Failed));
        assert_eq!(coord.run_status(), &RunStatus::Failed);

        let rejected_events: Vec<_> = coord
            .emitted_events()
            .iter()
            .filter(|e| e.event_type == "review.rejected")
            .collect();
        assert_eq!(rejected_events.len(), 1);
        assert_eq!(rejected_events[0].payload["reason"], "output quality too low");
    }

    #[test]
    fn retry_requeues_target_node() {
        let (mut coord, review_node_id) = setup_running_coordinator();

        // Add a target node that has already failed
        let target_node_id = Uuid::new_v4();
        coord.node_snapshots.insert(target_node_id, NodeSnapshot {
            node_id: target_node_id,
            status: NodeStatus::Failed,
            attempt: 1,
            started_at: Some(chrono::Utc::now()),
            ended_at: Some(chrono::Utc::now()),
            output: None,
        });

        pause_at_review(&mut coord, review_node_id);

        handle_review_decision(
            &mut coord,
            review_node_id,
            ReviewDecision::Retry {
                target_node_id,
                comment: Some("try again with updated params".into()),
            },
        )
        .unwrap();

        // Review node should be succeeded (its job is done)
        assert_eq!(coord.node_status(&review_node_id), Some(&NodeStatus::Succeeded));
        // Target node should be re-queued
        assert_eq!(coord.node_status(&target_node_id), Some(&NodeStatus::Queued));
        // Run should be running (not all nodes terminal)
        assert_eq!(coord.run_status(), &RunStatus::Running);

        let retry_events: Vec<_> = coord
            .emitted_events()
            .iter()
            .filter(|e| e.event_type == "review.retry_requested")
            .collect();
        assert_eq!(retry_events.len(), 1);
    }

    #[test]
    fn all_decisions_emit_correct_review_events() {
        // Approve
        let (mut coord, node_id) = setup_running_coordinator();
        pause_at_review(&mut coord, node_id);
        handle_review_decision(&mut coord, node_id, ReviewDecision::Approve { comment: None }).unwrap();
        assert!(coord.emitted_events().iter().any(|e| e.event_type == "review.approved"));

        // Reject
        let (mut coord, node_id) = setup_running_coordinator();
        pause_at_review(&mut coord, node_id);
        handle_review_decision(&mut coord, node_id, ReviewDecision::Reject { reason: "bad".into() }).unwrap();
        assert!(coord.emitted_events().iter().any(|e| e.event_type == "review.rejected"));

        // Retry
        let (mut coord, review_node_id) = setup_running_coordinator();
        let target_id = Uuid::new_v4();
        coord.node_snapshots.insert(target_id, NodeSnapshot {
            node_id: target_id,
            status: NodeStatus::Failed,
            attempt: 1,
            started_at: None,
            ended_at: None,
            output: None,
        });
        pause_at_review(&mut coord, review_node_id);
        handle_review_decision(&mut coord, review_node_id, ReviewDecision::Retry {
            target_node_id: target_id,
            comment: None,
        }).unwrap();
        assert!(coord.emitted_events().iter().any(|e| e.event_type == "review.retry_requested"));
    }
}
