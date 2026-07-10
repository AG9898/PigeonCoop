// Shared animation tick for every canvas sprite (DEC-008, DEC-013).
//
// A single ~100ms interval feeds a frame counter to every subscribed sprite —
// per docs/VISUAL_IDENTITY.md §4, sprites must never create one timer per
// node. The interval is a module-level singleton: it starts when the first
// component subscribes and stops when the last one unmounts.
//
// Respects `prefers-reduced-motion: reduce` — when set, no interval is
// started and every subscriber stays pinned to frame 0, which freezes each
// sprite on its current pose (see docs/VISUAL_IDENTITY.md §9).

import { useEffect, useState } from "react";

const TICK_MS = 100;

let frame = 0;
let intervalId: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<(frame: number) => void>();

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function ensureTicking() {
  if (intervalId !== null) return;
  if (prefersReducedMotion()) return;
  intervalId = setInterval(() => {
    frame += 1;
    listeners.forEach((listener) => listener(frame));
  }, TICK_MS);
}

function stopIfIdle() {
  if (listeners.size === 0 && intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

/** Subscribes to the shared animation tick. Returns the current frame count. */
export function useAnimationTick(): number {
  const [localFrame, setLocalFrame] = useState(frame);

  useEffect(() => {
    listeners.add(setLocalFrame);
    ensureTicking();
    return () => {
      listeners.delete(setLocalFrame);
      stopIfIdle();
    };
  }, []);

  return localFrame;
}
