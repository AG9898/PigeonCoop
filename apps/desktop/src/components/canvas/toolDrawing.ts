// Procedural pixel-art wrench-bot sprite for Tool nodes.
//
// Follows the pigeonDrawing.ts pattern: hand-authored ASCII pixel grids,
// transparent canvas, pixel drop shadow, and a state-tinted detail area.

import { NECK_BY_STATE, PIGEON_PALETTE, type PigeonState } from "./pigeonDrawing";

export type ToolState = PigeonState;

export interface ToolBotPalette {
  outline: string;
  bodyDark: string;
  body: string;
  bodyHi: string;
  metal: string;
  metalHi: string;
  eye: string;
  eyeHi: string;
  foot: string;
  footHi: string;
  spark: string;
  fail: string;
  shadow: string;
}

export const TOOL_BOT_PALETTE: ToolBotPalette = {
  outline: PIGEON_PALETTE.outline,
  bodyDark: "#1d242f",
  body: "#3a3e4a",
  bodyHi: "#4e5364",
  metal: "#2a3140",
  metalHi: "#6a7388",
  eye: PIGEON_PALETTE.eye,
  eyeHi: PIGEON_PALETTE.eyeHi,
  foot: PIGEON_PALETTE.foot,
  footHi: PIGEON_PALETTE.footHi,
  spark: "#f0b048",
  fail: "#e0644c",
  shadow: PIGEON_PALETTE.shadow,
};

export const NATIVE_W = 26;
export const NATIVE_H = 24;

const TOOL_IDLE: ReadonlyArray<string> = [
  "..........................",
  ".................WW.......",
  "................WwwW......",
  "...............WwwwwW.....",
  "...............WWwwWW.....",
  "..........OOOO...WW.......",
  ".........ODDBOO..W........",
  "........ODBBBBBOOW........",
  ".......ODBEEBBBHOO........",
  ".......ODBEeBBBHOO........",
  ".......ODBNNNBBHOO........",
  "........ODBNnBBBO.........",
  ".........ODBBBBBO.........",
  "........OOONNNOOO.........",
  ".......OHHHNNNHHHO........",
  "......OHHHHNNNHHHHO.......",
  "......OHHHBBBBBHHHO.......",
  ".......OHHBBBBBHHOO.......",
  "........OOBBBBBBO.........",
  ".........OOOBBBO..........",
  "..........DD..DD..........",
  "..........DD..DD..........",
  ".........FFf..FFf.........",
  "..........................",
];

const TOOL_IDLE_UP: ReadonlyArray<string> = [
  ".................WW.......",
  "................WwwW......",
  "...............WwwwwW.....",
  "...............WWwwWW.....",
  "..........OOOO...WW.......",
  ".........ODDBOO..W........",
  "........ODBBBBBOOW........",
  ".......ODBEEBBBHOO........",
  ".......ODBEeBBBHOO........",
  ".......ODBNNNBBHOO........",
  "........ODBNnBBBO.........",
  ".........ODBBBBBO.........",
  "........OOONNNOOO.........",
  ".......OHHHNNNHHHO........",
  "......OHHHHNNNHHHHO.......",
  "......OHHHBBBBBHHHO.......",
  ".......OHHBBBBBHHOO.......",
  "........OOBBBBBBO.........",
  ".........OOOBBBO..........",
  "..........DD..DD..........",
  "..........DD..DD..........",
  ".........FFf..FFf.........",
  "..........................",
  "..........................",
];

const TOOL_STEP_A: ReadonlyArray<string> = [
  "..........................",
  "..................WW......",
  ".................WwwW.....",
  ".................WWwW.....",
  "..........OOOO....WW......",
  ".........ODDBOO..W........",
  "........ODBBBBBOOW........",
  ".......ODBEEBBBHOO........",
  ".......ODBEeBBBHOO........",
  ".......ODBNNNBBHOO........",
  "........ODBNnBBBO.........",
  ".........ODBBBBBO.........",
  "........OOONNNOOO.........",
  ".......OHHHNNNHHHO........",
  "......OHHHHNNNHHHHO.......",
  "......OHHHBBBBBHHHO.......",
  ".......OHHBBBBBHHOO.......",
  "........OOBBBBBBO.........",
  ".........OOOBBBO..........",
  "..........DD..DD..........",
  "..........DD...D..........",
  "..........FFf..DD.........",
  "................FFf.......",
  "..........................",
];

const TOOL_STEP_B: ReadonlyArray<string> = [
  "..........................",
  "...............WW.........",
  "..............WwwW........",
  "..............WwWW........",
  "..........OOOO.WW.........",
  ".........ODDBOOW..........",
  "........ODBBBBBOO.........",
  ".......ODBEEBBBHO.........",
  ".......ODBEeBBBHO.........",
  ".......ODBNNNBBHO.........",
  "........ODBNnBBBO.........",
  ".........ODBBBBBO.........",
  "........OOONNNOOO.........",
  ".......OHHHNNNHHHO........",
  "......OHHHHNNNHHHHO.......",
  "......OHHHBBBBBHHHO.......",
  ".......OHHBBBBBHHOO.......",
  "........OOBBBBBBO.........",
  ".........OOOBBBO..........",
  "..........DD..DD..........",
  "..........D...DD..........",
  ".........DD..FFf..........",
  ".......FFf................",
  "..........................",
];

const TOOL_SPARK: ReadonlyArray<string> = [
  "..................s.......",
  ".................sWs......",
  "................WwwW......",
  "..............sWwwwwWs....",
  "...............WWwwWW.....",
  "..........OOOO...WW.......",
  ".........ODDBOO..W........",
  "........ODBBBBBOOW........",
  ".......ODBEEBBBHOO........",
  ".......ODBEeBBBHOO........",
  ".......ODBNnNBBHOO........",
  "........ODBNnBBBO.........",
  ".........ODBBBBBO.........",
  "........OOONNNOOO.........",
  ".......OHHHNNNHHHO........",
  "......OHHHHNNNHHHHO.......",
  "......OHHHBBBBBHHHO.......",
  ".......OHHBBBBBHHOO.......",
  "........OOBBBBBBO.........",
  ".........OOOBBBO..........",
  "..........D....D..........",
  ".........FFf..FFf.........",
  "..........................",
  "..........................",
];

const TOOL_DOWN: ReadonlyArray<string> = [
  "..........................",
  "..........................",
  ".................WW.......",
  "................WwwW......",
  "...............WWwwWW.....",
  "..........................",
  "...........OOOO...........",
  "..........ODDDBOO.........",
  ".........ODBBBBBOO........",
  "........ODBXXBBBHO........",
  "........ODBNNNBBHO........",
  "........ODBNnBBBO.........",
  ".......OOODBBBBBO.........",
  "......OHHHNNNHHHOO........",
  ".....OHHHHNNNHHHHO........",
  ".....OHHHBBBBBHHHO........",
  "......OHHBBBBBHHOO........",
  ".......OOBBBBBBO..........",
  "........OOOBBBO...........",
  ".........DD..DD...........",
  ".........DD..DD...........",
  "........FFf..FFf..........",
  "..........................",
  "..........................",
];

export type ToolPoseName = "idle" | "idleUp" | "spark" | "down" | "stepA" | "stepB";

const POSES: Record<ToolPoseName, ReadonlyArray<string>> = {
  idle: TOOL_IDLE,
  idleUp: TOOL_IDLE_UP,
  spark: TOOL_SPARK,
  down: TOOL_DOWN,
  stepA: TOOL_STEP_A,
  stepB: TOOL_STEP_B,
};

export interface DrawToolBotOptions {
  scale?: number;
  x?: number;
  y?: number;
  pose?: ToolPoseName;
  state?: ToolState;
  flipped?: boolean;
  palette?: ToolBotPalette;
  noShadow?: boolean;
}

export function drawToolBot(ctx: CanvasRenderingContext2D, opts: DrawToolBotOptions = {}) {
  const scale = opts.scale ?? 3;
  const baseX = opts.x ?? 0;
  const baseY = opts.y ?? 0;
  const pose = POSES[opts.pose ?? "idle"];
  const state = opts.state ?? "idle";
  const flipped = !!opts.flipped;
  const p = opts.palette ?? TOOL_BOT_PALETTE;
  const tint = NECK_BY_STATE[state];

  ctx.imageSmoothingEnabled = false;

  if (!opts.noShadow) {
    const shadowCx = baseX + (NATIVE_W / 2) * scale;
    const shadowCy = baseY + (NATIVE_H - 0.5) * scale;
    ctx.fillStyle = p.shadow;
    fillEllipse(ctx, shadowCx, shadowCy, 5 * scale, 1.2 * scale);
  }

  for (let row = 0; row < pose.length; row++) {
    const line = pose[row];
    for (let col = 0; col < line.length; col++) {
      const color = pixelColor(line[col], p, tint);
      if (!color) continue;
      const drawCol = flipped ? (NATIVE_W - 1 - col) : col;
      ctx.fillStyle = color;
      ctx.fillRect(
        (baseX + drawCol * scale) | 0,
        (baseY + row * scale) | 0,
        scale,
        scale,
      );
    }
  }
}

function pixelColor(
  ch: string,
  p: ToolBotPalette,
  tint: { mid: string; hi: string },
): string | null {
  switch (ch) {
    case ".": return null;
    case "O": return p.outline;
    case "D": return p.bodyDark;
    case "B": return p.body;
    case "H": return p.bodyHi;
    case "M": return p.metal;
    case "W": return p.metal;
    case "w": return p.metalHi;
    case "N": return tint.mid;
    case "n": return tint.hi;
    case "E": return p.eye;
    case "e": return p.eyeHi;
    case "F": return p.foot;
    case "f": return p.footHi;
    case "s": return p.spark;
    case "X": return p.fail;
    default: return null;
  }
}

function fillEllipse(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number) {
  const r2 = ry * ry;
  for (let dy = -Math.ceil(ry); dy <= Math.ceil(ry); dy++) {
    const t = 1 - (dy * dy) / r2;
    if (t <= 0) continue;
    const w = Math.floor(Math.sqrt(t) * rx);
    ctx.fillRect((cx - w) | 0, (cy + dy) | 0, w * 2, 1);
  }
}

export function poseForToolState(state: ToolState, frame: number): ToolPoseName {
  switch (state) {
    case "succeeded":
      return "spark";
    case "failed":
      return "down";
    case "running":
      return frame % 2 === 0 ? "stepA" : "stepB";
    case "waiting":
      return Math.floor(frame / 3) % 2 === 0 ? "stepA" : "stepB";
    case "paused":
      return Math.floor(frame / 12) % 2 === 0 ? "idle" : "idleUp";
    case "queued":
      return Math.floor(frame / 6) % 2 === 0 ? "idle" : "idleUp";
    case "idle":
    case "skipped":
    default:
      return Math.floor(frame / 4) % 2 === 0 ? "idle" : "idleUp";
  }
}
