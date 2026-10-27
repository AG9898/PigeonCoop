# Product Requirements Document (PRD)

## Product and status

**PigeonCoop — accepted target direction, 2026-10-27 (DEC-014).**

The repository currently implements a desktop-first Agent Arcade application.
This document specifies the next product baseline; the skill, CLI, MCP server,
terminal workspace, and recording protocol are not yet implemented. Existing
binary/package names remain until an explicit migration.

## 1. Product summary

PigeonCoop packages repeatable project workflows for existing coding assistants.
An assistant session executes a declared workflow using a skill. Rust records
structured activity, validates reports, persists history, supports replay, and
runs isolated mock simulations. CLI and MCP expose the same domain operations.
A Tauri desktop workspace and a simplified terminal workspace can be opened
when useful, without becoming prerequisites for real execution.

The first built-in template packages the developer's existing process:

**project-plan -> edit-workboard -> ralphloop(start-task, explicit bound)**

The workflow model is general enough for other explicit pipelines. A fully
configurable visual workflow IDE is not required for the first release.

## 2. Problem and primary user

Coding assistants can already plan, edit code, invoke tools, and delegate bounded
work. Developers need continuity and visibility across the project: which plan
produced a task, what can start, what agents are doing, what changed, what was
checked, and why work stopped. Manually reconstructing that workflow in a desktop
node editor adds friction.

The primary user is a developer using a coding assistant in a local Windows or
Linux repository. PigeonCoop fits into that assistant's workflow and exposes
durable evidence without requiring a replacement chat interface.

## 3. Product contract

- The assistant session owns real dispatch, worker lifetime, routing, retries,
  permissions, and task-loop decisions within declared limits.
- Rust owns the validated record and its projections. It does not independently
  prove that a reported command ran, tests passed, or a file changed.
- Opening/closing a viewer does not start, continue, complete, or cancel work.
- CLI/MCP operations record/query activity and submit requests to the owner;
  they do not transfer real execution ownership to Rust.
- A disconnected owner leaves incomplete coverage visible. Silence is never a
  success, failure, or cancellation signal.
- Definitions, task-board state, run activity, and evidence remain separate.
  A changed board does not rewrite historical runs.

See [INTEGRATION_CONTRACT.md](INTEGRATION_CONTRACT.md) for target boundaries.

## 4. Primary jobs

1. Start from an existing assistant and a declared workflow/template.
2. Plan a project change, accept its documentation direction, then write tasks.
3. Execute a bounded loop of dependency-ready tasks, one worker per cycle.
4. Optionally inspect project context in a terminal or desktop workspace.
5. Explain completion, failure, blocking, changes, and verification from stored
   evidence, including gaps in what was recorded.
6. Rehearse routing and limits with mock steps before authorizing real work.

## 5. Required v1 capabilities

### Skill and general workflow model

Package instructions and tool usage for planning, workboard authoring, bounded
execution, reporting, review, and recovery. Retain explicit definitions, node
contracts, revision identity, deterministic routing, and bounded retries.
Do not hardcode one repository's task IDs, paths, or group names.

The initial vocabulary remains Start, End, Agent, Tool, Router, Memory, and Human
Review. These describe steps; Rust does not become a second real-work scheduler.

### Canonical project delivery template

1. project-plan gathers context and agrees documentation direction with the user.
2. edit-workboard writes dependency-aware tasks using the project's contract.
3. ralphloop starts one fresh worker per cycle with an explicit iterations:N
   or tasks:N bound, checking the bound before dispatch.
4. Each worker invokes start-task for at most one startable task, verifies it,
   updates relevant docs, and returns its structured summary.
5. The owner records outcomes and halts on failure, blocking, missing/invalid
   summaries, lack of task progress, or the configured limit.

Keep startability and board mutation in the repository's skills/contracts.
PigeonCoop validates and displays reports; it must not silently become a second
task-board editor. Publishing requires explicit user authorization. A new task
cycle is not a retry of an old node. Ordinary node graphs remain DAGs unless
separately versioned.

### CLI and MCP

Provide recording, validation, project/run/event/evidence lookup, control
requests, and opening optional viewers through one Rust application boundary.
CLI output supports structured machine use; MCP stdio stays protocol-clean.
Names and wire schemas are specified during implementation, not inferred from
the old Tauri start_run API.

### Project workspace

Link plans/document revisions, task dependencies, workflows, task cycles, runs,
artifacts, changed files/diffs, and verification results. Show ownership,
recording coverage, requested actions, and acknowledged outcomes.

This is a project activity model. Source-code knowledge-graph extraction is not
required in v1. Do not imply every command, edit, or agent thought is captured
automatically. Represent missing evidence and sources explicitly.

### Optional desktop and terminal clients

- Desktop: Tauri + React/TypeScript for project context, topology/dependencies,
  details, file changes, and live/replay timelines.
- Terminal: Rust for compact task/run lists, activity, selected evidence, review
  requests, and chronological inspection.
- Both use the same record. Actions request work from the assistant owner and
  await acknowledgment; neither viewer owns real execution.
- Visual graph editing is secondary to templates/assistant-authored definitions.
- Design a fresh pixel-character workspace with original session characters and
  task/phase stations, translated to terminal cell/ASCII identities. Retire the
  current RPG and older city/pigeon assets; do not use them as new-UI fallbacks.
  Technical state and evidence remain explicit (DEC-015).
- Default relationships appear as one agent walking to another and playing an
  interaction. Sprite sheets and a separate Rust visual runtime support playback;
  stations are optional. Prototype hand-built versus library-backed animation
  with drawing-backend choice kept separate. Playback never owns or delays work.

### Mock simulation and replay

Simulation executes explicit mock outcomes against routing, reviews, retries,
and bounds. It invokes no real agents, shells, project scripts, network tools,
or writes to the selected repository. Its own clearly labeled simulation history
may be persisted in application storage.

Simulation does not predict actual edits, token cost, or success. Replay reads
recorded events and evidence without re-execution. Real runs, mock simulations,
and replay must be visually and structurally separable. The existing empty
simulation crate is a starting point, not an implemented simulator.

### Local persistence and compatibility

Keep SQLite, versioned definitions, append-only history, JSON import/export,
and typed state machines. Add provenance, coverage, owner/control correlation,
task-cycle links, and evidence references through an explicit versioned
contract. Preserve legacy exports/traces; never backfill invented ownership or
complete coverage.

No Rust types, JSON schemas, or SQL migrations change in this documentation pass.

### Platforms and distribution

Native Windows and native Linux execution are both required for v1. Windows may
be the primary interactive development environment; Linux remains a release and
verification target. WSL Linux testing does not verify native Windows execution.
A Windows viewer controlling WSL agents is deferred.

Distribute a coherent Rust toolset with skill setup, CLI, and MCP entry points.
Desktop installation/launch is optional. A headless install must not require a
display or Tauri/WebKit dependencies. Terminal toolkit, installer layout, command
names, and registry submissions are implementation choices. Existing manifests
do not prove the new package exists.

## 6. Non-goals

- Rust autonomously supervising or continuing real work after the owner exits
- replacement coding-agent harness or general-purpose chat application
- cloud orchestration, distributed workers, or collaborative editing
- unconstrained worker spawning or runtime graph mutation
- universal assistant/provider support
- codebase knowledge-graph extraction in the first release
- outcome/cost prediction from mock simulation
- native-Rust desktop renderer rewrite or mandatory RPG visual identity
- reskinning current RPG assets or reviving older city/pigeon art

## 7. Success criteria

A developer on either supported OS can:

- use an existing assistant to run the built-in project workflow without a GUI,
  with explicit bounds and recorded stop reasons;
- identify the plan/task revision used and evidence supporting reported changes
  and verification;
- open either viewer mid-run, backfill history, then follow live reports;
  closing it leaves owner execution unaffected;
- distinguish disconnection, stale/missing coverage, and pending requests from
  confirmed lifecycle outcomes;
- replay completed/interrupted records without side effects;
- simulate failure, review, retry, and limit paths without repository changes.
- recognize the same session/task identity in the new desktop pixel workspace
  and terminal representation, including static and plain-text fallbacks.

Technical acceptance includes consistent CLI/MCP/client projections, idempotent
ingestion, stable per-run replay order, rejected invalid transitions, legacy
trace compatibility, and native Windows/Linux integration coverage.

## 8. Migration and delivery order

1. Define provenance, owner lifecycle, evidence, control requests, and task-cycle
   identity, including schema/version migration and legacy trace handling.
2. Extract recording/persistence/inspection services from Tauri coordination.
3. Deliver CLI and one skill/template integration with structured reporting.
4. Expose the same operations through MCP; verify ownership on both OSes.
5. Add mock simulation, terminal inspection, and a redesigned desktop workspace.
6. Verify installation through first recorded workflow on Windows and Linux.

The prior Plan -> Execute Tool -> Critique -> Approve fixture remains a core smoke
test. The old workboard remains implementation history until remaining tasks are
explicitly reconciled with this baseline.
