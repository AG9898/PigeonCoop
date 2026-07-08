// loader.js — fetches cityDrawing.ts AND demo-app.jsx, transforms both via
// in-browser Babel, then evaluates them in order. Single entry point so we
// avoid babel-standalone's "only scans on initial page load" limitation.

(async () => {
  const errBanner = (msg) => {
    const root = document.getElementById("root");
    if (root) root.innerHTML =
      `<div style="padding:24px;color:#d65a45;font-family:ui-monospace,monospace;font-size:13px">
        <h2 style="margin:0 0 12px;color:#d65a45">Backdrop demo failed to load</h2>
        <pre style="white-space:pre-wrap">${msg}</pre>
      </div>`;
  };

  const fetchText = async (path) => {
    const r = await fetch(path);
    if (!r.ok) throw new Error(`fetch ${path} failed (${r.status})`);
    return r.text();
  };

  try {
    // 1) Load the source TS for the drawing module.
    const tsSrc = await fetchText("apps/desktop/src/components/canvas/cityDrawing.ts");

    // Strip TypeScript types via Babel (interfaces, type aliases, annotations).
    const tsTransformed = Babel.transform(tsSrc, {
      presets: ["typescript"],
      filename: "cityDrawing.ts",
    }).code;

    // Turn `export <decl>` into plain `<decl>` so we can eval as a script.
    const tsCode = tsTransformed.replace(
      /^export\s+(const|function|class|let|var|async\s+function)/gm,
      "$1"
    );

    const hoist = `
      window.drawCityTile  = drawCityTile;
      window.NIGHT_PALETTE = NIGHT_PALETTE;
      window.TILE_SIZE     = TILE_SIZE;
      window.EDGE_STREET   = EDGE_STREET;
      window.SIDEWALK      = SIDEWALK;
      window.BLOCK         = BLOCK;
      window.MID_STREET    = MID_STREET;
      window.mulberry32    = mulberry32;
    `;
    new Function(tsCode + "\n" + hoist)();

    // 2) Tweaks-panel.jsx — load + transform + eval.
    const tweaksSrc = await fetchText("tweaks-panel.jsx");
    const tweaksTransformed = Babel.transform(tweaksSrc, {
      presets: ["env", "react"],
      filename: "tweaks-panel.jsx",
    }).code;
    new Function(tweaksTransformed)();

    // 3) Demo app — load + transform + eval.
    const appSrc = await fetchText("demo-app.jsx");
    const appTransformed = Babel.transform(appSrc, {
      presets: ["env", "react"],
      filename: "demo-app.jsx",
    }).code;
    new Function(appTransformed)();
  } catch (err) {
    console.error(err);
    errBanner((err && err.message ? err.message : String(err)) + "\n\n" + (err && err.stack ? err.stack : ""));
  }
})();
