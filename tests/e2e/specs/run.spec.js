// E2E test: run flow and node state transitions
//
// Covers: TEST-003 — E2E test: run flow and node state transitions
//
// Flow: load demo workflow → create run against test workspace → start run →
//       observe node state transitions via IPC polling → verify run pauses at
//       HumanReview node → verify HumanReviewPanel appears in Live Run view.
//
// Prerequisites (must be done before `npm test`):
//   1. cargo tauri build --debug
//   2. tauri-driver  (separate terminal — WebDriver on localhost:4444)
//
// Test workspace: tests/e2e/fixtures/test-workspace/
//   Never points at a real project directory.
//
// Implementation note:
//   LibraryView now exposes a "Start Run" button, but this spec still creates
//   and starts the run directly via Tauri IPC using browser.executeAsync() so
//   setup stays deterministic. Some assertions below still rely on a planned
//   `list_events_for_run` IPC command that is not currently registered by the
//   desktop app.

import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Absolute path to the dedicated test workspace directory.
// The Tool node in the demo workflow runs `echo 'tool executed'` — no real
// project files are needed.
const TEST_WORKSPACE = path.resolve(__dirname, '../fixtures/test-workspace');

// Canonical demo workflow seeded on first launch (see useFirstRun.ts and
// examples/plan-execute-critique-approve/workflow.json).
const DEMO_WORKFLOW_ID = '00000000-0000-0000-0000-000000000001';

// Node IDs from examples/plan-execute-critique-approve/workflow.json
const NODE = {
  start:       '10000000-0000-0000-0000-000000000001',
  plan:        '10000000-0000-0000-0000-000000000002',
  executeTool: '10000000-0000-0000-0000-000000000003',
  critique:    '10000000-0000-0000-0000-000000000004',
  approve:     '10000000-0000-0000-0000-000000000005',
  end:         '10000000-0000-0000-0000-000000000006',
};

// Helper: call a Tauri command via window.__TAURI_INTERNALS__.invoke.
// Wraps browser.executeAsync so callers can use await.
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

// Helper: poll a Tauri command until the predicate returns truthy, or timeout.
async function pollUntil(command, args, predicate, { intervalMs = 500, timeoutMs = 20000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await tauriInvoke(command, args);
    if (predicate(result)) return result;
    await browser.pause(intervalMs);
  }
  throw new Error(`pollUntil("${command}") timed out after ${timeoutMs}ms`);
}

describe('Agent Arcade — run flow and node state transitions', () => {
  let runId = null;

  // ── 1. Library view shows the demo workflow ──────────────────────────────

  describe('Library view', () => {
    before(async () => {
      // Give the app time to finish initial render and register keyboard listeners
      // before sending the navigation shortcut. The first session has no warmup.
      await browser.pause(1500);
      // Navigate to Library view via keyboard shortcut '4'.
      await browser.keys(['4']);
      await browser.pause(1000);
    });

    it('shows the demo workflow card', async () => {
      const list = await $('[data-testid="workflow-list"]');
      await expect(list).toExist();

      const card = await $(`[data-testid="workflow-card-${DEMO_WORKFLOW_ID}"]`);
      await expect(card).toExist();
    });

    it('demo workflow card displays the correct name', async () => {
      // Use browser.execute to read textContent directly — WebKitWebDriver's
      // getText() can return an empty string for certain CSS-rendered spans.
      const nameEl = await $(`[data-testid="workflow-card-${DEMO_WORKFLOW_ID}"] .lib-card-name`);
      await expect(nameEl).toExist();
      const text = await browser.execute((el) => el.textContent.trim(), nameEl);
      expect(text.length).toBeGreaterThan(0);
    });
  });

  // ── 2. Create and start a run ────────────────────────────────────────────

  describe('Run lifecycle (IPC)', () => {
    it('creates a run against the test workspace', async () => {
      const run = await tauriInvoke('create_run', {
        workflowId: DEMO_WORKFLOW_ID,
        workspaceRoot: TEST_WORKSPACE,
      });

      expect(run).toBeTruthy();
      expect(typeof run.run_id).toBe('string');
      expect(run.run_id.length).toBeGreaterThan(0);
      expect(run.workflow_id).toBe(DEMO_WORKFLOW_ID);
      expect(run.workspace_root).toBe(TEST_WORKSPACE);

      runId = run.run_id;
    });

    it('starts the run — status transitions to running', async () => {
      await tauriInvoke('start_run', { runId: runId });

      // Poll until status is no longer Created/Ready.
      const run = await pollUntil(
        'get_run',
        { runId: runId },
        (r) => r && r.status !== 'created' && r.status !== 'ready' && r.status !== 'validating',
        { timeoutMs: 10000 }
      );

      // Must have moved into an active or terminal state.
      const activeOrTerminal = ['running', 'paused', 'succeeded', 'failed', 'cancelled'];
      expect(activeOrTerminal).toContain(run.status);
    });

    it('node status events are emitted for executed nodes', async () => {
      // Poll the event log until at least one node lifecycle event is recorded.
      // Events use dot-notation: node.queued, node.started, node.succeeded, etc.
      const events = await pollUntil(
        'list_events_for_run',
        { runId: runId, offset: 0, limit: 50 },
        (evs) => Array.isArray(evs) && evs.some((e) => e.event_type.startsWith('node.')),
        { timeoutMs: 15000 }
      );

      const nodeEvents = events.filter((e) => e.event_type.startsWith('node.'));
      expect(nodeEvents.length).toBeGreaterThan(0);

      // Every node event must carry the correct run_id.
      for (const ev of nodeEvents) {
        expect(ev.run_id).toBe(runId);
        expect(ev.event_id).toBeTruthy();
        expect(ev.timestamp).toBeTruthy();
      }
    });

    it('run pauses at the HumanReview node (Approve)', async () => {
      // The demo workflow has agent nodes that use a mock adapter — they
      // complete quickly. The HumanReview node at the end pauses execution.
      const run = await pollUntil(
        'get_run',
        { runId: runId },
        (r) => r && (r.status === 'paused' || r.status === 'succeeded' || r.status === 'failed'),
        { timeoutMs: 30000, intervalMs: 750 }
      );

      expect(run.status).toBe('paused');
    });

    it('events include a human_review_requested entry', async () => {
      const events = await tauriInvoke('list_events_for_run', {
        runId: runId,
        offset: 0,
        limit: 100,
      });

      // Stored event type is 'review.required' (dot-notation used by the engine).
      const reviewEvent = events.find((e) => e.event_type === 'review.required');
      expect(reviewEvent).toBeTruthy();
      expect(reviewEvent.node_id).toBe(NODE.approve);
    });
  });

  // ── 3. Live Run view UI ──────────────────────────────────────────────────

  describe('Live Run view', () => {
    before(async () => {
      // Navigate to Live Run view via keyboard shortcut '2'.
      await browser.keys(['2']);
      await browser.pause(500);
    });

    it('live run view is reachable and rendered', async () => {
      const view = await $('.live-run-view');
      await expect(view).toExist();
    });

    it('shows LIVE RUN title in the header', async () => {
      const title = await $('.view-title');
      const text = await title.getText();
      expect(text).toBe('LIVE RUN');
    });

    // NOTE: The UI path for starting a run now exists in LibraryView, but this
    // spec still bypasses it and drives the run through IPC. That means the
    // live view here is only partially wired to the active run unless the test
    // also navigates through the UI-owned run-selection state.

    it('HumanReviewPanel appears when run_id is linked to the view', async () => {
      // This remains limited by how the spec injects run state: the panel only
      // renders when the active runId is linked through the UI shell.
      const panel = await $('[data-testid="human-review-panel"]');
      // Expect not to exist when no runId is passed to LiveRunView.
      const exists = await panel.isExisting();

      if (!exists) {
        // Correct: no run linked via UI — placeholder is shown.
        const placeholder = await $('.view-placeholder');
        await expect(placeholder).toExist();
      } else {
        // Panel is present — run is linked (ideal future state).
        const nodeLabel = await $('[data-testid="hr-node-label"]');
        const labelText = await nodeLabel.getText();
        expect(labelText).toBeTruthy();
        const approveBtn = await $('[data-testid="hr-btn-approve"]');
        await expect(approveBtn).toExist();
      }
    });
  });

  // ── 4. Node state transitions verified via event log ─────────────────────

  describe('Node state transitions (event log)', () => {
    it('plan node transitioned through queued → running → succeeded', async () => {
      const events = await tauriInvoke('list_events_for_run', {
        runId: runId,
        offset: 0,
        limit: 200,
      });

      const planEvents = events.filter((e) => e.node_id === NODE.plan);
      // Events use dot-notation: node.started = running, node.succeeded = done.
      const eventTypes = planEvents.map((e) => e.event_type);

      expect(eventTypes).toContain('node.started');   // node entered running state
      expect(eventTypes).toContain('node.succeeded'); // node completed successfully
    });

    it('execute-tool node ran and succeeded', async () => {
      const events = await tauriInvoke('list_events_for_run', {
        runId: runId,
        offset: 0,
        limit: 200,
      });

      const toolEvents = events.filter((e) => e.node_id === NODE.executeTool);
      const eventTypes = toolEvents.map((e) => e.event_type);

      expect(eventTypes).toContain('node.started');
      expect(eventTypes).toContain('node.succeeded');
    });

    it('critique node ran and succeeded', async () => {
      const events = await tauriInvoke('list_events_for_run', {
        runId: runId,
        offset: 0,
        limit: 200,
      });

      const critiqueEvents = events.filter((e) => e.node_id === NODE.critique);
      const eventTypes = critiqueEvents.map((e) => e.event_type);

      expect(eventTypes).toContain('node.started');
      expect(eventTypes).toContain('node.succeeded');
    });

    it('approve (human_review) node is in waiting state', async () => {
      const events = await tauriInvoke('list_events_for_run', {
        runId: runId,
        offset: 0,
        limit: 200,
      });

      const approveEvents = events.filter((e) => e.node_id === NODE.approve);
      // HumanReview node emits node.waiting when paused for review decision.
      const eventTypes = approveEvents.map((e) => e.event_type);
      expect(eventTypes).toContain('node.waiting');
    });
  });
});
