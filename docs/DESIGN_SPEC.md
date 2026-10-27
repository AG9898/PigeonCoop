# Design Specification

**Accepted target, 2026-10-27 (DEC-014 + DEC-015). Implementation pending.**

## 1. Experience

PigeonCoop starts in the user's existing coding assistant. Its skill packages the
workflow; CLI and MCP connect that activity to a Rust-backed local record.
Opening a desktop or terminal workspace is optional.

The workspace answers: what is running, what is it doing, what changed, what was
verified, and what needs attention? It connects plans, task dependencies, runs,
and evidence without requiring the user to build a node graph first.

Design an entirely new pixel-character desktop workspace, with a matching
simplified cell/ASCII character language in the terminal. Retire the existing
RPG interface and current visual asset families as design inputs. This is a new
UI composition rather than a skin applied to the current layout.

## 2. Shared interaction contract

- Assistant sessions own real execution. Viewers display recorded projections.
- Distinguish reported activity, captured evidence, and unknown/missing coverage.
- Show project, workflow revision, owner, task/cycle, and recording freshness.
- An action request stays pending until acknowledged; show its observed outcome
  separately. Never display cancellation as complete because a button was clicked.
- Closing a workspace does not terminate the owner; reopening backfills history.
- Missing contact displays the last recorded state with a coverage warning.
  Do not invent success, failure, cancellation, or a new persisted run status.
- Definitions remain immutable within a run. Editing creates a later revision.
- Real execution, mock simulation, and replay have explicit mode labels.
- Requests to an unavailable owner remain unavailable/pending; viewers do not
  launch substitute sessions or bypass harness permission controls.

See [INTEGRATION_CONTRACT.md](INTEGRATION_CONTRACT.md) for ownership and evidence.

## 3. Primary journey

1. The developer invokes the skill from their assistant with a project objective.
2. project-plan gathers context and agrees the documentation direction.
3. edit-workboard produces tasks/dependencies using the repository contract.
4. The user/owner selects an explicit task or iteration bound for ralphloop.
5. The owner dispatches start-task workers, one per bounded cycle, and records
   summaries, checks, changes, and reasons to stop.
6. The developer optionally opens either workspace to inspect context or request
   review/control actions. The assistant remains the execution owner.
7. Completed or interrupted activity remains available for chronological replay.

The workflow model supports other declared pipelines. Templates and assistant-
authored definitions are first-class; visual authoring is secondary.

## 4. Desktop workspace

Retain Tauri + React/TypeScript; a Rust-native renderer rewrite is not part of
this direction. Retain selection continuity and shared live/replay projections
from DEC-011 without requiring the old permanent canvas layout.

### Pixel-character activity workspace

Show assistant/worker identities as small original pixel characters associated
with task/phase stations. Selecting one opens its task/run context, changes,
checks, and output. Keep project navigation and evidence details easy to reach;
resolve the exact room/board layout in the fresh design pass. Characters identify
sessions, stations show task context, and links show declared dependencies/routes.

Poses and small motion may reinforce recorded active, waiting, blocked, or
completed states. Idle animation cannot prove owner contact; show stale/unknown
coverage explicitly. Replay presentation comes from the selected event position.
Static/reduced-motion characters and text fallbacks preserve the same meaning.

Use new pixel art, without current RPG portraits/sprites/backgrounds or the older
procedural city/pigeon presentation. Keep ordinary text, output, diffs, and
actionable controls readable rather than pixelated.

### Connections expressed through activity

The default living-workspace view abstracts node boxes and connector lines into
agent visits: **one character walks to another, faces that character, and an
interaction animation plays**. For Agent A -> Tool/action -> Agent B, the visit
expresses the declared relationship/action. Stations and props are optional
context, not the required mediator. Action is a visual term, not a new node type.

Use a sequence such as idle -> approach -> face target -> interact -> settle.
The poses reflect the reported handoff, review, or explanation without inventing
dialogue or success. Only one actor needs to move. Identity, action context and
pending/failed state remain visible independently of playback.

Animate handoffs only from recorded operation/routing evidence. Characters shown
for sequential steps need not both be active: distinguish the prior contribution
from the currently executing actor. Do not imply unrecorded agent conversation,
parallel workers, a new dependency, or an actual output before it is reported.

Selection/inspection must reveal exact node IDs, input/output artifact references,
edge direction, route conditions, and failures. Offer an explicit dependency/
graph diagnostic view when needed; hiding default lines cannot hide causality,
skipped routes, blocked prerequisites, or recording gaps. The terminal expresses
the same handoff through selected actor/action/result rows and optional compact
relationship detail, without requiring a spatial scene.

### Sprite playback and Rust visual runtime

Production deliverables are sprite sheets/atlases for idle, walking and
interactions, with consistent frame dimensions, foot anchors, direction/facing,
clip rectangles, durations and loop/one-shot behavior. Interaction offsets align
two actors. Choose directional coverage in a movement prototype rather than
assuming eight-way sets up front. Imagegen studies are not production atlases.

A separate Rust visual runtime owns actor positions/facing, presentation sequences,
clip selection and frame sampling; real execution and workflow state machines
remain outside it. Compare a hand-built atlas/clip player with a reusable
animation library using one walking-and-interaction prototype. Drawing-backend
choice stays separate: the current Tauri/webview can draw sampled scene state;
a Rust-rendered surface requires an explicit integration decision. No full game
framework or renderer rewrite is committed by this clarification.

Playback never gates real execution, acknowledgment or completion. New events,
cancellation, stale contact, layout changes and replay seeks can interrupt/settle
sequences. Reconstruct reproducible presentation from recorded event position/time
and stable scene layout; seeking must not play a backlog of walking animations.
Reduced motion uses immediate reposition/static interaction poses. Terminal
clients translate visit/interact phases to cell movement or compact text without
needing raster playback.

### Project overview and navigation

Expose the project identity/root, plans/document revisions, task readiness and
dependency relationships, workflow definitions, and run/cycle history. Focus
selection on the active or blocked task and preserve context when opening a run.
Do not present the workflow DAG, task dependency graph, and file-change list as
one unlabeled universal graph.

### Activity and topology

Use a compact workflow/phase map or task-dependency view appropriate to the
selection. Provide clear status, owner, current reported operation, cycle and
attempt identity, and chronological activity. Routing and dependency relations
must remain distinguishable. Unknown progress has no invented percentage.

### Evidence and changes

A selected task/run opens relevant prompts, commands, captured output, artifact
references, changed-file/diff evidence, and verification results. Show whether
checks passed, failed, were skipped, or have no captured result. Preserve the
source and attribution limits of a change; pre-existing dirty files are not all
credited to the current task.

Large output stays readable, searchable, copyable, and associated with the
relevant step. Raw payloads are available as a detail view rather than the
default product surface. Embedded interactive terminals are capabilities of
particular integrations, not required for every recorded run.

### Review and control

Surface the artifact/task revision under review, the decision, and who made it.
Display request delivery/acknowledgment and execution outcomes separately.
Opening a viewer never authorizes publishing, approves a plan, or accepts a
permission prompt on the user's behalf.

## 5. Simplified terminal workspace

The Rust terminal client offers keyboard-driven project/task/run selection,
a compact workflow phase summary, current activity, review requests, event
history, and selected evidence. Use tables, lists, tree/dependency summaries, and
detail panes instead of reproducing a graphical canvas.

Provide resize-safe layouts, scrolling, readable wrapping, text status labels,
and discoverable shortcuts. Color and Unicode cannot be the only state cues.
Keep agent terminal input separate from workspace navigation if an integration
supports interactive attachment. Selection must not accidentally send input to
an agent session.

Echo desktop identities and task/phase stations with small cell-based characters,
status markers, and compact task/dependency summaries. Use block glyphs only when
supported, with ASCII/text equivalents. Preserve identity and selection across
fallbacks rather than fitting desktop sprite sheets into terminal cells.
Decorative motion can be disabled independently of live event updates.

The terminal workspace is distinct from the CLI machine-output interface.
Redirected CLI/MCP use must never receive full-screen escape sequences.
Choose the terminal toolkit during implementation; it must support native
Windows and Linux. Neither toolkit choice nor desktop rendering owns state.

## 6. Live inspection and replay

Backfill persisted events before following live reports, deduplicating by the
recording contract. Follow-tail and a selected historical position use the same
projection. Desktop supports a timeline; terminal supports chronological event
selection with a return-to-live action.

Show stale owner contact and capture gaps independently of the last lifecycle
state. Historical snapshots retain their workflow/board revision references.
Replay is read-only and must never invoke commands or dispatch workers.

## 7. Mock simulation

Enter simulation explicitly with declared mock outcomes. The preview supports
routing, failed steps, review gates, retries, and configured limits without real
agent or repository command execution. Mock review decisions are visibly mock.
Simulation writes only its own application-owned data, never the selected repo.

Show simulation identity throughout the workspace. Results describe behavior
under supplied mock outcomes; they do not predict actual code changes, cost, or
success. Starting real work requires a separate assistant-owned invocation.

## 8. Visual and accessibility direction

Use the evidence-first hierarchy in [VISUAL_IDENTITY.md](VISUAL_IDENTITY.md).
Readable density, stable selection, clear state labels, and useful information
outrank atmosphere and animation. Original pixel characters are the new identity;
current RPG assets, fantasy chrome, health-bar metaphors, and backdrops are retired.
Character activity never replaces explicit technical status or evidence.

Require keyboard access, visible focus, non-color state cues, useful empty/error
states, readable long paths, and narrow terminal layouts. A missing artifact,
capture gap, or unavailable owner must be understandable without raw JSON.

## 9. Existing implementation and migration

The current desktop still uses WorkflowSidebar, DesignSurface, NodeInspector,
RunPanel, HumanReviewPanel, CommandOutputPanel, EventInspector, and an interactive
agent terminal. DEC-013 artwork remains solely to keep the legacy app working
until replacement; it is not new-UI art or fallback material. Remove active legacy
art imports during migration. Existing behavior is covered by tests and the Tauri IPC
contract; this specification does not claim the new layout exists.

Reuse typed state derivation and event backfill rather than copying execution
logic into a redesigned UI. Reassess legacy Run/Cancel/Complete node controls
when attaching to assistant-owned records. Do not route those records through
the existing desktop-owned executor.

## 10. Acceptance

Verify the same fixture projects and traces in desktop and terminal clients:
bounded success, blocked dependencies, failed checks, missing worker summary,
owner disconnection, pending cancellation, missing evidence, legacy history,
and mock review/retry/limit paths. Native Windows and Linux both require visual
and integration checks. Verify new identities/stations, stale contact, scrubbed
replay, reduced motion, missing-new-art text fallback, and terminal ASCII/narrow
layouts. See [TESTING.md](TESTING.md).
