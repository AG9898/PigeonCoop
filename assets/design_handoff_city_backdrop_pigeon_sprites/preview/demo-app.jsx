/* global React, ReactDOM, drawCityTile, NIGHT_PALETTE, TILE_SIZE,
          TweaksPanel, useTweaks, TweakSection, TweakSlider, TweakToggle, TweakSelect */

// =============================================================================
// PigeonCoop — Canvas Backdrop Demo
// -----------------------------------------------------------------------------
// Mocks the WorkflowCanvas pan/zoom surface so the pixel-art city backdrop can
// be evaluated with placeholder pigeon-agent nodes for scale.
// =============================================================================

const { useEffect, useRef, useState, useMemo, useCallback } = React;

// -----------------------------------------------------------------------------
// City tile cache — render once per (seed, palette) to a data URL.
// -----------------------------------------------------------------------------

function useCityTile(seed, palette) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    const canvas = document.createElement("canvas");
    canvas.width = TILE_SIZE;
    canvas.height = TILE_SIZE;
    const ctx = canvas.getContext("2d");
    drawCityTile(ctx, { seed, palette });
    setUrl(canvas.toDataURL("image/png"));
  }, [seed, palette]);
  return url;
}

// -----------------------------------------------------------------------------
// Minimal pan/zoom hook — mimics React Flow's viewport.
// -----------------------------------------------------------------------------

function usePanZoom(initial = { x: 0, y: 0, zoom: 1 }) {
  const [viewport, setViewport] = useState(initial);
  const stageRef = useRef(null);
  const drag = useRef(null);

  const onMouseDown = useCallback((e) => {
    if (e.button !== 0 && e.button !== 1) return;
    if (e.target.closest(".agent-node") || e.target.closest(".tweaks-panel")) return;
    drag.current = { sx: e.clientX, sy: e.clientY, vx: viewport.x, vy: viewport.y };
    stageRef.current?.classList.add("dragging");
  }, [viewport.x, viewport.y]);

  useEffect(() => {
    const onMove = (e) => {
      if (!drag.current) return;
      const dx = e.clientX - drag.current.sx;
      const dy = e.clientY - drag.current.sy;
      setViewport((v) => ({ ...v, x: drag.current.vx + dx, y: drag.current.vy + dy }));
    };
    const onUp = () => {
      drag.current = null;
      stageRef.current?.classList.remove("dragging");
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const onWheel = useCallback((e) => {
    e.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    setViewport((v) => {
      // Zoom around cursor
      const factor = Math.exp(-e.deltaY * 0.0015);
      const newZoom = Math.max(0.2, Math.min(3, v.zoom * factor));
      const k = newZoom / v.zoom;
      return {
        zoom: newZoom,
        x: mx - (mx - v.x) * k,
        y: my - (my - v.y) * k,
      };
    });
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [onWheel]);

  const resetTo = useCallback((v) => setViewport(v), []);

  return { viewport, stageRef, onMouseDown, resetTo };
}

// -----------------------------------------------------------------------------
// Pigeon glyph (placeholder, top-down, 32×32-ish viewBox).
// -----------------------------------------------------------------------------

function PigeonGlyph({ accent = "#8a93a6" }) {
  // Top-down pigeon: oval body, head bump, two wing-tips, tail.
  return (
    <svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" shapeRendering="crispEdges">
      {/* Shadow */}
      <rect x="6" y="22" width="22" height="6" fill="#000" opacity="0.35" />
      {/* Body */}
      <g fill={accent}>
        <rect x="10" y="10" width="14" height="2" />
        <rect x="9"  y="12" width="16" height="2" />
        <rect x="8"  y="14" width="18" height="6" />
        <rect x="9"  y="20" width="16" height="2" />
        <rect x="11" y="22" width="12" height="1" />
      </g>
      {/* Wing markings */}
      <g fill="#4a5266">
        <rect x="10" y="15" width="14" height="1" />
        <rect x="11" y="17" width="12" height="1" />
      </g>
      {/* Head */}
      <g fill={accent}>
        <rect x="14" y="5"  width="6" height="2" />
        <rect x="13" y="7"  width="8" height="3" />
      </g>
      {/* Beak */}
      <rect x="16" y="4"  width="2" height="2" fill="#e8a032" />
      {/* Eye */}
      <rect x="15" y="8" width="1" height="1" fill="#0d0f14" />
      <rect x="18" y="8" width="1" height="1" fill="#0d0f14" />
      {/* Tail */}
      <g fill={accent}>
        <rect x="13" y="23" width="2" height="3" />
        <rect x="17" y="23" width="2" height="3" />
        <rect x="15" y="22" width="2" height="4" />
      </g>
      {/* Highlight on head */}
      <rect x="14" y="6" width="1" height="1" fill="#c8cdd8" opacity="0.6" />
    </svg>
  );
}

// -----------------------------------------------------------------------------
// Placeholder agent node.
// -----------------------------------------------------------------------------

const STATE_ACCENTS = {
  idle:      "#8a93a6",
  running:   "#5fa0c8",
  succeeded: "#4ec07a",
  failed:    "#d65a45",
  paused:    "#e8a032",
};

function AgentNode({ x, y, label, state = "idle", contextPct = null }) {
  const accent = STATE_ACCENTS[state] ?? STATE_ACCENTS.idle;
  return (
    <div
      className="agent-node"
      data-state={state}
      style={{ left: x, top: y }}
    >
      <div className="agent-node-sprite">
        <div className="agent-node-pigeon">
          <PigeonGlyph accent={accent} />
        </div>
        {contextPct != null && (
          <div className="agent-node-context-bar">
            <div
              style={{
                width: `${contextPct}%`,
                background: contextPct < 60 ? "#4ec07a"
                          : contextPct < 85 ? "#e8a032"
                          : "#d65a45",
              }}
            />
          </div>
        )}
      </div>
      <div className="agent-node-footer">
        {label}<span className="state">{state}</span>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Edges layer (decorative — shows the workflow connection style on top of city).
// -----------------------------------------------------------------------------

function EdgesLayer({ nodes, edges }) {
  const byId = useMemo(() => Object.fromEntries(nodes.map((n) => [n.id, n])), [nodes]);
  return (
    <svg className="edges-layer">
      {edges.map((e, i) => {
        const a = byId[e.from];
        const b = byId[e.to];
        if (!a || !b) return null;
        const x1 = a.x + 43, y1 = a.y + 86;
        const x2 = b.x + 43, y2 = b.y;
        const mid = (y1 + y2) / 2;
        const d = `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`;
        return <path key={i} d={d} />;
      })}
    </svg>
  );
}

// -----------------------------------------------------------------------------
// Mini-map — shows the full tile with a viewport rectangle overlay.
// -----------------------------------------------------------------------------

function MiniMap({ tileURL, viewport }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !tileURL) return;
    c.width = 192;
    c.height = 192;
    const ctx = c.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    const img = new Image();
    img.onload = () => {
      // Draw the tile centered in the minimap
      ctx.fillStyle = "#0e1015";
      ctx.fillRect(0, 0, 192, 192);
      ctx.drawImage(img, 0, 0, 192, 192);

      // Overlay viewport rectangle. The viewport, in world coords, covers
      // (-vx/zoom .. (window.w - vx)/zoom) × (-vy/zoom .. (window.h - vy)/zoom).
      const worldW = window.innerWidth / viewport.zoom;
      const worldH = window.innerHeight / viewport.zoom;
      const wx = -viewport.x / viewport.zoom;
      const wy = -viewport.y / viewport.zoom;
      const scale = 192 / TILE_SIZE;
      ctx.strokeStyle = "#5fa0c8";
      ctx.lineWidth = 1;
      ctx.strokeRect(
        (wx % TILE_SIZE) * scale,
        (wy % TILE_SIZE) * scale,
        worldW * scale,
        worldH * scale,
      );
    };
    img.src = tileURL;
  }, [tileURL, viewport]);

  return (
    <div className="minimap">
      <div className="minimap-label">TILE PREVIEW · 1024 × 1024</div>
      <canvas ref={canvasRef} />
    </div>
  );
}

// -----------------------------------------------------------------------------
// Sample workflow — placed on a single tile so the user can see scale.
// Coordinates are world-space (within one tile, 0..1024).
// -----------------------------------------------------------------------------

const SAMPLE_NODES = [
  // Plan -> Execute Tool -> Critique -> Approve  (canonical demo workflow)
  { id: "start",    x:  80,  y:  80,  label: "Start",        state: "succeeded" },
  { id: "plan",     x: 220,  y: 230,  label: "Plan",         state: "succeeded", contextPct: 42 },
  { id: "execute",  x: 470,  y: 380,  label: "Execute",      state: "running",   contextPct: 73 },
  { id: "critique", x: 700,  y: 230,  label: "Critique",     state: "idle",      contextPct: null },
  { id: "approve",  x: 700,  y: 600,  label: "Approve",      state: "paused" },
  { id: "tools",    x: 320,  y: 620,  label: "Run Tests",    state: "failed",    contextPct: 91 },
  { id: "memory",   x: 120,  y: 780,  label: "Memory",       state: "idle" },
  { id: "end",      x: 880,  y: 820,  label: "End",          state: "idle" },
];

const SAMPLE_EDGES = [
  { from: "start",    to: "plan" },
  { from: "plan",     to: "execute" },
  { from: "execute",  to: "critique" },
  { from: "execute",  to: "tools" },
  { from: "critique", to: "approve" },
  { from: "tools",    to: "memory" },
  { from: "approve",  to: "end" },
  { from: "memory",   to: "end" },
];

// -----------------------------------------------------------------------------
// Main app.
// -----------------------------------------------------------------------------

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "seed": 1729,
  "showGrid": true,
  "showVignette": true,
  "showNodes": true,
  "showEdges": true,
  "showTileBounds": false,
  "showMinimap": true
}/*EDITMODE-END*/;

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);

  const tileURL = useCityTile(t.seed, NIGHT_PALETTE);
  const { viewport, stageRef, onMouseDown, resetTo } = usePanZoom({
    // Start centered on the first tile, slightly zoomed in
    x: -120, y: -60, zoom: 0.85,
  });

  // Live HUD readout
  const worldCenter = useMemo(() => ({
    x: Math.round((window.innerWidth / 2 - viewport.x) / viewport.zoom),
    y: Math.round((window.innerHeight / 2 - viewport.y) / viewport.zoom),
  }), [viewport]);

  if (!tileURL) return <div className="loading">Painting the city</div>;

  return (
    <>
      <div
        className="stage"
        ref={stageRef}
        onMouseDown={onMouseDown}
      >
        <div
          className="stage-viewport"
          style={{
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
          }}
        >
          <div
            className="city-backdrop"
            style={{ backgroundImage: `url(${tileURL})` }}
          />
          {t.showGrid && <div className="grid-overlay" />}
          {t.showTileBounds && <div className="tile-debug" />}

          {t.showEdges && t.showNodes && (
            <EdgesLayer nodes={SAMPLE_NODES} edges={SAMPLE_EDGES} />
          )}
          {t.showNodes && SAMPLE_NODES.map((n) => (
            <AgentNode key={n.id} {...n} />
          ))}
        </div>
      </div>

      {t.showVignette && <div className="world-vignette" />}

      {/* HUD */}
      <div className="hud-corner hud-tl">
        <div className="hud-panel">
          <div className="hud-title">PIGEONCOOP · CANVAS BACKDROP</div>
          <div className="hud-subtitle">
            Pixel-art city tile · 1024 × 1024 · seamless
            &nbsp;·&nbsp;
            <a
              href="Pigeon Sprites.html"
              style={{ color: "#5fa0c8", textDecoration: "none", pointerEvents: "auto" }}
            >→ Agent sprites</a>
          </div>
        </div>
      </div>

      <div className="hud-corner hud-tr">
        <div className="hud-panel">
          <span className="label">Viewport</span>
          <span className="value">
            x {worldCenter.x}  y {worldCenter.y}  · {(viewport.zoom * 100).toFixed(0)}%
          </span>
        </div>
      </div>

      <div className="hud-corner hud-bl">
        <div className="hud-hint">
          <span><kbd>drag</kbd> pan</span>
          <span><kbd>wheel</kbd> zoom</span>
          <span style={{ color: "#5fa0c8" }}>
            Try zooming out to see the seamless tile join
          </span>
        </div>
      </div>

      {t.showMinimap && tileURL && <MiniMap tileURL={tileURL} viewport={viewport} />}

      {/* Tweaks panel */}
      <TweaksPanel title="Tweaks">
        <TweakSection title="Tile">
          <TweakSlider
            label="Seed"
            min={1}
            max={9999}
            step={1}
            value={t.seed}
            onChange={(v) => setTweak("seed", v)}
          />
        </TweakSection>
        <TweakSection title="Overlays">
          <TweakToggle
            label="48px tactical grid"
            checked={t.showGrid}
            onChange={(v) => setTweak("showGrid", v)}
          />
          <TweakToggle
            label="Center vignette"
            checked={t.showVignette}
            onChange={(v) => setTweak("showVignette", v)}
          />
          <TweakToggle
            label="Tile boundaries (debug)"
            checked={t.showTileBounds}
            onChange={(v) => setTweak("showTileBounds", v)}
          />
          <TweakToggle
            label="Mini-map"
            checked={t.showMinimap}
            onChange={(v) => setTweak("showMinimap", v)}
          />
        </TweakSection>
        <TweakSection title="Scale reference">
          <TweakToggle
            label="Show pigeon agent nodes (86×86 px)"
            checked={t.showNodes}
            onChange={(v) => setTweak("showNodes", v)}
          />
          <TweakToggle
            label="Show workflow edges"
            checked={t.showEdges}
            onChange={(v) => setTweak("showEdges", v)}
          />
        </TweakSection>
        <TweakSection title="View">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button className="tweak-btn" onClick={() => resetTo({ x: -120, y: -60, zoom: 0.85 })}>
              Centered (85%)
            </button>
            <button className="tweak-btn" onClick={() => resetTo({ x: 0, y: 0, zoom: 1 })}>
              1 : 1
            </button>
            <button className="tweak-btn" onClick={() => resetTo({
              x: -TILE_SIZE * 0.25, y: -TILE_SIZE * 0.25, zoom: 0.5,
            })}>
              4 tiles (50%)
            </button>
            <button className="tweak-btn" onClick={() => resetTo({
              x: -TILE_SIZE * 0.5, y: -TILE_SIZE * 0.5, zoom: 0.25,
            })}>
              16 tiles (25%)
            </button>
            <button className="tweak-btn" onClick={() => resetTo({ x: -200, y: -200, zoom: 2.0 })}>
              Zoom in (200%)
            </button>
          </div>
        </TweakSection>
      </TweaksPanel>
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
