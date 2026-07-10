# Design Specification

## 1. Design intent

The interface should feel like a **dark RPG campaign command interface built
with the precision of a modern creative tool** rather than a generic web
dashboard or a themed node-editor demo.

The design goal is not novelty for its own sake. The visual style must improve a developer's ability to:
- parse workflow structure quickly
- understand live execution
- locate failures and bottlenecks
- replay a run without getting lost

---

## 2. Experience pillars

### Pillar 1 — Practical
The app must be useful for running real tasks against a repository.

### Pillar 2 — Legible
A user should understand current state at a glance.

### Pillar 3 — Game-forward
Role identity, execution state, and run progression should feel central and
consequential without replacing technical language with fantasy copy.

### Pillar 4 — Controlled
The user should always feel they are driving the system, not chasing it.

### Pillar 5 — Developer-native
The product must feel like it was built by developers for developers. Do not over-polish or sand off technical edges. Visible system state, readable config files, and keyboard-driven workflows signal to experienced developers that this tool respects how they work. Refer to tools like `lazygit`, `k9s`, and Insomnia as reference points — technically capable, aesthetically purposeful, never dumbed down.

---

## 3. UX priorities

Priority order:
1. execution clarity
2. debugging speed
3. configuration efficiency
4. visual delight

If a visual flourish conflicts with clarity, clarity wins.

---

## 4. The continuous command workspace (DEC-011, DEC-013)

The app is a single screen with no view routing. Five stable regions preserve
spatial context across design, live execution, and replay:

1. **Top command bar** (§4.1) — product identity, workflow identity, workspace,
   validation, save, and run controls.
2. **Library rail** (§4.2) — workflows and nested run history.
3. **Command canvas** (§4.3) — the workflow graph remains the visual anchor in
   design, live execution, and replay.
4. **Context panel** (§4.4) — node configuration, run context, selected event,
   output, terminal, or human review based on selection and run state.
5. **Activity deck** (§4.5) — a collapsible bottom region for run timeline and
   event activity. It expands during execution without replacing the canvas.

Navigation is selection, not routing. Selecting a workflow loads its editable
definition. Selecting a run keeps the graph in place, makes it read-only, derives
its state from the event log, and opens the activity deck. Leaving a run restores
editing on the same command canvas.

### 4.1 Top command bar

The command bar uses icon-led controls with tooltips, a compact editable workflow
identity, persistent workspace-root control, and a visually dominant Run action.
Save/validation feedback is concise and does not resize the bar. Run mode exposes
a clear return-to-design control without implying page navigation.

Its contents depend on workspace state:

- **Design:** editable workflow name, Save (`Ctrl+S`), and Validate
- **Run selected:** a return-to-design action plus compact run identity
- **Always:** workspace root and the primary Run action; Run saves the live canvas
  when needed, creates the run, starts it, and reveals the activity deck

### 4.2 Library rail

`WorkflowSidebar` (`components/sidebar/WorkflowSidebar.tsx`). Purpose:
browse workflows and their run history without leaving the workspace.

Required elements:
- workflow list (name, version, last-updated), selected card highlighted
- run history sublist under the selected workflow: status chip
  (color-coded: succeeded green, failed red, running accent, cancelled
  muted), created-at timestamp, duration
- New / Import controls in the sidebar header
- Export and Delete buttons on the selected workflow card (Delete asks for
  confirmation before calling `delete_workflow`; deleting the open workflow
  loads the next one, or an empty canvas if none remain)
- error banner when a library IPC call fails

Behavior:
- the sidebar is presentational; the App shell owns all data and selection
- run status chips stay live via an app-wide `run_status_changed`
  subscription — they update even when the run is not open on the stage

The rail may collapse to an icon-width state at constrained desktop widths. Its
selected workflow expands to reveal run history, while workflow actions live in
a contextual menu or stable action row that cannot intercept selection.

### 4.3 Command canvas and design behavior

`DesignSurface` (`views/DesignSurface.tsx`) owns the editable command canvas,
role palette, selection, and validation overlays. The palette is an integrated
tool shelf rather than a wide permanent panel. Selecting exactly one node opens
its configuration in the shared context panel.

Required elements:
- graph canvas
- node palette (lists all 7 node types: Start, End, Agent, Tool, Router, Memory, Review)
- inspector panel
- floating validation overlay

Behavior:
- node palette items drag onto the canvas via `dataTransfer` (MIME type `application/reactflow`); drop position becomes the node's canvas coordinates; new node gets a UUID
- node palette items can also be clicked to add the node at a default position
- selecting a node on the canvas opens the `NodeInspector` panel on the right; deselecting or multi-selecting closes it
- exposes a `buildWorkflow()` handle so the App shell can serialize the
  live canvas for Save / Validate / Run

#### Node inspector panel

`NodeInspector` (`components/panels/NodeInspector.tsx`) renders when exactly one node is selected on the canvas. It shows:

- **Label** — editable text field; edits propagate to the canvas node immediately
- **Config section** — per-kind form fields matching the Rust `NodeConfig` variants:
  - *Agent*: `prompt` (textarea), `provider_hint` (select, populated from `KNOWN_PROVIDERS` in `types/providers.ts`), `model` (select of the provider's curated models plus an `Other...` option that reveals a free-form text input), `command` (text input, shown only when provider is `Custom Command`), `output_mode` (select: raw / json_stdout / json_last_line). Switching provider resets `model` to `undefined`. See DEC-006 and DEC-010 in `DECISIONS.md`.
    - Claude Code model options are CLI aliases (`opus`, `sonnet`, `haiku`, `fable`) that resolve to the latest model of each tier (DEC-010); exact dated IDs go through `Other...`.
    - OpenAI Codex has no curated list; the no-model option displays the default read from `~/.codex/config.toml` via the `get_codex_default_model` command, and explicit models go through `Other...`.
    - Claude Code additionally shows `completion_mode` (select: auto / manual — DEC-009 turn semantics) and `permission_mode` (select: acceptEdits (default) / auto / plan / manual / dontAsk).
  - *Tool*: `command`, `shell`, `timeout_ms`
  - *Router*: ordered `rules` list with `condition` and `target_key` per row; add/remove rows
  - *Memory*: `key`, `scope` (run_shared / node_local), `operation` (read / write)
  - *Human Review*: `prompt` (textarea), `reason`, `available_actions` (comma-separated)
  - *Start / End*: no-configuration placeholder text
- **Retry Policy** — `max_retries` and optional `max_runtime_ms`

All edits are reflected in the React Flow node data and serialized to `WorkflowDefinition.nodes[*].config` and `.retry_policy` when the workflow is saved. The inspector remounts (resets form state) when a different node is selected.
- supports drag/drop node placement
- supports edge creation; condition_kind (always/on_success/on_failure/expression) selected via dialog on connect
- surfaces invalid graph structures before run via `validate_workflow` command
- invalid nodes highlighted with dashed orange border; invalid edges with dashed orange stroke
- validation overlay shows human-readable error list; dismissable
- preserves layout and workflow metadata

### 4.4 Context panel

The right context panel is persistent in geometry and contextual in content:

- design with node selected: `NodeInspector`
- design without selection: workflow overview and concise canvas state
- run with event selected: `EventInspector` or `CommandOutputPanel`
- interactive agent: `AgentSessionTerminal`
- waiting review: `HumanReviewPanel`, visually prioritized above other details

Tabs are used only between sibling detail views. Raw payloads remain available
without dominating the default pane.

### 4.5 Run activity deck

`RunPanel` (`views/RunPanel.tsx`) supplies the read-only event-derived graph,
compact run HUD, timeline, event feed, and detail content. Live monitoring and
replay remain the same event-indexed surface.

Everything renders from the event log at an index (`deriveNodeStates`,
`deriveTokenPcts`). Following the live tail (index at the end) shows a
LIVE badge and auto-scrolls the feed; scrubbing to an earlier index rewinds
the graph, feed, and inspector to that point on the same timeline. The
panel backfills the persisted log (`list_events_for_run`) on open and
dedupes against streamed `run_event_appended` events by `event_id`, so a
run opened mid-flight shows its full history.

Required elements:
- the real workflow graph with node-state overlays and current node highlight
- timeline scrubber (event-indexed; keyboard-scrubbable)
- event feed
- run summary HUD (status, elapsed, run id) with Start/Cancel controls
- selected event inspector
- command output panel
- agent session terminal (interactive claude nodes — DEC-009)
- human review panel when a review gate is waiting

Behavior:
- transitions should make active flow obvious
- active routes should pulse/animate subtly
- errors should be impossible to miss
- terminal-like output should be visible without taking over the entire screen
- route decisions and memory updates are inspectable at any timeline point

#### Agent session terminal

When an Agent node on the interactive claude path (DEC-009) is running, the run surface shows an embedded terminal (`xterm.js` + fit addon) bound to the node's PTY session:

- renders raw PTY bytes streamed via the `agent_terminal_output` Tauri event (filtered by run_id + node_id)
- keystrokes typed into the terminal are sent back via the `agent_terminal_input` command — the user can answer permission prompts, the workspace-trust dialog, or steer claude mid-turn
- terminal resize invokes `agent_terminal_resize` so the CLI reflows correctly
- session state (running / awaiting user / ended) arrives via the `agent_session_state` Tauri event
- in `completion_mode: manual`, when the turn ends the node enters `Waiting` and the panel shows a **Complete node** button that invokes the `complete_agent_node` command; until then the user may keep conversing with claude in the terminal
- the terminal is scoped to the running session; after node completion the panel closes and the transcript-derived output appears through the normal event feed / output surfaces

#### Event feed panel
The event feed renders a chronological list of `RunEvent` records as they arrive via the `run_event_appended` Tauri event. Each feed item shows:
- sequence number
- timestamp (HH:MM:SS.mmm, local time)
- event type
- truncated node_id (when present)

Events are color-coded by family — the prefix before the dot in `event_type`. Each family has a distinct left-border color and event-type text color:
- **run** (blue) — run lifecycle events
- **node** (green) — node lifecycle events
- **command** (purple) — CLI command execution events
- **agent** (light blue) — agent request/response events
- **routing** (amber) — routing decision events
- **review** (orange) — human review events
- **memory** (cyan) — memory read/write events
- **budget / guardrail** (red) — budget and guardrail events

The feed auto-scrolls to the latest event. Clicking an event selects it and populates the detail panel with the full event payload.

#### Command output panel

`CommandOutputPanel` (`components/panels/CommandOutputPanel.tsx`) is a self-contained component that accepts a filtered `RunEvent[]` and derives its display with no dependency on `RunPanel` internals. It:

- filters for `event_type == "command.stdout"` and `"command.stderr"`, reading `payload.chunk` (string) and `payload.byte_offset` (number) from each event; events with a malformed payload are ignored
- concatenates each stream's chunks in ascending `byte_offset` order (not event arrival order) — this tolerates out-of-order delivery
- renders stdout and stderr as separate sections (`cop-section--stdout` / `cop-section--stderr`), each with its own header label and colour (`--ev-command` purple for stdout, red for stderr) so the two streams are distinguishable without relying on position alone
- collapses a stream to its first 20 lines by default once it exceeds 20 lines, with a toggle button (`Show all (N lines)` / `Collapse`) in the section header; short streams render fully with no toggle
- wraps output in a scrollable `<pre>` (`max-height: 320px`) with `user-select: text` so all output is copyable
- shows a placeholder ("No command output for this run.") when no stdout/stderr events are present

`RunPanel` selects the current run's `command.*` events with `useMemo` and passes them to `CommandOutputPanel` in the detail column. The command output panel renders when command events are present and no non-command event is selected; selecting a non-command event keeps the generic event detail inspector visible.

#### Event inspector panel

The event detail panel uses `EventInspector` (`components/panels/EventInspector.tsx`) to render selected events with typed, context-aware panes instead of raw JSON.

Every selected event shows:
1. **Envelope pane** — core fields: event_id, event_type, timestamp, node_id, causation_id, correlation_id
2. **Family-specific pane** (conditional, based on the event_type prefix):
   - **Node events** (`node.*`): node_id, node_type, attempt, workspace, input refs list, output, and error fields from the payload
   - **Routing events** (`router.*`, `edge.*`): router_node_id, reason (the branch selection rationale), and selected_edge_ids
   - **Command events** (`command.*`): command string, shell, cwd, exit_code (color-coded green/red), duration_ms, stdout_bytes, stderr_bytes, timeout_ms
3. **Full payload pane** — always rendered last as formatted JSON for complete transparency

Run-level events (e.g. `run.started`) show only the envelope and payload panes — no family-specific context.

---

## 5. Visual language

### Overall theme
- RPG campaign command table
- coordinated party roles expressed through workflow nodes
- modern creative-tool spacing, controls, and panel behavior
- developer-grade inspection with game-grade identity and state motion

### Avoid
- faux-medieval terminology or cartoonish metaphors
- over-saturated arcade aesthetic
- visual noise that obscures text or state
- faux-terminal-only presentation
- generic cyberpunk neon and purple/blue monochrome palettes
- ornamental frames around every surface

### Visual motifs to use
- generated campaign-map atmosphere
- animated role sprites, portrait fallbacks, and code-native insignias
- route/path illumination
- resource meters and state rings
- disciplined layered panel depth
- restrained motion
- see [`docs/VISUAL_IDENTITY.md`](VISUAL_IDENTITY.md) for the authoritative
  generated-asset, palette, typography, and role system

### Design system (`styles/global.css`)

The mission-control visual theme is implemented via CSS custom properties and consistent layering:

**Surfaces and depth:**
- Three background tiers: `--color-bg` (#0d0f14), `--color-surface` (#141720), `--color-surface-raised` (#181c28)
- Panels use `--shadow-panel` for baseline depth; cards and nodes get `--shadow-panel-hover` on hover
- Nav bar, view headers, and HUD bars use `linear-gradient` from `--color-surface-raised` to `--color-surface` for top-lit layering
- The `--glow-accent` variable provides a subtle blue glow for selected/focused elements

**Canvas layering:**
- generated environment artwork sits below a code-native grid, vignette, graph
  edges, and graph nodes; it never contains functional labels or state

**State glows and rings:**
- Running nodes: `node-pulse` animation (2s, cubic-bezier) oscillates a blue glow ring from 4px to 12px spread
- Failed nodes: `node-fail-flash` animation flashes a red glow ring twice then holds at a static red ring
- Paused nodes: `node-paused-blink` animation (3s) breathes an orange glow to signal "waiting on you"
- Waiting/succeeded: static glow rings (amber/green) with no animation — motion is reserved for states that demand attention

**Edge flow:**
- Active edges (`.lr-edge--active`) use `stroke-dasharray: 8 4` with a `stroke-dashoffset` animation (`edge-flow`, 0.8s linear) for directional marching dashes
- Selected/hovered edges get a subtle blue `drop-shadow` filter

**Accessibility:**
- A `prefers-reduced-motion: reduce` media query disables all node and edge animations for users who request reduced motion

---

## 6. Canvas behavior

The canvas is the product centerpiece.

### Builder state
- nodes are draggable
- edges are editable
- selection is crisp and obvious
- node ports are explicit
- invalid states are visually flagged

### Run state
- active nodes animate into focus
- active edges show directional motion
- blocked/waiting states are visually distinct
- failed nodes stand out immediately
- success state is visible but not noisy

### Replay state
- timeline selection rewinds/advances graph state
- node states reflect selected moment, not current actual run state

---

## 7. Node visuals

Each node should balance identity and readability.

The animated role, portrait fallback, resource, state, and canvas asset system is
specified in [`docs/VISUAL_IDENTITY.md`](VISUAL_IDENTITY.md). Generated sprite
frames establish identity and pose; deterministic HTML/CSS and event-derived data
establish state and animation cadence.

### Shared node structure (text-based nodes)
- icon/type marker
- label
- state ring/badge
- optional small metadata summary

### Node states to visualize
- idle
- queued
- running
- waiting
- success
- failed
- skipped
- paused/manual review

### Recommended style behavior (text-based nodes)
- running: subtle pulse or animated border
- waiting: amber hold state
- failed: high contrast alert state
- review: distinct manual intervention indicator

---

## 8. Information hierarchy

At all times the user should be able to answer:
1. what run is this?
2. what is happening now?
3. which node is active?
4. what happened just before this?
5. where do I inspect more detail?

Hierarchy should be:
- graph state first
- selected node/run details second
- raw log/event detail third

---

## 9. Terminal and output design

The product is CLI-wrapper based, but must not feel trapped in a terminal UI.

### Design requirement
Terminal output should be a panel within the app, not the whole experience.

### Output panel needs
- clear stdout/stderr separation if available
- timestamps or event association
- copy/select support
- collapse/expand for noisy outputs
- link back to originating node/event

### Decided implementation (DEC-004, amended by DEC-009)

Custom styled `<div>`/`<pre>` output panel for **captured output** (Tool nodes, post-hoc event review) — ANSI SGR escape codes (colors, bold, underline) are rendered to HTML `<span>` elements via the `anser` npm package. Non-SGR escape sequences (cursor movement, screen clear) are stripped. Output is rendered per-event as React components with click-through to the originating node/event in the inspector.

**Live interactive agent sessions** are the one surface that uses a real terminal emulator: DEC-009 adds xterm.js scoped to the agent session terminal on the run surface (see §4.4), because those sessions are genuinely interactive PTY streams, not captured strings. DEC-004's rationale still governs every captured-output surface.

### Design stance
The app should feel more visually rich than a terminal without hiding that terminal-backed execution is occurring.

---

## 10. Human review UX

Human review is a major differentiator in v1.

A review node should:
- pause the run clearly
- foreground the reason for review
- show relevant context and outputs
- allow approve/reject/edit/retry where applicable
- make the next consequence obvious

The system should not leave the user wondering whether execution is stuck or intentionally waiting.

---

## 11. Motion guidelines

Motion should explain state, not decorate it.

### Recommended motion
- edge flow animation during active routing
- node pulse during execution
- timeline playhead movement in replay
- smooth state transitions in panels

### Avoid
- constant motion everywhere
- large parallax effects
- flashy transitions on every click
- anything that slows repeated debugging workflows

---

## 12. Accessibility / usability guidelines

- all important states must be distinguishable without relying on color alone
- keyboard access should be supported for major actions
- text-heavy details must remain readable at normal desktop sizes
- animations should be subtle enough to avoid fatigue
- complex views must allow focus on one selected node or event at a time

---

## 13. Keyboard-first design

Keyboard-driven workflows are a priority, not an afterthought. Experienced developers navigate primarily by keyboard. The UI must support this from the start.

### Required keyboard behaviors
- canvas navigation without the mouse (arrow keys, zoom shortcuts)
- node selection, inspection, and connection from keyboard
- save from keyboard
- run start/stop from keyboard
- human review approve/reject from keyboard
- timeline scrubbing on the run surface from keyboard

There is no view-switching keybinding: DEC-011 removed view routing, so the
old `1`–`4` shortcuts no longer exist.

### Implemented keyboard shortcut map

| Context | Key | Action |
|---|---|---|
| Design surface | `Ctrl+S` / `Cmd+S` | Save the current canvas |
| Canvas (design) | `Arrow keys` | Pan canvas (50px per step) |
| Canvas (design) | `+` / `=` | Zoom in |
| Canvas (design) | `-` | Zoom out |
| Canvas (design) | `F` | Fit view (reset zoom to show all nodes) |
| Canvas (design) | `Tab` / `Shift+Tab` | Cycle node selection forward / backward |
| Canvas (design) | `Escape` | Deselect all nodes |
| Canvas (design) | `Delete` | Delete selected node/edge (React Flow built-in) |
| Run surface | `Ctrl+Enter` | Start run |
| Run surface | `Ctrl+.` | Cancel (stop) run |
| Human Review | `A` | Approve |
| Human Review | `R` | Reject |
| Human Review | `T` | Retry |
| Timeline scrubber | `Arrow Left/Down` | Previous event |
| Timeline scrubber | `Arrow Right/Up` | Next event |
| Timeline scrubber | `Home` | Jump to first event |
| Timeline scrubber | `End` | Jump to last event |

Canvas keyboard navigation is implemented in `useCanvasKeyboard` hook (`src/hooks/useCanvasKeyboard.ts`), which requires the canvas container to have `tabIndex={0}` for focus. Shortcuts are suppressed when focus is on form elements (input, textarea, select).

### Design stance
If a power user cannot perform a complete workflow — build, run, inspect, replay — without reaching for the mouse for more than edge cases, the keyboard support is insufficient.

Reference tools: `lazygit`, `k9s`, VS Code command palette.

---

## 14. First visual benchmark for success

A user should be able to watch a running workflow and immediately understand:
- where execution is
- which path is active
- whether the workflow is progressing or waiting
- whether something failed
- where to click for detail

If the user still needs to fall back to raw logs for basic situational awareness, the design has not done enough.
