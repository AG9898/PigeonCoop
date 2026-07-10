# Decisions

## Accepted decisions

### 2026-03-07 — Local-first product
The application is local-first for v1. No cloud-first architecture.

### 2026-03-07 — Desktop shell
The product will be built as a Tauri desktop app.

### 2026-03-07 — Core language
Rust is the core implementation language for engine/state/persistence.

### 2026-03-07 — Frontend approach
Use React + TypeScript inside Tauri rather than a Rust-only UI stack.

### 2026-03-07 — Primary v1 use case
Primary use case is workflow design wrapped in a fun interface, then live monitoring/replay of actual runs.

### 2026-03-07 — Execution target
First execution target is a CLI wrapper model operating in a selected local workspace/repository.

### 2026-03-07 — Task practicality
The tool must be practical for developing/coding in the repository or project that the agents are initialized in.

### 2026-03-07 — Human intervention
Support pause/review/approve/reject/retry/edit flows in v1.

### 2026-03-07 — Shell commands
Arbitrary shell commands are allowed in v1, with explicit logging and visibility.

### 2026-03-07 — File mutation policy
Raw write commands are allowed in v1, though Git-aware or patch-aware approaches are preferred where possible.

### 2026-03-07 — Orchestration scope
Do not include unconstrained orchestrator-agent instances in v1.

### 2026-03-07 — UX direction
2D mission-control / strategy HUD aesthetic. Practicality and debugging clarity outrank pure visual novelty.

### 2026-03-07 — Testing stack
Playwright cannot drive Tauri's native webview (WebView2/WKWebView/WebKitGTK). E2E testing uses `tauri-driver` + WebdriverIO instead. Frontend component tests use Vitest + React Testing Library with mocked `@tauri-apps/api`. Rust layers use `cargo test`. See [`docs/TESTING.md`](TESTING.md).

### 2026-03-07 — Distribution strategy
Distribute as native OS installers via GitHub Releases (`.dmg`, `.msi`, `.AppImage`). Also publish package manager formulae/manifests (Homebrew, winget, AUR) as early as possible — this is a trust signal and reduces install friction to a single command. Do not distribute the GUI app via npm; npm is inappropriate for a native binary + webview app. A future headless CLI companion (`agent-arcade-cli`) could be distributed via npm but is out of scope for v1. The Rust core crate architecture already supports this without structural changes.

### 2026-03-07 — Developer-first UX philosophy
The target user is a technical developer. The product must feel like it was built by developers for developers. Do not sand off technical edges in pursuit of consumer-grade polish. Keyboard-driven workflows, readable config files, and visible system state are higher priorities than visual smoothness. The setup-to-wow moment — watching a real workflow run against your own repo and replaying it — must be reachable in under 2 minutes from install. The demo workflow (`plan-execute-critique-approve`) must be the first thing a user can run, not a tutorial they have to complete first.

### 2026-03-07 — Workflow JSON schema versioning strategy (DEC-001)

**Context:** `WorkflowDefinition` had a single `version: u32` field with no documented meaning. It was being used by the persistence layer as a user revision counter (incrementing on save), but could also have been interpreted as a schema format version.

**Decision:** Two separate fields:
- `schema_version: u32` — set by the application, never by the user. Tracks the JSON format version. `CURRENT_SCHEMA_VERSION = 1`. Must be incremented whenever the schema changes in a backward-incompatible way, and a corresponding migration arm added to `workflow_model::workflow::migrate()`.
- `version: u32` — user-controlled revision counter. Incremented by the application each time the user saves a new revision of the same workflow. Used by the persistence layer as a row key in `workflow_versions`.

**Migration policy:** On load, call `migrate(wf)`. The function steps `schema_version` from the stored value to `CURRENT_SCHEMA_VERSION` one increment at a time, applying the appropriate transform in each `match` arm. This makes migrations composable and deterministic.

**Example v1 → v2 migration scenario:** If a future schema v2 adds a top-level `tags` array, the migrator sets `tags: []` on documents that lack it, then bumps `schema_version` to 2.

**Alternatives considered:**
- Single field (ambiguous — rejected; conflates schema format with user revision history)
- Semver string for schema_version (expressive but unnecessary complexity for a local-first tool with a simple u32 increment policy)
- User controls schema_version (rejected; users should not touch format metadata)

**Tradeoffs:** Adds one required field to the schema. Minor breaking change during v1 development, but no deployed users exist yet so cost is zero.

**Unblocks:** FOUND-003, MODEL-005.

### 2026-03-07 — CI pipeline scope: exclude src-tauri from cargo test

**Context:** Adding a CI pipeline required deciding which crates to include in `cargo test --workspace`.

**Decision:** Exclude `apps/desktop/src-tauri` (`agent-arcade`) from the workspace test run using `--exclude agent-arcade`. The CI `rust` job runs `cargo test --workspace --exclude agent-arcade`.

**Rationale:** The `src-tauri` crate is a thin binary shell — it wires up the Tauri window and IPC routes. It has no unit tests. Its `tauri::generate_context!()` macro reads `tauri.conf.json` at compile time and requires native system libraries (`libwebkit2gtk`, `libgtk-3`, etc.) to compile on Linux. Including it would add a heavy system-deps install step to every CI run with no test coverage gain. All testable business logic lives in the other crates.

**Alternatives considered:**
- Include `src-tauri` with system deps installed — adds ~2–3 min to every CI run for zero additional test coverage
- Separate CI job for Tauri compilation check only — viable but premature; can be added when the crate has meaningful logic worth validating

**Follow-up:** When E2E tests are added (TEST-001), a separate CI job will compile the full Tauri binary with system deps and run `tauri-driver` + WebdriverIO against it. That job will run on PR only, not on every push.

### 2026-03-08 — Contract-first IPC boundary (QA-001)

**Context:** The Tauri bridge between Rust commands and TypeScript consumers is the hardest boundary to catch at compile time. Field renames or type changes in Rust produce silent `unknown` values on the TypeScript side. With TAURI-002, TAURI-003, and TAURI-004 forming the entire run-lifecycle surface, implementing them without a prior contract creates high drift risk across multiple agent sessions.

**Decision:** Before any run-lifecycle or event-bridge Tauri command is implemented, produce:
1. `docs/TAURI_IPC_CONTRACT.md` — the canonical specification of every `invoke()` command (name, arg struct, return type, error type) and every `listen()` event (name, payload, emitter, subscriber).
2. `apps/desktop/src/types/ipc.ts` — TypeScript interfaces mirroring the contract, plus a typed `invokeTyped<T>()` wrapper.

No component may call `invoke()` with an inline `unknown` cast. Any deviation between implementation and contract is a bug.

**Alternatives considered:**
- Generate TypeScript bindings from Rust types via `ts-rs` or `specta` — viable long-term but adds build complexity and a codegen step in v1 before the contract surface is even settled.
- Runtime validation (Zod) at the boundary — useful defence-in-depth but does not replace a declared contract.

**Tradeoffs:** Adds one mandatory design task before implementation. Cost is low (< 1 session); benefit is that all three TAURI tasks implement against a shared specification rather than diverging independently.

**Blocks:** TAURI-002, TAURI-003, TAURI-004. See workboard task **QA-001**.

---

### 2026-03-08 — Test-first mandate for engine validator and coordinator (QA-002)

**Context:** The workflow validator (ENGINE-003) and run coordinator (ENGINE-004) are the most load-bearing Rust components. They define the error vocabulary (`ValidationError`, `StateTransitionError`) and state transition contracts that the entire system references. Implementing them without prior executable specifications risks silent assumption drift across agent sessions.

**Decision:** Before ENGINE-003 or ENGINE-004 implementation begins, commit failing unit tests to:
- `crates/core-engine/src/validator_tests.rs` (≥ 8 cases: valid graph, missing start/end, cycle, orphan node, invalid edge reference)
- `crates/core-engine/src/coordinator_tests.rs` (≥ 8 cases: state transitions, retry, pause/resume, cancel, human review gate)

The `ValidationError` and `StateTransitionError` enum variants are declared in these test files and become the canonical error types. Coordinator tests use trait injection for the event log — no SQLite in unit tests.

**Alternatives considered:**
- Write tests after implementation (standard TDD inversion) — rejected for this project because multiple agents implement tasks across sessions. Without prior tests as a contract, each session can independently diverge.
- Rely on ENGINE-008 (unit test task) to cover this retroactively — rejected; by that point the error vocabulary and state transition semantics are already locked in by prior implementations.

**Tradeoffs:** Adds one mandatory test-authoring task before implementation. The tests are expected to fail until ENGINE-003/004 are implemented — that is the intended state.

**Blocks:** ENGINE-003, ENGINE-004. See workboard task **QA-002**.

---

### 2026-03-08 — Unreachable node policy (QA-002)

**Context:** The workflow validator (ENGINE-003) must decide whether a node that exists in the node list but cannot be reached from the Start node via forward edges is a hard error or a warning. This decision affects the `ValidationError` vocabulary and the test contract.

**Decision:** Unreachable nodes are a **hard validation error** in v1. `WorkflowValidator::validate()` must return `ValidationError::UnreachableNode { node_id }` for each node that is unreachable from the Start node. The run will not proceed to execution.

**Rationale:**
- Unreachable nodes indicate a workflow design mistake (a disconnected subgraph or a forgotten edge). Silently ignoring them hides bugs and produces confusing run traces where nodes never execute but are never reported as skipped.
- In v1, where the graph is small and developer-facing, strict validation is more helpful than permissive warnings.
- The replay/debugging goals of the project require that every node has a clear status in every run. A node that can never be queued has no valid lifecycle.

**Alternatives considered:**
- Emit a warning (non-fatal) and allow the run to proceed — rejected for v1 because it produces confusion in the live run view (nodes stuck in Draft state with no explanation).
- Skip validation and detect unreachable nodes at runtime (they simply never get queued) — rejected because silent omission violates the explicitness principle (CLAUDE.md Rule D).

**Tradeoffs:** Developers must explicitly remove or connect all nodes before a run can start. This is a minor authoring friction but prevents runtime ambiguity.

**Follow-up:** If bounded loop support is added in v1.1, the validator must be updated to handle back-edges correctly so loop nodes are not incorrectly flagged as unreachable.

---

### 2026-03-08 — Agent CLI node output strategy (DEC-005)

**Context:** Agent nodes execute external CLI tools (e.g. `claude-code`, `aider`, custom scripts) and must make their output available to downstream nodes via run-scoped memory. Three options were considered:
1. Require structured JSON on stdout from the agent CLI
2. Capture raw text and pass it as-is
3. Use a configurable per-node output parsing strategy

**Decision:** Configurable output mode per `AgentNodeConfig`, defaulting to `raw`.

The `AgentNodeConfig` struct includes an `output_mode` field with three variants:
- `Raw` (default) — capture full stdout as a string; `AdapterOutput.output` is `{"raw": "<stdout>"}`. Works with any CLI.
- `JsonStdout` — parse the entire stdout as a JSON value; fail the node if stdout is not valid JSON.
- `JsonLastLine` — parse only the last non-empty line of stdout as JSON; fail the node if that line is not valid JSON. Supports a common agent CLI convention of emitting a structured summary line at the end of a verbose run.

The raw stdout is always captured in `AdapterOutput.stdout` regardless of `output_mode`. The `output_mode` only affects what goes into `AdapterOutput.output` (the structured value that downstream nodes and memory writes consume).

**Rationale:**
- Most real agent CLIs (`claude-code`, `aider`, shell scripts) emit natural-language output or diffs — not JSON. Requiring Option 1 globally would break compatibility with the entire target ecosystem.
- Option 2 (raw-only) is compatible but forces every downstream Router or Memory node to treat agent output as an opaque blob, with no path to structured data even when the agent can provide it.
- Option 3 preserves compatibility (default is `raw`) while enabling structured workflows where the agent CLI does emit parseable output. The `JsonLastLine` mode is a practical accommodation of a common pattern (agent emits verbose reasoning, then a final JSON summary line).

**Alternatives considered:**
- Require JSON on stdout globally — rejected; breaks all standard agent CLIs.
- Raw-only forever — rejected; forecloses structured workflows for CLIs that can produce structured output.
- Full regex/jq extraction — viable but over-engineered for v1. Can be added in v1.1 as a fourth mode without breaking the existing enum.

**Tradeoffs:**
- Adds one enum field to `AgentNodeConfig`. Minimal schema complexity.
- Nodes using `JsonStdout` or `JsonLastLine` will fail if the CLI does not honour the contract — this is intentional. Developers configuring these modes are opting in to a stricter contract.
- `Raw` default means existing tool configurations never break.

**Unblocks:** MODEL-005 (`AgentNodeConfig` struct), ADAPT-003 (agent CLI adapter output handling).

---

---

## ADR: NodeConfig is a typed enum — never treat it as a JSON map

**Context:** `NodeDefinition.config` was originally a raw `serde_json::Value`. It was refactored to `NodeConfig`, a strongly-typed enum discriminated by `node_type`. The `CliAdapter` continued calling `.get("command")` as if `config` were still a JSON map, causing a compile error (`E0599: no method named 'get' found for enum NodeConfig`). A follow-up fix corrected `CliAdapter::extract_command` and the primary test constructor but missed two additional failure sites, producing a second round of CI failures (`E0308: mismatched types`):
1. A test body that *mutated* a node's config field after construction (`node.config = serde_json::Value::Null`).
2. `NodeDefinition` test helper functions in other crates (`mock/mod.rs`, `core-engine/src/validator_tests.rs`) that were not updated.

**Decision:** All code that reads or writes `node.config` must use the `NodeConfig` enum — no `serde_json::Value` assignment or method call is valid anywhere on that field.

**Rule for future adapters and engine code:**
- To read tool config: `match &node.config { NodeConfig::Tool(cfg) => cfg.command.clone(), _ => Err(...) }`
- To read agent config: `match &node.config { NodeConfig::Agent(cfg) => &cfg.prompt, _ => Err(...) }`
- Never call `.get(...)`, `.as_str()`, or any `serde_json::Value` method on `NodeConfig`.

**Rule for test code — covers all three failure patterns:**
1. **Constructors:** use typed variants, e.g. `NodeConfig::Tool(ToolNodeConfig { command: "echo test".into(), shell: None, timeout_ms: None })`, not `serde_json::json!({"command": ...})` or `serde_json::Value::Null`.
2. **Post-construction mutation:** assigning `node.config = serde_json::Value::Null` to simulate a bad config is not valid. Use a mismatched variant instead, e.g. `node.config = NodeConfig::Start(StartNodeConfig {})` on a Tool node.
3. **Cross-crate helpers:** when `NodeDefinition` is constructed in test helpers across multiple crates (`runtime-adapters`, `core-engine`, etc.), every helper must be updated — not just the one in the crate where the type change originates.

**Search guidance:** when changing any field type on `NodeDefinition`, run a workspace-wide search for the field name (`config:`) in test modules across all crates before declaring the fix complete.

**Tradeoffs:** Slightly more verbose match arms vs. the old map lookup, but compile-time safety eliminates the entire class of "wrong field name" bugs.

---

### 2026-03-08 — Tauri build scaffolding requirements

**Context:** When `cargo build -p agent-arcade` was first attempted on a fresh Linux (WSL2) environment, it failed in three separate stages. These are not code bugs — they are scaffolding gaps in the initial project setup.

**Required conditions for `cargo build -p agent-arcade` to succeed on Linux:**

1. **System libraries** — GTK3/WebKit2GTK native libs must be installed via apt. One-time install per machine:
   ```bash
   sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev \
     libayatana-appindicator3-dev librsvg2-dev libsoup-3.0-dev
   ```

2. **`build.rs`** — must exist at `apps/desktop/src-tauri/build.rs` containing `tauri_build::build()`. Without it, `tauri::generate_context!()` cannot set `OUT_DIR` and fails with "OUT_DIR env var is not set".

3. **`icons/icon.png`** — must exist at `apps/desktop/src-tauri/icons/icon.png` as a valid RGBA PNG. `tauri_build::build()` reads it at compile time. Any other format (RGB, palette) causes a compile-time panic.

4. **`apps/desktop/dist/`** — must exist (can be empty) as `tauri.conf.json` points `frontendDist` to `../dist`. Without it, `generate_context!()` panics with "path doesn't exist".

5. **`tauri.conf.json` bundle target** — `"targets"` must be one of the documented enum values (`"all"`, `"deb"`, `"appimage"`, etc.). `"none"` is not valid even when `"active": false`. Use `"all"` with `"active": false` to disable bundling without a compile error.

6. **`chrono` in `Cargo.toml`** — `apps/desktop/src-tauri/Cargo.toml` must explicitly depend on `chrono = { workspace = true }` since `commands/mod.rs` uses `chrono::Utc` for timestamping run status updates.

**Note:** The `agent-arcade` crate is excluded from CI `cargo test --workspace` (see decision above) precisely because of items 1–4. These scaffolding requirements only matter when building the full Tauri binary, not when running the engine/persistence/model unit tests.

---

### 2026-03-19 — Tauri 2.x IPC argument casing: camelCase from JavaScript

**Context:** Tauri 2.x `#[tauri::command]` applies `rename_all = "camelCase"` when deserializing arguments from JavaScript. This means `invoke("create_run", { workflow_id: ..., workspace_root: ... })` silently fails — the Rust handler receives `None` for all fields. The correct call is `invoke("create_run", { workflowId: ..., workspaceRoot: ... })`.

This was not obvious because:
- The Rust struct fields keep their snake_case names
- Tauri does not emit a warning or error when a camelCase key has no matching field — it just uses the default value (`None`/`""`)
- The IPC contract doc used snake_case TypeScript interfaces (now corrected)

**Decision:** All TypeScript call sites must send camelCase argument keys. The `apps/desktop/src/types/ipc.ts` interfaces are the canonical source — they are defined with camelCase keys. The `TAURI_IPC_CONTRACT.md` TypeScript arg interfaces have been corrected to reflect this.

**Rule:** When adding a new `#[tauri::command]`, verify that the TypeScript call site uses camelCase for every arg key. Never test with the Rust struct field names directly from JS.

---

### 2026-03-19 — LiveRunView polling fallback for Tauri push events

**Context:** Tauri push events (`listen()`) are emitted as fire-and-forget by the Rust backend. In normal app usage they arrive within milliseconds. In WebKitWebDriver automation (the E2E test environment on Linux), the `listen()` callback in the frontend may never fire even when the backend has emitted the event — this is a WebKitWebDriver limitation, not a Tauri bug.

This caused `HumanReviewPanel` to never appear in E2E tests even though the run correctly paused: the `human_review_requested` Tauri event was emitted by the backend, stored in the DB, but the `listen()` callback in `LiveRunView` was not called.

**Decision:** `LiveRunView` adds a 2-second polling interval (`useEffect` with `setInterval`) that:
1. Calls `ipc.getRun({ runId })` to sync run status
2. When status is `"paused"` and no `reviewRequest` is set, calls `ipc.listEventsForRun` to find a `review.required` event and reconstruct the review panel payload
3. Uses `setReviewRequest(prev => prev ? prev : newValue)` to avoid overwriting state already set by the push-event path

This is production code, not a test workaround. The polling fallback also handles: tabs that were backgrounded during a run, slow event-bridge delivery on lower-end hardware, and any future environment where push events are unreliable.

**Tradeoffs:** Adds 2 IPC round-trips every 2 seconds while a run is active. Negligible in practice (SQLite reads are fast and local). The polling stops when the run is terminal.

**Alternatives considered:**
- Increasing the subscribe-then-start pause in E2E tests — tried up to 4s; push events still not delivered in WebKitWebDriver
- Buffering events in the backend and replaying on subscribe — would require persistent event queues per subscriber; over-engineered for v1
- Accepting the gap for E2E only and relying on push events in prod — rejected; the same failure mode can occur when a tab is hidden during a long run

---

### 2026-03-19 — Demo workflow Agent nodes require an explicit `command` field

**Context:** `AgentCliAdapter` requires either a `command` or `provider_hint` in the agent node config. Without a `command` field, the adapter throws `PreparationFailed` and the run fails before reaching the HumanReview node. The demo workflow embedded in `apps/desktop/src/data/demo-workflow.ts` originally had no `command` field on the Plan and Critique nodes.

**Decision:** All demo workflow Agent nodes have `"command": "true"` in their config. The `true` shell command exits immediately with code 0, making agent nodes behave like stubs during demo/test runs while satisfying the adapter's preparation check. The workflow JSON file at `examples/plan-execute-critique-approve/workflow.json` was also updated for consistency, though the app reads from `demo-workflow.ts`, not the file.

**Important:** When `demo-workflow.ts` is changed, the SQLite DB must be deleted so `useFirstRun` re-seeds the workflow on next launch: `rm -f ~/.local/share/com.agent-arcade.dev/agent-arcade.db`.

---

### 2026-03-23 — Provider/model selection strategy for agent nodes (DEC-006)

**Context:** `AgentNodeConfig` has a free-form `provider_hint: Option<String>` used as a CLI command fallback and event metadata label. Users need a structured way to choose an LLM provider (Claude Code, OpenAI Codex, Gemini CLI, etc.) and model (claude-sonnet-4-6, o4-mini, etc.) from the node inspector UI. Three approaches were considered:

1. Add a `ProviderKind` Rust enum to the serialized schema.
2. Combine provider and model into a single encoded string (e.g. `"claude:claude-sonnet-4-6"`).
3. Add a separate `model: Option<String>` field; keep provider registry as static constants outside the schema.

**Decision:** Option 3.

- Add `model: Option<String>` to `AgentNodeConfig` with `#[serde(skip_serializing_if = "Option::is_none")]`. No `schema_version` bump needed — additive optional field, backward-compatible by existing DEC-001 policy.
- Provider registry (known providers, curated model lists, CLI base commands and model flags) lives as a private constant in `crates/runtime-adapters/src/agent.rs` and mirrored as a TypeScript constant in `apps/desktop/src/types/providers.ts`. It is not part of the serialized schema.
- No Tauri IPC command for listing providers — static data requires no round-trip.
- `provider_hint` retains its current role as the provider key (e.g. `"claude"`, `"openai"`). The runtime adapter resolves the final CLI command from `provider_hint` + `model`.

**Alternatives considered:**
- `ProviderKind` enum in schema — rejected: provider lists change without engine involvement; registries should not be serialized schema.
- Combined string encoding — rejected: requires parsing at every use site, complicates UI state.
- Tauri IPC for provider list — rejected: unnecessary IPC overhead for purely static data.

**Tradeoffs:** Both the Rust adapter constant and the TypeScript constants file must be updated together when a new provider is added. Accepted: the coupling is explicit and co-located.

**Blocks:** MODEL-008 (done), ADAPT-005 (done — `PROVIDER_REGISTRY` implemented in `crates/runtime-adapters/src/agent.rs`; see ARCHITECTURE.md §8), UI-BLD-008 (done — `KNOWN_PROVIDERS` implemented in `apps/desktop/src/types/providers.ts`, wired into the Agent config form in `NodeInspector.tsx`).

**UI-BLD-008 implementation note:** The TypeScript mirror (`providers.ts`) additionally carries curated `models: ModelSpec[]` per provider for the dropdown UI — the Rust `PROVIDER_REGISTRY` only needs `(base_command, model_flag)` to resolve the CLI invocation and does not need a curated model list. The `Custom Command` provider (`id: "custom"`) has an empty `models` array; selecting it hides the model dropdown entirely and reveals a raw `command` text input instead, per the NodeInspector agent form behavior documented in DESIGN_SPEC.md §4.1.

---

### 2026-03-23 — Defer bounded loop edges to v1.1 (DEC-002)

**Context:** `ConditionKind` currently has four variants: `Always`, `OnSuccess`, `OnFailure`, `Expression`. Bounded loop edges would require a new variant (e.g. `Loop { max_iterations: u32, condition: String }`) plus significant changes to the validator, scheduler, runtime state, and replay system. Per AGENTS.md Rule E, bounded loop support is explicitly optional in v1 — allowed "only if explicitly modeled."

**Decision:** Defer bounded loop edges to v1.1. The `ConditionKind` enum is stable at four variants for v1.

**Rationale:**

1. **Scheduler complexity.** The current executor assumes DAG traversal (topological ordering). Loop back-edges break this assumption. The validator would need to distinguish intentional loop edges from error cycles — currently any cycle is a hard validation error (per the unreachable-node/cycle-detection decision in QA-002). Retrofitting this distinction is non-trivial.

2. **Runtime state overhead.** Loops require per-edge iteration counters tracked in the `RunInstance` or a new `LoopState` structure. These counters must be persisted, emitted as events, and correctly restored during replay. This is new state machinery with no existing foundation.

3. **Replay complexity.** A node that executes multiple times in a loop needs distinct `NodeSnapshot` entries per iteration. The replay timeline must display iterations as a group, not as separate unrelated executions. This affects the replay UI, event model, and persistence layer.

4. **Bounded retries already cover the most common case.** `RetryPolicy` (already implemented per node) handles "try again on failure" — the single most requested loop-like pattern in agent workflows. True graph loops (re-run a subgraph based on an output condition) are a distinct, more complex feature.

5. **v1 scope is already large.** Builder, live run, replay, persistence, human review, CLI adapters, and the demo workflow are all in scope. Adding loops would delay the core v1 deliverables for a feature that Rule E marks as optional.

**v1.1 implementation sketch (non-binding):**
- Add `ConditionKind::Loop { max_iterations: u32, condition: Option<String> }` — condition is an expression evaluated against the source node's output; if omitted, loops unconditionally up to `max_iterations`.
- Validator: allow back-edges only when they carry a `Loop` condition kind. Other back-edges remain hard errors.
- Scheduler: track `loop_iteration: HashMap<EdgeId, u32>` in `RunInstance`. Increment on each traversal; terminate when `max_iterations` is reached or condition evaluates to false.
- Events: emit `loop.iteration` and `loop.terminated` events.
- Replay: group loop iterations in the timeline view.
- Guardrails: emit `guardrail.warning` when a loop reaches 80% of `max_iterations`.

**Alternatives considered:**
- Include in v1 — rejected: adds 3–4 tasks of scheduler/validator/replay work for an optional feature. Delays core v1 delivery.
- Support loops as a node type instead of an edge kind — rejected: loops are a routing concern (edge semantics), not a computation concern (node semantics). A "loop node" would duplicate the router's responsibility.
- Simulate loops by chaining duplicate node sequences — viable workaround for v1 users who need loop-like behavior with a known small iteration count. Not elegant, but sufficient until v1.1.

**Tradeoffs:** v1 workflows cannot express "re-run this subgraph until a condition is met." Users must use bounded retries (per-node) or manually duplicate node sequences. This is an acceptable limitation given v1's scope.

**Unblocks:** Confirms `ConditionKind` is stable for v1 — no further schema changes needed for edge conditions.

---

### 2026-03-23 — Custom output panel over terminal emulator (DEC-004)

**Context:** The Live Run View needs a command output panel (DESIGN_SPEC §9). Two approaches: (1) embed xterm.js for full VT100/ANSI terminal support, or (2) build a custom styled `<div>`/`<pre>` panel with ANSI color rendering via a lightweight library.

**Decision:** Option 2 — custom styled output panel with ANSI color rendering via `anser`.

**Rationale:**

1. **Design spec alignment.** DESIGN_SPEC §9 states: "Terminal output should be a panel within the app, not the whole experience." xterm.js renders a standalone terminal canvas that fights the mission-control theme and competes visually with the graph, event feed, and inspector.

2. **Event association.** The event-first architecture (Rule B) requires output chunks to be linked to their originating node and event. A custom panel renders output per-event as React components with click-through to the event inspector. xterm.js has no concept of event-associated output regions.

3. **Captured strings, not live streams.** Per DEC-005, agent/tool output is captured as complete strings by the CLI adapter. The output arrives at the UI as `stdout`/`stderr` fields on `CommandExecutionCompleted` events — not as a live PTY stream. xterm.js's core value (interactive terminal emulation) is wasted on post-hoc string rendering.

4. **Styling consistency.** xterm.js uses a `<canvas>` renderer with its own font metrics and color palette. Matching the mission-control CSS variables (`--color-bg`, `--color-surface`, `--glow-accent`) requires fighting the library. A custom panel inherits the design system natively.

5. **Required panel features.** stdout/stderr separation, timestamps, collapse/expand, copy/select, and node-event backlinks are all trivial in React components. Retrofitting these onto xterm.js requires custom addons or wrapping the terminal in React scaffolding that duplicates most of what a custom panel already is.

**ANSI color rendering approach:**
- Add `anser` (npm package, ~10KB, MIT license) to render ANSI SGR escape codes (colors, bold, underline, dim, inverse) as HTML `<span>` elements with inline styles or CSS classes.
- Strip non-SGR escape sequences (cursor movement, screen clear, etc.) — these are irrelevant for captured output and would render as garbage in a `<div>`.
- Render output in `<pre>` blocks to preserve whitespace and alignment.
- This covers real-world CLI output: cargo (colored errors/warnings), jest/vitest (colored test results), eslint, grep, git diff, and most agent CLIs.

**What will NOT work without xterm.js:**
- Interactive terminal applications (vim, htop, less) — not relevant; no node type opens an interactive session.
- Progress bars that use cursor repositioning (e.g., `\r`-based spinners) — these will render as multiple lines instead of in-place updates. Acceptable: output is captured post-completion, not streamed live.
- Sixel or image-in-terminal protocols — not relevant for v1 use cases.

**Alternatives considered:**
- xterm.js — rejected: heavy (~300KB), canvas-based renderer fights the design system, no event association, overkill for captured string output.
- Raw text only (no ANSI rendering) — rejected: stripping all color from cargo/jest output degrades developer experience significantly. Color is information (red = error, green = pass).
- `ansi-to-html` package — viable alternative to `anser`; slightly larger API surface. `anser` was preferred for its smaller size and simpler interface.

**Tradeoffs:**
- No xterm.js means no future path to interactive embedded terminals without adding it later. Accepted: interactive terminals are out of v1 scope and likely out of v1.1 scope.
- `anser` dependency must be maintained. Risk is low — small, stable, MIT-licensed package with no transitive dependencies.

**Unblocks:** UI-RUN-004 (command output panel implementation).

---

### 2026-03-24 — Cross-platform changed file detection (DEC-003)

**Context:** When a Tool or Agent node runs a command, the engine could optionally detect which files were changed and log them as metadata on the `CommandExecutionCompleted` event. Three options were considered:
1. `git diff --name-only` / `git status --porcelain` before and after execution — accurate and cross-platform, but requires a git-backed workspace and adds latency to every command.
2. File system watcher (`inotify` on Linux, `FSEvents` on macOS, `ReadDirectoryChangesW` on Windows) via the `notify` crate — works for any workspace but adds a native cross-platform dependency, significant engineering complexity, and is prone to false positives (IDE temp files, build artifacts, lock files).
3. No detection in v1 — log command metadata only (command, cwd, exit code, stdout, stderr, duration_ms). Treat changed file detection as a deferred enhancement.

**Decision:** Option 3 — no changed file detection in v1. Changed file metadata is deferred to v1.1.

**Rationale:**
- The `CliAdapter` already captures the full observability artifact: command string, working directory, exit code, stdout, stderr, and duration. This is sufficient for the replay and debugging goals of v1.
- For developer workflows, the primary commands (cargo fmt, rustfmt, eslint --fix, git diff, test runners) already embed file change information in their stdout. The raw output is the most accurate change report for these tools.
- Option 2 (FS watcher) is ruled out: cross-platform watchers produce false positives (IDE temp files, build cache), add the `notify` crate dependency, require careful lifecycle management (start before command, stop after, drain the event queue), and are complex to get right across WSL2, macOS, and Windows. The added complexity is not proportionate to v1's scope.
- Option 1 (git diff) is the right approach for v1.1 but is deferred because: (a) it silently provides nothing for non-git workspaces with no error or fallback; (b) it requires two `git status` invocations per command (one before, one after), adding process-spawn latency; (c) new/untracked files are not tracked until `git add`, creating a gap between "changed on disk" and "changed per git".

**v1.1 implementation plan (non-binding):**
- Add `changed_files: Option<Vec<String>>` to `CommandExecutionCompleted` payload (additive, backward-compatible).
- In `CliAdapter::execute`: run `git -C <workspace_root> status --porcelain` before and after the command. Diff the two outputs to compute added/modified/deleted files. If `git` is not present or workspace is not a git repo, set `changed_files: None` (no error, no warning).
- Platform note: `git` is cross-platform and available on all three targets (macOS, Windows, Linux). No additional native dependency is needed.

**Alternatives considered:**
- Include git diff in v1 — rejected: non-git workspaces silently get nothing, and adding latency per command is not warranted when the core observability story (stdout/stderr) already covers the primary use cases.
- FS watcher (Option 2) — rejected: high complexity, false positives, and cross-platform dependency not proportionate to v1's scope.

**Tradeoffs:** Replay traces in v1 will not include a `changed_files` list. Users who need to know which files a command changed must read the command's stdout. This is acceptable for v1.

**Note:** This decision closes the open item listed under "Open decisions" in this file.

---

### 2026-03-27 — Character sprite node identity system (DEC-007)

**Context:** PigeonCoop's visual premise — "a game-styled developer tool" — requires more than a dark color scheme and grid overlay. The node representations (currently: icon + type abbreviation + label) are functional but generic. To deliver the game-inspired aesthetic described in the PRD and DESIGN_SPEC, nodes need a visual identity that feels like game units, not diagram boxes.

**Decision:** Adopt an animated pixel-art character sprite system for node visual identity, starting with Agent nodes.

Key choices within this decision:
- **CSS sprite-sheet animation** (not animated GIFs, not JavaScript timers): horizontal PNG/WebP sprite sheets animated via `steps()` keyframes on `background-position-x`. Controllable speed, state-driven, no GIF color limitations, performant.
- **Per-state animation mapping:** each of the 8 node states maps to a distinct sprite animation or speed variant, so state changes are visible without reading the text badge.
- **Health bar for context/token usage:** an overlay bar on agent nodes visualizes LLM context window fill percentage using RPG health-bar conventions (green → amber → red).
- **Game backdrop:** a tiled pixel-art terrain background behind the React Flow canvas adds environmental depth without competing with node readability.
- **Incremental rollout:** Agent nodes receive sprites first. Other node types retain text-based identity until dedicated assets exist. The component architecture (`AgentNode` registered separately from `WorkflowNode`) supports this without changing all 7 node types at once.
- **Asset convention:** source assets in `assets/character-sprites/<dated-folder>/`; deployed assets in `apps/desktop/public/sprites/` (Vite static serving).

**Rationale:** The game visual identity is a primary differentiator for the product, not a cosmetic add-on. The sprite approach is technically straightforward (CSS-only animation), respects `prefers-reduced-motion`, scales correctly with React Flow zoom via `image-rendering: pixelated`, and can be adopted incrementally as new assets are created.

**Full specification:** [`docs/VISUAL_IDENTITY.md`](VISUAL_IDENTITY.md) is the authoritative reference for all implementation details.

**Alternatives considered:**
- Animated GIFs — rejected: 256-color limit, no speed control, larger file size than WebP.
- JavaScript-driven canvas animation — rejected: adds complexity, breaks React rendering model, harder to sync with node state.
- Richer SVG icons per node type — rejected: doesn't achieve the game-unit feel; SVG animation is harder to synchronize with state.
- Keep text-based nodes permanently — rejected: misses the core product differentiator.

**Tradeoffs:**
- Requires dedicated pixel-art assets per node type. Until assets exist, node types fall back to text-based rendering. This is acceptable and expected.
- Health bar requires token usage data from the provider adapter. It is hidden when data is unavailable, so it degrades gracefully.
- Backdrop adds a visual layer that must be tested at all React Flow zoom levels.

**Blocks:** SPRITE-001, SPRITE-002, SPRITE-003, SPRITE-004, SPRITE-005.

---

### 2026-07-08 — Procedural canvas rendering for backdrop and character sprites (DEC-008)

**Context:** DEC-007 established the character-sprite node identity system on a WebP sprite-sheet pipeline (86×86 frames, CSS `steps()` animation, assets in `public/sprites/`) and explicitly rejected JavaScript-driven canvas animation. It also assumed a tiled WebP terrain image for the game backdrop, gating SPRITE-003 on asset availability and SPRITE-005 on per-character asset commissions. A high-fidelity design handoff (`assets/design_handoff_city_backdrop_pigeon_sprites/`) has since delivered both visual pieces as **procedural canvas code**: a seeded, seamless 1024×1024 pixel-art night-city tile (`cityDrawing.ts` + `CityBackdrop.tsx`) and a 26×24 hand-authored pixel-grid pigeon (`pigeonDrawing.ts`) whose poses and state tints are drawn at runtime — no image assets at all. The drawing modules are written as real TypeScript/React source targeting this repo's paths, with final palettes and pixel layouts.

**Decision:** Adopt procedural canvas rendering as the **primary** rendering approach for both the game backdrop and node character sprites. This amends DEC-007 in three ways:

1. **Backdrop is fully procedural.** The city tile is drawn by `drawCityTile` (seeded, deterministic) and mounted via `<CityBackdropViewportSynced>` inside React Flow. The `public/backdrops/` WebP-tile plan is retired. The backdrop remains static and non-interactive per VISUAL_IDENTITY.md §6 constraints.
2. **The agent sprite is procedural.** A new `PigeonSprite` canvas component calls `drawPigeon`/`poseForState` per animation tick. Run state is carried by the pigeon's neck-patch tint (`NECK_BY_STATE`, same semantic hues as the existing glow system) with no frame/box around the character; the container-level `.wf-node` glow states are retained on top. Future node-type characters (SPRITE-005) are authored the same way — ASCII pixel grids in code — removing the external asset-creation dependency entirely.
3. **The "no JavaScript animation timers" rule is amended.** DEC-007's CSS-only constraint served the WebP pipeline; procedural drawing requires a JS tick. The amended rule: canvas sprites animate from a **single shared low-frequency tick** (~100ms) for all sprites — never one timer per node — and the tick freezes under `prefers-reduced-motion: reduce`. One-shot poses (`succeeded`/`failed`) hold their final frame.

The WebP sprite sheets from SPRITE-001 (`public/sprites/`) are retained as **legacy/fallback assets** — not deleted, not extended. If static sheets are ever wanted again (e.g. palette previews or export), render the procedural poses to offscreen canvases and stitch — do not hand-author new WebP frames.

**Alternatives considered:**
- Keep WebP as primary, use procedural only for the backdrop — rejected: splits the character pipeline in two, keeps the per-character asset-commission bottleneck that had SPRITE-005 parked at low priority, and the procedural pigeon is already palette-matched to the backdrop while the WebP pigeon is not.
- Pre-render procedural poses to WebP strips and keep the CSS `steps()` system — viable and preserves the DEC-007 rule, but adds an export/build step for zero user-visible benefit; kept as a documented fallback path if the shared tick shows measurable cost.
- Reject the handoff and commission tile/sheet images matching the old specs — rejected: the handoff is final-fidelity and eliminates the asset bottleneck; re-deriving it as images is pure waste.

**Tradeoffs:**
- A JS animation tick enters the frontend. Bounded: one interval for all sprites, ~10Hz, pausable; canvas redraws of a 26×24 grid are trivial.
- Pixel art now lives in code. Editing a pose means editing an ASCII grid, not an image editor — acceptable for a developer-first project, and grids are reviewable in diffs.
- Two pigeon renditions exist during transition (legacy WebP, procedural). The procedural one is canonical; VISUAL_IDENTITY.md marks the WebP tables as legacy.

**Follow-up implications:** SPRITE-002, SPRITE-003, SPRITE-004, SPRITE-005 have been rewritten on the workboard against this decision. VISUAL_IDENTITY.md §2/§3/§4/§6/§8/§10 updated in the same change. Optional v1.1 item: WebP export of procedural poses (see handoff README "Assets").

---

### 2026-07-09 — Headed interactive agent execution for claude (DEC-009)

**Context:** The `AgentCliAdapter` pipes the prompt to the agent CLI's stdin. For `claude`, piped (non-TTY) stdin silently falls back to headless print mode. Claude pricing/terms differ between headless and interactive use, so the product requirement is that claude agent nodes run as **genuinely interactive (headed) sessions** while the engine still captures structured output and drives run state deterministically.

**Decision:** Agent nodes with `provider_hint: "claude"` and no explicit `command` execute as an interactive session inside a PTY (`portable-pty`), rendered live in the Live Run View via an xterm.js terminal the user can watch and type into. Mechanics:

1. **Spawn:** `claude --session-id <uuid> [--model <alias>] --permission-mode <mode> --settings <hook-json> <prompt>` is spawned in a PTY (argv array, no shell) with cwd = workspace root. The prompt is the initial argument, not stdin.
2. **Turn completion:** a `Stop` hook is injected via `--settings` whose command writes the hook's stdin JSON to a per-session sentinel file. The hook payload carries `last_assistant_message` and `transcript_path`, so the engine never guesses transcript locations.
3. **Output extraction:** the final assistant message text comes from the Stop-hook payload's `last_assistant_message` (primary), with the transcript JSONL at `transcript_path` (`type: "assistant"` entries → `message.content[].text`) as fallback — read at turn end while the session is live, because the CLI rotates transcript files on exit (verified empirically). TUI stdout is never scraped. `AgentOutputMode` (DEC-005) applies to that text for interactive sessions: `Raw` wraps it as `{"raw": ...}`, `JsonStdout`/`JsonLastLine` parse it.
4. **Completion semantics:** new additive optional field `completion_mode` on `AgentNodeConfig` (default `auto`). `auto`: when the Stop hook fires, the engine sends `/exit` to the session and completes the node. `manual`: the node transitions Running → `Waiting` (existing state-machine transition), the session stays open for the user to keep steering claude in the terminal, and the node completes only when the user triggers *Complete node* in the Live Run View (Tauri command), which finalizes from the latest transcript state.
5. **Permissions:** new additive optional field `permission_mode` on `AgentNodeConfig`, mapped to `--permission-mode` (default `acceptEdits` so unattended runs don't stall on file edits). Remaining TUI prompts (including the workspace-trust dialog and first-time MCP-server approval on first use of a directory) are answerable in the embedded terminal; `retry_policy.max_runtime_ms` remains the backstop.
6. **Terminal streaming:** raw PTY bytes stream to the frontend over a dedicated Tauri window event (`agent_terminal_output`) and keystrokes return via a command (`agent_terminal_input`) — they do **not** enter the append-only run event log. The event log receives the same typed `AgentEventKind` sequence as before, with output chunks derived from the transcript.

Neither new config field bumps `schema_version` — both are additive optional fields per the DEC-001 policy. Non-claude providers (`openai`/codex, custom commands, and any node with an explicit `command`) keep the existing pipe-based path unchanged.

**Relationship to prior decisions:**
- **Partially supersedes DEC-004:** xterm.js is now added — but only as the interactive session terminal for running Agent nodes. The `anser`-based custom output panel remains the renderer for Tool node output and post-hoc event review; DEC-004's rationale (event association, design-system fit for captured strings) still stands for that surface.
- **Amends DEC-005:** for interactive sessions, `output_mode` operates on the transcript's final assistant message instead of raw stdout. Pipe-path semantics are unchanged.

**Alternatives considered:**
- Hidden PTY (no UI) — rejected: only technically "headed", user cannot see or steer the session, and permission prompts would stall invisibly.
- External terminal window — rejected: flaky on WSL2 (launching Windows terminals from the Linux side), session lives outside the app, no event association.
- Keep headless `-p` with `--output-format json` — rejected by product constraint (pricing/terms of headless use).
- Transcript-path derivation from the workspace slug — rejected in favor of reading `transcript_path` from the Stop-hook payload; the slug algorithm is an undocumented CLI internal.

**Tradeoffs:**
- xterm.js (~300KB) enters the bundle after DEC-004 declined it; scoped to the Live Run agent terminal only.
- The engine depends on claude CLI behaviors (`--session-id`, `--settings` hooks, transcript JSONL shape) that are versioned with the CLI. If the sentinel never appears (old CLI, hook misconfiguration), the node fails with a clear reason after timeout rather than silently degrading to headless.
- `portable-pty` native dependency added to the workspace.
- Interactive sessions cannot run fully detached from a display; the desktop app is a hard requirement for agent nodes on the claude path (acceptable: this is a desktop-first product).

**Unblocks:** evergreen registry (DEC-010) UI changes ride along in the same node-inspector surface.

---

### 2026-07-09 — Evergreen provider/model registry (DEC-010)

**Context:** The curated model lists in `apps/desktop/src/types/providers.ts` (per DEC-006) go stale as providers ship new models — the Claude list offered `claude-opus-4-6`-generation IDs while newer models existed, and the Codex list didn't match the user's configured default. Gemini support is unused and dropped.

**Decision:**
1. **Claude models are CLI aliases**, not dated IDs: `opus`, `sonnet`, `haiku`, `fable`. The claude CLI resolves each alias to the latest model of that tier, so the dropdown never goes stale. Users who need to pin an exact dated model ID use the existing "Other…" free-text entry.
2. **Codex shows the configured default**: a small Tauri command (`get_codex_default_model`) reads `model = "..."` from `~/.codex/config.toml` so the model dropdown's no-model option displays what bare `codex` will actually use; free-text entry covers explicit overrides. This is a narrow exception to DEC-006's "no provider IPC" rule — it reads *local machine state*, not static registry data.
3. **Gemini is removed** from both `PROVIDER_REGISTRY` (Rust) and `KNOWN_PROVIDERS` (TS). Saved workflows with `provider_hint: "gemini"` degrade gracefully to the existing unknown-provider fallback (hint used as raw command), so no migration is required.

**Alternatives considered:**
- Refresh button hitting provider model-list APIs — rejected: requires raw API keys (`ANTHROPIC_API_KEY`/`OPENAI_API_KEY`) that subscription-auth CLI users typically don't have; adds network + caching machinery for marginal benefit over aliases.
- Keep curated dated IDs and update them each model launch — rejected: this is the maintenance treadmill being escaped.

**Tradeoffs:** alias resolution delegates model choice to the installed CLI version (older CLI = older "latest"); acceptable, since the CLI is also what executes the session. Pinning exact models remains possible via free text.

---

### DEC-011 — Unified single-screen workspace (replaces the four routed views)

**Status:** accepted, implemented (frontend); doc/spec follow-ups listed below.

**Context:** The UI was four keyboard-routed views (Builder / Live Run / Replay / Library) whose connections were implicit and partly broken: Library's "Open" button never actually loaded the workflow into the Builder (`App.openBuilder` ignored the id); Live Run only showed events received *after* mount, so opening an in-flight run gave an empty feed; Replay rendered node states as a text list, not a graph; starting a run required finding a per-card "Start Run" form and retyping the workspace path every time; token-usage derivation was duplicated verbatim in two views. User feedback: "so many panes that feel like they aren't connected but are."

**Decision:** One screen with three regions, no view routing:
- **Workflow sidebar** (`components/sidebar/WorkflowSidebar.tsx`) — always-visible library: workflows (new/import/export) with the selected one expanded to show run history. Selecting a workflow loads it onto the canvas; selecting a run opens the run surface.
- **Top bar** (`app/App.tsx`) — editable workflow name, Save (Ctrl+S), Validate, a **persisted** workspace-root input (`localStorage: agent-arcade.workspaceRoot`), and one **Run** button that saves the canvas, creates the run, starts it, and opens the run surface.
- **Stage** — either `views/DesignSurface.tsx` (edit mode: palette + canvas + inspector + floating validation overlay; exposes `buildWorkflow()` handle) or `views/RunPanel.tsx`.

**Live and replay are unified** in `RunPanel`: everything derives from the event log (`deriveNodeStates`, new shared `state/deriveTokenPcts.ts`) at an index. Following the live tail = index at end (LIVE badge, auto-scroll); scrubbing = an earlier index on the same timeline. The panel backfills `list_events_for_run` on open and dedupes against streamed `run_event_appended` by `event_id`, fixing the mid-flight-open bug. The graph is the real workflow canvas with state overlays (replacing Replay's text list). No backend changes; one IPC helper added (`ipc.validateWorkflow`, command already existed).

**Alternatives considered:**
- Keep four views but fix the broken links (load-on-open, backfill) — rejected: preserves the disconnected-panes mental model and the Live/Replay duplication.
- Tabbed single window (views as tabs) — rejected: still hides the workflow↔run relationship the sidebar now makes structural.
- Backend-driven "open run" navigation events — rejected: UI concern, engine stays authoritative on execution only.

**Tradeoffs:** removed the 1–4 view keyboard shortcuts and the four-view vocabulary that older docs/E2E specs used (specs ported, see below); the NODES status list panel was folded into the graph + event feed; `App.tsx` now owns more state (library, selection, run controls).

**Implemented in this change:** deleted `views/{BuilderView,LibraryView,LiveRunView,ReplayView}.tsx`; added `WorkflowSidebar`, `DesignSurface`, `RunPanel`, `state/deriveTokenPcts.ts`; rewrote `app/App.tsx`; top-bar/sidebar/run-panel/scrubber CSS in `styles/global.css` (incl. previously missing `.toolbar-btn` and `.timeline-scrubber` styles); replaced the four view test suites with `App/WorkflowSidebar/DesignSurface/RunPanel` suites (174 frontend tests green, `tsc` clean); ported all six E2E specs in `tests/e2e/specs/` to the new selectors/flows (`node --check` clean; **not executed** — see repo Discoveries about sandbox E2E).

**Follow-up implications (remaining work):** *(all resolved 2026-07-10 — see DEC-012)*
1. ~~Visual verification~~ — done via the full headed E2E suite (all 6 specs green in the sandbox; see DEC-012 for the bugs it surfaced).
2. ~~DESIGN_SPEC.md §4/§13 rewrite~~ — done; §4 now describes the unified workspace, §13 shortcut map updated (1–4 nav removed, Ctrl+S added), duplicate §13 heading renumbered to §14.
3. ~~E2E specs unverified~~ — executed and green after fixing spec drift (non-UUID edge ids in `builder.spec.js`, wrong `HumanReviewDecision` shape in `replay.spec.js`, missing `created_at` in `failure.spec.js`, compound vs descendant `.wf-node--failed` selector).
4. ~~Delete-workflow affordance~~ — added to the sidebar (confirmation → `delete_workflow` → open next workflow or empty canvas).
5. ~~Dead CSS~~ — pruned (`.lib-card*`, `.lr-hud*`, `.lr-node-*`, `.lr-detail-*`, `.replay-*` panels, `.library-*`, `.view*`, `.lib-welcome*`).
6. ~~Global `run_status_changed` subscription~~ — added in App; chips update for non-open runs, terminal transitions refetch the run for `ended_at`.
7. ~~TESTING.md / workboard reconciliation~~ — TESTING.md rewritten for the new suites and ported spec flows; workboard references are all in `done` tasks (historical record, intentionally untouched).

---

### DEC-012 — Fixes and semantics locked in by the first full E2E pass (2026-07-10)

**Status:** accepted, implemented.

**Context:** Executing the DEC-011-ported E2E suite for the first time (headed, in the WSL2 sandbox) surfaced that several "ported but unverified" flows had never actually worked against the real backend, plus one production bug that only manifests outside mocked unit tests.

**Decisions / fixes:**
1. **Canvas save must satisfy the Rust serde contract.** `WorkflowDefinition.default_constraints` is `#[serde(default)]` on a **non-Option** struct: absent is fine, explicit `null` is rejected. `flowToWorkflow` now omits the field (TS type made optional), and never-configured palette nodes serialize the same per-kind config skeleton the inspector uses (`defaultConfig`, now exported) because `NodeConfig::from_value` rejects `null`. This bug predated DEC-011 (old BuilderView had it too) — UI save had *never* succeeded against the real backend.
2. **Sidebar selection always loads the persisted definition.** `App.handleSelectWorkflow` fetches via `get_workflow` instead of trusting the cached `list_workflows` entry (stale after IPC updates), and re-clicking the open workflow reloads it (canvasKey gets a per-open nonce so the canvas remounts). Tradeoff: re-clicking discards unsaved canvas edits — accepted because selecting a *different* workflow already did, and "click card = load persisted state" is one consistent rule.
3. **Run-surface polling refetches the event log and stops at terminal.** The 2s fallback poll (needed where Tauri push events are dropped, e.g. WebKitWebDriver) previously refetched events only while `paused`, so a live run's graph/feed froze without push delivery. It now appends the log (deduped by `event_id`) every poll and stops polling after one final fetch once the run is terminal. This makes the code match what TESTING.md already claimed.
4. **State updaters must be StrictMode-pure.** `RunPanel.appendEvents` marked event ids seen *inside* the `setEvents` updater; StrictMode's double-invocation made the second call see everything as duplicate and return the old state — **every run opened mid-flight or finished showed an empty feed/timeline in dev builds**. Dedupe now happens before `setState`. Rule for future code: never mutate refs inside a state updater.
5. **Sidebar card actions live in normal flow.** The selected card's Export/Delete buttons were absolutely positioned over the name row; with two buttons the card's center point landed on Export (which `stopPropagation`s), silently eating selection clicks — for WebDriver *and* real users. Actions are now a flow row under the card meta.

**Alternatives considered:** teaching specs to click card edges instead of fixing the overlay (rejected: real-user misclick surface); making `default_constraints` `Option` in Rust (rejected: `RunConstraints::default()` semantics are correct, the frontend just violated the contract); keeping the paused-only poll and requiring push events (rejected: contradicts TESTING.md and fails in automation environments).

**Follow-up implications:** none open. E2E runbook for this sandbox recorded in TESTING.md §3 and AGENTS.md Discoveries.

---

### DEC-013 — RPG command workspace visual overhaul (2026-07-10)

**Status:** accepted; implementation in progress.

**Context:** The procedural pigeon, wrench-bot, and pixel-city direction made the
workflow canvas visually distinctive but did not reach the polish of a modern
creative tool. Design and run also replaced the central stage wholesale, which
preserved a single-window shell but still interrupted spatial context. The user
requested a complete dark-only overhaul with game identity as a central concern,
permission to leave the pigeon/city identity behind, and generated imagery where
it materially improves the product.

**Decision:** Agent Arcade adopts a dark RPG/MMO command-interface identity with
modern creative-tool structure. The workspace remains one screen and is organized
as a top command bar, workflow library rail, persistent command canvas, contextual
right panel, and collapsible run activity deck. Selecting a run makes the graph
read-only and event-derived without navigating away from the workspace. Generated
art supplies atmosphere and stable role identity; all status, controls, labels,
meters, focus, and accessibility cues remain deterministic code-native UI.

The procedural city and character renderers from DEC-008 are retired from active
use. Existing files may remain temporarily while imports and tests migrate, but
new visual work must follow `VISUAL_IDENTITY.md`.

**Alternatives considered:** polishing the existing pixel-city system was rejected
because it preserves the identity the overhaul is intended to replace; separate
design/run pages were rejected because they recreate the navigation problem that
DEC-011 solved; fully illustrated fantasy UI chrome was rejected because bitmap
controls age poorly, scale poorly, and obscure technical state.

**Tradeoffs:** generated assets add application weight and require explicit fallback
behavior; a persistent context panel and activity deck increase shell coordination;
the visual change invalidates some snapshot assumptions and requires headed visual
verification. Backend state ownership, event replay semantics, IPC contracts, and
workflow schemas are unchanged.

**Follow-up implications:** update the design and visual identity docs, store runtime
art under `apps/desktop/public/assets/command-deck/`, verify fallback icons and image
loading, and capture the workspace at the desktop sizes listed in
`VISUAL_IDENTITY.md`.

## Open decisions

*(No open decisions at this time.)*
