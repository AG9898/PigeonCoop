# Renderer handoff — 2026-10-27

The user accepted **PixiJS 8.22 with Canvas selected explicitly as the WSL
prototype baseline** (DEC-016). Keep the HTML/React inspector and shared Rust
native/WASM visual sampler. This is not production migration or native Windows
release approval.

Start with [the findings](PRODUCT_VERDICT.md) and
[curated screenshots](evidence/product-index.html). The first-round
[REVIEW.md](REVIEW.md) is historical. The experiment, assets, raw measurements and
screenshots are committed so these references survive another checkout.

Verified:

- Nine Rust tests on Linux; seventeen Node tests on Windows and Linux.
- Shared approximately 71 KB Rust/WASM sampler; 2,328 sampled cases and 3,848
  native/reference snapshots; no per-actor Tauri IPC.
- Actual LibreSprite PNG+JSON export, unequal clip durations, full/trimmed atlas
  anchors, and six exact packed/unpacked frame comparisons.
- Pixi Canvas in Windows Edge, Linux WebKitGTK and the existing Linux Tauri shell.
- CLI fixture owner/viewer attachment, contact gap, reconnection/backfill and
  explicit completion. Viewer closure leaves the owner running.
- Whole scene, focused pair and selectable session list; the dense 100-sprite
  view fails readability, while the focus/list alternatives retain all records.

Known limits:

- Native Windows Rust helpers fail to execute with OS error 5 despite execute
  ACLs. Portable compiler/SDK installation succeeded; native runtime was not
  verified and security/endpoint policy was not changed.
- The WSL distro named Ubuntu-22.04 reports Ubuntu 24.04.4. Graphics ran on
  private Xvfb/software paths; physical Linux/Windows DPI/input and hardware
  qualification remain open.
- Pixi WebGL corrupts sprites in the tested WebKit/software configuration. This
  is a retained failed configuration, not a Pixi Canvas failure or a universal
  Linux GPU claim.
- Final art, up/down directions, satchel mirroring and polished paired clips
  remain unfinished. All activity is synthetic; the production recorder/CLI/MCP
  and a full TUI are outside this prototype.

Reproduction commands and per-user tool locations are in [README.md](README.md).
The source includes machine-specific probe paths, not portable distribution
scripts. Linux tools under `/tmp` may need to be re-extracted after restart.
Use headless browsers/private displays throughout; never silently launch on the
user's visible desktop.

Next: iterate on this WSL baseline, establish the versioned asset/presentation
boundary and production-quality registered art, then plan production integration
against DEC-014/015/016. Native Windows and physical platform verification remain
separate work. No canonical workboard tasks were inserted or marked complete.

The comparison viewer now defaults to the accepted Pixi Canvas 8.22 + Rust/WASM + packed-atlas configuration. Reference WebGL/JS/untrimmed probes select their alternatives explicitly. The no-query default was captured on WSL in evidence/linux-webkit-checkpoint/.
