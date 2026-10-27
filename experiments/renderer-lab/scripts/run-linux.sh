#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
export CARGO_TARGET_DIR=/tmp/pigeoncoop-renderer-target
export PATH="$HOME/.cargo/bin:$PATH"
case "${1:-}" in
  core) cargo test --features native --lib; cargo run --bin export-fixture ;;
  native)
    cargo build --release --features native --bin native-scene
    xvfb-run -a -s '-screen 0 1280x800x24' env LIBGL_ALWAYS_SOFTWARE=1 PIGEONCOOP_PRIVATE_DISPLAY=1 "$CARGO_TARGET_DIR/release/native-scene"
    ;;
  webkit)
    for variant in "${@:2}"; do
      xvfb-run -a -s '-screen 0 1280x800x24' env LIBGL_ALWAYS_SOFTWARE=1 PIGEONCOOP_PRIVATE_DISPLAY=1 PIGEONCOOP_WEBKIT_VARIANT="$variant" PYTHONPATH=/tmp/pigeoncoop-python/usr/lib/python3/dist-packages PIGEONCOOP_GI_EXT=/tmp/pigeoncoop-python/usr/lib/python3/dist-packages/gi dbus-run-session -- python3 scripts/webkit-capture.py
    done
    ;;
  assets)
    mkdir -p evidence/asset-pipeline
    /tmp/pigeoncoop-libresprite/squashfs-root/AppRun -b assets/worker-a.aseprite --list-tags --sheet-type horizontal --format json-array --data evidence/asset-pipeline/worker-a.json --sheet evidence/asset-pipeline/worker-a.png
    /tmp/pigeoncoop-libresprite/squashfs-root/AppRun -b assets/worker-b.aseprite --list-tags --sheet-type packed --trim --format json-hash --data evidence/asset-pipeline/worker-b.json --sheet evidence/asset-pipeline/worker-b.png
    test -s evidence/asset-pipeline/worker-a.json
    test -s evidence/asset-pipeline/worker-b.json
    ;;
  *) echo 'Expected core, native, webkit <variants...>, or assets' >&2; exit 2 ;;
esac
