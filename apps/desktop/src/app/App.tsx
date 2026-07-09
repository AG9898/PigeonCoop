// Root application shell — the unified workspace (DEC-011).
//
// One screen instead of four routed views: a persistent workflow sidebar
// (library), a top bar with workflow identity and run controls, and a
// single main stage. The stage shows the editable design canvas when a
// workflow is selected, and the run surface (live + replay unified) when
// a run is selected. See ARCHITECTURE.md §10 and DESIGN_SPEC.md §4.

import { useCallback, useEffect, useRef, useState } from "react";
import { WorkflowSidebar } from "../components/sidebar/WorkflowSidebar";
import { DesignSurface, type DesignSurfaceHandle } from "../views/DesignSurface";
import { RunPanel } from "../views/RunPanel";
import { useFirstRun } from "../hooks/useFirstRun";
import { ipc } from "../types/ipc";
import type {
  RunInstance,
  RunStatus,
  ValidationResult,
  WorkflowDefinition,
} from "../types/workflow";

const WORKSPACE_ROOT_KEY = "agent-arcade.workspaceRoot";

export function App() {
  const designRef = useRef<DesignSurfaceHandle>(null);

  // Library state
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [runs, setRuns] = useState<RunInstance[] | null>(null);
  const [sidebarError, setSidebarError] = useState<string | null>(null);

  // Selection: a workflow is always the context; a run overlays the stage.
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  // Design canvas state
  const [loadedWorkflow, setLoadedWorkflow] = useState<WorkflowDefinition | undefined>();
  const [canvasKey, setCanvasKey] = useState("new");
  const [workflowName, setWorkflowName] = useState("Untitled Workflow");
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);

  // Run controls
  const [workspaceRoot, setWorkspaceRoot] = useState<string>(
    () => localStorage.getItem(WORKSPACE_ROOT_KEY) ?? ""
  );
  const [runStarting, setRunStarting] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [statusIsError, setStatusIsError] = useState(false);

  const { seeding } = useFirstRun();

  function report(message: string, isError = false) {
    setStatus(message);
    setStatusIsError(isError);
  }

  const loadWorkflows = useCallback(async (): Promise<WorkflowDefinition[]> => {
    try {
      const wfs = (await ipc.listWorkflows()) ?? [];
      setWorkflows(wfs);
      setSidebarError(null);
      return wfs;
    } catch (e) {
      setSidebarError(String(e));
      return [];
    }
  }, []);

  const loadRuns = useCallback(async (workflowId: string) => {
    try {
      const r = await ipc.listRunsForWorkflow({ workflowId });
      setRuns(r ?? []);
    } catch {
      setRuns([]);
    }
  }, []);

  const openWorkflow = useCallback(
    (wf: WorkflowDefinition) => {
      setSelectedWorkflowId(wf.workflow_id);
      setSelectedRunId(null);
      setLoadedWorkflow(wf);
      setCanvasKey(wf.workflow_id);
      setWorkflowName(wf.name);
      setValidationResult(null);
      setRuns(null);
      loadRuns(wf.workflow_id);
    },
    [loadRuns]
  );

  // Initial load (after demo seeding settles): open the first workflow so
  // the canvas is never a dead end on launch.
  useEffect(() => {
    if (seeding) return;
    (async () => {
      const wfs = await loadWorkflows();
      if (wfs.length > 0) {
        openWorkflow(wfs[0]);
      }
    })();
    // openWorkflow/loadWorkflows are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seeding]);

  // Persist the workspace root so Run is one click on every later session.
  useEffect(() => {
    localStorage.setItem(WORKSPACE_ROOT_KEY, workspaceRoot);
  }, [workspaceRoot]);

  function handleSelectWorkflow(id: string) {
    const wf = workflows.find((w) => w.workflow_id === id);
    if (!wf) return;
    if (id === selectedWorkflowId && selectedRunId === null) return;
    openWorkflow(wf);
  }

  function handleSelectRun(runId: string) {
    setSelectedRunId(runId);
  }

  function handleBackToEditor() {
    setSelectedRunId(null);
  }

  function handleNewWorkflow() {
    setSelectedWorkflowId(null);
    setSelectedRunId(null);
    setLoadedWorkflow(undefined);
    setCanvasKey(`new-${Date.now()}`);
    setWorkflowName("Untitled Workflow");
    setValidationResult(null);
    setRuns(null);
    report("");
  }

  async function handleImport(json: string) {
    try {
      const wf = await ipc.importWorkflow({ json });
      await loadWorkflows();
      openWorkflow(wf);
      report("Imported");
    } catch (e) {
      setSidebarError(String(e));
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
    } catch (e) {
      setSidebarError(String(e));
    }
  }

  /** Persist the current canvas. Returns the workflow_id, or null on failure. */
  const saveCurrent = useCallback(async (): Promise<string | null> => {
    const id = selectedWorkflowId ?? crypto.randomUUID();
    const name = workflowName.trim() || "Untitled Workflow";
    const wf = designRef.current?.buildWorkflow(id, name);
    if (!wf) return null;

    try {
      const exists = workflows.some((w) => w.workflow_id === id);
      if (exists) {
        await ipc.updateWorkflow({ workflow: wf });
      } else {
        await ipc.createWorkflow({ workflow: wf });
        setSelectedWorkflowId(id);
        loadRuns(id);
      }
      await loadWorkflows();
      report("Saved");
      return id;
    } catch (e) {
      report(`Save failed: ${e}`, true);
      return null;
    }
  }, [selectedWorkflowId, workflowName, workflows, loadWorkflows, loadRuns]);

  async function handleValidate() {
    const id = selectedWorkflowId ?? crypto.randomUUID();
    const name = workflowName.trim() || "Untitled Workflow";
    const wf = designRef.current?.buildWorkflow(id, name);
    if (!wf) return;

    try {
      const result = await ipc.validateWorkflow({ workflow: wf });
      setValidationResult(result);
      report(result.is_valid ? "Valid" : `${result.errors.length} error(s)`, !result.is_valid);
    } catch (e) {
      report(`Validation failed: ${e}`, true);
    }
  }

  /**
   * One-click run: save the canvas (design mode), create a run in the
   * configured workspace, start it, and open the run surface.
   */
  async function handleRun() {
    if (runStarting) return;
    const root = workspaceRoot.trim();
    if (!root) {
      report("Set a workspace folder to run in", true);
      return;
    }

    setRunStarting(true);
    try {
      // In design mode the canvas is live — persist it first so the run
      // executes exactly what is on screen. With a run open, the stored
      // definition is the source.
      let workflowId = selectedWorkflowId;
      if (selectedRunId === null) {
        workflowId = await saveCurrent();
      }
      if (!workflowId) return;

      const run = await ipc.createRun({ workflowId, workspaceRoot: root });
      await ipc.startRun({ runId: run.run_id });
      await loadRuns(workflowId);
      setSelectedRunId(run.run_id);
      report("Run started");
    } catch (e) {
      report(`Run failed: ${e}`, true);
    } finally {
      setRunStarting(false);
    }
  }

  /** Keep the sidebar run chips in sync with the open run's transitions. */
  const handleRunStatusChange = useCallback(
    (runId: string, newStatus: RunStatus) => {
      setRuns((prev) => {
        if (!prev) return prev;
        let changed = false;
        const next = prev.map((r) => {
          if (r.run_id !== runId || r.status === newStatus) return r;
          changed = true;
          return { ...r, status: newStatus };
        });
        return changed ? next : prev;
      });
    },
    []
  );

  // Ctrl+S saves the canvas in design mode.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "s" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (selectedRunId === null) saveCurrent();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedRunId, saveCurrent]);

  const runOpen = selectedRunId !== null;

  return (
    <div className="app">
      {/* ── Top bar: identity + actions, shared across modes ── */}
      <nav className="app-topbar">
        <span className="app-nav-brand">AGENT ARCADE</span>

        {runOpen ? (
          <button
            className="toolbar-btn topbar-edit-btn"
            data-testid="back-to-editor-btn"
            onClick={handleBackToEditor}
            title="Back to the workflow editor"
          >
            ✎ Edit workflow
          </button>
        ) : (
          <>
            <input
              className="topbar-name-input"
              data-testid="workflow-name-input"
              value={workflowName}
              onChange={(e) => setWorkflowName(e.target.value)}
              placeholder="Workflow name"
              aria-label="Workflow name"
            />
            <button
              className="toolbar-btn"
              data-testid="save-btn"
              onClick={saveCurrent}
              title="Save workflow (Ctrl+S)"
            >
              Save
            </button>
            <button
              className="toolbar-btn toolbar-btn--validate"
              data-testid="validate-btn"
              onClick={handleValidate}
            >
              Validate
            </button>
          </>
        )}

        {status && (
          <span
            className={`topbar-status${statusIsError ? " topbar-status--error" : ""}`}
            data-testid="topbar-status"
          >
            {status}
          </span>
        )}

        <div className="topbar-run-controls">
          <input
            className="topbar-workspace-input"
            data-testid="workspace-input"
            value={workspaceRoot}
            onChange={(e) => setWorkspaceRoot(e.target.value)}
            placeholder="workspace folder (where commands run)"
            aria-label="Workspace folder"
            title="Runs execute commands inside this folder"
          />
          <button
            className="toolbar-btn toolbar-btn--start topbar-run-btn"
            data-testid="run-btn"
            onClick={handleRun}
            disabled={runStarting || (runOpen ? !selectedWorkflowId : false)}
          >
            {runStarting ? "Starting…" : "▶ Run"}
          </button>
        </div>
      </nav>

      {/* ── Workspace: sidebar + stage ── */}
      <div className="app-workspace">
        <WorkflowSidebar
          workflows={workflows}
          runs={runs}
          selectedWorkflowId={selectedWorkflowId}
          selectedRunId={selectedRunId}
          onSelectWorkflow={handleSelectWorkflow}
          onSelectRun={handleSelectRun}
          onNewWorkflow={handleNewWorkflow}
          onImport={handleImport}
          onExport={handleExport}
          error={sidebarError}
        />

        <main className="app-stage">
          {runOpen ? (
            <RunPanel
              runId={selectedRunId!}
              onRunStatusChange={handleRunStatusChange}
            />
          ) : (
            <DesignSurface
              ref={designRef}
              workflow={loadedWorkflow}
              canvasKey={canvasKey}
              validationResult={validationResult}
              onDismissValidation={() => setValidationResult(null)}
            />
          )}
        </main>
      </div>
    </div>
  );
}
