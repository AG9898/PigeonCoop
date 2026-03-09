// Live Run View — monitors active workflow execution.
// Subscribes to Tauri events (never polls) and derives all state from events.
// Renders a read-only React Flow graph with per-node state animations.
// See ARCHITECTURE.md §10.2 and DESIGN_SPEC.md §4.2, §7.

import { useEffect, useMemo, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import ReactFlow, {
  Background,
  BackgroundVariant,
  MiniMap,
  type Node,
  type Edge,
  type NodeTypes,
} from "reactflow";
import "reactflow/dist/style.css";
import WorkflowNode, {
  type WorkflowNodeData,
} from "../components/nodes/WorkflowNode";
import type {
  NodeStatus,
  NodeState as VisualNodeState,
  RunEvent,
  RunStatus,
  WorkflowDefinition,
} from "../types/workflow";
import type {
  NodeStatusChangedPayload,
  RunEventAppendedPayload,
  RunStatusChangedPayload,
} from "../types/ipc";
import { ipc } from "../types/ipc";

// All 7 node types share the WorkflowNode component.
const NODE_TYPES: NodeTypes = {
  start: WorkflowNode,
  end: WorkflowNode,
  agent: WorkflowNode,
  tool: WorkflowNode,
  router: WorkflowNode,
  memory: WorkflowNode,
  human_review: WorkflowNode,
};

/** Map backend NodeStatus to the 8-state visual NodeState used by WorkflowNode. */
function toVisualState(status: NodeStatus): VisualNodeState {
  switch (status) {
    case "running":
      return "running";
    case "waiting":
      return "waiting";
    case "succeeded":
      return "succeeded";
    case "failed":
      return "failed";
    case "skipped":
      return "skipped";
    case "cancelled":
      return "skipped";
    case "queued":
      return "queued";
    default:
      return "idle";
  }
}

export interface LiveRunViewProps {
  runId: string | null;
}

interface NodeState {
  status: NodeStatus;
  attempt: number;
}

export function LiveRunView({ runId }: LiveRunViewProps) {
  const [runStatus, setRunStatus] = useState<RunStatus | null>(null);
  const [workflowName, setWorkflowName] = useState<string>("");
  const [workspaceRoot, setWorkspaceRoot] = useState<string>("");
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<string>("--:--");
  const [nodeStatuses, setNodeStatuses] = useState<Map<string, NodeState>>(
    new Map()
  );
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<RunEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowDefinition | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const eventFeedRef = useRef<HTMLUListElement>(null);

  // Load initial run data when runId changes
  useEffect(() => {
    if (!runId) return;
    setError(null);
    setEvents([]);
    setNodeStatuses(new Map());
    setSelectedEvent(null);
    setWorkflow(null);

    (async () => {
      try {
        const run = await ipc.getRun({ run_id: runId });
        if (!run) {
          setError(`Run ${runId} not found`);
          return;
        }
        setRunStatus(run.status);
        setWorkspaceRoot(run.workspace_root);
        setStartedAt(run.started_at ?? null);

        const wf = await ipc.getWorkflow({ id: run.workflow_id });
        setWorkflowName(wf?.name ?? run.workflow_id);
        setWorkflow(wf);
      } catch (e: unknown) {
        setError(
          typeof e === "object" && e !== null && "message" in e
            ? (e as { message: string }).message
            : String(e)
        );
      }
    })();
  }, [runId]);

  // Elapsed time ticker
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);

    if (!startedAt || isTerminal(runStatus)) {
      setElapsed(formatElapsed(startedAt, runStatus));
      return;
    }

    function tick() {
      setElapsed(formatElapsed(startedAt, runStatus));
    }
    tick();
    timerRef.current = setInterval(tick, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [startedAt, runStatus]);

  // Subscribe to Tauri events
  useEffect(() => {
    if (!runId) return;

    const unlisteners: UnlistenFn[] = [];

    async function subscribe() {
      unlisteners.push(
        await listen<RunStatusChangedPayload>(
          "run_status_changed",
          (ev) => {
            if (ev.payload.run_id !== runId) return;
            setRunStatus(ev.payload.new_status);
          }
        )
      );

      unlisteners.push(
        await listen<NodeStatusChangedPayload>(
          "node_status_changed",
          (ev) => {
            if (ev.payload.run_id !== runId) return;
            setNodeStatuses((prev) => {
              const next = new Map(prev);
              next.set(ev.payload.node_id, {
                status: ev.payload.new_status,
                attempt: ev.payload.attempt,
              });
              return next;
            });
          }
        )
      );

      unlisteners.push(
        await listen<RunEventAppendedPayload>(
          "run_event_appended",
          (ev) => {
            if (ev.payload.event.run_id !== runId) return;
            setEvents((prev) => [...prev, ev.payload.event]);
          }
        )
      );
    }

    subscribe();

    return () => {
      unlisteners.forEach((fn) => fn());
    };
  }, [runId]);

  // Auto-scroll event feed
  useEffect(() => {
    if (eventFeedRef.current) {
      eventFeedRef.current.scrollTop = eventFeedRef.current.scrollHeight;
    }
  }, [events]);

  if (!runId) {
    return (
      <div className="view live-run-view">
        <div className="view-header">
          <span className="view-title">LIVE RUN</span>
          <span className="view-subtitle">active execution monitor</span>
        </div>
        <div className="view-body view-placeholder">
          <span className="placeholder-label">
            [ no active run — start one from the Library ]
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="view live-run-view">
      <div className="view-header">
        <span className="view-title">LIVE RUN</span>
        <span className="view-subtitle">active execution monitor</span>
      </div>
      {error && <div className="lr-error">{error}</div>}
      <div className="view-body lr-body">
        {/* ── Run HUD ── */}
        <div className="lr-hud" data-testid="run-hud">
          <div className="lr-hud-row">
            <span className="lr-hud-label">RUN</span>
            <span className="lr-hud-value lr-hud-id" title={runId}>
              {runId.slice(0, 8)}
            </span>
          </div>
          <div className="lr-hud-row">
            <span className="lr-hud-label">WORKFLOW</span>
            <span className="lr-hud-value">{workflowName || "--"}</span>
          </div>
          <div className="lr-hud-row">
            <span className="lr-hud-label">STATUS</span>
            <span
              className={`run-status ${statusClass(runStatus)}`}
              data-testid="run-status"
            >
              {runStatus ?? "--"}
            </span>
          </div>
          <div className="lr-hud-row">
            <span className="lr-hud-label">WORKSPACE</span>
            <span className="lr-hud-value" title={workspaceRoot}>
              {workspaceRoot || "--"}
            </span>
          </div>
          <div className="lr-hud-row">
            <span className="lr-hud-label">ELAPSED</span>
            <span className="lr-hud-value lr-hud-elapsed">{elapsed}</span>
          </div>
        </div>

        {/* ── Main panels ── */}
        <div className="lr-panels">
          {/* Live workflow graph */}
          <div className="lr-panel lr-graph-panel" data-testid="live-graph">
            <div className="panel-header">GRAPH</div>
            <LiveGraph workflow={workflow} nodeStatuses={nodeStatuses} />
          </div>

          {/* Node status panel */}
          <div className="lr-panel lr-nodes-panel">
            <div className="panel-header">NODES</div>
            <ul className="lr-node-list">
              {nodeStatuses.size === 0 && (
                <li className="lr-empty">waiting for events...</li>
              )}
              {Array.from(nodeStatuses.entries()).map(
                ([nodeId, nodeState]) => (
                  <li key={nodeId} className="lr-node-item">
                    <span
                      className={`lr-node-status ${nodeStatusClass(nodeState.status)}`}
                    >
                      {nodeState.status}
                    </span>
                    <span className="lr-node-id" title={nodeId}>
                      {nodeId.slice(0, 8)}
                    </span>
                    {nodeState.attempt > 1 && (
                      <span className="lr-node-attempt">
                        attempt {nodeState.attempt}
                      </span>
                    )}
                  </li>
                )
              )}
            </ul>
          </div>

          {/* Event feed panel */}
          <div className="lr-panel lr-event-panel">
            <div className="panel-header">
              EVENT FEED{" "}
              <span className="panel-header-sub">({events.length})</span>
            </div>
            <ul className="lr-event-list" ref={eventFeedRef}>
              {events.length === 0 && (
                <li className="lr-empty">waiting for events...</li>
              )}
              {events.map((ev) => (
                <li
                  key={ev.event_id}
                  className={`lr-event-item${selectedEvent?.event_id === ev.event_id ? " lr-event-item--selected" : ""}`}
                  onClick={() => setSelectedEvent(ev)}
                >
                  <span className="lr-event-seq">#{ev.sequence}</span>
                  <span className="lr-event-type">{ev.event_type}</span>
                  {ev.node_id && (
                    <span className="lr-event-node">
                      {ev.node_id.slice(0, 8)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {/* Event detail / command output panel */}
          <div className="lr-panel lr-detail-panel">
            <div className="panel-header">DETAIL</div>
            {selectedEvent ? (
              <div className="lr-detail-content">
                <div className="lr-detail-row">
                  <span className="lr-detail-label">event_id</span>
                  <span className="lr-detail-value">
                    {selectedEvent.event_id}
                  </span>
                </div>
                <div className="lr-detail-row">
                  <span className="lr-detail-label">type</span>
                  <span className="lr-detail-value">
                    {selectedEvent.event_type}
                  </span>
                </div>
                <div className="lr-detail-row">
                  <span className="lr-detail-label">timestamp</span>
                  <span className="lr-detail-value">
                    {selectedEvent.timestamp}
                  </span>
                </div>
                {selectedEvent.node_id && (
                  <div className="lr-detail-row">
                    <span className="lr-detail-label">node_id</span>
                    <span className="lr-detail-value">
                      {selectedEvent.node_id}
                    </span>
                  </div>
                )}
                {selectedEvent.causation_id && (
                  <div className="lr-detail-row">
                    <span className="lr-detail-label">causation_id</span>
                    <span className="lr-detail-value">
                      {selectedEvent.causation_id}
                    </span>
                  </div>
                )}
                <div className="lr-detail-row lr-detail-row--payload">
                  <span className="lr-detail-label">payload</span>
                  <pre className="lr-detail-payload">
                    {JSON.stringify(selectedEvent.payload, null, 2)}
                  </pre>
                </div>
              </div>
            ) : (
              <div className="lr-empty">select an event to inspect</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LiveGraph — read-only React Flow graph with live node state overlays
// ---------------------------------------------------------------------------

/** Set of NodeStatus values that indicate an "active" node (source of active edges). */
const ACTIVE_STATUSES = new Set<NodeStatus>(["running", "waiting"]);

interface LiveGraphProps {
  workflow: WorkflowDefinition | null;
  nodeStatuses: Map<string, NodeState>;
}

function LiveGraph({ workflow, nodeStatuses }: LiveGraphProps) {
  const flowNodes: Node<WorkflowNodeData>[] = useMemo(() => {
    if (!workflow) return [];
    return workflow.nodes.map((n) => {
      const ns = nodeStatuses.get(n.node_id);
      const visualState: VisualNodeState = ns
        ? toVisualState(ns.status)
        : "idle";
      return {
        id: n.node_id,
        type: n.node_type,
        position: { x: n.display.x, y: n.display.y },
        data: { kind: n.node_type, label: n.label, state: visualState },
        draggable: false,
        selectable: false,
      };
    });
  }, [workflow, nodeStatuses]);

  const flowEdges: Edge[] = useMemo(() => {
    if (!workflow) return [];
    return workflow.edges.map((e) => {
      const sourceState = nodeStatuses.get(e.source_node_id);
      const isActive = sourceState
        ? ACTIVE_STATUSES.has(sourceState.status)
        : false;
      return {
        id: e.edge_id,
        source: e.source_node_id,
        target: e.target_node_id,
        label: e.label ?? undefined,
        animated: isActive,
        className: isActive ? "lr-edge--active" : undefined,
      };
    });
  }, [workflow, nodeStatuses]);

  if (!workflow) {
    return <div className="lr-empty">loading graph...</div>;
  }

  return (
    <div className="lr-graph-container">
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={NODE_TYPES}
        fitView
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag
        zoomOnScroll
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="var(--color-border)"
        />
        <MiniMap
          nodeColor="var(--color-surface)"
          maskColor="rgba(13,15,20,0.75)"
        />
      </ReactFlow>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isTerminal(status: RunStatus | null): boolean {
  return (
    status === "succeeded" ||
    status === "failed" ||
    status === "cancelled"
  );
}

function formatElapsed(
  startedAt: string | null,
  status: RunStatus | null
): string {
  if (!startedAt) return "--:--";
  const start = new Date(startedAt).getTime();
  if (isNaN(start)) return "--:--";
  const now = isTerminal(status) ? Date.now() : Date.now();
  const diff = Math.max(0, now - start);
  const secs = Math.floor(diff / 1000);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function statusClass(status: RunStatus | null): string {
  if (!status) return "";
  switch (status) {
    case "succeeded":
      return "run-status--ok";
    case "failed":
      return "run-status--fail";
    case "running":
    case "validating":
      return "run-status--running";
    case "cancelled":
      return "run-status--cancelled";
    default:
      return "";
  }
}

function nodeStatusClass(status: NodeStatus): string {
  switch (status) {
    case "running":
      return "lr-node-status--running";
    case "succeeded":
      return "lr-node-status--ok";
    case "failed":
      return "lr-node-status--fail";
    case "waiting":
      return "lr-node-status--waiting";
    case "queued":
      return "lr-node-status--queued";
    case "cancelled":
    case "skipped":
      return "lr-node-status--muted";
    default:
      return "";
  }
}
