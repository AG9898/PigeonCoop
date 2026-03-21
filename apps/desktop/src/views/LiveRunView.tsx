// Live Run View — monitors active workflow execution.
// Subscribes to Tauri events (never polls) and derives all state from events.
// Renders a read-only React Flow graph with per-node state animations.
// See ARCHITECTURE.md §10.2 and DESIGN_SPEC.md §4.2, §7.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  HumanReviewDecision,
  HumanReviewRequestedPayload,
  NodeStatusChangedPayload,
  RunEventAppendedPayload,
  RunStatusChangedPayload,
} from "../types/ipc";
import { ipc } from "../types/ipc";
import { HumanReviewPanel } from "../components/panels/HumanReviewPanel";

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
  const [reviewRequest, setReviewRequest] =
    useState<HumanReviewRequestedPayload | null>(null);
  const [reviewSubmitting, setReviewSubmitting] = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const eventFeedRef = useRef<HTMLUListElement>(null);

  async function handleReviewDecision(decision: HumanReviewDecision) {
    if (!reviewRequest) return;
    setReviewSubmitting(true);
    try {
      await ipc.submitHumanReviewDecision({
        runId: reviewRequest.run_id,
        nodeId: reviewRequest.node_id,
        decision,
      });
    } finally {
      setReviewSubmitting(false);
      setReviewRequest(null);
    }
  }

  // Load initial run data when runId changes
  useEffect(() => {
    if (!runId) return;
    setError(null);
    setEvents([]);
    setNodeStatuses(new Map());
    setSelectedEvent(null);
    setWorkflow(null);
    setReviewRequest(null);
    setReviewSubmitting(false);

    (async () => {
      try {
        const run = await ipc.getRun({ runId });
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

      unlisteners.push(
        await listen<HumanReviewRequestedPayload>(
          "human_review_requested",
          (ev) => {
            if (ev.payload.run_id !== runId) return;
            setReviewRequest(ev.payload);
          }
        )
      );
    }

    subscribe();

    return () => {
      unlisteners.forEach((fn) => fn());
    };
  }, [runId]);

  // Polling fallback for run status and review requests.
  // Tauri push events are the primary update mechanism, but in environments
  // where event delivery is unreliable (e.g. WebKitWebDriver automation),
  // this interval ensures the UI stays consistent with backend state.
  useEffect(() => {
    if (!runId) return;

    let stopped = false;
    async function poll() {
      if (stopped) return;
      try {
        const run = await ipc.getRun({ runId: runId! });
        if (!run || stopped) return;
        setRunStatus(run.status);

        // When paused with no panel showing, fetch the event log for the
        // review.required event and reconstruct the review request payload.
        if (run.status === "paused") {
          const evs = await ipc.listEventsForRun({ runId: runId!, offset: 0, limit: 200 });
          if (stopped) return;
          const reviewEv = evs.find((e) => e.event_type === "review.required");
          if (reviewEv && reviewEv.node_id) {
            const p = reviewEv.payload as {
              reason?: string;
              available_actions?: string[];
            } | null;
            setReviewRequest((prev) => {
              if (prev) return prev; // already set by event — don't overwrite
              return {
                run_id: run.run_id,
                node_id: reviewEv.node_id!,
                node_label: reviewEv.node_id!,
                reason: p?.reason ?? "",
                available_actions: (p?.available_actions ?? []) as Array<
                  "approve" | "reject" | "retry" | "edit_memory"
                >,
                timestamp: reviewEv.timestamp,
              };
            });
          }
        }
      } catch {
        // Ignore transient errors from polling
      }
    }

    const id = setInterval(poll, 2000);
    poll(); // immediate first check
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [runId]);

  // Auto-scroll event feed
  useEffect(() => {
    if (eventFeedRef.current) {
      eventFeedRef.current.scrollTop = eventFeedRef.current.scrollHeight;
    }
  }, [events]);

  // Run control keyboard shortcuts: Ctrl+Enter → start, Ctrl+. → cancel
  const handleRunStart = useCallback(async () => {
    if (!runId || runStatus === "running" || runStatus === "cancelled") return;
    try {
      await ipc.startRun({ runId });
    } catch {
      // handled by event subscription
    }
  }, [runId, runStatus]);

  const handleRunCancel = useCallback(async () => {
    if (!runId || !runStatus || isTerminal(runStatus)) return;
    try {
      await ipc.cancelRun({ runId });
    } catch {
      // handled by event subscription
    }
  }, [runId, runStatus]);

  useEffect(() => {
    if (!runId) return;
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      // Ctrl+Enter or Cmd+Enter → start run
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleRunStart();
        return;
      }
      // Ctrl+. or Cmd+. → cancel run
      if (e.key === "." && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleRunCancel();
        return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [runId, handleRunStart, handleRunCancel]);

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
      {reviewRequest && (
        <HumanReviewPanel
          request={reviewRequest}
          onDecision={handleReviewDecision}
          submitting={reviewSubmitting}
        />
      )}
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
          <div className="lr-hud-row lr-hud-controls">
            <button
              className="toolbar-btn toolbar-btn--start"
              onClick={handleRunStart}
              disabled={runStatus === "running" || runStatus === "cancelled" || isTerminal(runStatus)}
              title="Start run (Ctrl+Enter)"
              data-testid="run-start-btn"
            >
              Start <kbd>Ctrl+Enter</kbd>
            </button>
            <button
              className="toolbar-btn toolbar-btn--cancel"
              onClick={handleRunCancel}
              disabled={!runStatus || isTerminal(runStatus)}
              title="Cancel run (Ctrl+.)"
              data-testid="run-cancel-btn"
            >
              Cancel <kbd>Ctrl+.</kbd>
            </button>
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
                  className={`lr-event-item ${eventFamilyClass(ev.event_type)}${selectedEvent?.event_id === ev.event_id ? " lr-event-item--selected" : ""}`}
                  onClick={() => setSelectedEvent(ev)}
                >
                  <span className="lr-event-seq">#{ev.sequence}</span>
                  <span className="lr-event-time">
                    {formatEventTime(ev.timestamp)}
                  </span>
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

/** Extract the event family from a dotted event_type (e.g. "run.started" → "run"). */
function eventFamily(eventType: string): string {
  const dot = eventType.indexOf(".");
  return dot > 0 ? eventType.slice(0, dot) : eventType;
}

const KNOWN_FAMILIES = new Set([
  "run", "node", "command", "agent", "routing", "review", "memory", "budget", "guardrail",
]);

/** CSS modifier class for event family color-coding. */
function eventFamilyClass(eventType: string): string {
  const family = eventFamily(eventType);
  return KNOWN_FAMILIES.has(family) ? `lr-event-item--${family}` : "";
}

/** Format an ISO timestamp to a short HH:MM:SS.mmm display. */
function formatEventTime(timestamp: string): string {
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return "";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}
