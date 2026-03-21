# Design Specification

## 1. Design intent

The interface should feel like a **2D mission control / systems simulation / strategy HUD** rather than a generic web dashboard.

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

### Pillar 3 — Alive
The canvas should feel dynamic and active during execution.

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

## 4. Primary views

### 4.1 Builder View
Purpose: create and configure workflows.

Required elements:
- graph canvas
- node palette (lists all 7 node types: Start, End, Agent, Tool, Router, Memory, Review)
- inspector panel
- validation panel
- run button / test action

Behavior:
- node palette items drag onto the canvas via `dataTransfer` (MIME type `application/reactflow`); drop position becomes the node's canvas coordinates; new node gets a UUID
- node palette items can also be clicked to add the node at a default position
- supports drag/drop node placement
- supports edge creation; condition_kind (always/on_success/on_failure/expression) selected via dialog on connect
- surfaces invalid graph structures before run via `validate_workflow` command
- invalid nodes highlighted with dashed orange border; invalid edges with dashed orange stroke
- validation panel shows human-readable error list; dismissable
- preserves layout and workflow metadata

### 4.2 Live Run View
Purpose: monitor an active run.

Required elements:
- animated graph
- current node highlight
- event feed
- run summary HUD
- selected node inspector
- command output panel

Behavior:
- transitions should make active flow obvious
- active routes should pulse/animate subtly
- errors should be impossible to miss
- terminal-like output should be visible without taking over the entire screen

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

### 4.3 Replay View
Purpose: inspect completed runs.

Required elements:
- timeline scrubber
- event list
- graph playback state
- selected event details
- input/output diff panes

Behavior:
- user can scrub by event or time
- graph state updates to selected point in run
- route decisions and memory updates are inspectable

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

### 4.4 Library View
Purpose: browse workflows and past runs.

Required elements:
- workflow cards/list
- recent run history
- status indicators
- import/export controls

---

## 5. Visual language

### Overall theme
- mission control
- tactical map
- systems console
- devtool with game-grade motion polish

### Avoid
- cartoonish metaphors
- over-saturated arcade aesthetic
- visual noise that obscures text or state
- faux-terminal-only presentation

### Visual motifs to use
- grids
- radar-like overlays
- route/path illumination
- state glows/rings
- layered panel depth
- restrained motion

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

### Shared node structure
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

### Recommended style behavior
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
- global keybinding for switching between views (Builder, Live Run, Replay, Library)
- canvas navigation without the mouse (arrow keys, zoom shortcuts)
- node selection, inspection, and connection from keyboard
- run start/stop/pause from keyboard
- human review approve/reject from keyboard
- timeline scrubbing in Replay View from keyboard

### Implemented keyboard shortcut map

| Context | Key | Action |
|---|---|---|
| Global | `1` / `2` / `3` / `4` | Switch to Builder / Live Run / Replay / Library |
| Canvas (Builder) | `Arrow keys` | Pan canvas (50px per step) |
| Canvas (Builder) | `+` / `=` | Zoom in |
| Canvas (Builder) | `-` | Zoom out |
| Canvas (Builder) | `F` | Fit view (reset zoom to show all nodes) |
| Canvas (Builder) | `Tab` / `Shift+Tab` | Cycle node selection forward / backward |
| Canvas (Builder) | `Escape` | Deselect all nodes |
| Canvas (Builder) | `Delete` | Delete selected node/edge (React Flow built-in) |
| Live Run | `Ctrl+Enter` | Start run |
| Live Run | `Ctrl+.` | Cancel (stop) run |
| Human Review | `A` | Approve |
| Human Review | `R` | Reject |
| Human Review | `T` | Retry |
| Replay | `Arrow Left/Down` | Previous event |
| Replay | `Arrow Right/Up` | Next event |
| Replay | `Home` | Jump to first event |
| Replay | `End` | Jump to last event |

Canvas keyboard navigation is implemented in `useCanvasKeyboard` hook (`src/hooks/useCanvasKeyboard.ts`), which requires the canvas container to have `tabIndex={0}` for focus. Shortcuts are suppressed when focus is on form elements (input, textarea, select).

### Design stance
If a power user cannot perform a complete workflow — build, run, inspect, replay — without reaching for the mouse for more than edge cases, the keyboard support is insufficient.

Reference tools: `lazygit`, `k9s`, VS Code command palette.

---

## 13. First visual benchmark for success

A user should be able to watch a running workflow and immediately understand:
- where execution is
- which path is active
- whether the workflow is progressing or waiting
- whether something failed
- where to click for detail

If the user still needs to fall back to raw logs for basic situational awareness, the design has not done enough.
