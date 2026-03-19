# Testing

## Overview

Agent Arcade is a Tauri desktop application. Testing is split across three distinct layers because the Tauri native webview cannot be driven by Playwright or standard browser automation tools.

| Layer | What it covers | Tooling |
|---|---|---|
| Rust unit tests | Core engine, state machines, event model, persistence, adapters | `cargo test` |
| Frontend component tests | React/TS components and hooks in isolation | Vitest + React Testing Library |
| E2E tests | Full app running against a real build | `tauri-driver` + WebdriverIO |

---

## Why not Playwright?

Playwright controls browsers via CDP (Chrome DevTools Protocol). Tauri uses the **OS native webview** — WebView2 on Windows, WKWebView on macOS, WebKitGTK on Linux — which is not a browser instance Playwright can attach to.

Tauri exposes WebDriver support via `tauri-driver`, which is compatible with **WebdriverIO** and **selenium-webdriver**. Use those for E2E testing, not Playwright.

---

## 1. Rust unit tests

### Scope
- `crates/workflow-model` — definition construction, validation, edge cases
- `crates/event-model` — event serialization/deserialization, field contracts
- `crates/core-engine` — state machine transitions, scheduler logic, routing rules, guardrail enforcement
- `crates/runtime-adapters` — adapter interface contracts, mock command execution
- `crates/persistence` — repository queries, event log append behavior, run lookup

### Running
```bash
cargo test                        # all crates
cargo test -p core-engine         # specific crate
cargo test -p core-engine scheduler  # specific module
```

### Guidelines
- Test state machine transitions exhaustively — every valid and invalid transition
- Test event emission: every state transition should produce the expected typed event
- Use in-memory SQLite (`:memory:`) for persistence tests — never hit a real file in unit tests
- Mock CLI adapter execution; do not spawn real processes in unit tests
- Keep tests deterministic — no timers, no randomness, no external I/O

### runtime-adapters test suite (ADAPT-004)

The `runtime-adapters` crate has tests at two levels:

**Inline tests** (in each module):
- `cli/mod.rs` — prepare/execute/abort for CliAdapter; stdout, stderr, nonzero exit, timeout
- `mock/mod.rs` — MockAdapter configure/emit/error
- `agent.rs` — AgentCliAdapter prepare, execute, output modes, timeout

**Dedicated test suite** (`src/tests/`):
- `cli_adapter.rs` — **strict event ordering** (Prepared → Started → Stdout* → Completed, Prepared → Started → Failed on timeout), timeout reason string assertions, stderr event emission, nonzero exit behavior
- `mock_adapter.rs` — MockAdapter via `dyn Adapter` trait dispatch, event emission order preservation, empty/multi-event configs, abort idempotency

**Running specific test groups:**
```bash
cargo test -p runtime-adapters tests::cli_adapter    # strict ordering + timeout reason
cargo test -p runtime-adapters tests::mock_adapter   # mock/dyn-trait tests
```

### core-engine test suite (ENGINE-008)

The `core-engine` crate has comprehensive unit tests organized in two layers:

**Inline tests** (in each module):
- `state_machine/mod.rs` — run state machine happy paths, invalid transitions, lifecycle walkthroughs
- `state_machine/node.rs` — node state machine happy paths, retry semantics, lifecycle walkthroughs
- `scheduler/mod.rs` — next_ready_nodes, topological ordering
- `execution/mod.rs` — RouterEvaluator, ExecutionDriver with StubNodeExecutor, guardrail integration
- `review/mod.rs` — review handler dispatch (approve/reject/retry)

**Dedicated test suite** (`src/tests/`):
- `run_transitions.rs` — **exhaustive** run state machine matrix: all 10 valid and all 62 invalid (status, trigger) pairs verified, event payload data assertions, terminal state verification
- `node_transitions.rs` — **exhaustive** node state machine matrix: all 12 valid and all 78 invalid (status, trigger) pairs verified, attempt counter semantics, event payload assertions
- `validation.rs` — validate_to_result wrapper, combined error reporting, edge reference validation, large graph (20-node chain, diamond)
- `scheduler.rs` — predecessor terminal states (Succeeded, Skipped, Failed, Cancelled), diamond graph parallelism, missing snapshots, empty workflows
- `routing.rs` — all ConditionKind variants (Always, OnSuccess, OnFailure, Expression), mixed-edge routing, malformed payloads, type mismatches
- `review.rs` — pause/approve/reject/retry flows, event emission assertions, error cases (nonexistent nodes, invalid states)
- `guardrails.rs` — max_steps (warning threshold, exceeded, unlimited), max_runtime_ms, max_retries exhaustion, warning/exceeded ordering, within-limits workflow

**Running specific test groups:**
```bash
cargo test -p core-engine tests::run_transitions    # exhaustive run state machine
cargo test -p core-engine tests::node_transitions   # exhaustive node state machine
cargo test -p core-engine tests::routing            # routing rules
cargo test -p core-engine tests::review             # human review flows
cargo test -p core-engine tests::guardrails         # guardrail enforcement
```

---

## 2. Frontend component tests

### Scope
- React components (nodes, canvas, panels, overlays)
- Custom hooks (run state, replay timeline, builder graph)
- State derivation from engine events

### Tooling
- **Vitest** — test runner (integrates with Vite/Tauri frontend build)
- **React Testing Library** — component rendering and interaction
- **Mock `@tauri-apps/api`** — mock all `invoke()` calls; never hit the real Rust backend in component tests

### Running
```bash
cd apps/desktop
npm test          # or: npx vitest
```

### Tauri API mock pattern

All Tauri API mocks are registered globally in `apps/desktop/src/__tests__/setup.ts`, which is loaded by Vitest before every test file via `vite.config.ts → test.setupFiles`.

**Core (invoke):**
```ts
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));
```

**Event bridge (listen / emit / once):** required for any component that subscribes to live backend events.
```ts
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),  // returns no-op unlisten fn
  once:   vi.fn(() => Promise.resolve(() => {})),
  emit:   vi.fn(() => Promise.resolve()),
}));
```

Set up per-test return values:
```ts
import { invoke } from '@tauri-apps/api/core';
const mockInvoke = invoke as ReturnType<typeof vi.fn>;
mockInvoke.mockResolvedValueOnce({ status: 'Running', nodes: [] });
```

Components that call `listen()` inside a `useEffect` must call the returned unlisten function on cleanup. Tests can verify this by inspecting the mock's call count and return value.

For typed IPC interactions, use the interfaces from `apps/desktop/src/types/ipc.ts` (defined by QA-001). Do not cast `invoke` return values as `any` or `unknown` inline.

### Guidelines
- Components must not contain execution logic — test rendering and interaction only
- Builder view tests: graph manipulation, node palette, edge creation
- Live run view tests: correct rendering of node states from mocked events
- Replay view tests: timeline scrubbing state, event inspector display
- Do not test Tauri bridge behavior in component tests
- All new components using `listen()` must have at least one test asserting correct unlisten cleanup

---

## 3. End-to-end tests

### Scope
- Full application launched as a real Tauri build
- User flows: create workflow, start run, observe live state, inspect replay

### Tooling
- **`tauri-driver`** — Tauri's WebDriver server (ships with Tauri)
- **WebdriverIO** — test runner that connects to `tauri-driver`
- Tests live in `tests/e2e/`

### Setup
```bash
cargo install tauri-driver         # one-time install; installs tauri-driver v2.x

# Step 1: build the debug binary
cd apps/desktop
npm run tauri build -- --debug     # builds target/debug/agent-arcade
cd ../..

# Step 2: in one terminal, start tauri-driver (WebDriver server on localhost:4444)
# On WSL2 / Linux without GPU/DMA-buf support, use these env vars:
GDK_BACKEND=x11 \
WEBKIT_DISABLE_DMABUF_RENDERER=1 \
WEBKIT_DISABLE_COMPOSITING_MODE=1 \
LIBGL_ALWAYS_SOFTWARE=1 \
tauri-driver

# Step 3: in another terminal, run the E2E tests
cd tests/e2e
npm install                        # first time only
npm test
```

**Note:** `wdio-tauri-service` is not available as an npm package. WebdriverIO connects directly to `tauri-driver` via `hostname: localhost, port: 4444` in `wdio.conf.js`. No wdio service is required — just start `tauri-driver` manually before running tests.

**WSL2 / software rendering:** The four env vars above disable GPU/DMA-buf rendering in WebKitGTK, falling back to software rendering. Without them, `tauri-driver` may fail to open the app window (`DRM_IOCTL_MODE_CREATE_DUMB failed`) on WSL2. The `MESA/ZINK` warnings that appear at startup are harmless.

**Fresh DB on each run:** The app stores its SQLite database at `~/.local/share/com.agent-arcade.dev/agent-arcade.db`. If a previous test run seeded the demo workflow with stale data (e.g. before a `demo-workflow.ts` fix), delete the DB before re-running:
```bash
rm -f ~/.local/share/com.agent-arcade.dev/agent-arcade.db
```

### WebdriverIO configuration (outline)
```js
// tests/e2e/wdio.conf.js
export const config = {
  runner: 'local',
  specs: ['./specs/**/*.spec.js'],
  maxInstances: 1,   // WebKitWebDriver only supports one session at a time
  hostname: 'localhost',
  port: 4444,
  path: '/',
  // IMPORTANT: tauri:options MUST be in alwaysMatch, not the top-level capability object.
  // tauri-driver's map_capabilities only reads capabilities.alwaysMatch to convert
  // tauri:options → webkitgtk:browserOptions. Placing tauri:options at the top level
  // silently drops it and the binary is never launched.
  capabilities: [{
    alwaysMatch: {
      'tauri:options': {
        application: '../../target/debug/agent-arcade',
      },
    },
  }],
  services: [],   // no service needed; tauri-driver runs as a separate process
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: { timeout: 60000 },
};
```

### Priority E2E flows for v1
1. **Builder flow** — open app, create a workflow with all node types, save it
2. **Run flow** — load the demo workflow, start a run, observe node state transitions (**implemented: `tests/e2e/specs/run.spec.js`**)
3. **Human review gate** — run reaches a Human Review node, user approves, run continues (**implemented: `tests/e2e/specs/review.spec.js`**)
4. **Replay flow** — open a completed run, scrub the timeline, inspect events
5. **Failure handling** — run a workflow where a Tool node fails, verify Failed state is shown

### Implemented specs

| Spec | Covers |
|---|---|
| `tests/e2e/specs/app.spec.js` | Smoke test — app launches, window title, root DOM element |
| `tests/e2e/specs/run.spec.js` | Run flow — Library view, create/start run via IPC, node state transitions via `list_events_for_run`, LiveRunView UI assertions |
| `tests/e2e/specs/review.spec.js` | Human review gate — run pauses at HumanReview, panel visible, Approve clicked, run resumes to Succeeded, post-approval event log assertions |

### IPC access pattern in E2E tests

E2E specs drive runs via `window.__TAURI_INTERNALS__.invoke()` inside `browser.executeAsync()` rather than purely through the UI. This keeps setup deterministic and avoids races between UI state and run progression. The `review.spec.js` spec navigates through the Library UI (clicking the workflow card and the "Live Run" button on a run card) to mount `LiveRunView` before starting the run — this is the critical ordering that ensures event subscriptions are registered before the run fires events.

### WebKitWebDriver quirks

These are known behaviours in the WebKitGTK WebDriver used by tauri-driver on Linux:

1. **`element.getText()` can return an empty string** for elements whose text is rendered inside certain CSS layouts (e.g. `overflow: hidden`, flex containers). Use `browser.execute((el) => el.textContent.trim(), element)` as the reliable fallback:
   ```js
   const text = await browser.execute((el) => el.textContent.trim(), nameEl);
   expect(text.length).toBeGreaterThan(0);
   ```

2. **Tauri push events (`listen()`) are not reliably delivered** in WebKitWebDriver automation sessions. The Tauri event bridge emits fire-and-forget events; the `listen()` callback in a WebKitWebDriver-automated webview may never fire even when the backend has emitted the event. **Do not rely on push events in E2E specs.** Poll via IPC instead:
   ```js
   await pollUntil('get_run', { runId }, (r) => r?.status === 'paused', { timeoutMs: 20000 });
   ```
   `LiveRunView` implements a 2-second polling fallback (`ipc.getRun` + `ipc.listEventsForRun`) precisely because push-event delivery cannot be relied upon in this environment. This fallback is production code, not a test-only workaround — it also handles cases where the browser tab is backgrounded or the event bridge is slow.

3. **`expect(element).toExist()` only checks DOM presence**, not visibility. An element can be in the DOM but outside the viewport with `getText()` returning empty. Scroll into view or use `textContent` via `browser.execute` when text content matters.

### Test workspace fixture

Dedicated workspace: `tests/e2e/fixtures/test-workspace/`

Never substitute a real project directory. The demo workflow's Tool node runs
`echo 'tool executed'` so no files in the workspace are read or written.

### Guidelines
- E2E tests are slow; run them in CI on PRs, not on every save
- Use a dedicated test workspace directory — never point E2E tests at a real project
- Assert against state that originates from the Rust engine, not UI-derived assumptions
- Keep E2E specs narrowly scoped to critical user paths; avoid testing every UI detail here
- Use `browser.executeAsync()` + `window.__TAURI_INTERNALS__.invoke()` for IPC in E2E tests

---

## 4. Quality gates for the critical integration path

Two mandatory gates must be satisfied before implementation of the engine and Tauri bridge can begin. Both are tracked as workboard tasks.

### QA-001 — Tauri IPC boundary contract (blocks TAURI-002, TAURI-003, TAURI-004)

Before writing any run-lifecycle Tauri command, define the full IPC surface in `docs/TAURI_IPC_CONTRACT.md`:
- every `invoke()` command name, argument struct, return type, and error type
- every `listen()` event name, payload shape, emitter function, and subscriber component
- Tauri 2.x error serialisation behaviour (`Result::Err` serialises as a plain string)

Mirror every interface in `apps/desktop/src/types/ipc.ts` and expose a typed `invokeTyped<T>()` helper. No component may call `invoke()` directly with an inline cast.

Any deviation between the Rust implementation and the contract is a **bug**, not a design choice. The contract is the source of truth.

### QA-002 — Engine test-first mandate (blocks ENGINE-003, ENGINE-004)

Before implementing `WorkflowValidator` (ENGINE-003) or `RunCoordinator` (ENGINE-004), commit failing unit tests to:
- `crates/core-engine/src/validator_tests.rs` — ≥ 8 cases covering valid/invalid/cycle/unreachable graphs
- `crates/core-engine/src/coordinator_tests.rs` — ≥ 8 cases covering state transitions, retry, pause/resume, cancellation

The tests define `ValidationError` and `StateTransitionError` enum variants that the rest of the system references. Use trait injection (not SQLite) for the event log in coordinator tests.

Acceptance: `cargo check -p core-engine` passes; tests compile but fail until ENGINE-003/004 provide implementations.

---

## 5. Testing the canonical demo workflow

The **Plan -> Execute Tool -> Critique -> Approve** workflow (see `examples/plan-execute-critique-approve/`) is the primary integration target.

Each test layer covers it differently:

| Layer | What to assert |
|---|---|
| Rust unit | Run state machine transitions through all four node types with mock adapters |
| Frontend | Live run view renders all four nodes with correct state badges |
| E2E | Full run completes with approve step triggered by user interaction |

---

## 6. CI guidance

The live CI pipeline is defined in `.github/workflows/ci.yml` and runs automatically on every push and PR to `main`.

| Job | Command | Notes |
|-----|---------|-------|
| Rust tests | `cargo test --workspace --exclude agent-arcade` | All unit tests across pure Rust crates |
| Frontend tests | `npm test -- --run` | Vitest single-run from `apps/desktop/` |

### Why `--exclude agent-arcade`

`apps/desktop/src-tauri` (`agent-arcade`) is a thin binary shell with no unit tests. Its `tauri::generate_context!()` macro reads `tauri.conf.json` at **compile time** and requires native system libraries (`libwebkit2gtk`, `libgtk-3`, etc.) to build. Excluding it keeps CI fast and dependency-free. All testable logic lives in the other crates.

### E2E in CI

E2E tests run as a separate `e2e` job, triggered only on pull requests. The job:
- Installs Tauri system dependencies (`libwebkit2gtk-4.1-dev`, etc.)
- Builds the Tauri debug binary via `cargo tauri build --debug`
- Installs `tauri-driver` via `cargo install tauri-driver`
- Runs WebdriverIO tests under `xvfb-run` for a virtual display

```
cargo test --workspace --exclude agent-arcade   # unit — always, fast
npm test -- --run                               # component — always, fast
tauri-driver + wdio                             # E2E — PR only, requires binary
```

E2E test dependencies are declared in `tests/e2e/package.json` and specs live in `tests/e2e/specs/`. The CI job starts `tauri-driver` in the background before invoking `npm test`.

---

## 7. File locations

```text
agent-arcade/
  crates/
    workflow-model/src/tests/
    event-model/src/tests/
    core-engine/src/tests/
    runtime-adapters/src/tests/
    persistence/src/tests/
  apps/desktop/
    src/__tests__/           # component and hook tests
    src/__mocks__/           # Tauri API mocks
  tests/
    e2e/
      specs/
      wdio.conf.js
```

---

## 8. What is not tested here

- **Simulation crate** — deferred to v1.1
- **Plugin adapters** — out of scope for v1
- **Cloud/sync behavior** — out of scope for v1
- **Visual regression** — not a v1 priority; focus on functional correctness
