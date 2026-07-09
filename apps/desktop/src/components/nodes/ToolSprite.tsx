// Canvas-based procedural wrench-bot sprite for Tool nodes.

import { memo, useEffect, useRef } from "react";
import {
  drawToolBot,
  poseForToolState,
  NATIVE_W,
  NATIVE_H,
  type ToolState,
} from "../canvas/toolDrawing";
import type { NodeState } from "../../types/workflow";
import { useAnimationTick } from "../../hooks/useAnimationTick";

const SCALE = 3;

export interface ToolSpriteProps {
  state: NodeState;
  flipped?: boolean;
}

function ToolSprite({ state, flipped = false }: ToolSpriteProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frame = useAnimationTick();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const toolState = state as ToolState;
    const pose = poseForToolState(toolState, frame);
    drawToolBot(ctx, { scale: SCALE, pose, state: toolState, flipped });
  }, [state, frame, flipped]);

  return (
    <canvas
      ref={canvasRef}
      className="tool-node-sprite"
      width={NATIVE_W * SCALE}
      height={NATIVE_H * SCALE}
      aria-hidden="true"
    />
  );
}

export default memo(ToolSprite);
