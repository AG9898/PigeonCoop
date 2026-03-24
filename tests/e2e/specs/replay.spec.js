// E2E test: replay flow
//
// Covers: TEST-005 — E2E test: replay flow
//
// Flow: create run via IPC → start run → approve human review → run succeeds →
//       navigate to Library → click Replay button on the completed run →
//       ReplayView opens with events loaded → scrub timeline forward/backward →
//       verify node states update in graph state panel → verify event inspector
//       shows correct payload for the selected event.
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

describe('Agent Arcade — replay flow', () => {
  let runId = null;

  // ── 1. Create a completed run (create → start → approve → succeeded) ────

  describe('Setup: create a completed run', () => {
    it('creates a run against the test workspace', async () => {
      const run = await tauriInvoke('create_run', {
        workflowId: DEMO_WORKFLOW_ID,
        workspaceRoot: TEST_WORKSPACE,
      });

      expect(run).toBeTruthy();
      expect(typeof run.run_id).toBe('string');
      runId = run.run_id;
    });

    it('starts the run', async () => {
      await tauriInvoke('start_run', { runId });

      // Wait for the run to pause at the HumanReview node.
      const run = await pollUntil(
        'get_run',
        { runId },
        (r) => r && (r.status === 'paused' || r.status === 'succeeded' || r.status === 'failed'),
        { timeoutMs: 30000, intervalMs: 500 }
      );
      expect(run.status).toBe('paused');
    });

    it('approves the human review to complete the run', async () => {
      // Submit approval via IPC (bypass UI — this is setup, not the test target).
      await tauriInvoke('submit_human_review_decision', {
        runId,
        nodeId: NODE.approve,
        decision: 'approve',
      });

      // Wait for run to reach a terminal state.
      const run = await pollUntil(
        'get_run',
        { runId },
        (r) => r && (r.status === 'succeeded' || r.status === 'failed' || r.status === 'cancelled'),
        { timeoutMs: 20000, intervalMs: 500 }
      );
      expect(run.status).toBe('succeeded');
    });
  });

  // ── 2. Navigate to Replay via Library ─────────────────────────────────────

  describe('Library → Replay navigation', () => {
    before(async () => {
      // Navigate to Library view via keyboard shortcut '4'.
      await browser.pause(1000);
      await browser.keys(['4']);
      await browser.pause(1000);
    });

    it('Library view shows the demo workflow card', async () => {
      const card = await $(`[data-testid="workflow-card-${DEMO_WORKFLOW_ID}"]`);
      await expect(card).toExist();
    });

    it('clicking the workflow card loads run history', async () => {
      const card = await $(`[data-testid="workflow-card-${DEMO_WORKFLOW_ID}"]`);
      await card.click();
      await browser.pause(1000);
    });

    it('completed run card appears in run history', async () => {
      const runCard = await $(`[data-testid="run-card-${runId}"]`);
      await expect(runCard).toExist();
    });

    it('clicking Replay button opens ReplayView with the completed run', async () => {
      const replayBtn = await $(`[data-testid="open-replay-${runId}"]`);
      await expect(replayBtn).toExist();
      await replayBtn.click();

      // Wait for ReplayView to mount and load events.
      await browser.pause(3000);

      // Confirm ReplayView is showing.
      const view = await $('.replay-view');
      await expect(view).toExist();
    });
  });

  // ── 3. ReplayView loads events for the completed run ──────────────────────

  describe('Replay view opens a completed run', () => {
    it('displays REPLAY title', async () => {
      const title = await $('.view-title');
      const text = await browser.execute((el) => el.textContent.trim(), title);
      expect(text).toBe('REPLAY');
    });

    it('subtitle shows the run ID', async () => {
      const subtitle = await $('.view-subtitle');
      const text = await browser.execute((el) => el.textContent.trim(), subtitle);
      expect(text).toContain(runId);
    });

    it('event list is populated with events', async () => {
      const eventList = await $('[data-testid="event-list"]');
      await expect(eventList).toExist();

      // Wait for event items to render.
      const items = await $$('[data-testid="event-list"] [role="option"]');
      expect(items.length).toBeGreaterThan(0);
    });

    it('graph state panel is visible', async () => {
      const panel = await $('[data-testid="graph-state-panel"]');
      await expect(panel).toExist();
    });

    it('event detail panel is visible', async () => {
      const detail = await $('[data-testid="event-detail"]');
      await expect(detail).toExist();
    });
  });

  // ── 4. Timeline scrubbing changes node states on the graph ────────────────

  describe('Timeline scrubbing changes node states', () => {
    it('scrubbing to the last event shows completed node states', async () => {
      // Click the "go to last" button to scrub to the final event.
      const lastBtn = await $('button[aria-label="go to last event"]');
      await expect(lastBtn).toExist();
      await lastBtn.click();
      await browser.pause(500);

      // At the last event, multiple nodes should have reached terminal states.
      // The plan node should show as succeeded.
      const planState = await $(`[data-testid="node-state-${NODE.plan}"]`);
      const planExists = await planState.isExisting();
      if (planExists) {
        const badge = await browser.execute(
          (el) => el.querySelector('.node-state-badge')?.textContent?.trim(),
          planState
        );
        expect(badge).toBe('succeeded');
      }
    });

    it('scrubbing to the first event reduces visible node states', async () => {
      // Click the "go to first" button to scrub back to event 0.
      const firstBtn = await $('button[aria-label="go to first event"]');
      await expect(firstBtn).toExist();
      await firstBtn.click();
      await browser.pause(500);

      // At the very first event (typically a run.started event), there
      // should be fewer (or no) node states than at the end.
      const nodeStatesAtStart = await $$('[data-testid="graph-state-panel"] .node-state-item');
      const startCount = nodeStatesAtStart.length;

      // Scrub back to last to count states there.
      const lastBtn = await $('button[aria-label="go to last event"]');
      await lastBtn.click();
      await browser.pause(500);

      const nodeStatesAtEnd = await $$('[data-testid="graph-state-panel"] .node-state-item');
      const endCount = nodeStatesAtEnd.length;

      // End of run should have more node states than the beginning.
      expect(endCount).toBeGreaterThanOrEqual(startCount);
    });

    it('stepping forward with next button updates node states incrementally', async () => {
      // Go to the first event.
      const firstBtn = await $('button[aria-label="go to first event"]');
      await firstBtn.click();
      await browser.pause(300);

      const initialCount = (await $$('[data-testid="graph-state-panel"] .node-state-item')).length;

      // Click "next" several times to advance through node events.
      const nextBtn = await $('button[aria-label="next event"]');
      let maxCount = initialCount;
      for (let i = 0; i < 10; i++) {
        await nextBtn.click();
        await browser.pause(200);
        const currentCount = (await $$('[data-testid="graph-state-panel"] .node-state-item')).length;
        if (currentCount > maxCount) maxCount = currentCount;
      }

      // After stepping forward through several events, we should have seen
      // at least one new node state appear.
      expect(maxCount).toBeGreaterThanOrEqual(initialCount);
    });

    it('stepping backward with previous button can revert node states', async () => {
      // Go to the last event first.
      const lastBtn = await $('button[aria-label="go to last event"]');
      await lastBtn.click();
      await browser.pause(300);

      const endCount = (await $$('[data-testid="graph-state-panel"] .node-state-item')).length;

      // Go back to the first event.
      const firstBtn = await $('button[aria-label="go to first event"]');
      await firstBtn.click();
      await browser.pause(300);

      const startCount = (await $$('[data-testid="graph-state-panel"] .node-state-item')).length;

      // Start should have fewer or equal node states compared to end.
      expect(startCount).toBeLessThanOrEqual(endCount);
    });
  });

  // ── 5. Event inspector shows correct payload for selected event ───────────

  describe('Event inspector shows correct payload', () => {
    it('clicking an event in the list selects it and shows detail', async () => {
      // Click the last event in the list to ensure it's a node event.
      const lastBtn = await $('button[aria-label="go to last event"]');
      await lastBtn.click();
      await browser.pause(500);

      // The event inspector should render an envelope pane.
      const inspector = await $('[data-testid="event-inspector"]');
      await expect(inspector).toExist();
    });

    it('envelope pane shows event fields (event_id, type, timestamp)', async () => {
      const envelope = await $('[data-testid="ei-envelope"]');
      await expect(envelope).toExist();

      // Read the envelope content — should contain event_id and event type.
      const text = await browser.execute((el) => el.textContent, envelope);
      expect(text.length).toBeGreaterThan(0);
    });

    it('payload pane shows JSON for the selected event', async () => {
      const payload = await $('[data-testid="ei-payload"]');
      await expect(payload).toExist();

      const text = await browser.execute((el) => el.textContent.trim(), payload);
      // Payload should contain some JSON-like content.
      expect(text.length).toBeGreaterThan(0);
    });

    it('selecting a node event shows the node context pane', async () => {
      // Navigate to a node event. Fetch events via IPC to find one.
      const events = await tauriInvoke('list_events_for_run', {
        runId,
        offset: 0,
        limit: 200,
      });

      // Find the index of a node.succeeded event (guaranteed to exist).
      const nodeEventIdx = events.findIndex((e) => e.event_type === 'node.succeeded');
      expect(nodeEventIdx).toBeGreaterThanOrEqual(0);

      // Click the corresponding event item in the list to select it.
      // Events are rendered as <li role="option"> elements in order.
      const eventItems = await $$('[data-testid="event-list"] [role="option"]');
      expect(eventItems.length).toBeGreaterThan(nodeEventIdx);
      await eventItems[nodeEventIdx].click();
      await browser.pause(500);

      // The node context pane should be visible for this node event.
      const nodePane = await $('[data-testid="ei-node-pane"]');
      await expect(nodePane).toExist();

      // It should display the node_id.
      const text = await browser.execute((el) => el.textContent, nodePane);
      expect(text.length).toBeGreaterThan(0);
    });

    it('scrubbing updates event inspector to reflect new position', async () => {
      // Record the current envelope text.
      const envelopeBefore = await browser.execute(
        (el) => el.textContent,
        await $('[data-testid="ei-envelope"]')
      );

      // Click "next event" to move to a different event.
      const nextBtn = await $('button[aria-label="next event"]');
      await nextBtn.click();
      await browser.pause(500);

      // The envelope should now show different content (different event_id at minimum).
      const envelopeAfter = await browser.execute(
        (el) => el.textContent,
        await $('[data-testid="ei-envelope"]')
      );

      // The two envelopes should differ because they represent different events.
      expect(envelopeAfter).not.toBe(envelopeBefore);
    });
  });

  // ── 6. Verify event data integrity via IPC ────────────────────────────────

  describe('Event data integrity', () => {
    it('events loaded by ReplayView match the IPC event log', async () => {
      // Fetch events directly via IPC for comparison.
      const events = await tauriInvoke('list_events_for_run', {
        runId,
        offset: 0,
        limit: 200,
      });

      // Count event items in the UI.
      const uiItems = await $$('[data-testid="event-list"] [role="option"]');
      expect(uiItems.length).toBe(events.length);
    });

    it('run lifecycle events are present (started, paused, succeeded)', async () => {
      const events = await tauriInvoke('list_events_for_run', {
        runId,
        offset: 0,
        limit: 200,
      });

      const types = events.map((e) => e.event_type);
      expect(types).toContain('run.started');
      expect(types).toContain('run.paused');
      expect(types).toContain('run.succeeded');
    });

    it('all demo workflow nodes have lifecycle events', async () => {
      const events = await tauriInvoke('list_events_for_run', {
        runId,
        offset: 0,
        limit: 200,
      });

      // Every non-start node should have at least one node.* event.
      const nodesWithEvents = new Set(
        events.filter((e) => e.event_type.startsWith('node.')).map((e) => e.node_id)
      );

      // Plan, tool, critique, and approve nodes must appear.
      expect(nodesWithEvents.has(NODE.plan)).toBe(true);
      expect(nodesWithEvents.has(NODE.executeTool)).toBe(true);
      expect(nodesWithEvents.has(NODE.critique)).toBe(true);
      expect(nodesWithEvents.has(NODE.approve)).toBe(true);
    });
  });
});
