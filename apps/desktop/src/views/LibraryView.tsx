// LibraryView — browse workflows and past runs.
// Provides navigation to Builder and Replay views.
// See ARCHITECTURE.md §10.4 and DESIGN_SPEC.md §4.4.

import { useEffect, useRef, useState } from "react";
import { ipc } from "../types/ipc";
import type { RunInstance, WorkflowDefinition } from "../types/workflow";

interface Props {
  onOpenReplay: (runId: string) => void;
  onOpenBuilder?: (workflowId?: string) => void;
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

export function LibraryView({ onOpenReplay, onOpenBuilder }: Props) {
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [runs, setRuns] = useState<Record<string, RunInstance[]>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
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
      const r = await ipc.listRunsForWorkflow({ workflow_id: workflowId });
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
                    </div>
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
