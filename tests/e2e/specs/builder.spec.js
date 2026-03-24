// E2E test: builder flow
//
// Covers: TEST-002 — E2E test: builder flow
//
// Flow: navigate to Builder view → add all 7 node types from the palette →
//       save the workflow → verify persistence via IPC → add edges via IPC →
//       reload the updated workflow in Builder → verify nodes and edges →
//       navigate to Library → verify the workflow card appears.
//
// Prerequisites (must be done before `npm test`):
//   1. cargo tauri build --debug
//   2. tauri-driver  (separate terminal — WebDriver on localhost:4444)
//
// Edges are added via IPC (update_workflow) rather than mouse drag-and-drop on
// React Flow handles. WebKitWebDriver mouse action reliability on small DOM
// elements (~10px handles) is insufficient for CI stability. The edge-creation
// UI (handle drag + condition dialog) is covered by frontend component tests.

// Canonical demo workflow seeded on first launch — used to identify "our" workflow.
const DEMO_WORKFLOW_ID = '00000000-0000-0000-0000-000000000001';

// All 7 v1 node types (CLAUDE.md §6 / NodePalette PALETTE_ITEMS).
const ALL_NODE_KINDS = [
  'start', 'end', 'agent', 'tool', 'router', 'memory', 'human_review',
];

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

describe('Agent Arcade — builder flow', () => {
  let savedWorkflowId = null;
  let savedWorkflow = null;

  // ── 1. Navigate to Builder and add all 7 node types ──────────────────────

  describe('Node creation via palette', () => {
    before(async () => {
      // Give the app time to finish initial render and register keyboard listeners.
      await browser.pause(1500);
      // Navigate to Builder view via keyboard shortcut '1'.
      await browser.keys(['1']);
      await browser.pause(1000);
    });

    it('Builder view is visible', async () => {
      const view = await $('.builder-view');
      await expect(view).toExist();
    });

    it('palette lists all 7 node types', async () => {
      const items = await $$('.palette-item');
      expect(items.length).toBe(7);
    });

    it('clicking each palette item adds a node to the canvas', async () => {
      const items = await $$('.palette-item');

      for (const item of items) {
        await item.click();
        await browser.pause(200);
      }

      // All 7 nodes should be rendered in the React Flow canvas.
      const nodes = await $$('.react-flow__node');
      expect(nodes.length).toBe(7);
    });

    it('each of the 7 node types has a corresponding canvas node', async () => {
      // React Flow assigns class react-flow__node-{type} based on the node type.
      for (const kind of ALL_NODE_KINDS) {
        const node = await $(`.react-flow__node-${kind}`);
        await expect(node).toExist();
      }
    });
  });

  // ── 2. Save the workflow ─────────────────────────────────────────────────

  describe('Workflow save (UI + IPC verification)', () => {
    it('clicking Save shows "Saved" status', async () => {
      // Find the Save button in the builder toolbar.
      const buttons = await $$('button.toolbar-btn');
      let saveBtn = null;
      for (const btn of buttons) {
        const text = await browser.execute((el) => el.textContent.trim(), btn);
        if (text === 'Save') { saveBtn = btn; break; }
      }
      expect(saveBtn).toBeTruthy();
      await saveBtn.click();
      await browser.pause(500);

      // Status indicator should confirm success.
      const status = await $('.builder-status');
      const text = await browser.execute((el) => el.textContent.trim(), status);
      expect(text).toBe('Saved');
    });

    it('persisted workflow contains all 7 node types', async () => {
      const workflows = await tauriInvoke('list_workflows');
      // At minimum: demo workflow + our new workflow.
      expect(workflows.length).toBeGreaterThanOrEqual(2);

      // Find the workflow that is not the demo.
      const newWf = workflows.find((w) => w.workflow_id !== DEMO_WORKFLOW_ID);
      expect(newWf).toBeTruthy();
      expect(newWf.nodes.length).toBe(7);

      const types = newWf.nodes.map((n) => n.node_type).sort();
      expect(types).toEqual([...ALL_NODE_KINDS].sort());

      savedWorkflowId = newWf.workflow_id;
      savedWorkflow = newWf;
    });
  });

  // ── 3. Add edges via IPC, then reload in Builder ─────────────────────────

  describe('Edge persistence and reload', () => {
    it('updates workflow with 6 edges connecting all nodes', async () => {
      // Build a chain: start → agent → tool → router → memory → human_review → end
      const order = ['start', 'agent', 'tool', 'router', 'memory', 'human_review', 'end'];
      const byKind = {};
      for (const n of savedWorkflow.nodes) {
        byKind[n.node_type] = n.node_id;
      }

      const edges = [];
      for (let i = 0; i < order.length - 1; i++) {
        edges.push({
          edge_id: `edge-${i}-${Date.now()}`,
          source_node_id: byKind[order[i]],
          target_node_id: byKind[order[i + 1]],
          condition_kind: 'always',
        });
      }

      const updated = {
        ...savedWorkflow,
        edges,
        updated_at: new Date().toISOString(),
      };
      await tauriInvoke('update_workflow', { workflow: updated });

      // Verify edges persisted via IPC.
      const fetched = await tauriInvoke('get_workflow', { id: savedWorkflowId });
      expect(fetched.edges.length).toBe(6);
    });

    it('loading the updated workflow in Builder renders nodes and edges', async () => {
      // Click Load in the builder toolbar.
      const buttons = await $$('button.toolbar-btn');
      let loadBtn = null;
      for (const btn of buttons) {
        const text = await browser.execute((el) => el.textContent.trim(), btn);
        if (text === 'Load') { loadBtn = btn; break; }
      }
      expect(loadBtn).toBeTruthy();
      await loadBtn.click();
      await browser.pause(500);

      // Picker modal should appear.
      const picker = await $('.workflow-picker');
      await expect(picker).toExist();

      // Select "Untitled Workflow" from the picker list.
      const pickerItems = await $$('.picker-item');
      expect(pickerItems.length).toBeGreaterThanOrEqual(2);

      let clicked = false;
      for (const item of pickerItems) {
        const text = await browser.execute((el) => el.textContent.trim(), item);
        if (text === 'Untitled Workflow') {
          await item.click();
          clicked = true;
          break;
        }
      }
      expect(clicked).toBe(true);
      // Allow React Flow to lay out the loaded graph.
      await browser.pause(1500);

      // Verify 7 nodes rendered.
      const nodes = await $$('.react-flow__node');
      expect(nodes.length).toBe(7);

      // Verify 6 edges rendered.
      const edges = await $$('.react-flow__edge');
      expect(edges.length).toBe(6);
    });
  });

  // ── 4. Workflow appears in Library view ──────────────────────────────────

  describe('Library view', () => {
    before(async () => {
      // Navigate to Library view via keyboard shortcut '4'.
      await browser.keys(['4']);
      await browser.pause(1000);
    });

    it('workflow list is visible', async () => {
      const list = await $('[data-testid="workflow-list"]');
      await expect(list).toExist();
    });

    it('saved workflow card is present', async () => {
      const card = await $(`[data-testid="workflow-card-${savedWorkflowId}"]`);
      await expect(card).toExist();
    });

    it('card displays the correct workflow name', async () => {
      const nameEl = await $(
        `[data-testid="workflow-card-${savedWorkflowId}"] .lib-card-name`
      );
      await expect(nameEl).toExist();
      // Use browser.execute for reliable text extraction (WebKitWebDriver quirk).
      const text = await browser.execute((el) => el.textContent.trim(), nameEl);
      expect(text).toBe('Untitled Workflow');
    });
  });
});
