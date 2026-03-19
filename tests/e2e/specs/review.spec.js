// E2E test: human review gate
//
// Covers: TEST-004 — E2E test: human review gate
//
// Flow: create run via IPC (not started) → navigate to LibraryView → click
//       workflow card to load run history → click "Live Run" button on the run
//       card to open LiveRunView with runId → THEN start run via IPC → run
//       pauses at HumanReview node → HumanReviewPanel appears in LiveRunView →
//       click Approve → run resumes → run reaches Succeeded.
//
// Why "create before navigate":
//   All demo-workflow nodes use stub execution (1 ms each). If the run is
//   started before LiveRunView is mounted and subscribed to the
//   `human_review_requested` Tauri event, the panel never appears because
//   Tauri events are fire-and-forget (no buffering). The solution is to create
//   the run (non-started), navigate to LiveRunView so it subscribes, then
//   start the run.
//
// Prerequisites (must be done before `npm test`):
//   1. cargo tauri build --debug
//   2. tauri-driver  (separate terminal — WebDriver on localhost:4444)
//
// Test workspace: tests/e2e/fixtures/test-workspace/
//   Never points at a real project directory.

import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TEST_WORKSPACE = path.resolve(__dirname, '../fixtures/test-workspace');
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

describe('Agent Arcade — human review gate', () => {
  let runId = null;

  // ── 1. Create the run (not started) via IPC ───────────────────────────────

  describe('Run creation (IPC)', () => {
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

    it('new run is in created/ready state (not running)', async () => {
      const run = await tauriInvoke('get_run', { runId: runId });
      const preStartStates = ['created', 'ready', 'validating'];
      expect(preStartStates).toContain(run.status);
    });
  });

  // ── 2. Navigate to LiveRunView via Library run history ────────────────────
  //
  // Open the demo workflow card in Library to load its run history, then click
  // the "Live Run" button on the newly created run card. This causes App.tsx to
  // call openLiveRun(runId) → LiveRunView mounts with the runId → event
  // listeners are registered BEFORE the run starts.

  describe('LiveRunView navigation (UI)', () => {
    before(async () => {
      // Navigate to Library view via keyboard shortcut '4'.
      await browser.keys(['4']);
      await browser.pause(500);
    });

    it('Library view is visible', async () => {
      const list = await $('[data-testid="workflow-list"]');
      await expect(list).toExist();
    });

    it('demo workflow card is present', async () => {
      const card = await $(`[data-testid="workflow-card-${DEMO_WORKFLOW_ID}"]`);
      await expect(card).toExist();
    });

    it('clicking demo workflow card loads run history', async () => {
      // Click the card to trigger loadRuns for the demo workflow.
      const card = await $(`[data-testid="workflow-card-${DEMO_WORKFLOW_ID}"]`);
      await card.click();
      // Wait for run list to render.
      await browser.pause(1000);
    });

    it('newly created run card appears in run history', async () => {
      // The run card for the pre-created run should be visible.
      const runCard = await $(`[data-testid="run-card-${runId}"]`);
      await expect(runCard).toExist();
    });

    it('clicking "Live Run" button navigates to LiveRunView with the run ID', async () => {
      const liveRunBtn = await $(`[data-testid="open-liverun-${runId}"]`);
      await expect(liveRunBtn).toExist();
      await liveRunBtn.click();

      // Give React time to navigate, for LiveRunView to mount, and for all four
      // listen() calls inside subscribe() to complete their async IPC registration.
      // WebKitGTK software rendering can be slower — 4s is conservative.
      await browser.pause(4000);

      // Confirm LiveRunView is now showing.
      const view = await $('.live-run-view');
      await expect(view).toExist();

      // Run HUD should be visible (not the placeholder).
      const hud = await $('[data-testid="run-hud"]');
      await expect(hud).toExist();
    });
  });

  // ── 3. Start the run (LiveRunView is now subscribed to events) ────────────

  describe('Run start (IPC)', () => {
    it('starts the run after LiveRunView is mounted', async () => {
      await tauriInvoke('start_run', { runId: runId });

      // Give the background task time to advance past the stub nodes.
      // Stub nodes complete in ~1 ms, so the run should reach HumanReview
      // (and fire `human_review_requested`) within a few milliseconds.
      // The browser.pause gives the Tauri event bridge time to deliver the
      // event to the already-mounted LiveRunView.
      await browser.pause(500);
    });
  });

  // ── 4. HumanReviewPanel UI assertions ─────────────────────────────────────

  describe('HumanReviewPanel (UI)', () => {
    it('run pauses at the HumanReview node', async () => {
      const run = await pollUntil(
        'get_run',
        { runId: runId },
        (r) => r && (r.status === 'paused' || r.status === 'succeeded' || r.status === 'failed'),
        { timeoutMs: 20000, intervalMs: 500 }
      );
      expect(run.status).toBe('paused');
    });

    it('human_review_requested event is in the event log', async () => {
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

    it('HumanReviewPanel is visible in LiveRunView', async () => {
      // The panel is rendered by LiveRunView when it receives the
      // `human_review_requested` event. Because we navigated to LiveRunView
      // before starting the run, the listener was registered in time.
      const panel = await $('[data-testid="human-review-panel"]');
      await expect(panel).toExist();
    });

    it('panel displays the node label', async () => {
      const label = await $('[data-testid="hr-node-label"]');
      await expect(label).toExist();
      const text = await label.getText();
      expect(text.length).toBeGreaterThan(0);
    });

    it('panel displays the review reason', async () => {
      const reason = await $('[data-testid="hr-reason"]');
      await expect(reason).toExist();
    });

    it('Approve button is visible', async () => {
      const approveBtn = await $('[data-testid="hr-btn-approve"]');
      await expect(approveBtn).toExist();
      const disabled = await approveBtn.getAttribute('disabled');
      expect(disabled).toBeNull();
    });
  });

  // ── 5. Approve the review and verify run resumes ──────────────────────────

  describe('Approve decision (UI + IPC)', () => {
    it('clicking Approve submits the decision', async () => {
      const approveBtn = await $('[data-testid="hr-btn-approve"]');
      await approveBtn.click();

      // Give the Tauri bridge time to process the IPC call.
      await browser.pause(500);
    });

    it('run resumes after approval (status is no longer paused)', async () => {
      const run = await pollUntil(
        'get_run',
        { runId: runId },
        (r) => r && r.status !== 'paused',
        { timeoutMs: 15000, intervalMs: 300 }
      );

      // The run should be running or have reached a terminal state.
      const postApprovalStates = ['running', 'succeeded', 'failed', 'cancelled'];
      expect(postApprovalStates).toContain(run.status);
    });

    it('run reaches Succeeded after approval', async () => {
      const run = await pollUntil(
        'get_run',
        { runId: runId },
        (r) => r && (r.status === 'succeeded' || r.status === 'failed' || r.status === 'cancelled'),
        { timeoutMs: 20000, intervalMs: 500 }
      );

      expect(run.status).toBe('succeeded');
    });

    it('HumanReviewPanel is dismissed after approval', async () => {
      // After a decision is submitted, LiveRunView clears reviewRequest → panel
      // is no longer rendered.
      const panel = await $('[data-testid="human-review-panel"]');
      const exists = await panel.isExisting();
      expect(exists).toBe(false);
    });
  });

  // ── 6. End node and post-approval event verification (IPC) ───────────────

  describe('Post-approval events (IPC)', () => {
    it('End node transitioned to succeeded', async () => {
      const events = await tauriInvoke('list_events_for_run', {
        runId: runId,
        offset: 0,
        limit: 200,
      });

      const endEvents = events.filter((e) => e.node_id === NODE.end);
      // node.succeeded is emitted when the End node completes.
      const succeeded = endEvents.some((e) => e.event_type === 'node.succeeded');
      expect(succeeded).toBe(true);
    });

    it('HumanReview (Approve) node transitioned to succeeded after approval', async () => {
      const events = await tauriInvoke('list_events_for_run', {
        runId: runId,
        offset: 0,
        limit: 200,
      });

      const approveEvents = events.filter((e) => e.node_id === NODE.approve);
      // HumanReview node emits node.waiting (paused) then node.succeeded (after approval).
      const eventTypes = approveEvents.map((e) => e.event_type);
      expect(eventTypes).toContain('node.waiting');
      expect(eventTypes).toContain('node.succeeded');
    });

    it('human_review_decided event is recorded in the event log', async () => {
      const events = await tauriInvoke('list_events_for_run', {
        runId: runId,
        offset: 0,
        limit: 200,
      });

      // Stored event type is 'review.approved' (dot-notation used by the engine).
      const decidedEvent = events.find((e) => e.event_type === 'review.approved');
      expect(decidedEvent).toBeTruthy();
      expect(decidedEvent.node_id).toBe(NODE.approve);
      expect(decidedEvent.payload).toBeTruthy();
    });

    it('run_status_changed events show complete lifecycle', async () => {
      const events = await tauriInvoke('list_events_for_run', {
        runId: runId,
        offset: 0,
        limit: 200,
      });

      // Run lifecycle events use dot-notation: run.started, run.paused, run.succeeded.
      // The run must have gone through: running → paused → running → succeeded.
      const eventTypes = events.map((e) => e.event_type);
      expect(eventTypes).toContain('run.started');   // → running
      expect(eventTypes).toContain('run.paused');    // → paused
      expect(eventTypes).toContain('run.succeeded'); // → succeeded
    });
  });
});
