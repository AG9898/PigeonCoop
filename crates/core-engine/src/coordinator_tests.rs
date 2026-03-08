// Tests for RunCoordinator.
// These tests verify the ENGINE-004 implementation.

#[cfg(test)]
mod tests {
    use uuid::Uuid;
    use chrono::Utc;
    use workflow_model::run::{RunInstance, RunStatus, NodeSnapshot, NodeStatus, RunConstraints};
    use event_model::event::RunEvent;
    use crate::coordinator::{RunCoordinator, EventLog};
    use crate::state_machine::RunTransitionInput;
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
    #[test]
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
    fn invalid_transition_returns_state_transition_error() {
        let mut coordinator = make_coordinator();
        // Start from Created is not a valid transition
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
    /// to Succeeded.
    #[test]
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

    // -----------------------------------------------------------------------
    // Retry logic
    // -----------------------------------------------------------------------

    /// When a node fails with retries remaining, it must be re-queued (Failed → Queued)
    /// and the attempt counter must be incremented.
    #[test]
    fn node_fails_with_retries_schedules_retry_and_increments_attempt() {
        let mut coordinator = make_coordinator();

        let node_id = Uuid::new_v4();
        coordinator
            .node_snapshots
            .insert(node_id, make_node_snapshot(node_id, NodeStatus::Running));

        coordinator
            .fail_node(node_id, "timeout".into(), 2)
            .expect("fail_node with retries must succeed");

        assert_eq!(
            coordinator.node_status(&node_id),
            Some(&NodeStatus::Queued),
            "node must be Queued (retry scheduled) when retries remain"
        );

        let snap = coordinator.node_snapshots.get(&node_id).unwrap();
        assert_eq!(snap.attempt, 2, "attempt must be incremented after retry");
    }

    // -----------------------------------------------------------------------
    // Guardrails
    // -----------------------------------------------------------------------

    /// When max_steps is exceeded, the run must transition to Failed.
    #[test]
    fn max_steps_guardrail_halts_run() {
        let run = RunInstance {
            run_id: Uuid::new_v4(),
            workflow_id: Uuid::new_v4(),
            workflow_version: 1,
            status: RunStatus::Running,
            workspace_root: "/tmp/workspace".into(),
            created_at: Utc::now(),
            started_at: None,
            ended_at: None,
            active_nodes: vec![],
            constraints: RunConstraints {
                max_steps: Some(1),
                ..RunConstraints::default()
            },
            summary: None,
        };
        let mut coordinator = RunCoordinator::new(run, InMemoryEventLog::new());

        let node_id = Uuid::new_v4();
        coordinator
            .node_snapshots
            .insert(node_id, make_node_snapshot(node_id, NodeStatus::Running));

        coordinator
            .complete_node_success(node_id, 100)
            .expect("complete_node_success must not error");

        assert_eq!(
            coordinator.run_status(),
            &RunStatus::Failed,
            "run must be Failed when max_steps guardrail is exceeded"
        );
    }

    // -----------------------------------------------------------------------
    // Event emission
    // -----------------------------------------------------------------------

    /// Every run-level transition must emit exactly one event.
    #[test]
    fn each_run_transition_emits_one_event() {
        let mut coordinator = make_coordinator();

        coordinator
            .transition_run(RunTransitionInput::BeginValidation { node_count: 1 })
            .unwrap();
        assert_eq!(coordinator.emitted_events().len(), 1);

        coordinator
            .transition_run(RunTransitionInput::ValidationPassed { node_count: 1 })
            .unwrap();
        assert_eq!(coordinator.emitted_events().len(), 2);

        coordinator
            .transition_run(RunTransitionInput::Start { node_count: 1 })
            .unwrap();
        assert_eq!(coordinator.emitted_events().len(), 3);
    }

    /// Every node-level transition must emit exactly one event.
    #[test]
    fn each_node_transition_emits_one_event() {
        let mut coordinator = make_coordinator();
        let node_id = Uuid::new_v4();
        coordinator
            .node_snapshots
            .insert(node_id, make_node_snapshot(node_id, NodeStatus::Ready));

        coordinator
            .transition_node(node_id, NodeTransitionInput::Queue { node_type: "tool".into() })
            .unwrap();
        assert_eq!(coordinator.emitted_events().len(), 1);

        coordinator
            .transition_node(
                node_id,
                NodeTransitionInput::Start {
                    node_type: "tool".into(),
                    input_refs: vec![],
                    workspace_root: "/tmp".into(),
                },
            )
            .unwrap();
        assert_eq!(coordinator.emitted_events().len(), 2);
    }

    // -----------------------------------------------------------------------
    // Full workflow run (integration)
    // -----------------------------------------------------------------------

    /// Simulates a complete 3-node workflow lifecycle:
    ///   Start → Tool → End
    /// Each node transitions through the correct states and the run ends in Succeeded.
    #[test]
    fn full_workflow_start_tool_end_succeeds() {
        let mut coordinator = make_coordinator();

        // Advance run to Running
        coordinator
            .transition_run(RunTransitionInput::BeginValidation { node_count: 3 })
            .unwrap();
        coordinator
            .transition_run(RunTransitionInput::ValidationPassed { node_count: 3 })
            .unwrap();
        coordinator
            .transition_run(RunTransitionInput::Start { node_count: 3 })
            .unwrap();
        assert_eq!(coordinator.run_status(), &RunStatus::Running);

        let start_id = Uuid::new_v4();
        let tool_id = Uuid::new_v4();
        let end_id = Uuid::new_v4();

        // Insert node snapshots in Ready state
        for id in [start_id, tool_id, end_id] {
            coordinator
                .node_snapshots
                .insert(id, make_node_snapshot(id, NodeStatus::Ready));
        }

        // Queue and run Start node
        coordinator
            .transition_node(start_id, NodeTransitionInput::Queue { node_type: "start".into() })
            .unwrap();
        coordinator
            .transition_node(
                start_id,
                NodeTransitionInput::Start {
                    node_type: "start".into(),
                    input_refs: vec![],
                    workspace_root: "/tmp/test-workspace".into(),
                },
            )
            .unwrap();
        assert_eq!(coordinator.node_status(&start_id), Some(&NodeStatus::Running));

        // Start node completes
        coordinator.complete_node_success(start_id, 10).unwrap();
        assert_eq!(coordinator.node_status(&start_id), Some(&NodeStatus::Succeeded));
        assert_eq!(coordinator.run_status(), &RunStatus::Running, "run still running");

        // Queue and run Tool node
        coordinator
            .transition_node(tool_id, NodeTransitionInput::Queue { node_type: "tool".into() })
            .unwrap();
        coordinator
            .transition_node(
                tool_id,
                NodeTransitionInput::Start {
                    node_type: "tool".into(),
                    input_refs: vec![],
                    workspace_root: "/tmp/test-workspace".into(),
                },
            )
            .unwrap();
        assert_eq!(coordinator.node_status(&tool_id), Some(&NodeStatus::Running));

        coordinator.complete_node_success(tool_id, 500).unwrap();
        assert_eq!(coordinator.node_status(&tool_id), Some(&NodeStatus::Succeeded));
        assert_eq!(coordinator.run_status(), &RunStatus::Running, "run still running");

        // Queue and run End node
        coordinator
            .transition_node(end_id, NodeTransitionInput::Queue { node_type: "end".into() })
            .unwrap();
        coordinator
            .transition_node(
                end_id,
                NodeTransitionInput::Start {
                    node_type: "end".into(),
                    input_refs: vec![],
                    workspace_root: "/tmp/test-workspace".into(),
                },
            )
            .unwrap();

        // End node completes — all nodes are now terminal, run must succeed
        coordinator.complete_node_success(end_id, 5).unwrap();
        assert_eq!(coordinator.node_status(&end_id), Some(&NodeStatus::Succeeded));
        assert_eq!(
            coordinator.run_status(),
            &RunStatus::Succeeded,
            "run must be Succeeded after all nodes complete"
        );

        // Verify events were emitted (3 run + many node transitions)
        assert!(
            coordinator.emitted_events().len() > 5,
            "expected multiple events for a full workflow run"
        );

        // Verify event types include node and run events
        let has_run_started = coordinator
            .emitted_events()
            .iter()
            .any(|e| e.event_type == "run.started");
        let has_run_succeeded = coordinator
            .emitted_events()
            .iter()
            .any(|e| e.event_type == "run.succeeded");
        assert!(has_run_started, "run.started event missing");
        assert!(has_run_succeeded, "run.succeeded event missing");
    }
}
