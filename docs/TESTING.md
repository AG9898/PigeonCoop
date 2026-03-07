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
```ts
// src/__mocks__/@tauri-apps/api/core.ts
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));
```

Set up per-test return values:
```ts
import { invoke } from '@tauri-apps/api/core';
(invoke as vi.Mock).mockResolvedValueOnce({ status: 'Running', nodes: [] });
```

### Guidelines
- Components must not contain execution logic — test rendering and interaction only
- Builder view tests: graph manipulation, node palette, edge creation
- Live run view tests: correct rendering of node states from mocked events
- Replay view tests: timeline scrubbing state, event inspector display
- Do not test Tauri bridge behavior in component tests

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
cargo install tauri-driver         # one-time install

# In one terminal: build and start the app in test mode
cargo tauri build --debug

# In another terminal: start tauri-driver
tauri-driver

# Run E2E tests
cd tests/e2e
npm test
```

### WebdriverIO configuration (outline)
```js
// tests/e2e/wdio.conf.js
export const config = {
  runner: 'local',
  specs: ['./specs/**/*.spec.js'],
  capabilities: [{
    'tauri:options': {
      application: '../../target/debug/agent-arcade',
    },
  }],
  services: ['tauri'],
};
```

### Priority E2E flows for v1
1. **Builder flow** — open app, create a workflow with all node types, save it
2. **Run flow** — load the demo workflow, start a run, observe node state transitions
3. **Human review gate** — run reaches a Human Review node, user approves, run continues
4. **Replay flow** — open a completed run, scrub the timeline, inspect events
5. **Failure handling** — run a workflow where a Tool node fails, verify Failed state is shown

### Guidelines
- E2E tests are slow; run them in CI on PRs, not on every save
- Use a dedicated test workspace directory — never point E2E tests at a real project
- Assert against state that originates from the Rust engine, not UI-derived assumptions
- Keep E2E specs narrowly scoped to critical user paths; avoid testing every UI detail here

---

## 4. Testing the canonical demo workflow

The **Plan -> Execute Tool -> Critique -> Approve** workflow (see `examples/plan-execute-critique-approve/`) is the primary integration target.

Each test layer covers it differently:

| Layer | What to assert |
|---|---|
| Rust unit | Run state machine transitions through all four node types with mock adapters |
| Frontend | Live run view renders all four nodes with correct state badges |
| E2E | Full run completes with approve step triggered by user interaction |

---

## 5. CI guidance

Recommended pipeline stages:

```
cargo test           # Rust unit tests — fast, always run
npm test             # Frontend component tests — fast, always run
tauri-driver + wdio  # E2E tests — slower, run on PR / pre-merge
```

E2E tests require a compiled Tauri binary; run them in a headful CI environment or use a virtual display (Xvfb on Linux).

---

## 6. File locations

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

## 7. What is not tested here

- **Simulation crate** — deferred to v1.1
- **Plugin adapters** — out of scope for v1
- **Cloud/sync behavior** — out of scope for v1
- **Visual regression** — not a v1 priority; focus on functional correctness
