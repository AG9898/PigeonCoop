// CityBackdrop.tsx
// -----------------------------------------------------------------------------
// Pixel-art night cityscape backdrop for the React Flow canvas.
//
// Renders the procedural city tile from cityDrawing.ts to an offscreen canvas
// once on mount, then exports it to a data URL used as a `background-image`
// on a positioned <div>. The <div> sits *behind* the React Flow canvas, with
// `image-rendering: pixelated` so it stays crisp at any React Flow zoom level.
//
// Usage (inside WorkflowCanvas.tsx, behind <ReactFlow>):
//
//   <CityBackdrop seed={1729} />
//   <ReactFlow ...>
//     {/* drop the React Flow <Background> entirely — the grid overlay is in
//         the existing .app rule in global.css and stays on top */}
//   </ReactFlow>
//
// React Flow's transform (pan + zoom) is applied to the `.react-flow__viewport`
// element. To make the backdrop pan with the canvas, mount this component
// inside <ReactFlow> and consume the viewport via `useViewport()` from
// `reactflow`. The <CityBackdropViewportSynced> variant below does that.
// -----------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { useViewport } from "reactflow";
import {
  drawCityTile,
  NIGHT_PALETTE,
  TILE_SIZE,
  type CityPalette,
} from "./cityDrawing";

export interface CityBackdropProps {
  seed?: number;
  palette?: CityPalette;
  /** Optional class hook for additional styling. */
  className?: string;
}

/**
 * Renders the city tile and exposes the resulting data URL. Caches per
 * (seed, palette) so repeated mounts don't redraw.
 */
function useCityTileDataURL(seed: number, palette: CityPalette): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const canvas = document.createElement("canvas");
    canvas.width = TILE_SIZE;
    canvas.height = TILE_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawCityTile(ctx, { seed, palette });
    // toDataURL is synchronous but heavy; defer for one frame so mount is snappy
    requestAnimationFrame(() => {
      if (cancelled) return;
      setUrl(canvas.toDataURL("image/png"));
    });
    return () => {
      cancelled = true;
    };
  }, [seed, palette]);

  return url;
}

/**
 * Static (no pan/zoom sync) — paints a tiled background that fills the parent.
 * Use when you just want the texture and don't care about lining up with
 * React Flow's transform.
 */
export function CityBackdrop({ seed = 1729, palette = NIGHT_PALETTE, className }: CityBackdropProps) {
  const url = useCityTileDataURL(seed, palette);

  return (
    <div
      className={`city-backdrop ${className ?? ""}`.trim()}
      aria-hidden="true"
      style={{
        backgroundImage: url ? `url(${url})` : undefined,
      }}
    />
  );
}

/**
 * Pan/zoom-synced variant — must be mounted *inside* <ReactFlow> (so it has
 * access to the viewport). Translates and scales the background to track the
 * viewport transform, so panning the canvas pans the city.
 *
 * The CSS keeps `background-repeat: repeat` and updates `background-position`
 * + `background-size` from the React Flow viewport.
 */
export function CityBackdropViewportSynced({
  seed = 1729,
  palette = NIGHT_PALETTE,
  className,
}: CityBackdropProps) {
  const url = useCityTileDataURL(seed, palette);
  const { x, y, zoom } = useViewport();

  const tileSize = TILE_SIZE * zoom;

  return (
    <div
      className={`city-backdrop city-backdrop--synced ${className ?? ""}`.trim()}
      aria-hidden="true"
      style={{
        backgroundImage: url ? `url(${url})` : undefined,
        backgroundSize: `${tileSize}px ${tileSize}px`,
        backgroundPosition: `${x}px ${y}px`,
      }}
    />
  );
}

/**
 * Bare canvas (no DOM cost of data-URL round-trip) — renders straight to a
 * <canvas> element. Use this if you want to layer additional animated draw
 * passes on top (e.g. flickering windows, moving pigeon dots) later.
 */
export function CityBackdropCanvas({ seed = 1729, palette = NIGHT_PALETTE, className }: CityBackdropProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.width = TILE_SIZE;
    canvas.height = TILE_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawCityTile(ctx, { seed, palette });
  }, [seed, palette]);

  return (
    <canvas
      ref={ref}
      className={`city-backdrop-canvas ${className ?? ""}`.trim()}
      aria-hidden="true"
      width={TILE_SIZE}
      height={TILE_SIZE}
    />
  );
}
