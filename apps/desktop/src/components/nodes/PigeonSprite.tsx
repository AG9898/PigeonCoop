// Canvas-based procedural pigeon sprite for Agent nodes (DEC-008).
//
// Draws the pigeon character from pigeonDrawing.ts on a transparent <canvas>,
// choosing the pose via poseForState(state, frame) on a shared ~100ms
// animation tick (useAnimationTick — one interval for every sprite on the
// canvas, never one timer per node). Run state is communicated by the
// neck-patch tint; there is no surrounding frame/box around the character.
//
// See docs/VISUAL_IDENTITY.md §2-§4.

import { memo, useEffect, useRef } from "react";
import { drawPigeon, poseForState, NATIVE_W, NATIVE_H, type PigeonState } from "../canvas/pigeonDrawing";
import type { NodeState } from "../../types/workflow";
import { useAnimationTick } from "../../hooks/useAnimationTick";

/** Integer display scale — 3x matches the handoff's state-row default (78x72 px). */
const SCALE = 3;

export interface PigeonSpriteProps {
  state: NodeState;
  /** Face left instead of the default right-facing pose. */
  flipped?: boolean;
}

function PigeonSprite({ state, flipped = false }: PigeonSpriteProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frame = useAnimationTick();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // NodeState and PigeonState are the same 8-value state union (see
    // docs/VISUAL_IDENTITY.md — "no new states introduced").
    const pose = poseForState(state as PigeonState, frame);
    drawPigeon(ctx, { scale: SCALE, pose, state: state as PigeonState, flipped });
  }, [state, frame, flipped]);

  return (
    <canvas
      ref={canvasRef}
      className="ag-node-sprite"
      width={NATIVE_W * SCALE}
      height={NATIVE_H * SCALE}
      aria-hidden="true"
    />
  );
}

export default memo(PigeonSprite);
