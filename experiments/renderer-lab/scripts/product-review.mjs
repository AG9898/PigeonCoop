import {readFile,writeFile,stat} from 'node:fs/promises';
const json=async path=>JSON.parse(await readFile(path,'utf8'));
const windows=await json('evidence/comparison-windows/report.json'),wasm=await json('evidence/wasm-win32.json'),pixels=await json('evidence/image-conformance.json'),integration=await json('evidence/integration/report.json'),tauri=await json('evidence/linux-tauri-pixi-canvas/report.json'),cli=await json('evidence/cli-live-pixi-canvas/report.json');
const range=values=>`${Math.min(...values).toFixed(2)}–${Math.max(...values).toFixed(2)}`;
const pixiCanvas=await json('evidence/pixi-canvas/report.json');
windows.candidates.push({name:'pixi-canvas-8.22 + Rust/packed',measurements:pixiCanvas.measurements,baseline_frame_intervals_ms:null});
const table=windows.candidates.filter(c=>c.measurements.length).flatMap(c=>[2,20,100].map(count=>`| ${c.name} | ${count} | ${range(c.measurements.filter(m=>m.count===count).map(m=>m.cpu_submit_ms.p95))} | ${c.baseline_frame_intervals_ms?.p95?.toFixed(2)??'not sampled'} |`)).join('\n');
const wasmTable=wasm.sampling_and_json_decode.map(r=>`| ${r.count} | ${r.p95_ms.toFixed(3)} | ${r.p99_ms.toFixed(3)} |`).join('\n');
const pixelTable=pixels.results.map(r=>`| ${r.name} | ${(r.match_ratio*100).toFixed(2)}% | ${r.passes?'Pass':'**Observed failure**'} |`).join('\n');
const integratedTable=integration.canvas_rust_packed_budget.map(r=>`| ${r.count} | ${r.cpu_submit_ms.p95.toFixed(2)} | ${r.frame_intervals_ms.p95.toFixed(2)} |`).join('\n');
const verdict=`# Product renderer verdict — 2026-10-27

**Accepted WSL prototype baseline (DEC-016): use PixiJS 8.22's Canvas backend for the pixel scene,
normal HTML/React inspection controls, and one deterministic Rust presentation
core compiled natively and to WASM. Keep recording/CLI headless and viewers
optional.**

The user accepted this evidence-based direction for the WSL prototype; it remains a recommendation for broader product integration,
not an accepted production migration or a claim that every release gate passed.
All experiment runs used synthetic records; production execution/recording is
unchanged. [Curated screenshots](evidence/product-index.html) are saved locally.

## Why this is the best fit for the tested v1 product

The scene needs atlas blits, depth sorting, selection, a camera, modest ambient
motion and deterministic replay. Both Canvas routes meet that workload while fitting the
existing web UI and a local-browser viewer launched from a CLI. Normal HTML can
carry the dense inspector, paths, output, search, keyboard controls and evidence.
Those product surfaces matter more than maximizing sprite throughput.

Native Macroquad is viable: it draws the same scene correctly and has ample
headroom in the Linux software test. The experiment gives no reason to reject
its drawing capability. A dedicated native game window would, however, add a
separate inspector/accessibility/layout integration and another viewer surface
to package. Those costs are engineering assessments, not measured person-days.
Tauri embedding is a separate problem from standalone native drawing.

The best overall package choice is PixiJS 8.22 with its Canvas backend selected
explicitly for the v1 scene. It reuses maintained scene/texture/layer/interaction
facilities and supports a later validated WebGL route without replacing asset
contracts. The direct Canvas adapter is a smaller and slightly faster reference;
its measured advantage does not outweigh that library support for this animated
workspace. This maintainability judgment is an engineering assessment, not a
performance result.

Pixi Canvas passed Windows and WebKit/software sprite probes, actual Linux Tauri
attachment and the end-to-end CLI/browser proof. Its measured p95 CPU submission
was 1.4-2.9 ms across 2/20/100 actors, including Rust/WASM sampling and packed atlas
handling. That leaves headroom for the tested workload.

Pixi WebGL performs well on Windows but fails visual correctness in the tested
WebKit/software path, including 8.22 and the tested WebGL1/preserved-buffer
variants. The failure is environment-specific and its upstream cause unresolved.
Choose Canvas explicitly instead of assuming that WebGL feature availability
proves correct drawing. WebGL acceleration should be enabled only after that
platform/driver path passes conformance.

The web guide's Canvas-coming-soon statement is stale relative to the tested
8.22 package: its shipped CanvasRenderer and autoDetectRenderer implementations
provide this backend. The additional backend was inspected and exercised before
this final recommendation. The default browser route should pin the verified
version and keep backend choice explicit. See the versioned
[CanvasRenderer API](https://pixijs.download/v8.22.0/docs/rendering.CanvasRenderer.html)
and the locally installed package source; this is not an assumed fallback.

Bevy was not implemented or benchmarked. Nothing in the tested scene requires a
larger game-engine application model. Reconsider that only if product requirements
grow beyond this evidence; do not infer a Bevy performance result.

## Runtime recommendation and animation ownership

Keep workflow/recording state, visual choreography and decorative motion separate.
Rust samples the visual state from recorded fixture state and explicit presentation
time; seeking reconstructs a frame without a queue of obsolete walks. Native
Macroquad and the browser's WASM module use the same Rust crate. Drawing adapters
receive one bulk scene; there is no per-frame per-actor Tauri IPC.

The WASM module is **${wasm.binary_bytes.toLocaleString()} bytes**. It passed
${wasm.checked_snapshots.toLocaleString()} sampled cases across 2/20/100 actors,
four outcome/contact scenarios and reduced motion, with exact state/frame fields
and position differences below 0.0001 logical pixels. A separate native/exported
reference comparison passed 3,848 snapshots. This proves the fixture boundary,
not production recorder/CLI integration.

| Actors | Rust/WASM sampling + JSON decode p95 ms | p99 ms |
|---|---:|---:|
${wasmTable}

The native Macroquad animation library's frame rectangles match seekable
sampling. Its built-in update method uses frame time and uniform FPS; the
experiment uses explicit frame selection so pauses, seeks and unequal exported
durations remain under our clock. Prefer a small deterministic clip sampler and
use renderer libraries for drawing/rectangles, rather than letting library wall
clocks decide presentation history. See the pinned
[Macroquad animation implementation](https://docs.rs/crate/macroquad/0.4.16/source/src/experimental/animation.rs).

## Asset generation and sprite-sheet pipeline

Use concept generation to establish identity, palette, clothing and key poses.
Production animation should come from one registered editable character source
in a pixel editor, with hand-authored directions and paired interaction poses.
Independently generating many nominally identical frames has not been validated
as a reliable production pipeline by this experiment.

The tested path is:

1. Editable SVG test art inspired by V2, converted into two six-frame editable
   \`.aseprite\` test documents. These are simple test bases, not final layered art.
2. Actual LibreSprite 1.3 batch export to PNG+JSON, retaining named idle/walk/handoff
   tags and unequal durations of 600/200, 140/140 and 180/300 milliseconds.
3. Normalize full cells/JSON arrays and packed trimmed cells/JSON hashes into
   frame rectangles, logical source size, trim offset, duration, foot anchor and
   clip membership. Reject out-of-bounds rectangles, zero durations and unsupported
   rotated packing. Prefer JSON arrays for predictable ordering in production.
4. Sample by elapsed clip time; phase changes establish clip start times. Draw
   trimmed frames relative to the original foot anchor. Renderer choice does not
   alter these asset semantics.
5. Canvas using actual packed exports and the Rust core matches the untrimmed
   reference canvas **pixel-for-pixel at six tested timestamps**. Pixi Canvas also passes six exact full-versus-packed canvas comparisons. Pixi WebGL also loads
   the same normalized packed data on Windows. Native Macroquad loads the same
   registered source atlas; packed import into its renderer remains unimplemented.

The [Aseprite CLI](https://www.aseprite.org/docs/cli/) documents batch PNG+JSON/tag
exports, trimming and padding. Aseprite itself was not installed or licensed in
this experiment; the real batch run used the official
[LibreSprite 1.3 release](https://github.com/LibreSprite/LibreSprite/releases/tag/v1.3).
Keep editable source and runtime exports separately, with a versioned asset
manifest before production adoption. This experimental manifest does not change
production workflow/event schemas or require trace migration.

Start production authoring with consistent 48-pixel logical cells, an explicit
foot anchor and modest clip/direction coverage. The 32-pixel study is available
for comparison; 48 is my visual preference for readability, not an accepted final
art specification. Asymmetric clothing/satchels need real direction poses: the
prototype's mirroring swaps the bag side, and up/down art remains unfinished.
Registration, directions and choreography are the next visual-quality bottlenecks.

## OS and presentation evidence

| Path | Evidence | Interpretation |
|---|---|---|
| Native Windows Edge, headless | Direct Canvas, Pixi Canvas and Pixi WebGL/Rust/packed render and seek correctly | Browser path passes these fixtures |
| WSL Linux native executable, Xvfb | Macroquad scene and nine Rust tests pass | Native Linux code path works in software graphics |
| Actual WebKitGTK 2.52.6, Xvfb | Direct Canvas and Pixi Canvas/Rust/packed render correctly; Pixi WebGL sprites corrupt | Real compatibility difference in this setup |
| Existing Linux Tauri shell, Xvfb | Direct Canvas and Pixi Canvas/Rust/WASM/packed ready; \`__TAURI_INTERNALS__\` confirmed; handoff/stale/reduced captures | Actual Tauri shell integration smoke passes |
| Windows/Linux Node CLI fixture harness | Attach/detach/reopen, ordered backfill, spaced/non-ASCII paths, unknown owner outcome | Development harness behavior passes on both OSes |
| Native Windows Rust/Macroquad/Tauri | Cargo helpers cannot execute (OS error 5) | Still unverified; not an engine failure |

The WSL distribution is named Ubuntu-22.04 but currently reports Ubuntu 24.04.4.
All Linux graphics used private Xvfb and forced software rendering. Do not compare
its raw frame times against the RTX 3080 Windows run, or treat it as physical Linux
hardware/DPI/input qualification. WebKit's reported “Apple GPU” identity is
privacy-sanitized and is not the actual hardware. Tauri's OS webview differences
are documented in its [webview reference](https://v2.tauri.app/reference/webview-versions/).

The image probe compares 1,090 opaque inner sprite pixels at recorded foot
positions against the source atlas, allowing channel error 2 and requiring >99%
agreement. It explicitly retains the failed configuration:

| Capture | Atlas-pixel agreement | Result |
|---|---:|---|
${pixelTable}

This probe checks sprites, not every UI pixel or every possible driver. Separate
six-timestamp exact Canvas equality validates packed/unpacked asset registration.

## Performance and fluidity

Matched Windows comparison: same 1280×800 viewport, DPR 1, atlas, geometry and
inspector; three repetitions per actor count, 120 recorded intervals after 20
warm-up frames each. CPU submission includes sampling, drawing submission and
inspector updates. It does **not** prove GPU completion or end-to-end input latency.

| Drawing route | Actors | p95 CPU submission range ms | Blank rAF baseline p95 ms |
|---|---:|---:|---:|
${table}

The direct Canvas reference + Rust/WASM + packed-export path also stayed within the proposed
16.67 ms CPU frame budget in these fixtures:

| Actors | Integrated submission p95 ms | Headless frame interval p95 ms |
|---|---:|---:|
${integratedTable}

The initial 18–19 ms frame intervals were not a valid reason to reject a drawing
engine: blank-page pacing is similar. The Pixi Canvas row includes the Rust/WASM and packed-atlas integration, while the first direct Canvas/Pixi WebGL baseline rows use the reference fixture sampler; this is a product-budget comparison, not an isolated GPU microbenchmark. The source now reports scheduling and CPU
submission separately. Forced GPU/readback diagnostics are retained separately
in \`diagnostics-readback.json\`; repeated Canvas readback changes its cost and is
not the production workload. No stable 60 FPS, native Windows input latency or
full-process memory release guarantee is inferred from these headless tests.

All tested Canvas routes have sufficient CPU submission headroom for this bounded scene. Direct Canvas also
avoids loading the approximately ${(await stat('web/pixi-8.22.min.js')).size.toLocaleString()}-byte
Pixi bundle. The recommended Pixi Canvas route accepts that optional viewer payload to reuse its scene and asset facilities; it is not a dependency of the shipped headless recorder. The observed page-ready times are
single local samples in an already-running browser, not cold-install benchmarks.

## CLI launch and viewer lifecycle

The recommendation is one headless recording/query domain with explicit optional
viewers: a normal workspace window, a local browser, compact terminal inspection,
or replay/static evidence. Recording and machine-output commands must not need
Tauri, WebKit, a display, or an installed Node runtime in the shipped product.
The Node scripts here are development test harnesses, not the future install contract.

The fixture owner is bounded to ten explicit records. A viewer can close while
the owner continues, then reopen and backfill without duplicate sequence IDs.
Terminating an owner without a terminal report leaves its last recorded Running
status; a timer or process exit does not manufacture success/failure/cancellation.
Loopback snapshot reads require a short-lived token and reject foreign origins.
No write/control protocol or production CLI schema is selected by this test.

The real Windows CLI-to-browser proof attached at sequence ${cli.initial.last_seq},
lost the viewer service, reopened at sequence ${cli.backfilled.last_seq}, and
observed an explicit final Succeeded report. The owner survived viewer closure.
Process-to-readiness samples were ${cli.first_viewer_process_ready_ms.toFixed(0)} ms
and ${cli.reopened_viewer_process_ready_ms.toFixed(0)} ms; these are Node harness
measurements on this managed machine, not a native Rust CLI speed promise.
All visual checks remained headless or on private displays.

For the eventual CLI, keep browser opening explicit, support no-open/JSON/text
inspection, preserve the chosen project/run/replay position on attachment, and
let the user select a viewer without changing execution ownership. Exact command
names are still a product/interface decision.

## Which ways to present it

Use a full evidence workspace for inspection, an active-pair scene for current
visits, and a selectable session/task list for larger runs. The 100-sprite crowd
failed readability; replacing it with a faster renderer would not make its
overlapping labels/characters useful. Tested focus mode shows 2 of 100 records,
and the list can select fixture-099 while correctly showing no recorded action
or artifact for that idle fixture. No extra activity is invented.

Provide a compact terminal/cell/text view over the same identities and evidence.
Only the terminal text projection is implemented here; no TUI toolkit is selected.
The 1024×600 browser captures are a compact layout study, not a finished mini-window
or always-on-top product. Keep a relationship/graph diagnostic view available when
needed, rather than requiring the entire graph to remain the main scene.

## Decision confidence and remaining gates

**The experiment supports a clear v1 recommendation: HTML/React + PixiJS Canvas,
shared Rust/native-WASM presentation sampling, renderer-neutral PNG+JSON assets,
and optional browser/Tauri/terminal viewers attached through the CLI domain.**

Confidence is strongest for bounded 2D drawing, asset registration, shared clock,
replay and viewer lifecycle. It is lower for final art, high-density design,
physical platform behavior and distribution. This chooses the next engineering
direction; it does not mark a release ready.

Before production adoption: verify native Windows executable/WebView2/PTY paths
on an approved build/test setup, physical Windows/Linux DPI/input and hardware
graphics, complete owner/recording contracts, version the asset/WASM boundary,
exercise real-project evidence/output sizes, finish direction/interaction art,
and select the terminal toolkit. No Windows security controls were bypassed.
No workboard tasks were silently inserted or marked complete.

## Sources and artifacts

The key evidence is retained in \`evidence/comparison-windows/report.json\`,
\`evidence/wasm-win32.json\`, \`evidence/image-conformance.json\`,
\`evidence/integration/report.json\`, \`evidence/linux-tauri/report.json\`,
\`evidence/linux-macroquad/native-report.json\`, \`evidence/asset-pipeline/\`,
\`evidence/cli-live/report.json\`, and \`evidence/cli-{win32,linux}.json\`.
The source scripts make limitations and expected failures explicit.

The native candidate's platform/build expectations are documented by
[Macroquad](https://github.com/not-fl3/macroquad). Its successful Linux drawing
test and package size are not a claim that Windows deployment was verified.
`;
await writeFile('PRODUCT_VERDICT.md',verdict);
const shots=[['pixi-canvas/windows.png','Recommended Pixi Canvas + Rust/WASM + real packed atlas on Windows'],['linux-tauri-pixi-canvas/handoff.png','Actual Linux Tauri shell, private display, same Rust/Canvas assets'],['linux-macroquad/03-handoff.png','Native Linux Macroquad reference; drawing works'],['linux-webkit-latest/03-handoff.png','Rejected configuration: Pixi 8.22 sprite corruption in WebKit/software'],['integration/focus-100.png','Focus view: 2 of 100 recorded fixture sessions'],['integration/list-100.png','Selectable session list with explicit missing action/evidence'],['cli-live-pixi-canvas/attached.png','CLI fixture service -> headless browser attachment'],['cli-live-pixi-canvas/contact-gap.png','Viewer contact gap preserves recorded outcome'],['cli-live-pixi-canvas/reattached.png','Reopened viewer backfills while owner continues'],['cli-live-pixi-canvas/terminal.png','Explicit terminal report, rather than inferred success']];
await writeFile('evidence/product-index.html',`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PigeonCoop product renderer verdict</title><style>body{font:15px/1.6 Segoe UI,sans-serif;max-width:1250px;margin:35px auto;padding:0 24px;background:#f6f2e8;color:#29463a}h1,h2{font-family:Georgia,serif;font-weight:normal}p{max-width:900px}.verdict{padding:18px 22px;border-left:4px solid #60834f;background:#e5ead8}section{display:grid;grid-template-columns:1fr 1fr;gap:26px}figure{margin:0}img{width:100%;display:block;border:1px solid #cdd2bb}figcaption{font-size:12px;padding:7px 0;color:#5e7055}a{color:#356249}.limit{border-left:4px solid #ae7848;padding-left:16px}@media(max-width:800px){section{grid-template-columns:1fr}}</style><h1>The product recommendation</h1><p>October 27, 2026 · bounded synthetic experiments · all visual checks hidden</p><p class="verdict"><strong>HTML/React + PixiJS Canvas, with one deterministic Rust presentation core compiled to WASM for browser/Tauri.</strong> Keep the recorder/CLI headless and viewers optional. Keep assets in renderer-neutral PNG + JSON.</p><p>Recommended Pixi Canvas submissions were about 1.4–2.9 ms at p95, including the Rust/WASM and packed-atlas path. Shared Rust sampling, real editor batch exports, packed-sheet registration, native Linux drawing, Linux Tauri and CLI-to-browser detach/reconnect have working evidence. The WebKit/software Pixi WebGL configuration visibly fails and remains a recorded failure.</p><p class="limit">Recommendation, not release approval: native Windows executables/WebView2 remain blocked or unverified. WSL/Xvfb is software graphics, not physical Linux hardware qualification. Final character directions and dense layouts need design work.</p><p><a href="../PRODUCT_VERDICT.md">Full verdict, measurements, alternatives and remaining gates</a> · <a href="image-conformance.json">Atlas pixel conformance</a></p><h2>Review captures</h2><section>${shots.map(([file,label])=>`<figure><a href="${file}"><img loading="lazy" src="${file}" alt="${label}"></a><figcaption>${label}</figcaption></figure>`).join('')}</section></html>`);
console.log('Wrote PRODUCT_VERDICT.md and curated product-index.html.');
