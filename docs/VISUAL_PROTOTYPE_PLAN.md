# Living Workspace Prototype Plan

**Proposed experiment, 2026-10-27. No renderer or library selection is accepted.**

The user prefers the second imagegen character draft (V2). Preserve its identity,
proportions, clothing and warm pixel-world direction while developing genuinely
registered animation assets. The concept is retained at
[pigeoncoop-character-v2-draft.png](../assets/concepts/pigeoncoop-character-v2-draft.png),
with its [generation prompts](../assets/concepts/pigeoncoop-character-v2-draft.prompts.md).
It is a visual reference, not a production sprite sheet or deployed UI asset.

## 1. First experiment

Build one small inhabited clearing/workspace, with two characters, a short walk
around one obstacle, one interaction, and two ambient loops. Use synthetic
recorded events and a replay slider; do not attach real agents or change the
current production UI to test the visual idea.

One character idles, approaches the other, faces them, plays a handoff/review
interaction, and settles. A station is optional. Click/select reveals the
fixture node/action IDs and evidence; no default connector lines are needed.
Include failure, owner-contact loss, cancellation and an instant replay seek.

This tests the actual uncertainty: whether motion, scene composition, character
scale and interactions make project work more understandable and alive.

## 2. Asset authoring pipeline

1. Use V2 as the visual anchor for new character/environment studies. Imagegen
   helps explore silhouettes, props, palette and key poses; do not independently
   generate dozens of supposedly identical animation frames.
2. Choose native pixel scale before producing a library. Compare character
   heights around 32 and 48 logical pixels in a small 16-pixel tile scene; use
   nearest-neighbor integer enlargement and judge actual readability. These are
   candidate scales, not a locked production specification.
3. Establish one clean base character in a pixel editor such as Aseprite. Match
   V2's identity while cleaning alpha, pixel clusters, palette, foot anchor and
   silhouette. Keep layered editable source and derive variants from that base.
4. Author a minimal clip set: idle, horizontal walking and a short interaction
   with a matching receiving pose. Add direction coverage only as the movement
   test demands; flipping is acceptable only when clothing/props permit it.
5. Export atlas PNG plus JSON containing frame rectangles, durations and clip
   tags. Add our own foot anchors, facing and interaction offsets through a small
   asset manifest. Validate the manifest against the real exported dimensions.
6. Assemble scenery from a few reusable tiles and independent props. Retain
   source art separately from runtime exports; no old RPG/city/pigeon art reuse.

[Aseprite supports sheet PNG/JSON export and batch automation](https://www.aseprite.org/docs/cli/).
Imagegen concepts still need registration/cleanup; a visually plausible strip
does not guarantee consistent frame bounds, transparency or foot positions.

## 3. World composition

| Layer | First assets | Runtime behavior |
|---|---|---|
| Ground | grass, path, edge tiles | Mostly static tile grid |
| Scenery | tree, plant, rock/fence, optional work prop | Foot-based depth order; simple blocked cells |
| Actors | V2-based worker + one distinct variant | Idle, walk, face, interact |
| Ambient | small water loop + foliage sway | Low-frame-rate decorative clips |
| Feedback | selected actor/action, waiting/failure cue | Recorded state plus readable text |
| App UI | inspector, transport, mode/coverage | Normal crisp controls above the world |

Use the same square-aligned elevated view throughout. A giant painted background
would make depth, navigation and rearrangement difficult to test. Tiles/props
provide reusable composition and allow actors to pass behind trees naturally.
Ground can be cached; sort actors/props by their foot position, with explicit
foreground layers where necessary. Avoid a physics engine for this first scene.

[Tiled's tile/object layers](https://doc.mapeditor.org/en/stable/manual/layers/)
can provide ground, props, walkability and named interaction points; its
[tile animations](https://doc.mapeditor.org/en/latest/manual/editing-tilesets/)
support ambient loops. For the tiny first scene a hand-authored map manifest is
also adequate; adopting an editor is optional until scene-authoring effort is known.

## 4. Runtime responsibilities

- Asset loading/validation and hot reload of test art.
- Camera pan/zoom, nearest-neighbor sampling and coordinate conversion.
- Scene layers and foot-position depth ordering.
- Actor identity, position, facing and clip playback with one shared clock.
- A small walkability grid/waypoint route around the test obstacle; reserve A*
  or more elaborate navigation for layouts that actually require it.
- Interaction choreography: target approach point, face target, play paired
  clips, settle; no real workflow execution authority.
- Selection/hit testing and a normal evidence inspector.
- Replay sampling/interruption, reduced motion and a compact terminal projection.

Keep recorded workflow state, visual choreography and ambient decoration separate.
Use stable layout/seed and seekable presentation time. Ambient motion must not
suggest agents are connected or working after contact is lost. Real execution
never waits for walking/interaction playback. Avoid per-frame per-actor Tauri IPC:
send compact scene/event commands and sample/interpolate within the drawing
process, or run the visual core directly beside the native renderer.

## 5. Rendering candidates to test

| Candidate | Why test it | Boundary/risk |
|---|---|---|
| Macroquad + small Rust presentation core | First native Rust experiment: direct 2D drawing, sprites and camera support | Standalone prototype first; Tauri embedding is a separate experiment |
| PixiJS in the existing Tauri webview | Compare how quickly the same scene fits current React controls and inspector | Drawing is JS; keep Rust recording and explicit visual-state contracts |
| Bevy | Reconsider if scene systems/assets/tooling grow beyond the small runtime | Do not select a larger application/engine model before the scene proves a need |

**Recommendation:** Start with the native Macroquad experiment, then exercise the
same assets/fixture sequence in the Tauri drawing path before choosing production
integration. Compare a tiny deterministic clip sampler to library playback; do
not let a wall-clock-only player dictate replay behavior. Do not implement all
three candidates or build a custom graphics backend first.

Primary references checked for this proposal:

- [Macroquad platform/2D overview](https://macroquad.rs/)
- [Macroquad animation API](https://docs.rs/macroquad/latest/macroquad/experimental/animation/index.html)
  is explicitly experimental; avoid baking that API into our asset format.
- [PixiJS AnimatedSprite](https://pixijs.download/v8.21.0/docs/scene.AnimatedSprite.html)
- [Bevy sprite-sheet example](https://bevy.org/examples/2d-rendering/sprite-sheet/)

Native Rust drawing in its own window and embedding it into Tauri are different
tasks. Web/WASM support does not prove compatibility with every target webview.
Verify native Windows/Linux window/input/scaling behavior and actual Tauri
integration before treating any candidate as a release architecture.

### Comparison procedure and environment

Use the same registered atlas, map, fixture event sequence, camera size and
interaction timing in both candidates. Compare release/production builds on the
same machine, recording DPI, graphics backend, actor count and build settings.
Exercise 2, 20 and 100 actors with selection, pan/zoom, window resizing, replay
seeks and reduced motion. Record frame-time distribution, startup, CPU/memory,
idle behavior, text/pixel clarity and the effort to connect an evidence inspector.
Do not infer application integration quality solely from sprite throughput.

Recommended first comparison environment: native Windows, using a native checkout
and Windows Rust/Node tools. This exercises the actual Windows window/input/DPI
path and Tauri's WebView2. Retain WSL for Linux core/CLI tests and secondary Linux
GUI smoke coverage; compare Linux native graphics separately before release.
WSLg adds a Linux GUI/virtual-GPU route and is not an interchangeable Windows
renderer benchmark. Do not relocate the current checkout just to write this plan.

Platform references: [Tauri webviews](https://v2.tauri.app/reference/webview-versions/)
and [Microsoft's WSL GUI guidance](https://learn.microsoft.com/en-us/windows/wsl/tutorials/gui-apps).

## 6. Pass/fail and next decision

The test passes when:

- V2 remains recognizable and crisp at the selected logical size.
- Feet do not slide/jitter, facing and paired interaction offsets align, and
  characters pass behind the test prop with correct depth.
- The scene feels alive with only two ambient loops and does not distract from
  identifying the current operation or selected evidence.
- Pause/scrub/seek, cancellation, stale contact and reduced motion behave clearly;
  the same record reconstructs the same task/actor relationship.
- 2, 20 and 100 fixture actors have measured frame pacing and idle resource use;
  note hardware/build mode instead of asserting performance from library choice.
- Native Windows and Linux pass; a terminal view expresses the same actor visit
  and action without needing pixel-identical art.

Then record the chosen native scale, atlas/clip contract, rendering route, capture
of the scene, measured limitations and Tauri integration result. Expand assets
only after this decision. No new asset mass-generation, procedural world system,
physics, multiplayer, or production workflow migration is part of the experiment.
