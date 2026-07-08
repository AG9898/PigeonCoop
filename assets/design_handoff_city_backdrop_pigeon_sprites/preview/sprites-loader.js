// sprites-loader.js — fetches cityDrawing.ts + pigeonDrawing.ts + the React
// app, strips TypeScript, evaluates everything in order.

(async () => {
  const errBanner = (msg) => {
    const root = document.getElementById("root");
    if (root) root.innerHTML =
      `<div style="padding:24px;color:#d65a45;font-family:ui-monospace,monospace;font-size:13px">
        <h2 style="margin:0 0 12px;color:#d65a45">Sprite canvas failed to load</h2>
        <pre style="white-space:pre-wrap">${msg}</pre>
      </div>`;
  };

  const fetchText = async (path) => {
    const r = await fetch(path);
    if (!r.ok) throw new Error(`fetch ${path} failed (${r.status})`);
    return r.text();
  };

  const stripExports = (code) =>
    code.replace(
      /^export\s+(const|function|class|let|var|async\s+function)/gm,
      "$1",
    );

  const evalTs = async (path, hoistList) => {
    const src = await fetchText(path);
    const transformed = Babel.transform(src, {
      presets: ["typescript"],
      filename: path,
    }).code;
    const code = stripExports(transformed);
    const hoist = hoistList.map((n) => `window.${n} = ${n};`).join("\n");
    new Function(code + "\n" + hoist)();
  };

  try {
    // 1) City drawing (needed for backdrop)
    await evalTs(
      "apps/desktop/src/components/canvas/cityDrawing.ts",
      ["drawCityTile", "NIGHT_PALETTE", "TILE_SIZE", "mulberry32"],
    );

    // 2) Pigeon drawing
    await evalTs(
      "apps/desktop/src/components/canvas/pigeonDrawing.ts",
      ["drawPigeon", "PIGEON_PALETTE", "NECK_BY_STATE", "NATIVE_W", "NATIVE_H", "poseForState"],
    );

    // 3) React app
    const appSrc = await fetchText("sprites-app.jsx");
    const appTransformed = Babel.transform(appSrc, {
      presets: ["env", "react"],
      filename: "sprites-app.jsx",
    }).code;
    new Function(appTransformed)();
  } catch (err) {
    console.error(err);
    errBanner((err && err.message ? err.message : String(err)) + "\n\n" + (err && err.stack ? err.stack : ""));
  }
})();
