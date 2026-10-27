# Renderer and product integration experiment

Read [PRODUCT_VERDICT.md](PRODUCT_VERDICT.md) for the current recommendation,
measured results, asset pipeline, OS/CLI matrix, limitations and reproduction
commands. Open the [curated screenshot gallery](evidence/product-index.html) for
visual review. [REVIEW.md](REVIEW.md) retains the historical first round.

This isolated experiment is based on planning commit `9417a15`. It does not
change the production UI, recorder, execution state machine, canonical workboard
or accepted architecture. All workflow activity is synthetic.

## Windows browser checks

From this directory, using installed Edge (all launches are headless):

```powershell
npm.cmd ci
node scripts/prepare-assets.mjs
node --test scripts/fixture.test.mjs scripts/atlas-contract.test.mjs scripts/wasm.test.mjs scripts/session.test.mjs
node scripts/comparison.mjs
node scripts/integration-proof.mjs
node scripts/pixi-canvas-proof.mjs
node scripts/cli-viewer-proof.mjs --pixi-canvas
node scripts/product-review.mjs
```

The small exported test sheets and WASM artifact are retained with their source.
New screenshots/measurement JSON remain local under `evidence/`. Native Windows
Rust helpers still fail with OS error 5; no security policy was changed.
`scripts/Use-Toolchain.ps1` imports the portable compiler environment for one
process, without changing machine settings.

## Linux checks

Run `scripts/run-linux.sh core`, `native`, `assets`, or `webkit canvas-rust latest pixi-canvas`
through the approved WSL environment. The script contains the experiment's tool
locations. All graphics use private Xvfb displays; there is no visible fallback.
The WSL distribution named Ubuntu-22.04 currently reports Ubuntu 24.04.4.
WSL/software rendering is not Linux hardware or physical DPI/input qualification.

`scripts/tauri-proof.mjs` checks the existing Linux Tauri debug shell with the
fixture frontend on unused loopback port 1420 and isolated XDG data/config dirs.
Run it under Xvfb/dbus-run-session with `PIGEONCOOP_PRIVATE_DISPLAY=1` and
`LIBGL_ALWAYS_SOFTWARE=1`. The verdict documents extracted WebKit/Cairo tools.

## Scope limits

Rust sampling passes on Linux and as the same WASM module in Windows/Linux.
Canvas 2D, Pixi 8.21/8.22, Macroquad, real editor batch exports, browser/Tauri
viewing and a development CLI fixture service have been exercised. The production
CLI/MCP/recorder and a full terminal workspace are not implemented by this study.

Pixi's WebGL/WebKit/software path renders corrupted sprite data in the tested configuration.
The actual cause is unresolved. Pixi Canvas, direct Canvas/Rust/packed sheets and native Macroquad
render correctly. Do not generalize that result to all Linux GPUs; use the
captured pixel conformance evidence and explicit remaining release gates.

Fresh SVG and `.aseprite` files are editable test art inspired by V2, not final
production characters. Directional art, mirroring asymmetry and final choreography
remain unfinished. No retired RPG/city assets are imported.

The source branch contains a Windows-invalid root filename ending in a space.
This native checkout excludes it with sparse checkout; the source file was not
deleted and no global Git protection setting was changed.

The final recommended package/backend is **PixiJS 8.22 with Canvas selected
explicitly**, backed by the shared Rust sampler and HTML/React inspection.
The direct Canvas implementation remains a small test reference. WebGL is an
optional future acceleration route after platform-specific conformance.
Use `tauri-proof.mjs --pixi-canvas` for the recommended Linux shell proof.
Rebuilding the full verdict needs both Windows and Linux evidence files.

The Linux test tools were installed without sudo by extracting official Ubuntu
packages (`python3-cairo`, `python3-gi-cairo`, `webkit2gtk-driver`) with `dpkg-deb -x`
into `/tmp/pigeoncoop-python` and `/tmp/pigeoncoop-webkit-driver/extracted`.
The capture wrapper sets PYTHONPATH and the GI Cairo extension path explicitly.
LibreSprite 1.3 was downloaded from its official release and extracted under
`/tmp/pigeoncoop-libresprite`; its AppImage SHA256 was
`fd90bddda8135fe00f4a9a9c8c9ebd48f9b07e8782ab269be5c9efb1a851af30`.
These temp tools may need to be re-extracted after cleanup or restart.