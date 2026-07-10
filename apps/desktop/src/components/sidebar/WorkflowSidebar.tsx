// WorkflowSidebar — the always-visible library pane of the unified workspace.
// Lists workflows; the selected workflow expands to show its run history.
// Selecting a workflow loads it onto the canvas; selecting a run opens the
// run surface on the same canvas. Presentational: the App shell owns data.
// See DESIGN_SPEC.md §4.

import { useMemo, useRef, useState } from "react";
import {
  Download,
  FilePlus2,
  History,
  Search,
  Trash2,
  Upload,
  Workflow,
} from "lucide-react";
import type { RunInstance, WorkflowDefinition } from "../../types/workflow";

export interface WorkflowSidebarProps {
  workflows: WorkflowDefinition[];
  /** Runs for the selected workflow (null = not loaded yet). */
  runs: RunInstance[] | null;
  selectedWorkflowId: string | null;
  selectedRunId: string | null;
  onSelectWorkflow: (id: string) => void;
  onSelectRun: (runId: string) => void;
  onNewWorkflow: () => void;
  onImport: (json: string) => void;
  onExport: (workflowId: string) => void;
  onDelete: (workflowId: string) => void;
  error?: string | null;
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
  paused: "run-status--running",
};

export function WorkflowSidebar({
  workflows,
  runs,
  selectedWorkflowId,
  selectedRunId,
  onSelectWorkflow,
  onSelectRun,
  onNewWorkflow,
  onImport,
  onExport,
  onDelete,
  error,
}: WorkflowSidebarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const visibleWorkflows = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return workflows;
    return workflows.filter((workflow) =>
      workflow.name.toLocaleLowerCase().includes(normalized)
    );
  }, [query, workflows]);

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const json = await file.text();
    onImport(json);
    e.target.value = "";
  }

  return (
    <aside className="workflow-sidebar" data-testid="workflow-sidebar">
      <div className="sidebar-header">
        <div className="sidebar-heading">
          <span className="sidebar-heading-icon" aria-hidden="true">
            <Workflow size={16} />
          </span>
          <div>
            <span className="sidebar-title">Workflow Library</span>
            <span className="sidebar-count">{workflows.length} saved</span>
          </div>
        </div>
        <div className="sidebar-actions">
          <button
            className="icon-btn"
            data-testid="new-workflow-btn"
            onClick={onNewWorkflow}
            title="New empty workflow"
            aria-label="New workflow"
          >
            <FilePlus2 size={15} />
          </button>
          <button
            className="icon-btn"
            data-testid="import-btn"
            onClick={() => fileInputRef.current?.click()}
            title="Import a workflow JSON file"
            aria-label="Import workflow"
          >
            <Upload size={15} />
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

      <label className="sidebar-search">
        <Search size={14} aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search workflows"
          aria-label="Search workflows"
        />
      </label>

      {error && (
        <div className="lib-error" data-testid="lib-error">
          {error}
        </div>
      )}

      {workflows.length === 0 ? (
        <div className="lib-empty" data-testid="empty-workflows">
          <Workflow size={24} aria-hidden="true" />
          <strong>No workflows yet</strong>
          <span>Create a workflow or import a JSON definition.</span>
        </div>
      ) : visibleWorkflows.length === 0 ? (
        <div className="lib-empty">
          <Search size={22} aria-hidden="true" />
          <strong>No matches</strong>
          <span>Try another workflow name.</span>
        </div>
      ) : (
        <ul className="sidebar-list" data-testid="workflow-list">
          {visibleWorkflows.map((wf) => {
            const isSelected = selectedWorkflowId === wf.workflow_id;
            return (
              <li key={wf.workflow_id}>
                <div
                  className={`sidebar-card${isSelected ? " sidebar-card--selected" : ""}`}
                  data-testid={`workflow-card-${wf.workflow_id}`}
                  onClick={() => onSelectWorkflow(wf.workflow_id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      onSelectWorkflow(wf.workflow_id);
                    }
                  }}
                >
                  <div className="sidebar-card-main">
                    <span className="sidebar-card-glyph" aria-hidden="true">
                      <Workflow size={15} />
                    </span>
                    <span className="sidebar-card-copy">
                      <span className="sidebar-card-name">{wf.name}</span>
                      <span className="sidebar-card-meta">
                        Version {wf.version} · {formatDate(wf.updated_at)}
                      </span>
                    </span>
                  </div>
                  {isSelected && (
                    <div className="sidebar-card-actions">
                      <button
                        className="sidebar-action-btn sidebar-export-btn"
                        data-testid={`export-btn-${wf.workflow_id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onExport(wf.workflow_id);
                        }}
                        title="Export workflow"
                      >
                        <Download size={13} />
                        Export
                      </button>
                      <button
                        className="sidebar-action-btn lib-btn--danger"
                        data-testid={`delete-btn-${wf.workflow_id}`}
                        title="Delete this workflow"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(wf.workflow_id);
                        }}
                      >
                        <Trash2 size={13} />
                        Delete
                      </button>
                    </div>
                  )}
                </div>

                {/* Runs for the expanded workflow */}
                {isSelected && (
                  <div className="sidebar-runs">
                    <div className="sidebar-runs-header">
                      <History size={12} />
                      Run history
                    </div>
                    {runs === null ? (
                      <div className="lib-empty">loading…</div>
                    ) : runs.length === 0 ? (
                      <div className="lib-empty" data-testid="empty-runs">
                        No runs yet
                      </div>
                    ) : (
                      <ul className="sidebar-run-list" data-testid="run-list">
                        {runs.map((run) => (
                          <li
                            key={run.run_id}
                            className={`sidebar-run-card${selectedRunId === run.run_id ? " sidebar-run-card--selected" : ""}`}
                            data-testid={`run-card-${run.run_id}`}
                            onClick={() => onSelectRun(run.run_id)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                onSelectRun(run.run_id);
                              }
                            }}
                          >
                            <span
                              className={`run-status ${STATUS_CLASS[run.status] ?? ""}`}
                            >
                              {run.status}
                            </span>
                            <span className="sidebar-run-meta">
                              {formatDate(run.created_at)} · {duration(run)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
