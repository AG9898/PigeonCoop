# AGENTS.md

## Project: PigeonCoop

PigeonCoop packages assistant-owned project workflows as a skill with CLI and MCP interfaces, backed by Rust recording, validation, replay, and mock simulation. Desktop (Tauri + React/TypeScript) and terminal workspaces are optional clients. Native Windows and Linux are both v1 execution targets.

This is the accepted target direction (DEC-014), not a claim that the transition is implemented. Existing crates, binary names (`agent-arcade`), schemas, and desktop execution paths remain until migrated explicitly. Read `docs/INTEGRATION_CONTRACT.md` for the target ownership and interface boundaries.

This is the working contract for implementation agents. Keep it current, concise, and aligned with the docs in `docs/`.

---

## 1. Product intent

Package repeatable project workflows for existing coding assistants and make their activity inspectable across plans, tasks, runs, artifacts, changes, and verification.

It is:

- a local skill + CLI + MCP toolset
- an assistant-owned workflow model with a built-in project delivery template
- a Rust-backed activity recorder, validator, replay debugger, and mock simulator
- optional desktop and simplified terminal workspaces over the same recorded data
- a developer tool whose visual hierarchy prioritizes execution evidence

It is not:

- a generic chatbot app
- a cloud-first SaaS in v1
- a universal autonomous multi-agent framework
- a full 3D game
- an unconstrained swarm sandbox

Core promise: use an existing assistant to plan a project change, write dependency-aware tasks, and execute a bounded task loop; optionally open a workspace to understand activity, evidence, changes, and failures. A general workflow model supports other explicit pipelines.

---

## 2. Non-negotiable architecture

### Assistant owns execution; Rust owns the recorded projection
The assistant session owns dispatch, worker/process lifetime, retries, and execution decisions. Rust validates structured reports and owns persisted events and derived inspection state. Recording an assistant report does not independently verify its claims. Clients never infer success from silence, terminal text, or a disconnected session.

The recorder and viewers do not secretly continue a run after its owner exits. Control actions are requests to the owner; requested, acknowledged, and observed outcomes are distinct. Mock simulation is the exception: Rust may drive explicit mock steps without invoking real agents or repository commands.

### Event-first system
Every important transition emits a typed event. Replay is a first-class requirement.

### Definition and execution are separate
Keep these distinct:
- `WorkflowDefinition`
- `RunInstance`
- `RunEvent`
- `MemoryState`
- `NodeSnapshot`

Do not mutate workflow definitions during execution.

### Explicit state machines
Node and run state must be modeled as finite state machines. Do not infer state from logs, timers, or UI-only state.

### Constrained execution
Allowed in v1:

- DAG execution
- conditional routing
- bounded retries
- human review gates
- bounded task cycles with explicit task/iteration limits and stop conditions
- existing DAG routing and bounded node retries within an individual run

Not allowed in v1:

- autonomous graph rewrites
- undeclared or unbounded worker spawning
- unconstrained agent-to-agent chatter outside the graph
- hidden side effects

### Explicit I/O contracts
Every node type must declare expected inputs, produced outputs, memory access, side effects, and retry semantics.

---

## 3. v1 scope

In scope:

- skill integration plus CLI and MCP access to one Rust recording/inspection layer
- general workflow model; project-plan -> edit-workboard -> ralphloop -> start-task as the first template
- assistant-owned execution against selected projects/repos on native Windows and Linux
- optional Tauri/React desktop and simplified Rust terminal workspaces
- project context linking plans, task dependencies, runs, artifacts, changes, and checks
- isolated mock simulation of routing, reviews, retries, and limits
- live run visualization
- replay/timeline debugging
- human review nodes
- local SQLite persistence
- JSON workflow import/export
- practical developer workflows

Out of scope:

- cloud multi-tenant deployment
- collaborative editing
- distributed workers
- plugin marketplace
- dynamic runtime graph mutation
- open-ended orchestrator agents
- broad compatibility with every agent ecosystem
- codebase knowledge-graph extraction as a v1 requirement
- predictions of real agent edits, cost, or success from mock simulation
- 3D-first game engine work

If tradeoffs are required, preserve this order:

1. replay/debugging integrity
2. execution state correctness
3. practical usability on real projects
4. visual polish

---

## 4. Stack and execution model

- Optional desktop shell: Tauri
- Recording, validation, replay, and simulation core: Rust
- Desktop frontend: React, TypeScript, React Flow or equivalent
- Optional terminal workspace: Rust; toolkit selected during implementation
- Persistence: SQLite
- Serialization: JSON
- Target execution owner: existing assistant session using the packaged skill; CLI/MCP report activity and expose inspection/control-request operations
- Existing execution baseline: desktop-owned command adapters and interactive Claude PTYs (DEC-009); preserve until explicitly migrated, and do not assume this provider behavior is current without verification

Commands execute in a selected workspace root. Arbitrary shell commands are allowed in v1 behind explicit user configuration and safety controls. Prefer structured patch/edit flows when available, but raw write commands are allowed if execution logs capture command, working directory, exit code, stdout/stderr metadata, and detectable changed files.

---

## 5. Node taxonomy

Retain these existing node types as the initial workflow vocabulary. They describe workflow steps; the skill/assistant dispatches real work in the target architecture:

1. Start Node: entry point only
2. End Node: terminal success/failure sink
3. Agent Node: runs an agent-oriented task via CLI/provider adapter
4. Tool Node: runs scripts, build/test commands, linters, formatters, or local tools
5. Router Node: deterministic branching based on prior outputs or explicit rules
6. Memory Node: read/write run-scoped shared memory
7. Human Review Node: pauses execution for inspect/approve/reject/edit

Do not add manager/orchestrator nodes in v1 unless the rest of the system is stable.

Canonical product template: **project-plan -> edit-workboard -> ralphloop(start-task, explicit bound)**. Planning direction is accepted before board writes; each worker handles one startable task and reports verification/docs outcomes. The prior **Plan -> Execute Tool -> Critique -> Approve** fixture remains an engine smoke test. A task cycle is distinct from node retries or graph back-edges (DEC-014).

---

## 6. State and event requirements

Run lifecycle:
- `Created`
- `Validating`
- `Ready`
- `Running`
- `Paused`
- `Succeeded`
- `Failed`
- `Cancelled`

Node lifecycle:
- `Draft`
- `Validated`
- `Ready`
- `Queued`
- `Running`
- `Waiting`
- `Succeeded`
- `Failed`
- `Cancelled`
- `Skipped`

Memory scopes for v1:
- `run_shared`
- `node_local`

Minimum event families:
- workflow events
- run lifecycle events
- node lifecycle events
- routing events
- command execution events
- agent request/response events
- memory read/write events
- human review events
- budget/guardrail events
- persistence/import/export events

Each event should include, where applicable: `event_id`, `run_id`, `workflow_id`, `node_id`, `timestamp`, `event_type`, `payload`, `causation_id`, and `correlation_id`.

---

## 7. UX principles

Design a fresh pixel-character workspace that makes project progress and evidence easy to inspect (DEC-015). Original characters identify assistant/worker sessions, with task/phase stations and explicit technical state. Translate the identity to terminal cell/ASCII characters with text fallbacks. Current RPG/MMO artwork, sprites, portraits, backdrops, and older city/pigeon assets are retired design inputs, not new-UI fallbacks. Their files remain only until the legacy UI is replaced; do not delete assets still used by the running app during docs work. Desktop and terminal clients share semantics, not identical layouts; a permanently visible node editor is not required.

Prioritize:

1. debugging clarity
2. practical task execution
3. live visibility
4. aesthetic differentiation

Default connections become one character visiting another and playing an interaction; shared stations are optional. Plan sprite-sheet clips and a separate Rust visual runtime for movement/facing/frame sampling. Evaluate hand-built versus library-backed playback in a prototype, keeping drawing-backend choice separate. Animation never owns workflow state or gates real execution; replay seeks reconstruct presentation without stale animation queues.

Required information across clients:

- project identity, plan/task dependencies, workflow revision, run owner, and recording coverage
- live activity and chronological replay with clear gaps and pending control requests
- task/run details, prompts, commands, artifacts, changed files, and verification evidence
- explicit real / simulation / replay modes
- optional desktop workspace and compact keyboard-driven terminal views; neither is required to execute a workflow

---

## 8. Implementation priorities

Phase order:

1. settle recording provenance, owner/control semantics, and schema migration contracts
2. extract transport-independent recording, validation, persistence, and replay services
3. CLI + skill integration for the canonical bounded project workflow
4. MCP access to the same domain operations
5. native Windows and Linux integration verification
6. safe mock simulation, simplified terminal inspection, and desktop workspace redesign
7. polish, distribution, and documentation

Optimize for inspectability, deterministic replay, typed contracts, clean module boundaries, and documentation quality. Do not optimize first for adapter breadth, collaboration, remote orchestration, or visual overproduction.

---

## 9. Coding guidelines

Rust:
- prefer strong typing over dynamic maps
- use enums for state machines and node/event kinds
- avoid hidden side effects
- keep core engine crates independent from Tauri concerns
- design for testability

Frontend:
- treat backend events as source-of-truth input
- distinguish assistant reports, captured evidence, missing coverage, and pending requests
- do not duplicate execution logic in the UI
- keep visual state derivable from engine state/events
- separate design-time graph editing from run-time monitoring

Persistence:
- version workflow definitions separately from runs
- keep the event log append-only in principle
- avoid lossy transformation of run traces

---

## 10. Docs and decisions

Every substantial implementation change must update relevant docs in the same change.

Update:
- `docs/PRD.md` for product scope, users, or success criteria
- `docs/ARCHITECTURE.md` for topology, boundaries, crates, or data flow
- `docs/DESIGN_SPEC.md` for UI behavior and visual language
- `docs/EVENT_SCHEMA.md` for events, lifecycles, replay, or payloads
- `docs/REPO_STRUCTURE.md` for layout or major generated assets
- `docs/TAURI_IPC_CONTRACT.md` for frontend/backend command contracts
- `docs/INTEGRATION_CONTRACT.md` for skill/CLI/MCP ownership, recording, and optional clients
- `docs/TESTING.md` for test strategy, commands, fixtures, or patterns
- `docs/workboard.md` and `docs/workboard.schema.json` for workboard shape/rules
- `docs/DECISIONS.md` for meaningful technical decisions
- this file when durable agent rules or summarized constraints change

Keep the accepted target distinct from implemented behavior. The existing workboard has not been replanned for DEC-014; reconcile task intent against the new docs before selecting legacy desktop-only work. Do not silently rewrite the board during documentation changes.

When changing schema, state, or event design, include examples where practical and note migration implications.

Decision records must include context, decision, alternatives considered, tradeoffs, and follow-up implications.

---

## 11. Workboard

Canonical queue: `docs/workboard.json`.
Contract: `docs/workboard.md`.
Schema: `docs/workboard.schema.json`.

Use the workboard skills for targeted selection and updates:
- `query-workboard`
- `start-task`
- `edit-workboard`
- `project-plan`

Do not dump the full board into context when a targeted query is enough.

A task is startable when:
- `status` is `todo` or `ready`
- `blocked_by` is empty
- every `depends_on` task is `done`

Targeted edit rules:
- never bulk-rewrite `docs/workboard.json`
- edit only fields relevant to the active task or requested planning change
- keep `project.updated_at` current when the board changes
- do not invent new `group_id` values without updating `task_groups` and workboard docs

---

## 12. Agent workflow

Standard task cycle:
1. Read this file at the start of a task.
2. Use `query-workboard` when task selection is needed.
3. Use `start-task` for end-to-end workboard task execution when appropriate.
4. Read only the docs relevant to the task before editing.
5. Implement the smallest coherent change that satisfies the task.
6. Run relevant verification commands.
7. Update docs and workboard entries in the same change when needed.
8. Record meaningful decisions in `docs/DECISIONS.md`.

Repo-local skills are synced from `/home/ag9898/projects/ag.dev/skills-core` into `.claude/skills/`, `.agents/skills/`, and `.codex/skills/`. Do not hand-edit generated skill copies unless the user explicitly asks for a local override; prefer updating the source in `ag.dev` and re-running the sync script.

Stop and report when:
- no startable workboard task exists
- verification fails and the fix is not clear
- a request would violate v1 boundaries
- a schema, event, or state-machine change needs an uncaptured decision
- an irreversible action is required without explicit authorization

---

## 13. Verification commands

Prefer the narrowest relevant checks, but do not skip fast checks for touched areas.

| Command | What it checks |
|---|---|
| `cargo test --workspace --exclude agent-arcade` | Rust workspace tests excluding the Tauri binary shell |
| `cd apps/desktop && npm test -- --run` | Frontend unit/component tests |
| `npx --yes ajv-cli validate -s docs/workboard.schema.json -d docs/workboard.json` | Workboard schema validity |
| `cd apps/desktop && npm run dev` | Browser-only frontend startup |
| `cd apps/desktop && npm run tauri dev` | Full desktop startup |

---

## 14. Discoveries

Append durable project discoveries here when they would save future agents time.

Format:

```md
### YYYY-MM-DD — Short title
What was discovered, why it matters, and what future agents should do differently.
```

Keep entries short. Do not reorganize or rewrite existing entries unless asked.

### 2026-07-08 — E2E tests (tauri-driver + WebdriverIO) cannot render the app window in this sandbox
A pre-built `target/debug/agent-arcade` binary and `tauri-driver` are both present in this environment, and `tauri-driver` starts and answers `/status` fine. But running any spec — including the pre-existing, already-`done` `app.spec.js`, `run.spec.js` — fails identically: the window title is empty and `#root` never appears in the DOM, and any `browser.executeAsync(() => window.__TAURI_INTERNALS__.invoke(...))` call fails with `WebDriverError: Origin header is not a valid URL`. This reproduces with the documented WSL2 software-rendering env vars (`GDK_BACKEND=x11`, `WEBKIT_DISABLE_DMABUF_RENDERER=1`, `WEBKIT_DISABLE_COMPOSITING_MODE=1`, `LIBGL_ALWAYS_SOFTWARE=1`) and with `DISPLAY=:0` set. Root cause is environment-specific (likely this sandbox's display/webview stack, not app code) and was not resolved. Future agents: don't spend time trying to get `cd tests/e2e && npm test` fully green in this sandbox — verify new/changed E2E specs via `node --check specs/<file>.spec.js` plus close pattern-matching against the existing passing-in-CI specs, and note the limitation rather than treating it as a task failure.

### 2026-07-09 — Headed Tauri E2E can run with an extracted WebKitWebDriver
The previous sandbox E2E rendering issue was not reproduced after providing a native `WebKitWebDriver`. `tauri-driver` initially failed because `webkit2gtk-driver` was not installed on `PATH`; without sudo, `apt-get download webkit2gtk-driver` plus `dpkg-deb -x` into `/tmp/webkit2gtk-driver-extract` worked, then `tauri-driver --native-driver /tmp/webkit2gtk-driver-extract/usr/bin/WebKitWebDriver` launched the headed app. `app.spec.js` passed (`Agent Arcade` title and `#root` found). Current failures are spec drift, not startup: `builder.spec.js` searches for `workflow-card-null`, and `failure.spec.js` sends a `create_workflow` fixture missing required `created_at`, causing later `runId: null` cascades. Future agents should use the extracted-driver workaround before assuming the sandbox cannot run headed E2E, then fix the stale specs.

### 2026-07-09 — UI restructured to a unified single-screen workspace (DEC-011); handoff state
The four routed views (Builder/Live Run/Replay/Library) were replaced in one change by a single workspace: `WorkflowSidebar` (library, always visible) + top bar (name, Save/Validate, persisted workspace root, one-click Run) + one stage showing `DesignSurface` or `RunPanel` (live + replay unified over the event log with a scrubbable timeline). Full rationale, file map, and the **remaining-work checklist** live in `docs/DECISIONS.md` DEC-011 — read that before touching the frontend. Verified: `tsc` clean, 174 vitest tests green, E2E specs ported and `node --check`ed but **not executed**; the new UI has **not yet been visually verified** in `npm run tauri dev`. Unrelated to the repo: a ready-to-import demo workflow with real claude agent nodes (haiku, plan mode) sits at `/home/ag9898/claude-live-demo.workflow.json` for demoing runs.

### 2026-07-10 — Full E2E suite passes in this sandbox; runbook + bugs it caught (DEC-012)
All 6 E2E specs (88 tests) now pass headed in this sandbox. Runbook in `docs/TESTING.md` §3 "Running E2E in the WSL2 sandbox" — the three non-obvious requirements: (1) extracted `WebKitWebDriver` for `tauri-driver --native-driver` (no sudo: `apt-get download webkit2gtk-driver` + `dpkg-deb -x`), (2) **the Vite dev server must be running on :1420** — the plain-`cargo build` debug binary loads `devUrl`, not embedded assets, so specs fail with an empty `#root` otherwise (this was the real cause behind the 2026-07-08 "cannot render" discovery), (3) delete `~/.local/share/com.agent-arcade.dev/agent-arcade.db` first — a stale seeded demo workflow makes agent nodes fail `preparation failed: AgentNodeConfig must have either command or provider_hint set`. Running the suite surfaced real app bugs (canvas save never worked against the real backend; StrictMode-impure `appendEvents` blanked the feed for any run opened mid-flight/finished; sidebar card actions swallowed selection clicks) — all fixed, see DEC-012. Lesson: mocked unit suites stayed green through all of these; run the headed suite before declaring frontend work verified.

### 2026-10-27 — Portable Windows tooling and native renderer experiment gate
Rust and portable MSVC/Windows SDK can be installed under the user account without elevation. The reviewed portable-msvc downloader (gist revision `49b58850aa5e5c1e65f090d4651ee76607883e11`) verifies Microsoft payload hashes; using absolute MSI paths was needed for extraction in the packaged-app environment. `experiments/renderer-lab/scripts/Use-Toolchain.ps1` imports the resulting compiler environment for one process. Cargo-generated helpers nevertheless fail to launch with OS error 5 despite execute ACLs; the enforcement source is unresolved. Do not disable security controls or report native Rust/Macroquad/Tauri verification as passing. The completed Edge/Pixi study uses headless capture only; its README and REVIEW distinguish browser evidence from missing native tests. Git for Windows also rejects the tracked root filename `, t.status, ` ending in a space; the experiment checkout excludes that path without deleting the source file.

### 2026-10-27 — Renderer comparison follow-up: shared Rust/WASM and webview compatibility
The broader renderer lab passes nine Rust cases on Linux and seventeen Node cases on both Windows/Linux, including actual editor exports, shared WASM sampling and CLI fixture lifecycle. Canvas/Rust/packed sheets also work inside the existing Linux Tauri shell on private Xvfb. Pixi 8.22 corrupts sprites in the tested WebKit/software path while Canvas and native Macroquad render correctly; the exact cause remains unresolved. Keep this observed failure separate from Windows Pixi results. The product verdict recommends HTML/Canvas plus shared Rust native/WASM presentation sampling, with optional viewers, but no production migration is accepted. Native Windows execution is still unverified. The WSL distro named Ubuntu-22.04 currently reports Ubuntu 24.04.4; record actual OS/graphics context rather than inferring it from the distro name.

### 2026-10-27 — Verify Pixi backend availability against the pinned package
PixiJS 8.22 ships CanvasRenderer and auto-detection support even though its general web guide still says Canvas is coming soon. The versioned API and actual package were inspected, and Pixi Canvas passed Windows/WebKit pixels, packed-frame parity, Linux Tauri and CLI/browser proofs. The final renderer-lab recommendation is PixiJS 8.22 with Canvas selected explicitly, normal HTML/React controls and shared Rust native/WASM sampling; direct Canvas remains a reference adapter. Keep Pixi WebGL/software failures separate from Pixi Canvas results. This recommendation is not a production migration or native Windows release pass.

### 2026-10-27 — WSL renderer checkpoint accepted (DEC-016)
The user accepted pinned PixiJS 8.22 with Canvas selected explicitly, HTML/React inspection and shared Rust native/WASM sampling for WSL prototype iteration. Resume from `experiments/renderer-lab/HANDOFF.md`; the experiment and saved evidence are retained together. This does not migrate production UI or qualify native Windows/physical Linux hardware. Earlier recommendation-only entries are historical; DEC-016 defines the accepted scope.
