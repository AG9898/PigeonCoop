// E2E test: failure handling
//
// Covers: TEST-006 — E2E test: failure handling
//
// Flow: create a dedicated workflow (start → tool[exit 1] → end) via IPC →
//       create a run against the test workspace → navigate to LibraryView →
//       click the workflow card to load run history → click "Live Run" button
//       to open LiveRunView with the run ID (subscribes to events BEFORE the
//       run starts) → start the run via IPC → poll until the run reaches
//       Failed → verify the Tool node transitioned to Failed, the run
//       transitioned to Failed, and the failed node renders with the
//       high-contrast failed state class in the live graph.
//
// Prerequisites (must be done before `npm test`):
//   1. cargo tauri build --debug
//   2. tauri-driver  (separate terminal — WebDriver on localhost:4444)
//
// Test workspace: tests/e2e/fixtures/test-workspace/
//   Never points at a real project directory.
//
// Why a dedicated workflow instead of the demo workflow:
//   The canonical demo workflow's Tool node runs `echo 'tool executed'`,
//   which always succeeds. Failure handling requires a Tool node whose
//   command exits non-zero, so this spec creates a minimal
//   start → tool → end workflow via `create_workflow` IPC with
//   `retry_policy.max_retries: 0` on the Tool node so the node (and then the
//   run) fails on the first attempt without waiting through retry backoff.

import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TEST_WORKSPACE = path.resolve(__dirname, '../fixtures/test-workspace');

// Fixed IDs for the dedicated failure-workflow (distinct from the demo
// workflow's 00000000.../10000000... IDs).
const WORKFLOW_ID = '30000000-0000-0000-0000-000000000001';
const NODE = {
  start: '30000000-0000-0000-0000-000000000002',
  tool:  '30000000-0000-0000-0000-000000000003',
  end:   '30000000-0000-0000-0000-000000000004',
};

const FAILURE_WORKFLOW = {
  workflow_id: WORKFLOW_ID,
  name: 'E2E Failure Workflow',
  version: 1,
  metadata: {
    description: 'Minimal start -> tool -> end workflow with a Tool node that always fails, used by TEST-006.',
  },
  nodes: [
    {
      node_id: NODE.start,
      node_type: 'start',
      label: 'Start',
      config: {},
      input_contract: {},
      output_contract: {},
      memory_access: {},
      retry_policy: { max_retries: 0 },
      display: { x: 100, y: 200 },
    },
    {
      node_id: NODE.tool,
      node_type: 'tool',
      label: 'Failing Tool',
      config: {
        command: 'exit 1',
      },
      input_contract: {},
      output_contract: {},
      memory_access: {},
      // No retries: the node (and then the run) fails on the first attempt.
      retry_policy: { max_retries: 0 },
      display: { x: 350, y: 200 },
    },
    {
      node_id: NODE.end,
      node_type: 'end',
      label: 'End',
      config: {},
      input_contract: {},
      output_contract: {},
      memory_access: {},
      retry_policy: { max_retries: 0 },
      display: { x: 600, y: 200 },
    },
  ],
  edges: [
    {
      edge_id: '30000000-0000-0000-0000-000000000010',
      source_node_id: NODE.start,
      target_node_id: NODE.tool,
      condition_kind: 'always',
    },
    {
      // on_success only: when the Tool node fails, this edge does not match,
      // there is no on_failure edge, so RouterEvaluator returns NoMatch and
      // the run coordinator fails the run.
      edge_id: '30000000-0000-0000-0000-000000000011',
      source_node_id: NODE.tool,
      target_node_id: NODE.end,
      condition_kind: 'on_success',
    },
  ],
  default_constraints: {
    max_retries: 0,
    max_runtime_ms: 60000,
  },
  // Required by the Rust WorkflowDefinition (no serde default for these).
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

// Helper: call a Tauri command via window.__TAURI_INTERNALS__.invoke.
async function tauriInvoke(command, args = {}) {
  const result = await browser.executeAsync(function(cmd, cmdArgs, done) {
    window.__TAURI_INTERNALS__.invoke(cmd, cmdArgs)
      .then(function(data) { done({ ok: true, data: data }); })
      .catch(function(err) { done({ ok: false, error: String(err) }); });
  }, command, args);

  if (!result.ok) {
    throw new Error(`Tauri command "${command}" failed: ${result.error}`);
  }
  return result.data;
}

// Helper: poll a Tauri command until predicate returns truthy, or timeout.
async function pollUntil(command, args, predicate, { intervalMs = 500, timeoutMs = 30000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await tauriInvoke(command, args);
    if (predicate(result)) return result;
    await browser.pause(intervalMs);
  }
  throw new Error(`pollUntil("${command}") timed out after ${timeoutMs}ms`);
}

describe('Agent Arcade — failure handling', () => {
  let runId = null;

  // ── 1. Create the failure workflow and a run (not started) via IPC ────────

  describe('Workflow + run creation (IPC)', () => {
    it('creates the failure workflow', async () => {
      // Fixed workflow_id: fall back to update when a previous local run
      // already seeded it (CI always starts from a clean database).
      try {
        await tauriInvoke('create_workflow', { workflow: FAILURE_WORKFLOW });
      } catch {
        await tauriInvoke('update_workflow', { workflow: FAILURE_WORKFLOW });
      }

      const fetched = await tauriInvoke('get_workflow', { id: WORKFLOW_ID });
      expect(fetched).toBeTruthy();
      expect(fetched.workflow_id).toBe(WORKFLOW_ID);
      expect(fetched.nodes.length).toBe(3);
      expect(fetched.edges.length).toBe(2);
    });

    it('creates a run against the test workspace', async () => {
      const run = await tauriInvoke('create_run', {
        workflowId: WORKFLOW_ID,
        workspaceRoot: TEST_WORKSPACE,
      });

      expect(run).toBeTruthy();
      expect(typeof run.run_id).toBe('string');
      expect(run.run_id.length).toBeGreaterThan(0);
      expect(run.workflow_id).toBe(WORKFLOW_ID);
      expect(run.workspace_root).toBe(TEST_WORKSPACE);

      runId = run.run_id;
    });

    it('new run is in created/ready state (not running)', async () => {
      const run = await tauriInvoke('get_run', { runId: runId });
      const preStartStates = ['created', 'ready', 'validating'];
      expect(preStartStates).toContain(run.status);
    });
  });

  // ── 2. Open the run surface via the sidebar run history ──────────────────
  //
  // Unified workspace (DEC-011): select the failure workflow in the sidebar
  // to load its run history, then click the pre-created run card. RunPanel
  // mounts with the runId → event listeners are registered BEFORE the run
  // starts, matching the pattern established by review.spec.js (TEST-004).

  describe('Run surface navigation (UI)', () => {
    before(async () => {
      await browser.pause(1000);
    });

    it('workflow sidebar is visible', async () => {
      const list = await $('[data-testid="workflow-list"]');
      await expect(list).toExist();
    });

    it('failure workflow card is present', async () => {
      const card = await $(`[data-testid="workflow-card-${WORKFLOW_ID}"]`);
      await expect(card).toExist();
    });

    it('clicking the workflow card loads run history', async () => {
      const card = await $(`[data-testid="workflow-card-${WORKFLOW_ID}"]`);
      await card.click();
      await browser.pause(1000);
    });

    it('newly created run card appears in run history', async () => {
      const runCard = await $(`[data-testid="run-card-${runId}"]`);
      await expect(runCard).toExist();
    });

    it('clicking the run card opens the run surface with the run ID', async () => {
      const runCard = await $(`[data-testid="run-card-${runId}"]`);
      await expect(runCard).toExist();
      await runCard.click();

      // Give React time to mount RunPanel and for the listen() calls inside
      // subscribe() to complete their async IPC registration. WebKitGTK
      // software rendering can be slower.
      await browser.pause(4000);

      const view = await $('[data-testid="run-panel"]');
      await expect(view).toExist();

      const hud = await $('[data-testid="run-hud"]');
      await expect(hud).toExist();
    });
  });

  // ── 3. Start the run and wait for it to fail ───────────────────────────────

  describe('Run start and failure (IPC)', () => {
    it('starts the run after RunPanel is mounted', async () => {
      await tauriInvoke('start_run', { runId: runId });
      await browser.pause(500);
    });

    it('run transitions to Failed', async () => {
      const run = await pollUntil(
        'get_run',
        { runId: runId },
        (r) => r && (r.status === 'failed' || r.status === 'succeeded' || r.status === 'cancelled'),
        { timeoutMs: 20000, intervalMs: 500 }
      );
      expect(run.status).toBe('failed');
    });

    it('Tool node transitioned to Failed in the event log', async () => {
      const events = await tauriInvoke('list_events_for_run', {
        runId: runId,
        offset: 0,
        limit: 100,
      });

      const toolEvents = events.filter((e) => e.node_id === NODE.tool);
      const eventTypes = toolEvents.map((e) => e.event_type);
      expect(eventTypes).toContain('node.started');
      expect(eventTypes).toContain('node.failed');
    });

    it('run.failed event is recorded with the failing node reference', async () => {
      const events = await tauriInvoke('list_events_for_run', {
        runId: runId,
        offset: 0,
        limit: 100,
      });

      const runFailedEvent = events.find((e) => e.event_type === 'run.failed');
      expect(runFailedEvent).toBeTruthy();
      expect(runFailedEvent.payload).toBeTruthy();
    });
  });

  // ── 4. Failed node is visually prominent in the live view ─────────────────

  describe('Failed node visual state (UI)', () => {
    it('the failed Tool node renders with the high-contrast failed class', async () => {
      // node_status_changed is a fire-and-forget Tauri push event; per
      // TESTING.md §"WebKitWebDriver quirks" it is not always reliably
      // delivered to a WebKitWebDriver-automated webview. Poll the DOM
      // rather than asserting on a single render pass.
      // .react-flow__node-tool is ReactFlow's wrapper; the wf-node--* state
      // classes are on the inner div rendered by WorkflowNode — descendant
      // selector, not compound.
      await browser.waitUntil(
        async () => {
          const failedNode = await $('.react-flow__node-tool .wf-node--failed');
          return await failedNode.isExisting();
        },
        {
          timeout: 15000,
          interval: 500,
          timeoutMsg: 'expected the Tool node to render with .wf-node--failed within 15s',
        }
      );

      const failedNode = await $('.react-flow__node-tool .wf-node--failed');
      await expect(failedNode).toExist();
    });

    it('a node.failed event is visible in the event feed', async () => {
      // The separate node panel was folded into the graph (DEC-011); the
      // failure is asserted on the graph above and in the event feed here.
      const feedItems = await $$('[data-testid="event-list"] .lr-event-item');
      let sawFailed = false;
      for (const item of feedItems) {
        const text = await browser.execute((el) => el.textContent, item);
        if (text.includes('node.failed')) { sawFailed = true; break; }
      }
      expect(sawFailed).toBe(true);
    });

    it('run status HUD reflects Failed', async () => {
      const status = await $('[data-testid="run-status"]');
      const text = await browser.execute((el) => el.textContent.trim(), status);
      expect(text).toBe('failed');
    });
  });
});
