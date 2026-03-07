// Vitest global test setup.
// Mock @tauri-apps/api so component tests never hit the real Rust backend.
// See docs/TESTING.md §2 for the full mock pattern.

import { vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));
