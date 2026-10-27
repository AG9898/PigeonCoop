# Assistant Integration Contract

**Accepted target requirements, 2026-10-27 (DEC-014). Not an implemented API.**

This document defines responsibilities shared by the skill, CLI, MCP server,
Rust recorder, and optional viewers. Concrete command/tool names, wire fields,
transport details, and schema migrations must be specified before implementation.
The current desktop API is documented in [TAURI_IPC_CONTRACT.md](TAURI_IPC_CONTRACT.md).

## 1. Ownership

| Component | Owns | Must not imply |
|---|---|---|
| Assistant session + skill | Real dispatch, workers, routing, permissions, retries, task limits, execution outcomes | A report alone proves its claims |
| Rust recording/application layer | Validation, accepted event order, persistence, projections, queries | It executes or supervises real work after the owner exits |
| CLI and MCP | Access to shared recording, query, and request operations | Separate schedulers or inconsistent histories |
| Desktop and terminal workspaces | Inspection and explicit requests to the owner | UI state or a button click confirms execution |
| Mock simulator | Explicit mock transitions and bounded mock cycles | A real command ran or a result was predicted |

A real run has an identified assistant owner and a pinned workflow revision.
An MCP host session, a viewer process, and an assistant execution owner are
different identities. Restarting a recorder/viewer does not adopt ownership.
Ownership transfer/resumption requires an explicit reconciled handoff; automatic
takeover, retry, or re-dispatch is outside the initial contract.

## 2. Operations to expose

These are capabilities, not finalized command/tool names:

- register/import and validate workflow definitions and revisions;
- open an owner-associated recording for a selected project/workspace;
- submit structured lifecycle, routing, command, worker-summary, review, and
  verification reports with references to collected evidence;
- list/query projects, plans, task snapshots, cycles, runs, events, and artifacts;
- read a stable history page and subscribe/follow from a durable position;
- submit an approval/rejection/cancellation request to the owning assistant;
- acknowledge/reject requests and report their observed execution outcomes;
- run a clearly isolated mock simulation;
- open a desktop or terminal viewer attached to a project, run, or simulation.

CLI machine output must remain parseable; progress/diagnostics use a separate
channel. MCP stdio must contain only protocol messages. Plain CLI recording and
query operations must work in CI/redirected terminals without a TTY or display.

## 3. Reporting and durable state

Reports must identify their owner, source, run, workflow revision, and applicable
task/cycle/step attempt. Distinguish an assistant assertion, an adapter/hook
capture, and an artifact-backed result. Never label all three independently
verified. Adapters collect only what the selected integration supports.

The shared Rust layer validates identities, report shapes, and lifecycle
transitions before append. Retried delivery must be idempotent; conflicting
content under the same report identity is rejected. Acknowledgment means durable
acceptance. Rejected reports do not partly change projections.

Persist a stable per-run replay order independent of producer timestamps.
Concurrent CLI/MCP/viewer processes must not create separate run owners,
duplicate accepted reports, or reorder persisted history on reconnect. Backfill
then follow using a cursor/deduplication contract. The choice of an in-process
library, local recorder companion, and local IPC is an implementation decision;
none grants the recorder real-work orchestration authority.

## 4. Partial coverage and interrupted owners

Record capture capabilities and gaps separately from execution status. A missing
heartbeat, lost MCP connection, or stopped owner process is evidence of lost
contact, not proof that a command succeeded, failed, or stopped running.

Keep the last accepted lifecycle state visible with an explicit stale/unknown
coverage indicator. Do not invent a new persisted run status in a UI component.
Reconciliation may append an evidenced outcome or explicit interruption record
through the versioned contract; it must not rewrite old events. Do not promise
live child-process recovery for arbitrary assistant harnesses.

## 5. Review and control requests

Distinguish request creation, delivery, owner acknowledgment, and observed result.
A cancellation click is pending until acknowledged and execution stopping is
reported; loss of contact leaves that request unresolved. An acknowledged
cancellation request is not proof that all child processes have exited.

Record a human decision with the actor and reviewed artifact/task revision.
The owner consumes the decision according to its skill/harness permissions.
The recorder does not manufacture approval, bypass an assistant permission
prompt, or mark a task done because a request was sent. A viewer must not start
a replacement agent when no owner is available. CLI/MCP availability does not
grant authorization to publish changes.

## 6. Canonical task-cycle contract

The built-in template follows project-plan -> edit-workboard -> ralphloop with
start-task workers. Preserve the installed repository skill contracts, including
dependency readiness, one task per worker, doc/test gates, and publish policy.
Use project-specific paths and schema configuration rather than hardcoded board
fields from this repository.

The owner checks an explicit iteration or completed-task bound before dispatch,
launches one fresh worker per cycle, validates its summary, and halts on failure,
blocking, malformed/missing summary, no progress, or the bound. Record each
cycle and its task/run references separately from a node retry attempt.

The board remains a planning/execution artifact maintained by the skill/worker.
Rust may index snapshots and references but cannot silently mutate task status.
Observe board revisions so historical task dependencies remain explainable.

## 7. Project evidence

Link plan/document revisions, task snapshots/dependencies, runs/cycles, outputs,
artifacts, changed files/diffs, and verification commands/results. Preserve
source references and distinguish missing, skipped, failed, and passed checks.

A dirty worktree before a task is not evidence that the task changed every dirty
file. Capture a baseline when available and mark attribution limits when it is
not. Missing check output cannot be displayed as a pass. Redaction and external
artifact retention must not silently turn absent content into complete replay.

## 8. Real execution, mock simulation, and replay

Real execution belongs to the assistant. Simulation belongs to a mock-only Rust
driver with explicit outcomes for routing, review, retry, and bound tests.
Replay is read-only projection of a stored record. Select and label these modes
explicitly; do not infer simulation from provider names or empty commands.

The simulation driver must have no path to real agent/shell/network executors or
project writes. Application-owned simulation storage is allowed and separate
from real run history. A mock approval is never a real human approval. Do not
automatically convert a simulation into a real run.

## 9. Platforms and optional clients

Native Windows and Linux are v1 requirements. Headless skill/CLI/MCP use cannot
depend on Tauri, a display server, or WebKit development/runtime packages.
Desktop remains Tauri + React/TypeScript; terminal rendering remains Rust with
a toolkit chosen at implementation time.

The planned Rust visual runtime samples actor visits/interactions and sprite
clips from accepted projections. It owns presentation only, never dispatch or
workflow lifecycle. Approach animations cannot gate outcomes or invent chatter.
Drawing-backend choice is independent of playback; terminal clients may use
cell/text equivalents. Reconnect/seek reconstructs the selected scene instead
of running a stale animation queue.

Shell selection, argv/quoting, paths, PTYs, signals/process trees, cancellation,
and file-change capture require explicit OS contracts and native tests. Current
`sh -c` adapters are legacy behavior, not a cross-platform guarantee. Windows
UI-to-WSL execution is not a first-release requirement.

## 10. Compatibility and open implementation details

This documentation change does not add event types, wire fields, lifecycle
variants, SQL columns, or commands. The existing models/schemas stay unchanged.
Before recording new owner, source, cycle, mode, coverage, and control metadata,
specify their versioning, payload examples, validation, and migrations in the
schema/API docs and matching code change.

Retain legacy desktop workflows and traces, mark their provenance/capture
coverage as legacy/unspecified, and do not invent source evidence. Keep current
binary/package names until an explicit rename. Exact wire names, local IPC,
terminal toolkit, and installer layout remain scoped implementation decisions.
