// LibraryView — browse workflows and past runs.
// Provides navigation to Builder and Replay views.
// See ARCHITECTURE.md §10.4 and DESIGN_SPEC.md §4.4.

import { useEffect, useRef, useState } from "react";
import { ipc } from "../types/ipc";
import type { RunInstance, WorkflowDefinition } from "../types/workflow";

interface Props {
  onOpenReplay: (runId: string) => void;
  onOpenBuilder?: (workflowId?: string) => void;
  onOpenLiveRun?: (runId: string) => void;
  /** When true, shows a welcome banner highlighting the demo workflow. */
  isFirstRun?: boolean;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function duration(run: RunInstance): string {
  if (!run.started_at) return "—";
  const end = run.ended_at ? new Date(run.ended_at) : new Date();
  const ms = end.getTime() - new Date(run.started_at).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

const STATUS_CLASS: Record<string, string> = {
  succeeded: "run-status--ok",
  failed: "run-status--fail",
  cancelled: "run-status--cancelled",
  running: "run-status--running",
};

interface StartRunForm {
  workspace: string;
  running: boolean;
  error: string | null;
}

export function LibraryView({ onOpenReplay, onOpenBuilder, onOpenLiveRun, isFirstRun }: Props) {
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [runs, setRuns] = useState<Record<string, RunInstance[]>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [startRunForms, setStartRunForms] = useState<Record<string, StartRunForm>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function loadWorkflows() {
    try {
      const wfs = await ipc.listWorkflows();
      setWorkflows(wfs ?? []);
    } catch (e) {
      setError(String(e));
    }
  }

  async function loadRuns(workflowId: string) {
    if (runs[workflowId]) return;
    try {
      const r = await ipc.listRunsForWorkflow({ workflowId });
      setRuns((prev) => ({ ...prev, [workflowId]: r ?? [] }));
    } catch {
      setRuns((prev) => ({ ...prev, [workflowId]: [] }));
    }
  }

  useEffect(() => {
    loadWorkflows();
  }, []);

  function selectWorkflow(id: string) {
    setSelectedId((prev) => (prev === id ? null : id));
    loadRuns(id);
  }

  async function handleImport() {
    fileInputRef.current?.click();
  }

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError(null);
    try {
      const json = await file.text();
      await ipc.importWorkflow({ json });
      await loadWorkflows();
      e.target.value = "";
    } catch (err) {
      setImportError(String(err));
      e.target.value = "";
    }
  }

  async function handleExport(workflowId: string) {
    try {
      const json = await ipc.exportWorkflow({ id: workflowId });
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `workflow-${workflowId}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(String(err));
    }
  }

  function toggleStartRunForm(workflowId: string) {
    setStartRunForms((prev) => {
      if (prev[workflowId]) {
        const next = { ...prev };
        delete next[workflowId];
        return next;
      }
      return { ...prev, [workflowId]: { workspace: "", running: false, error: null } };
    });
  }

  function updateWorkspace(workflowId: string, value: string) {
    setStartRunForms((prev) => ({
      ...prev,
      [workflowId]: { ...prev[workflowId], workspace: value, error: null },
    }));
  }

  async function submitStartRun(workflowId: string) {
    const form = startRunForms[workflowId];
    if (!form || form.running) return;
    setStartRunForms((prev) => ({
      ...prev,
      [workflowId]: { ...prev[workflowId], running: true, error: null },
    }));
    try {
      const run = await ipc.createRun({ workflowId, workspaceRoot: form.workspace });
      await ipc.startRun({ runId: run.run_id });
      setStartRunForms((prev) => {
        const next = { ...prev };
        delete next[workflowId];
        return next;
      });
      onOpenLiveRun?.(run.run_id);
    } catch (e) {
      setStartRunForms((prev) => ({
        ...prev,
        [workflowId]: { ...prev[workflowId], running: false, error: String(e) },
      }));
    }
  }

  const selected = selectedId ? workflows.find((w) => w.workflow_id === selectedId) : null;
  const selectedRuns = selectedId ? (runs[selectedId] ?? null) : null;
  const recentRun = (wfId: string) => runs[wfId]?.[0] ?? null;

  return (
    <div className="view library-view">
      <div className="view-header">
        <span className="view-title">LIBRARY</span>
        <span className="view-subtitle">workflows &amp; run history</span>
        <div className="library-header-actions">
          <button
            className="lib-btn"
            data-testid="import-btn"
            onClick={handleImport}
          >
            Import
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            style={{ display: "none" }}
            data-testid="import-file-input"
            onChange={onFileChange}
          />
        </div>
      </div>

      {(error || importError) && (
        <div className="lib-error" data-testid="lib-error">
          {error ?? importError}
        </div>
      )}

      {isFirstRun && (
        <div className="lib-welcome" data-testid="welcome-banner">
          <div className="lib-welcome-title">WELCOME TO AGENT ARCADE</div>
          <div className="lib-welcome-body">
            A demo workflow is ready to go. Select it below, choose a workspace
            directory, and run it to see the system in action.
          </div>
        </div>
      )}

      <div className="view-body library-body">
        {/* Workflow list */}
        <div className="library-panel">
          <div className="panel-header">WORKFLOWS</div>
          {workflows.length === 0 ? (
            <div className="lib-empty" data-testid="empty-workflows">
              no workflows found
            </div>
          ) : (
            <ul className="lib-list" data-testid="workflow-list">
              {workflows.map((wf) => {
                const latest = recentRun(wf.workflow_id);
                const isSelected = selectedId === wf.workflow_id;
                const form = startRunForms[wf.workflow_id];
                return (
                  <li
                    key={wf.workflow_id}
                    className={`lib-card${isSelected ? " lib-card--selected" : ""}`}
                    data-testid={`workflow-card-${wf.workflow_id}`}
                    onClick={() => selectWorkflow(wf.workflow_id)}
                  >
                    <div className="lib-card-main">
                      <span className="lib-card-name">{wf.name}</span>
                      <span className="lib-card-meta">
                        v{wf.version} · {formatDate(wf.updated_at)}
                      </span>
                      {latest && (
                        <span
                          className={`run-status ${STATUS_CLASS[latest.status] ?? ""}`}
                        >
                          {latest.status}
                        </span>
                      )}
                    </div>
                    <div className="lib-card-actions">
                      <button
                        className="lib-btn lib-btn--sm"
                        data-testid={`open-builder-${wf.workflow_id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenBuilder?.(wf.workflow_id);
                        }}
                      >
                        Open
                      </button>
                      <button
                        className="lib-btn lib-btn--sm"
                        data-testid={`export-btn-${wf.workflow_id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleExport(wf.workflow_id);
                        }}
                      >
                        Export
                      </button>
                      <button
                        className="lib-btn lib-btn--sm lib-btn--run"
                        data-testid={`start-run-${wf.workflow_id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleStartRunForm(wf.workflow_id);
                        }}
                      >
                        Start Run
                      </button>
                    </div>
                    {form && (
                      <div
                        className="lib-start-run-form"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          className="lib-workspace-input"
                          type="text"
                          placeholder="workspace path"
                          data-testid={`workspace-input-${wf.workflow_id}`}
                          value={form.workspace}
                          onChange={(e) => updateWorkspace(wf.workflow_id, e.target.value)}
                          disabled={form.running}
                        />
                        <button
                          className="lib-btn lib-btn--sm"
                          data-testid={`submit-run-${wf.workflow_id}`}
                          disabled={form.running}
                          onClick={() => submitStartRun(wf.workflow_id)}
                        >
                          {form.running ? "Starting…" : "Run"}
                        </button>
                        {form.error && (
                          <span
                            className="lib-run-error"
                            data-testid={`start-run-error-${wf.workflow_id}`}
                          >
                            {form.error}
                          </span>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Run history */}
        <div className="library-panel">
          <div className="panel-header">
            RUN HISTORY
            {selected && (
              <span className="panel-header-sub"> — {selected.name}</span>
            )}
          </div>
          {!selected ? (
            <div className="lib-empty">select a workflow to view runs</div>
          ) : selectedRuns === null ? (
            <div className="lib-empty">loading…</div>
          ) : selectedRuns.length === 0 ? (
            <div className="lib-empty" data-testid="empty-runs">
              no runs yet
            </div>
          ) : (
            <ul className="lib-list" data-testid="run-list">
              {selectedRuns.map((run) => (
                <li
                  key={run.run_id}
                  className="lib-card lib-card--run"
                  data-testid={`run-card-${run.run_id}`}
                >
                  <div className="lib-card-main">
                    <span
                      className={`run-status ${STATUS_CLASS[run.status] ?? ""}`}
                    >
                      {run.status}
                    </span>
                    <span className="lib-card-meta">
                      {formatDate(run.created_at)} · {duration(run)}
                    </span>
                    <span className="lib-card-id">{run.run_id.slice(0, 8)}</span>
                  </div>
                  {onOpenLiveRun && (
                    <button
                      className="lib-btn lib-btn--sm"
                      data-testid={`open-liverun-${run.run_id}`}
                      onClick={() => onOpenLiveRun(run.run_id)}
                    >
                      Live Run
                    </button>
                  )}
                  <button
                    className="lib-btn lib-btn--sm"
                    data-testid={`open-replay-${run.run_id}`}
                    onClick={() => onOpenReplay(run.run_id)}
                  >
                    Replay
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
