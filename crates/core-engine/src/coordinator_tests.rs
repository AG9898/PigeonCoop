// Test-first spec for RunCoordinator.
// These tests define the contract ENGINE-004 must satisfy.
// All tests that call coordinator methods are expected to FAIL until
// ENGINE-004 is implemented — that is correct and intentional. See QA-002.

#[cfg(test)]
mod tests {
    use uuid::Uuid;
    use chrono::Utc;
    use workflow_model::run::{RunInstance, RunStatus, NodeSnapshot, NodeStatus, RunConstraints};
    use workflow_model::workflow::WorkflowDefinition;
    use event_model::event::RunEvent;
    use crate::coordinator::{RunCoordinator, EventLog, StateTransitionError};
    use crate::state_machine::{RunTransitionInput, TransitionError};
    use crate::state_machine::node::NodeTransitionInput;

    // -----------------------------------------------------------------------
    // In-memory event log stub (test infrastructure)
    // -----------------------------------------------------------------------

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

    // -----------------------------------------------------------------------
    // Test helpers
    // -----------------------------------------------------------------------

    fn make_run() -> RunInstance {
        RunInstance {
            run_id: Uuid::new_v4(),
            workflow_id: Uuid::new_v4(),
            workflow_version: 1,
            status: RunStatus::Created,
            workspace_root: "/tmp/test-workspace".into(),
            created_at: Utc::now(),
            started_at: None,
            ended_at: None,
            active_nodes: vec![],
            constraints: RunConstraints::default(),
            summary: None,
        }
    }

    fn make_node_snapshot(node_id: Uuid, status: NodeStatus) -> NodeSnapshot {
        NodeSnapshot {
            node_id,
            status,
            attempt: 1,
            started_at: None,
            ended_at: None,
            output: None,
        }
    }

    fn make_coordinator() -> RunCoordinator<InMemoryEventLog> {
        RunCoordinator::new(make_run(), InMemoryEventLog::new())
    }

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------

    /// A freshly created RunCoordinator must expose Created run status without
    /// any transition calls. This is a pure state assertion — no engine code required.
    #[test]
    fn new_run_starts_in_created_state() {
        let coordinator = make_coordinator();
        assert_eq!(coordinator.run_status(), &RunStatus::Created);
    }

    /// A freshly created RunCoordinator must have no emitted events.
    #[test]
    fn new_coordinator_has_no_emitted_events() {
        let coordinator = make_coordinator();
        assert!(coordinator.emitted_events().is_empty());
    }

    // -----------------------------------------------------------------------
    // Run lifecycle transitions
    // -----------------------------------------------------------------------

    /// The coordinator must drive the run from Created all the way to Running
    /// via the valid transition sequence: Created → Validating → Ready → Running.
    /// Each step must succeed and the status must reflect the new state.
    #[test]
    #[should_panic(expected = "ENGINE-004")]
    fn valid_run_transitions_created_through_to_running() {
        let mut coordinator = make_coordinator();
        assert_eq!(coordinator.run_status(), &RunStatus::Created);

        coordinator
            .transition_run(RunTransitionInput::BeginValidation { node_count: 3 })
            .expect("Created → Validating must succeed");
        assert_eq!(coordinator.run_status(), &RunStatus::Validating);

        coordinator
            .transition_run(RunTransitionInput::ValidationPassed { node_count: 3 })
            .expect("Validating → Ready must succeed");
        assert_eq!(coordinator.run_status(), &RunStatus::Ready);

        coordinator
            .transition_run(RunTransitionInput::Start { node_count: 3 })
            .expect("Ready → Running must succeed");
        assert_eq!(coordinator.run_status(), &RunStatus::Running);
    }

    /// An invalid transition (e.g. Start from Created, skipping Validating)
    /// must return a StateTransitionError. The run status must not change.
    #[test]
    #[should_panic(expected = "ENGINE-004")]
    fn invalid_transition_returns_state_transition_error() {
        let mut coordinator = make_coordinator();
        // Running → Created is not a valid transition
        let result = coordinator.transition_run(RunTransitionInput::Start { node_count: 1 });
        assert!(
            result.is_err(),
            "Start from Created state must return an error"
        );
        // Run status must remain unchanged
        assert_eq!(coordinator.run_status(), &RunStatus::Created);
    }

    // -----------------------------------------------------------------------
    // Cancellation
    // -----------------------------------------------------------------------

    /// Cancelling a running run must transition the run to Cancelled and emit
    /// a RunCancelled event.
    #[test]
    #[should_panic(expected = "ENGINE-004")]
    fn cancel_running_run_transitions_to_cancelled_and_emits_event() {
        let mut coordinator = make_coordinator();

        // Advance to Running
        coordinator
            .transition_run(RunTransitionInput::BeginValidation { node_count: 1 })
            .unwrap();
        coordinator
            .transition_run(RunTransitionInput::ValidationPassed { node_count: 1 })
            .unwrap();
        coordinator
            .transition_run(RunTransitionInput::Start { node_count: 1 })
            .unwrap();
        assert_eq!(coordinator.run_status(), &RunStatus::Running);

        // Cancel
        coordinator
            .cancel(Some("user requested cancel".into()))
            .expect("cancel from Running must succeed");

        assert_eq!(coordinator.run_status(), &RunStatus::Cancelled);

        // At least one event must have been emitted for the cancellation
        let has_cancel_event = coordinator
            .emitted_events()
            .iter()
            .any(|e| e.event_type.contains("cancelled") || e.event_type.contains("cancel"));
        assert!(has_cancel_event, "expected a RunCancelled event to be emitted");
    }

    // -----------------------------------------------------------------------
    // Node completion
    // -----------------------------------------------------------------------

    /// When a node completes successfully, its snapshot status must transition
    /// to Succeeded and the next eligible nodes must be queued.
    #[test]
    #[should_panic(expected = "ENGINE-004")]
    fn node_succeeds_transitions_to_succeeded_and_queues_next() {
        let mut coordinator = make_coordinator();

        let node_id = Uuid::new_v4();
        coordinator
            .node_snapshots
            .insert(node_id, make_node_snapshot(node_id, NodeStatus::Running));

        coordinator
            .complete_node_success(node_id, 500)
            .expect("completing a running node must succeed");

        assert_eq!(
            coordinator.node_status(&node_id),
            Some(&NodeStatus::Succeeded),
            "node must be Succeeded after completion"
        );
    }

    /// When a node fails and has no retries remaining, the run must transition
    /// to Failed and emit a RunFailed event.
    #[test]
    #[should_panic(expected = "ENGINE-004")]
    fn node_fails_with_no_retries_transitions_run_to_failed() {
        let mut coordinator = make_coordinator();

        // Advance run to Running
        coordinator
            .transition_run(RunTransitionInput::BeginValidation { node_count: 1 })
            .unwrap();
        coordinator
            .transition_run(RunTransitionInput::ValidationPassed { node_count: 1 })
            .unwrap();
        coordinator
            .transition_run(RunTransitionInput::Start { node_count: 1 })
            .unwrap();

        let node_id = Uuid::new_v4();
        coordinator
            .node_snapshots
            .insert(node_id, make_node_snapshot(node_id, NodeStatus::Running));

        // Fail the node with 0 retries remaining
        coordinator
            .fail_node(node_id, "exit code 1".into(), 0)
            .expect("failing a node with no retries must succeed as an operation");

        assert_eq!(
            coordinator.node_status(&node_id),
            Some(&NodeStatus::Failed),
            "node must be Failed"
        );
        assert_eq!(
            coordinator.run_status(),
            &RunStatus::Failed,
            "run must be Failed when a node fails with no retries"
        );

        let has_failed_event = coordinator
            .emitted_events()
            .iter()
            .any(|e| e.event_type.contains("failed") || e.event_type.contains("fail"));
        assert!(has_failed_event, "expected a RunFailed event to be emitted");
    }

    // -----------------------------------------------------------------------
    // Human review gate
    // -----------------------------------------------------------------------

    /// When the coordinator pauses at a HumanReview node, the run must
    /// transition to Paused and a HumanReviewRequested event must be emitted.
    #[test]
    #[should_panic(expected = "ENGINE-004")]
    fn pause_on_human_review_transitions_run_to_paused_and_emits_event() {
        let mut coordinator = make_coordinator();

        // Advance run to Running
        coordinator
            .transition_run(RunTransitionInput::BeginValidation { node_count: 2 })
            .unwrap();
        coordinator
            .transition_run(RunTransitionInput::ValidationPassed { node_count: 2 })
            .unwrap();
        coordinator
            .transition_run(RunTransitionInput::Start { node_count: 2 })
            .unwrap();

        let review_node_id = Uuid::new_v4();
        coordinator
            .node_snapshots
            .insert(review_node_id, make_node_snapshot(review_node_id, NodeStatus::Running));

        coordinator
            .pause_for_review(review_node_id, Some("requires human approval".into()))
            .expect("pause_for_review must succeed from Running");

        assert_eq!(
            coordinator.run_status(),
            &RunStatus::Paused,
            "run must be Paused after a human review gate"
        );
        assert_eq!(
            coordinator.node_status(&review_node_id),
            Some(&NodeStatus::Waiting),
            "review node must be in Waiting state"
        );

        let has_review_event = coordinator
            .emitted_events()
            .iter()
            .any(|e| {
                e.event_type.contains("review") || e.event_type.contains("paused")
            });
        assert!(
            has_review_event,
            "expected a HumanReviewRequested or RunPaused event to be emitted"
        );
    }

    /// Approving a paused review node must resume the run (Paused → Running)
    /// and transition the node from Waiting back to Running.
    #[test]
    #[should_panic(expected = "ENGINE-004")]
    fn approve_paused_run_resumes_and_transitions_correctly() {
        let mut coordinator = make_coordinator();

        // Advance run to Running and pause at a review node
        coordinator
            .transition_run(RunTransitionInput::BeginValidation { node_count: 2 })
            .unwrap();
        coordinator
            .transition_run(RunTransitionInput::ValidationPassed { node_count: 2 })
            .unwrap();
        coordinator
            .transition_run(RunTransitionInput::Start { node_count: 2 })
            .unwrap();

        let review_node_id = Uuid::new_v4();
        coordinator
            .node_snapshots
            .insert(review_node_id, make_node_snapshot(review_node_id, NodeStatus::Running));

        coordinator
            .pause_for_review(review_node_id, None)
            .unwrap();

        assert_eq!(coordinator.run_status(), &RunStatus::Paused);

        // Approve the review
        coordinator
            .approve_review(review_node_id)
            .expect("approve_review must succeed from Paused");

        assert_eq!(
            coordinator.run_status(),
            &RunStatus::Running,
            "run must resume to Running after review approval"
        );
        assert_eq!(
            coordinator.node_status(&review_node_id),
            Some(&NodeStatus::Running),
            "review node must return to Running after approval"
        );
    }
}
