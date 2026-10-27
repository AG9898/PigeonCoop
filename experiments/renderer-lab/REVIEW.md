> Historical first-round report. The broader [product verdict](PRODUCT_VERDICT.md) supersedes its unresolved Linux/Rust conclusions.

# Windows prototype review — 2026-10-27

**Partial experiment; no renderer selected. All visual checks ran headlessly.**

Portable Rust 1.99.1, MSVC 14.44.35207 (compiler 19.44.35229), and Windows SDK
10.0.26100.0 are available under the user account, without administrator rights.
Node 24.12.0/npm 11.6.2 and WebView2 were already present.

Native verification stopped when Cargo's generated helper executables could not
start: `Access is denied. (os error 5)`. The executable's ACL grants execute
access. The precise enforcement source is unresolved; no security controls were
disabled or circumvented. The portable compiler itself runs. Native Rust tests,
Macroquad rendering and Tauri/WebView2 integration remain unverified.

The completed visual path is **PixiJS in headless Windows Edge 156.0.4314.42**,
using **ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 (0x00002216) Direct3D11 vs_5_0 ps_5_0, D3D11)**. This is not the Rust engine, a Tauri
webview, a physical DPI/input check, or Linux release coverage.

## Evidence and checks

- Eight browser fixture unit tests passed. Rust's eight tests are authored but blocked.
- Atlas dimensions/12 cell bounds/foot anchor validated against the actual PNG.
- Direct texture sampling and AnimatedSprite frame selection produce identical
  canvas pixels at six timestamps, including walk and handoff poses.
- Backward/forward seeks reproduce the same snapshot. Reduced-motion and stale
  canvases remain static across later timestamps; lost contact leaves outcome unknown.
- Actual scenario/reduced-motion controls, selection hit testing and zoom worked.
- Captured 1280×720, 1440×900, 1920×1080 viewports and emulated DPR 1.25/1.5.
- No browser page errors were observed. A compact terminal projection is retained.

## Measured browser timing

180 recorded frame intervals after 30 warm-up frames per case. Production Pixi
bundle, DPR 1, 1280×800 viewport, same Windows machine/RTX 3080. GPU backend is
recorded above. CPU submission includes scene updates, rendering submission and
inspector DOM updates; it is not GPU completion time.

| Actors | Frame selection | p50 ms | p95 ms | p99 ms | CPU submit p95 ms | Intervals >33.33 ms |
|---|---|---:|---:|---:|---:|---:|
| 2 | sampler | 17.90 | 18.50 | 20.10 | 0.50 | 0 |
| 2 | library | 17.70 | 19.70 | 23.40 | 0.50 | 0 |
| 20 | sampler | 17.80 | 18.50 | 18.90 | 0.50 | 0 |
| 20 | library | 17.70 | 18.30 | 18.60 | 0.40 | 0 |
| 100 | sampler | 17.60 | 18.30 | 18.60 | 0.50 | 0 |
| 100 | library | 17.70 | 18.60 | 21.80 | 0.50 | 0 |

The proposed 60 FPS / 16.67 ms frame budget is **not demonstrated** by these
headless intervals. Similar intervals across actor counts and low submission
times suggest scheduling/presentation pacing matters here; that is an inference,
not a measured cause. This tiny study does not establish a useful performance
winner. Do not choose a renderer from these figures.

Idle CDP main-thread task time: 0.0198 seconds
over a 2-second sample; JS heap: 8.45 MiB.
These counters exclude total browser/process memory and much GPU work.
Startup, full process CPU/memory budgets and native idle behavior remain open.

## Visual assessment

The two-character visit is readable; the foot anchors, path around the obstacle,
depth ordering and selected evidence are reviewable in the captures. The V2
teal jacket/satchel and green worker variant are represented by fresh editable
test art, not a cleaned production version of the concept. Your preference still
determines whether this visual direction is worth developing.

The 100-actor stress layout **fails legibility** because sprites overlap densely.
It needs camera/layout/aggregation work before it could represent actual activity.
The larger 48-pixel cell is easier to read than the 32-pixel variant at this scale.
Up/down facing currently has labels but lacks directional character poses;
left mirroring also swaps the satchel. The short handoff is a minimal two-pose
test, not finished choreography. Automated screenshots do not settle those art
and animation-quality questions.

## Remaining experiment

1. Resolve permission to execute locally built development binaries through the
   machine's approved support path; then run Rust tests and the fixture exporter.
2. Reconcile Rust/browser fixture parity and build the standalone Macroquad
   candidate with the same atlas, scene, events, camera and measurements.
3. Verify native private-desktop capture support before any native window launch;
   never fall back to the user's visible desktop.
4. Test actual Tauri/WebView2 integration, native DPI/input and native Linux.
5. Refine directional/paired art and high-density readability, then record the
   renderer/playback decision with evidence. No production migration is selected.

## Captures

- [01-idle.png](evidence/01-idle.png)
- [02-approach.png](evidence/02-approach.png)
- [03-handoff.png](evidence/03-handoff.png)
- [04-settled.png](evidence/04-settled.png)
- [05-contact-lost.png](evidence/05-contact-lost.png)
- [06-cancelled.png](evidence/06-cancelled.png)
- [07-failure.png](evidence/07-failure.png)
- [08-reduced-motion.png](evidence/08-reduced-motion.png)
- [09-small-character.png](evidence/09-small-character.png)
- [10-stress-100.png](evidence/10-stress-100.png)
- [11-selection-zoom.png](evidence/11-selection-zoom.png)
- [12-twenty-actors.png](evidence/12-twenty-actors.png)
- [dpr-1.25.png](evidence/dpr-1.25.png)
- [dpr-1.5.png](evidence/dpr-1.5.png)
- [size-1280x720.png](evidence/size-1280x720.png)
- [size-1440x900.png](evidence/size-1440x900.png)
- [size-1920x1080.png](evidence/size-1920x1080.png)

[Raw measurements](evidence/browser-report.json) · [Atlas bounds](evidence/atlas-validation.json) · [Terminal projection](evidence/terminal.txt)
