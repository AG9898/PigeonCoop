// Vitest global test setup.
// Mock @tauri-apps/api so component tests never hit the real Rust backend.
// See docs/TESTING.md §2 for the full mock pattern.

import { vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// Mock reactflow: jsdom lacks ResizeObserver and SVG APIs required by the
// real library. Tests that exercise the canvas mount it as a plain div.
vi.mock("reactflow", () => ({
  default: ({ children }: { children?: unknown }) => children ?? null,
  Background: () => null,
  BackgroundVariant: { Dots: "dots", Lines: "lines", Cross: "cross" },
  Controls: () => null,
  MiniMap: () => null,
  Handle: () => null,
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  useNodesState: (init: unknown[]) => [init, vi.fn(), vi.fn()],
  useEdgesState: (init: unknown[]) => [init, vi.fn(), vi.fn()],
  addEdge: vi.fn((_params: unknown, edges: unknown[]) => edges),
}));
