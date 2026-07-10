import { spriteFrameForState } from "../components/nodes/AnimatedRoleSprite";

describe("spriteFrameForState", () => {
  it("cycles running nodes faster than idle nodes", () => {
    expect(spriteFrameForState("running", 3)).toBe(1);
    expect(spriteFrameForState("idle", 3)).toBe(0);
  });

  it("holds deterministic frames for non-looping states", () => {
    expect(spriteFrameForState("paused", 999)).toBe(1);
    expect(spriteFrameForState("succeeded", 999)).toBe(2);
    expect(spriteFrameForState("failed", 999)).toBe(0);
    expect(spriteFrameForState("skipped", 999)).toBe(0);
  });
});
