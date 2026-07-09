// PigeonSprite — canvas smoke test + poseForState mapping test.
//
// jsdom does not implement a real 2D canvas context, so these tests verify
// the component renders the expected <canvas> element (crisp, correctly
// sized, no surrounding frame) rather than pixel output. The pose-selection
// logic itself (poseForState) is pure and tested directly against the
// integrated pigeonDrawing.ts module — see docs/VISUAL_IDENTITY.md §3 for
// the state-to-cadence contract this mirrors.

import { render } from "@testing-library/react";
import PigeonSprite from "../components/nodes/PigeonSprite";
import { poseForState, NATIVE_W, NATIVE_H } from "../components/canvas/pigeonDrawing";

describe("PigeonSprite — smoke test", () => {
  it("renders a transparent, pixelated canvas at the native grid size", () => {
    const { container } = render(<PigeonSprite state="idle" />);
    const canvas = container.querySelector("canvas.ag-node-sprite");
    expect(canvas).toBeTruthy();
    expect(canvas?.getAttribute("width")).toBe(String(NATIVE_W * 3));
    expect(canvas?.getAttribute("height")).toBe(String(NATIVE_H * 3));
  });

  it("renders without a surrounding frame/box element", () => {
    const { container } = render(<PigeonSprite state="running" />);
    // The sprite is exactly the canvas — no wrapping div with border/frame classes.
    expect(container.querySelectorAll("canvas")).toHaveLength(1);
    expect(container.querySelector(".ag-node-sprite-frame")).toBeNull();
  });

  it("re-renders cleanly across all 8 node states", () => {
    const states = [
      "idle", "queued", "running", "waiting",
      "paused", "succeeded", "failed", "skipped",
    ] as const;
    for (const state of states) {
      const { unmount } = render(<PigeonSprite state={state} />);
      unmount();
    }
  });
});

describe("poseForState — mapping", () => {
  it("maps succeeded to the one-shot hop pose regardless of frame", () => {
    expect(poseForState("succeeded", 0)).toBe("hop");
    expect(poseForState("succeeded", 42)).toBe("hop");
  });

  it("maps failed to the one-shot down pose regardless of frame", () => {
    expect(poseForState("failed", 0)).toBe("down");
    expect(poseForState("failed", 99)).toBe("down");
  });

  it("alternates running between stepA/stepB every tick (fast run)", () => {
    expect(poseForState("running", 0)).toBe("stepA");
    expect(poseForState("running", 1)).toBe("stepB");
    expect(poseForState("running", 2)).toBe("stepA");
  });

  it("alternates waiting between stepA/stepB every 3 ticks (slow walk)", () => {
    expect(poseForState("waiting", 0)).toBe("stepA");
    expect(poseForState("waiting", 2)).toBe("stepA");
    expect(poseForState("waiting", 3)).toBe("stepB");
    expect(poseForState("waiting", 5)).toBe("stepB");
    expect(poseForState("waiting", 6)).toBe("stepA");
  });

  it("alternates paused between idle/idleUp every 12 ticks", () => {
    expect(poseForState("paused", 0)).toBe("idle");
    expect(poseForState("paused", 11)).toBe("idle");
    expect(poseForState("paused", 12)).toBe("idleUp");
    expect(poseForState("paused", 23)).toBe("idleUp");
    expect(poseForState("paused", 24)).toBe("idle");
  });

  it("alternates queued between idle/idleUp every 6 ticks", () => {
    expect(poseForState("queued", 0)).toBe("idle");
    expect(poseForState("queued", 5)).toBe("idle");
    expect(poseForState("queued", 6)).toBe("idleUp");
  });

  it("alternates idle and skipped between idle/idleUp every 4 ticks", () => {
    expect(poseForState("idle", 0)).toBe("idle");
    expect(poseForState("idle", 3)).toBe("idle");
    expect(poseForState("idle", 4)).toBe("idleUp");
    expect(poseForState("skipped", 0)).toBe("idle");
    expect(poseForState("skipped", 4)).toBe("idleUp");
  });
});
