// RunPanel — the single run surface: live monitoring and replay unified.
// A run is always rendered from its event log: an active run follows the
// tail of the log as events stream in; scrubbing the timeline rewinds the
// same graph to any earlier point. There is no separate replay mode.
//
// Subscribes to Tauri events and loads the persisted event log on open, so
// a run opened mid-flight shows its full history. All state is derived
// from backend events — the panel never invents execution truth.
// See ARCHITECTURE.md §10 and DESIGN_SPEC.md §4.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import ReactFlow, {
  MiniMap,
  type Node,
  type Edge,
  type NodeTypes,
} from "reactflow";
import "reactflow/dist/style.css";
import WorkflowNode, {
  type WorkflowNodeData,
} from "../components/nodes/WorkflowNode";
import AgentNode from "../components/nodes/AgentNode";
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
  RunEventAppendedPayload,
  RunStatusChangedPayload,
} from "../types/ipc";
import { ipc } from "../types/ipc";
import { HumanReviewPanel } from "../components/panels/HumanReviewPanel";
import { CommandOutputPanel } from "../components/panels/CommandOutputPanel";
import { AgentSessionTerminal } from "../components/panels/AgentSessionTerminal";
import { EventInspector } from "../components/panels/EventInspector";
import { TimelineScrubber } from "../components/panels/TimelineScrubber";
import { CityBackdropViewportSynced } from "../components/canvas/CityBackdrop";
import { deriveNodeStates } from "../state/deriveNodeStates";
import { deriveTokenPcts, type TokenPctByNode } from "../state/deriveTokenPcts";

// Agent nodes render the procedural pigeon and runtime token health bar.
const NODE_TYPES: NodeTypes = {
  start: WorkflowNode,
  end: WorkflowNode,
  agent: AgentNode,
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

export interface RunPanelProps {
  runId: string;
  /** Notifies the host shell of run status transitions (for sidebar chips). */
  onRunStatusChange?: (runId: string, status: RunStatus) => void;
}

type DetailTab = "event" | "output";

export function RunPanel({ runId, onRunStatusChange }: RunPanelProps) {
  const [runStatus, setRunStatus] = useState<RunStatus | null>(null);
  const [workflowName, setWorkflowName] = useState<string>("");
  const [workspaceRoot, setWorkspaceRoot] = useState<string>("");
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<string>("--:--");
  const [events, setEvents] = useState<RunEvent[]>([]);
  // null = follow the live tail; a number = user scrubbed to that index.
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("event");
  const [error, setError] = useState<string | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowDefinition | null>(null);
  const [reviewRequest, setReviewRequest] =
    useState<HumanReviewRequestedPayload | null>(null);
  const [reviewSubmitting, setReviewSubmitting] = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const eventFeedRef = useRef<HTMLUListElement>(null);
  const seenEventIds = useRef<Set<string>>(new Set());

  const following = scrubIndex === null;
  const effectiveIndex = following
    ? events.length - 1
    : Math.min(scrubIndex, events.length - 1);
  const currentEvent = effectiveIndex >= 0 ? events[effectiveIndex] : null;

  const nodeStates = useMemo(
    () => deriveNodeStates(events, effectiveIndex),
    [events, effectiveIndex]
  );
  const tokenPcts = useMemo(
    () => deriveTokenPcts(events, effectiveIndex),
    [events, effectiveIndex]
  );
  const commandEvents = useMemo(
    () =>
      events
        .slice(0, effectiveIndex + 1)
        .filter((ev) => ev.event_type.startsWith("command.")),
    [events, effectiveIndex]
  );

  const propagateStatus = useCallback(
    (status: RunStatus) => {
      setRunStatus(status);
      onRunStatusChange?.(runId, status);
    },
    [runId, onRunStatusChange]
  );

  const appendEvents = useCallback((incoming: RunEvent[]) => {
    setEvents((prev) => {
      const fresh = incoming.filter(
        (ev) => !seenEventIds.current.has(ev.event_id)
      );
      if (fresh.length === 0) return prev;
      fresh.forEach((ev) => seenEventIds.current.add(ev.event_id));
      return [...prev, ...fresh];
    });
  }, []);

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

  // Load run metadata and the persisted event log when runId changes.
  useEffect(() => {
    setError(null);
    setEvents([]);
    seenEventIds.current = new Set();
    setScrubIndex(null);
    setDetailTab("event");
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
        propagateStatus(run.status);
        setWorkspaceRoot(run.workspace_root);
        setStartedAt(run.started_at ?? null);

        const wf = await ipc.getWorkflow({ id: run.workflow_id });
        setWorkflowName(wf?.name ?? run.workflow_id);
        setWorkflow(wf);

        // Backfill the event log so runs opened mid-flight (or finished)
        // show full history rather than only events after subscription.
        const past = await ipc.listEventsForRun({
          runId,
          offset: 0,
          limit: 1000,
        });
        appendEvents(past);
      } catch (e: unknown) {
        setError(
          typeof e === "object" && e !== null && "message" in e
            ? (e as { message: string }).message
            : String(e)
        );
      }
    })();
    // propagateStatus/appendEvents are stable per runId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  // Elapsed time ticker
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);

    if (!startedAt || isTerminal(runStatus)) {
      setElapsed(formatElapsed(startedAt));
      return;
    }

    function tick() {
      setElapsed(formatElapsed(startedAt));
    }
    tick();
    timerRef.current = setInterval(tick, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [startedAt, runStatus]);

  // Subscribe to Tauri events
  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];

    async function subscribe() {
      unlisteners.push(
        await listen<RunStatusChangedPayload>("run_status_changed", (ev) => {
          if (ev.payload.run_id !== runId) return;
          propagateStatus(ev.payload.new_status);
        })
      );

      unlisteners.push(
        await listen<RunEventAppendedPayload>("run_event_appended", (ev) => {
          if (ev.payload.event.run_id !== runId) return;
          appendEvents([ev.payload.event]);
        })
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
  }, [runId, propagateStatus, appendEvents]);

  // Polling fallback for run status and review requests.
  // Tauri push events are the primary update mechanism, but in environments
  // where event delivery is unreliable (e.g. WebKitWebDriver automation),
  // this interval ensures the UI stays consistent with backend state.
  useEffect(() => {
    let stopped = false;
    async function poll() {
      if (stopped) return;
      try {
        const run = await ipc.getRun({ runId });
        if (!run || stopped) return;
        propagateStatus(run.status);

        // When paused with no panel showing, fetch the event log for the
        // review.required event and reconstruct the review request payload.
        if (run.status === "paused") {
          const evs = await ipc.listEventsForRun({
            runId,
            offset: 0,
            limit: 200,
          });
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
  }, [runId, propagateStatus]);

  // Auto-scroll the event feed only while following the live tail.
  useEffect(() => {
    if (following && eventFeedRef.current) {
      eventFeedRef.current.scrollTop = eventFeedRef.current.scrollHeight;
    }
  }, [events, following]);

  // Run control keyboard shortcuts: Ctrl+Enter → start, Ctrl+. → cancel
  const handleRunStart = useCallback(async () => {
    if (runStatus === "running" || isTerminal(runStatus)) return;
    try {
      await ipc.startRun({ runId });
    } catch {
      // handled by event subscription
    }
  }, [runId, runStatus]);

  const handleRunCancel = useCallback(async () => {
    if (!runStatus || isTerminal(runStatus)) return;
    try {
      await ipc.cancelRun({ runId });
    } catch {
      // handled by event subscription
    }
  }, [runId, runStatus]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleRunStart();
        return;
      }
      if (e.key === "." && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleRunCancel();
        return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleRunStart, handleRunCancel]);

  const canStart =
    runStatus === "created" || runStatus === "ready";

  function handleScrub(index: number) {
    // Scrubbing to the last event re-enters follow mode.
    setScrubIndex(index >= events.length - 1 ? null : index);
  }

  return (
    <div className="run-panel" data-testid="run-panel">
      {error && <div className="lr-error">{error}</div>}
      {reviewRequest && (
        <HumanReviewPanel
          request={reviewRequest}
          onDecision={handleReviewDecision}
          submitting={reviewSubmitting}
        />
      )}

      {/* ── Run header strip ── */}
      <div className="run-strip" data-testid="run-hud">
        <span
          className={`run-status ${statusClass(runStatus)}`}
          data-testid="run-status"
        >
          {runStatus ?? "--"}
        </span>
        <span className="run-strip-name">{workflowName || "--"}</span>
        <span className="run-strip-sep">·</span>
        <span className="run-strip-id" title={runId}>
          {runId.slice(0, 8)}
        </span>
        <span className="run-strip-sep">·</span>
        <span className="run-strip-workspace" title={workspaceRoot}>
          {workspaceRoot || "--"}
        </span>
        <span className="run-strip-elapsed">{elapsed}</span>
        <div className="run-strip-controls">
          {canStart && (
            <button
              className="toolbar-btn toolbar-btn--start"
              onClick={handleRunStart}
              title="Start run (Ctrl+Enter)"
              data-testid="run-start-btn"
            >
              Start <kbd>Ctrl+Enter</kbd>
            </button>
          )}
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

      {/* ── Graph (the same canvas the workflow was designed on) ── */}
      <div className="run-graph" data-testid="live-graph">
        <RunGraph
          workflow={workflow}
          nodeStates={nodeStates}
          tokenPcts={tokenPcts}
        />
        <AgentSessionTerminal runId={runId} />
      </div>

      {/* ── Timeline dock ── */}
      <div className="run-dock">
        <div className="run-dock-scrub">
          <TimelineScrubber
            index={Math.max(0, effectiveIndex)}
            total={events.length}
            onChange={handleScrub}
          />
          {!following && (
            <button
              className="toolbar-btn run-follow-btn"
              data-testid="follow-live-btn"
              onClick={() => setScrubIndex(null)}
              title="Jump to the latest event"
            >
              ⏭ Latest
            </button>
          )}
          {following && !isTerminal(runStatus) && (
            <span className="run-live-badge" data-testid="live-badge">
              ● LIVE
            </span>
          )}
        </div>

        <div className="run-dock-panels">
          {/* Event feed */}
          <div className="run-dock-panel run-events-panel">
            <div className="panel-header">
              EVENTS <span className="panel-header-sub">({events.length})</span>
            </div>
            <ul
              className="lr-event-list"
              ref={eventFeedRef}
              data-testid="event-list"
            >
              {events.length === 0 && (
                <li className="lr-empty">waiting for events...</li>
              )}
              {events.map((ev, idx) => (
                <li
                  key={ev.event_id}
                  className={`lr-event-item ${eventFamilyClass(ev.event_type)}${idx === effectiveIndex ? " lr-event-item--selected" : ""}`}
                  onClick={() => handleScrub(idx)}
                  role="option"
                  aria-selected={idx === effectiveIndex}
                >
                  <span className="lr-event-seq">#{ev.sequence}</span>
                  <span className="lr-event-time">
                    {formatEventTime(ev.timestamp)}
                  </span>
                  <span className="lr-event-type">{ev.event_type}</span>
                  {ev.node_id && (
                    <span className="lr-event-node">
                      {nodeLabel(workflow, ev.node_id)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {/* Detail: selected event or command output */}
          <div className="run-dock-panel run-detail-panel" data-testid="event-detail">
            <div className="panel-header run-detail-tabs">
              <button
                className={`run-detail-tab${detailTab === "event" ? " run-detail-tab--active" : ""}`}
                data-testid="detail-tab-event"
                onClick={() => setDetailTab("event")}
              >
                EVENT
              </button>
              <button
                className={`run-detail-tab${detailTab === "output" ? " run-detail-tab--active" : ""}`}
                data-testid="detail-tab-output"
                onClick={() => setDetailTab("output")}
              >
                OUTPUT
                {commandEvents.length > 0 && (
                  <span className="panel-header-sub"> ({commandEvents.length})</span>
                )}
              </button>
            </div>
            {detailTab === "event" ? (
              <EventInspector event={currentEvent} />
            ) : (
              <CommandOutputPanel events={commandEvents} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RunGraph — read-only React Flow graph with event-derived state overlays
// ---------------------------------------------------------------------------

/** NodeStatus values that indicate an "active" node (source of active edges). */
const ACTIVE_STATUSES = new Set<NodeStatus>(["running", "waiting"]);

interface RunGraphProps {
  workflow: WorkflowDefinition | null;
  nodeStates: Record<string, NodeStatus>;
  tokenPcts: TokenPctByNode;
}

function RunGraph({ workflow, nodeStates, tokenPcts }: RunGraphProps) {
  const flowNodes: Node<WorkflowNodeData>[] = useMemo(() => {
    if (!workflow) return [];
    return workflow.nodes.map((n) => {
      const status = nodeStates[n.node_id];
      const visualState: VisualNodeState = status
        ? toVisualState(status)
        : "idle";
      return {
        id: n.node_id,
        type: n.node_type,
        position: { x: n.display.x, y: n.display.y },
        data: {
          kind: n.node_type,
          label: n.label,
          state: visualState,
          tokenPct:
            n.node_type === "agent" ? tokenPcts.get(n.node_id) : undefined,
        },
        draggable: false,
        selectable: false,
      };
    });
  }, [workflow, nodeStates, tokenPcts]);

  const flowEdges: Edge[] = useMemo(() => {
    if (!workflow) return [];
    return workflow.edges.map((e) => {
      const sourceStatus = nodeStates[e.source_node_id];
      const isActive = sourceStatus
        ? ACTIVE_STATUSES.has(sourceStatus)
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
  }, [workflow, nodeStates]);

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
        <CityBackdropViewportSynced />
        <div className="wf-canvas-grid" aria-hidden="true" />
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
    status === "succeeded" || status === "failed" || status === "cancelled"
  );
}

function formatElapsed(startedAt: string | null): string {
  if (!startedAt) return "--:--";
  const start = new Date(startedAt).getTime();
  if (isNaN(start)) return "--:--";
  const diff = Math.max(0, Date.now() - start);
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

/** Resolve a node_id to its human label; falls back to a short id. */
function nodeLabel(
  workflow: WorkflowDefinition | null,
  nodeId: string
): string {
  const node = workflow?.nodes.find((n) => n.node_id === nodeId);
  return node?.label ?? nodeId.slice(0, 8);
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
