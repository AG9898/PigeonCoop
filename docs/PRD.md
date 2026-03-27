# Product Requirements Document (PRD)

## Product
PigeonCoop

## Version
Draft v1

## Status
Approved planning baseline

---

## 1. Product summary

PigeonCoop is a local-first desktop application for designing, running, monitoring, and replaying agent workflows through a game-inspired 2D interface. The initial version is aimed at developers who want a more visual, inspectable, and engaging way to manage agentic workflows tied to a local repository or project workspace.

The product acts as a practical bridge between a workflow builder, a CLI task wrapper, and a replay/debugger.

---

## 2. Problem statement

Developers working with agentic workflows currently face a fragmented tool landscape:
- node editors are often visually static and weak for debugging
- agent frameworks are hard to observe in real time
- CLI-driven workflows are practical but opaque
- log-based debugging is slow and mentally expensive
- multi-step runs across a repository are difficult to inspect and replay

There is room for a tool that combines practical execution with strong visual feedback and post-run analysis.

---

## 3. Product vision

Create a desktop workflow IDE for agentic systems that feels more like a living systems simulation than a static graph tool, while remaining useful for real development work.

The product should help developers:
- design workflows visually
- run them on local projects
- monitor them live
- understand exactly what happened afterward

---

## 4. Target user

### Primary user
Technical developers building and debugging agent workflows that operate on local repositories, codebases, or structured task environments.

### Early adopter profile
- solo OSS builders
- agent framework experimenters
- internal tooling engineers
- developers using CLI-based coding/repo agents

### Not a target for v1
- non-technical end users
- enterprise multi-tenant admin teams
- managed cloud orchestration users

---

## 5. Primary jobs to be done

1. **Design a workflow visually**
   - create nodes and edges
   - configure execution behavior
   - validate graph structure

2. **Run tasks against a real project**
   - select a workspace/repository
   - execute agent or tool steps in context
   - inspect outputs and errors

3. **Monitor workflow progress live**
   - see active nodes and flow progression
   - inspect current command, prompt, tool action, or status
   - understand stalls and failures quickly

4. **Replay and debug completed runs**
   - scrub through run history
   - inspect routing, outputs, and memory changes
   - retry or adjust workflow after failures

---

## 6. Product goals

### Must-have goals
- local-first desktop app
- practical workflow builder
- live monitoring with clear node states
- event-backed replay/debugging
- CLI wrapper execution for real repository tasks
- human review and intervention support
- strong documentation for multi-agent implementation

### Differentiation goals
- visually engaging, game-inspired 2D experience — animated character sprites, health bars, and a living world backdrop (see [`docs/VISUAL_IDENTITY.md`](VISUAL_IDENTITY.md))
- better observability than terminal/log-only tools
- smoother bridge between workflow design and real execution

---

## 7. Non-goals for v1

- cloud-native orchestration platform
- collaborative editing
- unconstrained autonomous orchestrator agents
- dynamic runtime graph mutation
- generalized distributed worker infrastructure
- “supports every agent framework” promise
- 3D simulation or game engine first build

---

## 8. Core product principles

1. **Useful first, stylish second**
   Visual identity should improve comprehension, not obscure it.

2. **Replay is first-class**
   Runs must be inspectable after completion.

3. **Local-first wins**
   Prefer fast iteration and practical desktop workflows over premature cloud architecture.

4. **Constrain the system**
   Bounded execution is easier to debug, safer to run, and more valuable to developers.

5. **Documentation is part of the product**
   Implementation must stay synchronized with written design docs.

---

## 9. Key features for v1

### 9.1 Workflow builder
- visual graph canvas
- drag-and-connect nodes
- configure node properties
- validate workflows before execution
- save/load workflows locally

### 9.2 Repository-aware execution
- choose a local workspace/project root
- run nodes inside that working directory
- support agent/tool execution via CLI wrapper
- log commands, outputs, and failures

### 9.3 Live monitoring
- animated graph state
- current node activity
- event stream feed
- node details inspector
- run status summary

### 9.4 Replay debugger
- timeline scrubber
- event inspection
- node-by-node history
- prompt/command/output inspection
- routing and retry analysis

### 9.5 Human review
- pause at review nodes
- approve/reject/modify next steps
- inspect run memory and outputs
- retry failed nodes where supported

### 9.6 Local persistence
- workflow definitions
- versioned workflow metadata
- run history
- event logs
- settings

---

## 10. v1 node types

- Start Node
- End Node
- Agent Node
- Tool Node
- Router Node
- Memory Node
- Human Review Node

---

## 11. Canonical v1 workflow

**Plan -> Execute Tool -> Critique -> Approve**

This is the reference workflow for architecture validation and demos.

Example use case:
1. Agent analyzes a repository task
2. Tool runs build/lint/test or another project command
3. Agent critiques the result
4. Human approves next action or completion

---

## 12. Success criteria

### Product success criteria
A user can:
- create a workflow without editing raw files manually
- execute it against a local repo/project
- understand live progress from the UI without reading terminal output only
- inspect a completed run and explain why it succeeded or failed

### Technical success criteria
- run history is reconstructable from stored events
- execution state is deterministic enough for replay
- engine state and UI state remain consistent
- workflow definitions are versionable and exportable

---

## 13. User stories

### Workflow design
- As a developer, I want to create and connect workflow nodes visually so I can model task flows quickly.
- As a developer, I want validation errors before running a workflow so I can avoid obvious graph issues.

### Practical execution
- As a developer, I want to point the workflow at a local repository so nodes operate in the right context.
- As a developer, I want to wrap CLI tasks and agent commands in the workflow so I can use real tools, not just demos.

### Monitoring
- As a developer, I want to see which node is active and why so I can understand progress in real time.
- As a developer, I want to inspect current outputs and errors without hunting through logs.

### Replay/debugging
- As a developer, I want to replay a completed run so I can debug routing, retries, and failures.
- As a developer, I want to inspect prompts, commands, outputs, and memory changes at each step.

### Human control
- As a developer, I want to approve or reject sensitive steps so I can stay in control of real project changes.

---

## 14. Constraints and guardrails

The product must support execution constraints such as:
- max retries
- max runtime
- max step count
- optional token/budget limits where available

The system must make routing and side effects inspectable.

---

## 15. Metrics to track later

Not all required in first build, but supported by design:
- run duration
- node duration
- retry counts
- success/failure rate
- command exit codes
- changed files per run if detectable
- token usage when providers expose it

---

## 16. Distribution and installation

### Target install experience
A developer should be able to install and reach their first meaningful run in under 2 minutes.

### Primary distribution channels
- **GitHub Releases** — attach native OS installers as release artifacts on every tagged release
- **Homebrew** (macOS) — `brew install agent-arcade`
- **winget** (Windows) — `winget install agent-arcade`
- **AUR** (Arch Linux) — community-maintainable formula

Package manager support is a trust signal as much as a convenience. It should be set up early, not deferred to post-launch.

### Release build pipeline
A GitHub Actions workflow (`.github/workflows/release.yml`) runs on every `v*` tag push and produces:
- `.dmg` — macOS (both `aarch64-apple-darwin` and `x86_64-apple-darwin`)
- `.msi` — Windows (`x86_64-pc-windows-msvc`)
- `.AppImage` — Linux (`x86_64-unknown-linux-gnu`)

The workflow uses `tauri-apps/tauri-action` to build, create the GitHub Release, and attach all artifacts automatically. The Tauri bundler config (`tauri.conf.json`) sets `bundle.active: true` with targets `["dmg", "msi", "appimage"]`.

### Package manager manifests
Maintained under `distribution/`:
- `distribution/homebrew/agent-arcade.rb` — Homebrew formula with arm64/x64 macOS support
- `distribution/winget/AgentArcade.yaml` — winget singleton manifest for MSI installer
- `distribution/aur/PKGBUILD` — AUR binary package using AppImage extraction

Each manifest contains placeholder SHA256 checksums that must be updated on each release. The Homebrew and winget manifests are submitted to their respective package registries via PR.

### What is not used for distribution
- npm/npx — inappropriate for a native binary + webview desktop app; adds Node.js as a hard runtime dependency on end users for no functional benefit
- Electron-style bundling — Tauri's native webview approach is intentional; do not replace it

### Future CLI companion
A headless `agent-arcade-cli` for CI/scripting use cases could be distributed via npm as a separate package. This is out of scope for v1 but the Rust core crate structure already supports it.

### First-run experience requirement
On first launch, the app must immediately offer the demo workflow (`plan-execute-critique-approve`). The user should be able to select a workspace and run it without building anything from scratch. The path from install to first replay must be obvious and short.

---

## 17. Release philosophy

Ship a narrow but coherent v1 that works well for local workflows, CLI-backed execution, live monitoring, and replay.

Do not broaden scope until the core loop is strong:
1. build
2. run
3. monitor
4. replay
5. adjust
