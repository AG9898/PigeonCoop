import {readFile,readdir,writeFile} from 'node:fs/promises';
const result=JSON.parse(await readFile('evidence/browser-report.json','utf8'));
const images=(await readdir('evidence')).filter(f=>f.endsWith('.png')).sort();
const timings=result.benchmarks.map(b=>`| ${b.count} | ${b.player} | ${b.frame_intervals_ms.p50.toFixed(2)} | ${b.frame_intervals_ms.p95.toFixed(2)} | ${b.frame_intervals_ms.p99.toFixed(2)} | ${b.cpu_submit_ms.p95.toFixed(2)} | ${b.stalls_over_33ms} |`).join('\n');
const intro=`# Windows prototype review — 2026-10-27

**Partial experiment; no renderer selected. All visual checks ran headlessly.**

Portable Rust 1.99.1, MSVC 14.44.35207 (compiler 19.44.35229), and Windows SDK
10.0.26100.0 are available under the user account, without administrator rights.
Node 24.12.0/npm 11.6.2 and WebView2 were already present.

Native verification stopped when Cargo's generated helper executables could not
start: \`Access is denied. (os error 5)\`. The executable's ACL grants execute
access. The precise enforcement source is unresolved; no security controls were
disabled or circumvented. The portable compiler itself runs. Native Rust tests,
Macroquad rendering and Tauri/WebView2 integration remain unverified.

The completed visual path is **PixiJS in headless Windows Edge ${result.browser_version}**,
using **${result.renderer.renderer}**. This is not the Rust engine, a Tauri
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
${timings}

The proposed 60 FPS / 16.67 ms frame budget is **not demonstrated** by these
headless intervals. Similar intervals across actor counts and low submission
times suggest scheduling/presentation pacing matters here; that is an inference,
not a measured cause. This tiny study does not establish a useful performance
winner. Do not choose a renderer from these figures.

Idle CDP main-thread task time: ${result.idle.main_thread_task_seconds.toFixed(4)} seconds
over a 2-second sample; JS heap: ${(result.idle.js_heap_used_bytes/1048576).toFixed(2)} MiB.
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

${images.map(f=>`- [${f}](evidence/${f})`).join('\n')}

[Raw measurements](evidence/browser-report.json) · [Atlas bounds](evidence/atlas-validation.json) · [Terminal projection](evidence/terminal.txt)
`;
await writeFile('REVIEW.md',intro);
const rows=result.benchmarks.map(b=>`<tr><td>${b.count}</td><td>${b.player}</td><td>${b.frame_intervals_ms.p95.toFixed(2)} ms</td><td>${b.cpu_submit_ms.p95.toFixed(2)} ms</td></tr>`).join('');
await writeFile('evidence/index.html',`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PigeonCoop Windows prototype review</title><style>body{font:15px/1.6 Segoe UI,sans-serif;max-width:1200px;margin:35px auto;padding:0 22px;background:#f6f2e8;color:#2b453a}h1,h2{font-family:Georgia,serif;font-weight:normal}p{max-width:850px}.notice{border-left:4px solid #b17c42;padding:10px 18px;background:#eee6d4}section{display:grid;grid-template-columns:1fr 1fr;gap:24px}figure{margin:0}img{width:100%;display:block;border:1px solid #cfd3be}figcaption{font-size:12px;padding:7px 0;color:#617056}a{color:#356249}table{border-collapse:collapse;margin:20px 0}td,th{text-align:left;padding:7px 22px 7px 0;border-bottom:1px solid #d1d5c4}code{font:12px Consolas,monospace}@media(max-width:750px){section{grid-template-columns:1fr}}</style><h1>The first clearing</h1><p>Windows headless visual study · October 27, 2026</p><p class="notice"><strong>Partial experiment.</strong> Portable Rust/MSVC/SDK installed without admin rights. Native build helpers could not execute (Access denied); Rust/Macroquad and Tauri remain blocked. These screenshots show PixiJS in headless Windows Edge using the RTX 3080. No visible browser windows were opened.</p><p>Eight browser fixture tests passed, with deterministic seeks, frozen stale/reduced-motion scenes, six-timestamp animation-player pixel parity, selection and resizing checks. The 100-actor layout is a readability failure. The art is V2-inspired test art with incomplete direction coverage.</p><h2>Timing observations</h2><p>180 intervals per case after warm-up. The proposed 60 FPS budget is not demonstrated; no renderer selection follows from this study. These are headless scheduling intervals, not a native-app benchmark.</p><table><tr><th>Actors</th><th>Frame selection</th><th>Frame p95</th><th>CPU submission p95</th></tr>${rows}</table><p><a href="../REVIEW.md">Full review and limitations</a> · <a href="browser-report.json">Raw results</a></p><h2>Screenshot sequence</h2><section>${images.map(f=>`<figure><a href="${f}"><img loading="lazy" src="${f}" alt="${f}"></a><figcaption>${f}</figcaption></figure>`).join('')}</section></html>`);
console.log(`Wrote review and gallery for ${images.length} screenshots.`);
