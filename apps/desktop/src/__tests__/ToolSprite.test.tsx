// ToolSprite smoke tests and state-to-pose mapping.

import { render } from "@testing-library/react";
import ToolSprite from "../components/nodes/ToolSprite";
import { poseForToolState, NATIVE_W, NATIVE_H } from "../components/canvas/toolDrawing";

describe("ToolSprite", () => {
  it("renders a transparent, pixelated canvas at the native grid size", () => {
    const { container } = render(<ToolSprite state="idle" />);
    const canvas = container.querySelector("canvas.tool-node-sprite");
    expect(canvas).toBeTruthy();
    expect(canvas?.getAttribute("width")).toBe(String(NATIVE_W * 3));
    expect(canvas?.getAttribute("height")).toBe(String(NATIVE_H * 3));
  });

  it("renders without a surrounding frame element", () => {
    const { container } = render(<ToolSprite state="running" />);
    expect(container.querySelectorAll("canvas")).toHaveLength(1);
    expect(container.querySelector(".tool-node-sprite-frame")).toBeNull();
  });

  it("re-renders cleanly across all 8 node states", () => {
    const states = [
      "idle", "queued", "running", "waiting",
      "paused", "succeeded", "failed", "skipped",
    ] as const;
    for (const state of states) {
      const { unmount } = render(<ToolSprite state={state} />);
      unmount();
    }
  });
});

describe("poseForToolState", () => {
  it("maps terminal states to held poses", () => {
    expect(poseForToolState("succeeded", 0)).toBe("spark");
    expect(poseForToolState("succeeded", 12)).toBe("spark");
    expect(poseForToolState("failed", 0)).toBe("down");
    expect(poseForToolState("failed", 12)).toBe("down");
  });

  it("alternates running between step poses every tick", () => {
    expect(poseForToolState("running", 0)).toBe("stepA");
    expect(poseForToolState("running", 1)).toBe("stepB");
    expect(poseForToolState("running", 2)).toBe("stepA");
  });

  it("uses slower animation cadences for waiting, paused, and queued", () => {
    expect(poseForToolState("waiting", 0)).toBe("stepA");
    expect(poseForToolState("waiting", 3)).toBe("stepB");
    expect(poseForToolState("paused", 0)).toBe("idle");
    expect(poseForToolState("paused", 12)).toBe("idleUp");
    expect(poseForToolState("queued", 0)).toBe("idle");
    expect(poseForToolState("queued", 6)).toBe("idleUp");
  });
});
