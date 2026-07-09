// Vitest global test setup.
// Mock @tauri-apps/api so component tests never hit the real Rust backend.
// See docs/TESTING.md §2 for the full mock pattern.

import { vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// Mock @tauri-apps/api/event so tests never hit the real Tauri event bus.
// listen() returns a no-op unlisten function; emit/once are stubs.
// Components that use listen() in effects should call unlisten on cleanup —
// these mocks let tests verify that contract without a live backend.
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
  once: vi.fn(() => Promise.resolve(() => {})),
  emit: vi.fn(() => Promise.resolve()),
}));

// Stub HTMLCanvasElement.prototype.getContext("2d"): jsdom does not implement
// a real 2D canvas context (would require the optional "canvas" npm
// package) and otherwise logs a noisy "Not implemented" error. Procedural
// sprite/backdrop components (pigeonDrawing.ts, cityDrawing.ts, DEC-008)
// draw with a small set of primitive calls — stub just enough that draw
// routines run to completion in tests without throwing.
if (typeof HTMLCanvasElement !== "undefined") {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    fillRect: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    set fillStyle(_v: unknown) {},
    get fillStyle() { return "#000"; },
    set globalAlpha(_v: unknown) {},
    get globalAlpha() { return 1; },
    set imageSmoothingEnabled(_v: unknown) {},
    get imageSmoothingEnabled() { return false; },
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.toDataURL = vi.fn(() => "data:image/png;base64,");
}

// Mock reactflow: jsdom lacks ResizeObserver and SVG APIs required by the
// real library. Tests that exercise the canvas mount it as a plain div.
vi.mock("reactflow", () => ({
  default: ({ children }: { children?: unknown }) => children ?? null,
  ReactFlowProvider: ({ children }: { children?: unknown }) => children,
  Background: () => null,
  BackgroundVariant: { Dots: "dots", Lines: "lines", Cross: "cross" },
  Controls: () => null,
  MiniMap: () => null,
  Handle: () => null,
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  useNodesState: (init: unknown[]) => {
    const setNodes = vi.fn();
    return [init, setNodes, vi.fn()];
  },
  useEdgesState: (init: unknown[]) => [init, vi.fn(), vi.fn()],
  addEdge: vi.fn((_params: unknown, edges: unknown[]) => edges),
  useReactFlow: (() => {
    // Shared singleton so hook and test code see the same spy instances.
    const instance = {
      project: vi.fn(({ x, y }: { x: number; y: number }) => ({ x, y })),
      getViewport: vi.fn(() => ({ x: 0, y: 0, zoom: 1 })),
      setViewport: vi.fn(),
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
      fitView: vi.fn(),
      getNodes: vi.fn(() => []),
      setNodes: vi.fn(),
    };
    return () => instance;
  })(),
  useViewport: () => ({ x: 0, y: 0, zoom: 1 }),
}));
