// Scheduler sequencing tests.
// Tests RunScheduler.next_ready_nodes with various graph topologies and
// snapshot states, including skipped/failed/cancelled predecessors.

use std::collections::HashMap;
use uuid::Uuid;
use workflow_model::node::NodeKind;
use workflow_model::run::NodeStatus;
use crate::scheduler::RunScheduler;
use super::helpers::*;

// ---------------------------------------------------------------------------
// next_ready_nodes
// ---------------------------------------------------------------------------

#[test]
fn empty_workflow_returns_no_ready_nodes() {
    let wf = make_workflow(vec![], vec![]);
    let snapshots = HashMap::new();
    let scheduler = RunScheduler::new();
    let ready = scheduler.next_ready_nodes(&wf, &snapshots);
    assert!(ready.is_empty());
}

#[test]
fn start_node_with_no_predecessors_is_ready() {
    let id = Uuid::new_v4();
    let wf = make_workflow(vec![make_node(id, NodeKind::Start)], vec![]);
    let mut snapshots = HashMap::new();
    snapshots.insert(id, make_snapshot(id, NodeStatus::Ready));

    let ready = RunScheduler::new().next_ready_nodes(&wf, &snapshots);
    assert_eq!(ready, vec![id]);
}

#[test]
fn node_not_ready_when_predecessor_is_running() {
    let a = Uuid::new_v4();
    let b = Uuid::new_v4();
    let wf = make_workflow(
        vec![make_node(a, NodeKind::Start), make_node(b, NodeKind::Tool)],
        vec![make_edge(a, b)],
    );
    let mut snapshots = HashMap::new();
    snapshots.insert(a, make_snapshot(a, NodeStatus::Running));
    snapshots.insert(b, make_snapshot(b, NodeStatus::Ready));

    let ready = RunScheduler::new().next_ready_nodes(&wf, &snapshots);
    assert!(!ready.contains(&b));
}

#[test]
fn node_ready_when_predecessor_succeeded() {
    let a = Uuid::new_v4();
    let b = Uuid::new_v4();
    let wf = make_workflow(
        vec![make_node(a, NodeKind::Start), make_node(b, NodeKind::Tool)],
        vec![make_edge(a, b)],
    );
    let mut snapshots = HashMap::new();
    snapshots.insert(a, make_snapshot(a, NodeStatus::Succeeded));
    snapshots.insert(b, make_snapshot(b, NodeStatus::Ready));

    let ready = RunScheduler::new().next_ready_nodes(&wf, &snapshots);
    assert!(ready.contains(&b));
}

#[test]
fn node_ready_when_predecessor_skipped() {
    let a = Uuid::new_v4();
    let b = Uuid::new_v4();
    let wf = make_workflow(
        vec![make_node(a, NodeKind::Start), make_node(b, NodeKind::Tool)],
        vec![make_edge(a, b)],
    );
    let mut snapshots = HashMap::new();
    snapshots.insert(a, make_snapshot(a, NodeStatus::Skipped));
    snapshots.insert(b, make_snapshot(b, NodeStatus::Ready));

    let ready = RunScheduler::new().next_ready_nodes(&wf, &snapshots);
    assert!(ready.contains(&b));
}

#[test]
fn node_ready_when_predecessor_failed() {
    // Per the scheduler code, Failed is a terminal state that allows successors
    // (for OnFailure routing).
    let a = Uuid::new_v4();
    let b = Uuid::new_v4();
    let wf = make_workflow(
        vec![make_node(a, NodeKind::Start), make_node(b, NodeKind::Tool)],
        vec![make_edge(a, b)],
    );
    let mut snapshots = HashMap::new();
    snapshots.insert(a, make_snapshot(a, NodeStatus::Failed));
    snapshots.insert(b, make_snapshot(b, NodeStatus::Ready));

    let ready = RunScheduler::new().next_ready_nodes(&wf, &snapshots);
    assert!(ready.contains(&b));
}

#[test]
fn node_ready_when_predecessor_cancelled() {
    let a = Uuid::new_v4();
    let b = Uuid::new_v4();
    let wf = make_workflow(
        vec![make_node(a, NodeKind::Start), make_node(b, NodeKind::Tool)],
        vec![make_edge(a, b)],
    );
    let mut snapshots = HashMap::new();
    snapshots.insert(a, make_snapshot(a, NodeStatus::Cancelled));
    snapshots.insert(b, make_snapshot(b, NodeStatus::Ready));

    let ready = RunScheduler::new().next_ready_nodes(&wf, &snapshots);
    assert!(ready.contains(&b));
}

#[test]
fn already_running_node_not_returned_as_ready() {
    let a = Uuid::new_v4();
    let b = Uuid::new_v4();
    let wf = make_workflow(
        vec![make_node(a, NodeKind::Start), make_node(b, NodeKind::Tool)],
        vec![make_edge(a, b)],
    );
    let mut snapshots = HashMap::new();
    snapshots.insert(a, make_snapshot(a, NodeStatus::Succeeded));
    snapshots.insert(b, make_snapshot(b, NodeStatus::Running)); // already running

    let ready = RunScheduler::new().next_ready_nodes(&wf, &snapshots);
    assert!(!ready.contains(&b));
}

#[test]
fn already_succeeded_node_not_returned_as_ready() {
    let a = Uuid::new_v4();
    let wf = make_workflow(vec![make_node(a, NodeKind::Start)], vec![]);
    let mut snapshots = HashMap::new();
    snapshots.insert(a, make_snapshot(a, NodeStatus::Succeeded));

    let ready = RunScheduler::new().next_ready_nodes(&wf, &snapshots);
    assert!(ready.is_empty());
}

#[test]
fn multiple_predecessors_all_must_be_terminal() {
    // C depends on both A and B.
    let a = Uuid::new_v4();
    let b = Uuid::new_v4();
    let c = Uuid::new_v4();
    let wf = make_workflow(
        vec![
            make_node(a, NodeKind::Start),
            make_node(b, NodeKind::Tool),
            make_node(c, NodeKind::End),
        ],
        vec![make_edge(a, c), make_edge(b, c)],
    );

    // A succeeded, B still running → C not ready.
    let mut snapshots = HashMap::new();
    snapshots.insert(a, make_snapshot(a, NodeStatus::Succeeded));
    snapshots.insert(b, make_snapshot(b, NodeStatus::Running));
    snapshots.insert(c, make_snapshot(c, NodeStatus::Ready));

    let ready = RunScheduler::new().next_ready_nodes(&wf, &snapshots);
    assert!(!ready.contains(&c));

    // Now B also succeeded → C ready.
    snapshots.insert(b, make_snapshot(b, NodeStatus::Succeeded));
    let ready = RunScheduler::new().next_ready_nodes(&wf, &snapshots);
    assert!(ready.contains(&c));
}

#[test]
fn diamond_graph_both_branches_ready_simultaneously() {
    // Start → A, Start → B (A and B are independent).
    let start = Uuid::new_v4();
    let a = Uuid::new_v4();
    let b = Uuid::new_v4();
    let end = Uuid::new_v4();
    let wf = make_workflow(
        vec![
            make_node(start, NodeKind::Start),
            make_node(a, NodeKind::Agent),
            make_node(b, NodeKind::Tool),
            make_node(end, NodeKind::End),
        ],
        vec![
            make_edge(start, a),
            make_edge(start, b),
            make_edge(a, end),
            make_edge(b, end),
        ],
    );

    let mut snapshots = HashMap::new();
    snapshots.insert(start, make_snapshot(start, NodeStatus::Succeeded));
    snapshots.insert(a, make_snapshot(a, NodeStatus::Ready));
    snapshots.insert(b, make_snapshot(b, NodeStatus::Ready));
    snapshots.insert(end, make_snapshot(end, NodeStatus::Ready));

    let ready = RunScheduler::new().next_ready_nodes(&wf, &snapshots);
    assert!(ready.contains(&a));
    assert!(ready.contains(&b));
    assert!(!ready.contains(&end)); // end needs both a and b
}

#[test]
fn missing_snapshot_means_node_is_not_ready() {
    let a = Uuid::new_v4();
    let wf = make_workflow(vec![make_node(a, NodeKind::Start)], vec![]);
    let snapshots = HashMap::new(); // no snapshot for a

    let ready = RunScheduler::new().next_ready_nodes(&wf, &snapshots);
    assert!(ready.is_empty());
}

// ---------------------------------------------------------------------------
// topological_order
// ---------------------------------------------------------------------------

#[test]
fn topological_order_single_node() {
    let a = Uuid::new_v4();
    let wf = make_workflow(vec![make_node(a, NodeKind::Start)], vec![]);
    let order = RunScheduler::new().topological_order(&wf).unwrap();
    assert_eq!(order, vec![a]);
}

#[test]
fn topological_order_linear() {
    let a = Uuid::new_v4();
    let b = Uuid::new_v4();
    let c = Uuid::new_v4();
    let wf = make_workflow(
        vec![
            make_node(a, NodeKind::Start),
            make_node(b, NodeKind::Tool),
            make_node(c, NodeKind::End),
        ],
        vec![make_edge(a, b), make_edge(b, c)],
    );

    let order = RunScheduler::new().topological_order(&wf).unwrap();
    assert_eq!(order.len(), 3);
    let pos: HashMap<Uuid, usize> = order.iter().enumerate().map(|(i, &id)| (id, i)).collect();
    assert!(pos[&a] < pos[&b]);
    assert!(pos[&b] < pos[&c]);
}

#[test]
fn topological_order_diamond() {
    let start = Uuid::new_v4();
    let a = Uuid::new_v4();
    let b = Uuid::new_v4();
    let end = Uuid::new_v4();
    let wf = make_workflow(
        vec![
            make_node(start, NodeKind::Start),
            make_node(a, NodeKind::Agent),
            make_node(b, NodeKind::Tool),
            make_node(end, NodeKind::End),
        ],
        vec![
            make_edge(start, a),
            make_edge(start, b),
            make_edge(a, end),
            make_edge(b, end),
        ],
    );

    let order = RunScheduler::new().topological_order(&wf).unwrap();
    assert_eq!(order.len(), 4);
    let pos: HashMap<Uuid, usize> = order.iter().enumerate().map(|(i, &id)| (id, i)).collect();
    assert!(pos[&start] < pos[&a]);
    assert!(pos[&start] < pos[&b]);
    assert!(pos[&a] < pos[&end]);
    assert!(pos[&b] < pos[&end]);
}

#[test]
fn topological_order_returns_none_for_cycle() {
    let a = Uuid::new_v4();
    let b = Uuid::new_v4();
    let wf = make_workflow(
        vec![make_node(a, NodeKind::Tool), make_node(b, NodeKind::Tool)],
        vec![make_edge(a, b), make_edge(b, a)],
    );

    let order = RunScheduler::new().topological_order(&wf);
    assert!(order.is_none(), "cyclic graph must return None");
}

#[test]
fn scheduler_default_works() {
    let _ = RunScheduler::default();
}
