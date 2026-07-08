/* global React, ReactDOM,
          drawCityTile, NIGHT_PALETTE, TILE_SIZE,
          drawPigeon, PIGEON_PALETTE, NECK_BY_STATE, NATIVE_W, NATIVE_H, poseForState */

// =============================================================================
// Pigeon Sprite Canvas
// -----------------------------------------------------------------------------
// A focused page for closely visualizing the procedural pixel-art pigeon
// against the actual city backdrop, with no surrounding container frame.
// =============================================================================

const { useEffect, useRef, useState, useMemo, useCallback } = React;

// -----------------------------------------------------------------------------
// City backdrop tile (cached).
// -----------------------------------------------------------------------------

function useCityTile(seed) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    const canvas = document.createElement("canvas");
    canvas.width = TILE_SIZE;
    canvas.height = TILE_SIZE;
    const ctx = canvas.getContext("2d");
    drawCityTile(ctx, { seed, palette: NIGHT_PALETTE });
    setUrl(canvas.toDataURL("image/png"));
  }, [seed]);
  return url;
}

// -----------------------------------------------------------------------------
// Animation tick (drives wing/leg cycle).
// -----------------------------------------------------------------------------

function useAnimationTick(running = true) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!running) return;
    let raf;
    let last = performance.now();
    const loop = (t) => {
      // ~10 ticks/s
      if (t - last > 100) {
        setTick((v) => v + 1);
        last = t;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [running]);
  return tick;
}

// -----------------------------------------------------------------------------
// Pigeon canvas — renders the sprite at a given scale, sized exactly to fit.
// No surrounding frame. The animation tick drives pose selection per state.
// -----------------------------------------------------------------------------

function PigeonCanvas({ scale, state, frame, flipped = false, palette }) {
  const ref = useRef(null);
  // Native sprite is 26×24. Pad ~2 cells on each side for shadow + drop-shadow
  // and to allow hop/down pose y-offsets without clipping.
  const padX = 2;
  const padY = 3;
  const width  = (NATIVE_W + padX * 2) * scale;
  const height = (NATIVE_H + padY * 2) * scale;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, width, height);
    const pose = poseForState(state, frame);
    drawPigeon(ctx, {
      x: padX * scale,
      y: padY * scale,
      scale,
      pose,
      state,
      flipped,
      palette,
    });
  }, [scale, state, frame, flipped, palette, width, height]);

  return (
    <canvas
      ref={ref}
      className={scale >= 8 ? "hero-canvas" : "state-canvas"}
      width={width}
      height={height}
      style={{ width, height }}
    />
  );
}

// -----------------------------------------------------------------------------
// State row — every state at native(ish) scale, on the same baseline.
// -----------------------------------------------------------------------------

const STATES = [
  "idle",
  "queued",
  "running",
  "waiting",
  "paused",
  "succeeded",
  "failed",
  "skipped",
];

function StateRow({ scale, frame, animate, palette }) {
  return (
    <div className="state-row">
      {STATES.map((s) => (
        <div className="state-tile" key={s}>
          <PigeonCanvas
            scale={scale}
            state={s}
            frame={animate ? frame : 0}
            palette={palette}
          />
          <div className="state-label">
            <span
              className="state-color"
              style={{ "--c": NECK_BY_STATE[s].hi }}
            />
            {s}
          </div>
        </div>
      ))}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Inspector sidebar — palette swatches + controls.
// -----------------------------------------------------------------------------

function Inspector({
  heroState, setHeroState,
  heroScale, setHeroScale,
  rowScale, setRowScale,
  animate, setAnimate,
  showBackdrop, setShowBackdrop,
  showGrid, setShowGrid,
  flipped, setFlipped,
  palette,
}) {
  return (
    <aside className="inspector">

      <div className="insp-section">
        <h3 className="insp-title">Hero pose</h3>
        <div className="btn-row">
          {STATES.map((s) => (
            <button
              key={s}
              className={`opt-btn ${heroState === s ? "active" : ""}`}
              onClick={() => setHeroState(s)}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="insp-section">
        <h3 className="insp-title">Scale</h3>
        <div className="range-row">
          <div className="row-head">
            <span>Hero scale</span>
            <span className="v">{heroScale}×</span>
          </div>
          <input
            type="range"
            min={4} max={16} step={1}
            value={heroScale}
            onChange={(e) => setHeroScale(+e.target.value)}
          />
          <div className="note">
            Native sprite is {NATIVE_W}×{NATIVE_H} px. At {heroScale}× that's{" "}
            {NATIVE_W * heroScale}×{NATIVE_H * heroScale} px.
          </div>
        </div>
        <div className="range-row">
          <div className="row-head">
            <span>State-row scale</span>
            <span className="v">{rowScale}×</span>
          </div>
          <input
            type="range"
            min={2} max={6} step={1}
            value={rowScale}
            onChange={(e) => setRowScale(+e.target.value)}
          />
        </div>
      </div>

      <div className="insp-section">
        <h3 className="insp-title">Display</h3>
        <label className="toggle-row">
          <span>Animate</span>
          <input
            type="checkbox"
            checked={animate}
            onChange={(e) => setAnimate(e.target.checked)}
          />
        </label>
        <label className="toggle-row">
          <span>City backdrop</span>
          <input
            type="checkbox"
            checked={showBackdrop}
            onChange={(e) => setShowBackdrop(e.target.checked)}
          />
        </label>
        <label className="toggle-row">
          <span>Reference grid</span>
          <input
            type="checkbox"
            checked={showGrid}
            onChange={(e) => setShowGrid(e.target.checked)}
          />
        </label>
        <label className="toggle-row">
          <span>Flip horizontal</span>
          <input
            type="checkbox"
            checked={flipped}
            onChange={(e) => setFlipped(e.target.checked)}
          />
        </label>
      </div>

      <div className="insp-section">
        <h3 className="insp-title">Body palette</h3>
        <div className="insp-grid">
          <Swatch name="body"      color={palette.body} />
          <Swatch name="body-hi"   color={palette.bodyHi} />
          <Swatch name="belly"     color={palette.belly} />
          <Swatch name="body-dark" color={palette.bodyDark} />
          <Swatch name="outline"   color={palette.outline} />
          <Swatch name="beak"      color={palette.beak} />
          <Swatch name="foot"      color={palette.foot} />
          <Swatch name="foot-hi"   color={palette.footHi} />
        </div>
      </div>

      <div className="insp-section">
        <h3 className="insp-title">State neck-patch tints</h3>
        <div className="insp-grid">
          {STATES.map((s) => (
            <Swatch key={s} name={s} color={NECK_BY_STATE[s].hi} />
          ))}
        </div>
        <div className="note">
          The pigeon's iridescent neck patch (the most distinctive marking on
          a real rock pigeon) carries the run-state color — so the sprite
          itself signals state. No surrounding frame or halo needed.
        </div>
      </div>

      <div className="insp-section">
        <h3 className="insp-title">Spec</h3>
        <div className="note">
          • Native grid {NATIVE_W} × {NATIVE_H} px<br/>
          • Side-view, faces right by default<br/>
          • Poses: idle / idle-up / step-A / step-B / hop / down<br/>
          • Pure 2D canvas, no SVG, no images<br/>
          • Source: <code>src/components/canvas/pigeonDrawing.ts</code>
        </div>
      </div>

      <div className="insp-section">
        <h3 className="insp-title">Next</h3>
        <div className="note">
          Frame-strip export → 8 frames per animation as a horizontal WebP,
          matching the convention in <code>VISUAL_IDENTITY.md §2</code>.
          Ask when ready.
        </div>
      </div>
    </aside>
  );
}

function Swatch({ name, color }) {
  return (
    <div className="swatch">
      <span className="dot" style={{ background: color }} />
      <span className="name">{name}</span>
      <span className="hex">{color.replace("#", "").toUpperCase().slice(0, 6)}</span>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Main app
// -----------------------------------------------------------------------------

function App() {
  const [heroState, setHeroState]       = useState("running");
  const [heroScale, setHeroScale]       = useState(10);
  const [rowScale,  setRowScale]        = useState(3);
  const [animate,   setAnimate]         = useState(true);
  const [showBackdrop, setShowBackdrop] = useState(true);
  const [showGrid,  setShowGrid]        = useState(false);
  const [flipped,   setFlipped]         = useState(false);

  const tick = useAnimationTick(animate);
  const tileURL = useCityTile(1729);

  if (!tileURL) return <div className="loading">Preparing canvas</div>;

  // Hero pixel-grid overlay (when enabled) sized to the actual canvas.
  const heroPx = NATIVE_W * heroScale;
  const heroPy = NATIVE_H * heroScale;

  return (
    <div className="sprite-stage">
      <header className="app-header">
        <div>
          <div className="title">PIGEONCOOP · AGENT SPRITES</div>
          <div className="subtitle">
            Procedural pixel-art · {NATIVE_W}×{NATIVE_H} native · state-driven neck patch
          </div>
        </div>
        <nav>
          <a href="index.html">Canvas Backdrop</a>
          <a className="active">Agent Sprites</a>
        </nav>
      </header>

      <main className="viewer">
        {showBackdrop && (
          <div
            className="viewer-bg"
            style={{ backgroundImage: `url(${tileURL})` }}
          />
        )}
        <div className="viewer-vignette" />

        <div className="viewer-stack">
          <div className="hero-zone">
            <div style={{ position: "relative" }}>
              <PigeonCanvas
                scale={heroScale}
                state={heroState}
                frame={animate ? tick : 0}
                flipped={flipped}
              />
              {showGrid && (
                <PixelGrid
                  width={heroPx}
                  height={heroPy}
                  cell={heroScale}
                  paddingX={2 * heroScale}
                  paddingY={3 * heroScale}
                />
              )}
            </div>
            <div className="hero-caption">
              <strong>{heroState}</strong> &nbsp;·&nbsp; {heroScale}× &nbsp;·&nbsp;{" "}
              {NATIVE_W * heroScale} × {NATIVE_H * heroScale} px display
            </div>
          </div>

          <StateRow
            scale={rowScale}
            frame={tick}
            animate={animate}
          />
        </div>
      </main>

      <Inspector
        heroState={heroState}     setHeroState={setHeroState}
        heroScale={heroScale}     setHeroScale={setHeroScale}
        rowScale={rowScale}       setRowScale={setRowScale}
        animate={animate}         setAnimate={setAnimate}
        showBackdrop={showBackdrop} setShowBackdrop={setShowBackdrop}
        showGrid={showGrid}       setShowGrid={setShowGrid}
        flipped={flipped}         setFlipped={setFlipped}
        palette={PIGEON_PALETTE}
      />
    </div>
  );
}

// -----------------------------------------------------------------------------
// Pixel-grid reference overlay — thin lines at every native-pixel boundary.
// -----------------------------------------------------------------------------

function PixelGrid({ width, height, cell, paddingX, paddingY }) {
  // Drawn on a positioned <svg> aligned over the hero canvas.
  const lines = [];
  for (let x = 0; x <= width; x += cell) {
    lines.push(
      <line key={`v${x}`} x1={paddingX + x} x2={paddingX + x} y1={paddingY} y2={paddingY + height}
        stroke="rgba(95, 160, 200, 0.18)" strokeWidth="1" />
    );
  }
  for (let y = 0; y <= height; y += cell) {
    lines.push(
      <line key={`h${y}`} x1={paddingX} x2={paddingX + width} y1={paddingY + y} y2={paddingY + y}
        stroke="rgba(95, 160, 200, 0.18)" strokeWidth="1" />
    );
  }
  const totalW = width  + paddingX * 2;
  const totalH = height + paddingY * 2;
  return (
    <svg
      width={totalW}
      height={totalH}
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    >
      {lines}
      {/* Outer bounds */}
      <rect
        x={paddingX} y={paddingY}
        width={width} height={height}
        fill="none"
        stroke="rgba(95, 160, 200, 0.5)" strokeWidth="1"
      />
    </svg>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
