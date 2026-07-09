// pigeonDrawing.ts
// -----------------------------------------------------------------------------
// Procedural pixel-art pigeon agent sprite for PigeonCoop.
//
// Designed to share the visual language of the city backdrop (cityDrawing.ts):
//   - Slate-blue body tones matching rooftop palette
//   - Warm orange feet matching window-glow palette
//   - Neck patch tinted by node STATE (replaces reference's iridescent — pulls
//     state color into the character itself instead of needing a halo box)
//
// Native sprite grid: 26 cols × 24 rows. Rendered at integer scales (3x, 6x,
// 12x) for chunky pixel-art display. No square frame — the sprite sits on
// transparent canvas with only a small drop-shadow under the feet.
// -----------------------------------------------------------------------------

export type PigeonState = "idle" | "queued" | "running" | "waiting" | "paused" | "succeeded" | "failed" | "skipped";

export interface PigeonPalette {
  outline:   string;
  bodyDark:  string;
  body:      string;
  bodyHi:    string;
  belly:     string;
  beak:      string;
  beakHi:    string;
  eye:       string;
  eyeHi:     string;
  foot:      string;
  footHi:    string;
  shadow:    string;
}

/** Matches the city backdrop palette. */
export const PIGEON_PALETTE: PigeonPalette = {
  outline:  "#0c0e14",
  bodyDark: "#22293a",
  body:     "#3a4256",
  bodyHi:   "#525a72",
  belly:    "#6a7388",
  beak:     "#181922",
  beakHi:   "#2a2330",
  eye:      "#0a0c10",
  eyeHi:    "#d8dde8",
  foot:     "#d65a3a",
  footHi:   "#f08458",
  shadow:   "rgba(0,0,0,0.55)",
};

/** Neck-patch color by state — borrows from the existing state ring system. */
export const NECK_BY_STATE: Record<PigeonState, { mid: string; hi: string }> = {
  idle:      { mid: "#6a7388", hi: "#8d96aa" }, // grey (resting)
  queued:    { mid: "#6a7388", hi: "#8d96aa" },
  running:   { mid: "#3e8ec0", hi: "#7cc0e8" }, // cool blue, active
  waiting:   { mid: "#b8862a", hi: "#f0b048" }, // warm amber, holding
  paused:    { mid: "#c87a28", hi: "#f0a058" }, // deeper amber
  succeeded: { mid: "#3a9358", hi: "#6ec880" }, // green
  failed:    { mid: "#a83828", hi: "#e0644c" }, // red
  skipped:   { mid: "#4a5266", hi: "#6a7388" }, // dimmer grey
};

// -----------------------------------------------------------------------------
// Pixel grid — 26 wide × 24 tall.
//
// Char legend:
//   .  transparent
//   O  outline (very dark)
//   D  body dark (shadow side)
//   B  body mid (slate)
//   H  body highlight (belly / chest)
//   N  neck patch mid     ← state-tinted at draw time
//   n  neck patch highlight ← state-tinted
//   K  beak
//   k  beak highlight (single pixel)
//   E  eye
//   e  eye highlight
//   F  foot mid (orange)
//   f  foot highlight
//   S  shadow underneath (drawn separately as a soft ellipse)
//
// Pigeon faces RIGHT. Flip horizontally for left-facing.
// -----------------------------------------------------------------------------

const PIGEON_IDLE: ReadonlyArray<string> = [
  "..........................", //  0
  "..........................", //  1
  ".............OOOO.........", //  2  crown
  "............ODDDBO........", //  3
  "...........OBBBBBBO.......", //  4
  "...........OBBBHHBOO......", //  5
  "..........OBBHHHHBOKO.....", //  6  beak start
  "..........OBHEHHHBOKKO....", //  7  eye
  "..........OBHeHHHBOOO.....", //  8
  "..........OBnNNNBBO.......", //  9
  ".........OBnNNNBBBO.......", // 10  neck patch
  ".........OBnNNBBBBO.......", // 11
  "........OBBBBBBBBBBO......", // 12
  ".......OBBHHHHHHHBBBO.....", // 13
  "......OBBHHHHHHHHHBBBO....", // 14
  "......OBHHHHHHHHHHBBBBO...", // 15
  ".....OBHHHHHHHHHHHBBBBBO..", // 16  tail
  ".....OBHHHHHHHHHHBBBBBBO..", // 17
  "......OBBHHHHHHHBBBBBBO...", // 18
  ".......OBBHHHHBBBBBBO.....", // 19
  ".........OBBBBBBBBO.......", // 20
  "..........BB....BB........", // 21  legs
  "..........BB....BB........", // 22
  ".........FFf..FFf.........", // 23  feet
];

// Subtle alternate frame: head shifted up by 1px (idle breathing).
const PIGEON_IDLE_UP: ReadonlyArray<string> = [
  ".............OOOO.........", //  1
  "............ODDDBO........", //  2
  "...........OBBBBBBO.......", //  3
  "...........OBBBHHBOO......", //  4
  "..........OBBHHHHBOKO.....", //  5
  "..........OBHEHHHBOKKO....", //  6
  "..........OBHeHHHBOOO.....", //  7
  "..........OBnNNNBBO.......", //  8
  ".........OBnNNNBBBO.......", //  9
  ".........OBnNNBBBBO.......", // 10
  "..........................", // 11 (gap as neck stretches)
  "........OBBBBBBBBBBO......", // 12
  ".......OBBHHHHHHHBBBO.....", // 13
  "......OBBHHHHHHHHHBBBO....", // 14
  "......OBHHHHHHHHHHBBBBO...", // 15
  ".....OBHHHHHHHHHHHBBBBBO..", // 16
  ".....OBHHHHHHHHHHBBBBBBO..", // 17
  "......OBBHHHHHHHBBBBBBO...", // 18
  ".......OBBHHHHBBBBBBO.....", // 19
  ".........OBBBBBBBBO.......", // 20
  "..........BB....BB........", // 21
  "..........BB....BB........", // 22
  ".........FFf..FFf.........", // 23
  "..........................", // 24
];

// Succeeded — pigeon hopping up, feet tucked under.
const PIGEON_HOP: ReadonlyArray<string> = [
  ".............OOOO.........", //  0
  "............ODDDBO........", //  1
  "...........OBBBBBBO.......", //  2
  "...........OBBBHHBOO......", //  3
  "..........OBBHHHHBOKO.....", //  4
  "..........OBHEHHHBOKKO....", //  5
  "..........OBHeHHHBOOO.....", //  6
  "..........OBnNNNBBO.......", //  7
  ".........OBnNNNBBBO.......", //  8
  ".........OBnNNBBBBO.......", //  9
  "........OBBBBBBBBBBO......", // 10
  ".......OBBHHHHHHHBBBO.....", // 11
  "......OBBHHHHHHHHHBBBO....", // 12
  "......OBHHHHHHHHHHBBBBO...", // 13
  ".....OBHHHHHHHHHHHBBBBBO..", // 14
  ".....OBHHHHHHHHHHBBBBBBO..", // 15
  "......OBBHHHHHHHBBBBBBO...", // 16
  ".......OBBHHHHBBBBBBO.....", // 17
  ".........OBBBBBBBBO.......", // 18
  "..........OFFOOFFO........", // 19  feet tucked
  "..........................", // 20
  "..........................", // 21
  "..........................", // 22
  "..........................", // 23
];

// Failed — slumped, head down, eye closed (shows as horizontal line).
const PIGEON_DOWN: ReadonlyArray<string> = [
  "..........................", //  0
  "..........................", //  1
  "..........................", //  2
  "..........................", //  3
  "............OOOO..........", //  4
  "...........ODDDBO.........", //  5
  "..........OBBBBBBO........", //  6
  "..........OBBOOHBOO.......", //  7  closed eye
  ".........OBBHHHHBOKO......", //  8
  ".........OBHHHHHBOKKO.....", //  9
  ".........OBnNNNBBO........", // 10
  "........OBnNNNBBBO........", // 11
  ".......OBBBBBBBBBBO.......", // 12
  "......OBBHHHHHHHBBBO......", // 13
  ".....OBBHHHHHHHHHBBBO.....", // 14
  ".....OBHHHHHHHHHHBBBBO....", // 15
  "....OBHHHHHHHHHHHBBBBBO...", // 16
  "....OBHHHHHHHHHHBBBBBBO...", // 17
  ".....OBBHHHHHHHBBBBBBO....", // 18
  "......OBBHHHHBBBBBBO......", // 19
  "........OBBBBBBBBO........", // 20
  "..........BB....BB........", // 21
  "..........BB....BB........", // 22
  ".........FFf..FFf.........", // 23
];

// Walking/running — body lifted slightly, legs in mid-step. (Simple 2-frame loop.)
// Frame A: rear leg planted, front leg lifted forward.
const PIGEON_STEP_A: ReadonlyArray<string> = [
  "..........................", //  0
  ".............OOOO.........", //  1
  "............ODDDBO........", //  2
  "...........OBBBBBBO.......", //  3
  "...........OBBBHHBOO......", //  4
  "..........OBBHHHHBOKO.....", //  5
  "..........OBHEHHHBOKKO....", //  6
  "..........OBHeHHHBOOO.....", //  7
  "..........OBnNNNBBO.......", //  8
  ".........OBnNNNBBBO.......", //  9
  ".........OBnNNBBBBO.......", // 10
  "........OBBBBBBBBBBO......", // 11
  ".......OBBHHHHHHHBBBO.....", // 12
  "......OBBHHHHHHHHHBBBO....", // 13
  "......OBHHHHHHHHHHBBBBO...", // 14
  ".....OBHHHHHHHHHHHBBBBBO..", // 15
  ".....OBHHHHHHHHHHBBBBBBO..", // 16
  "......OBBHHHHHHHBBBBBBO...", // 17
  ".......OBBHHHHBBBBBBO.....", // 18
  ".........OBBBBBBBBO.......", // 19
  "..........BB....BB........", // 20  both upper legs visible
  "..........BB.....B........", // 21  rear straight, front bending
  "..........FFf...BB........", // 22  rear foot planted, front mid-swing
  "................FFf.......", // 23  front foot lifted forward
];

// Frame B: mirror — front leg planted, rear leg lifted back.
const PIGEON_STEP_B: ReadonlyArray<string> = [
  "..........................", //  0
  ".............OOOO.........", //  1
  "............ODDDBO........", //  2
  "...........OBBBBBBO.......", //  3
  "...........OBBBHHBOO......", //  4
  "..........OBBHHHHBOKO.....", //  5
  "..........OBHEHHHBOKKO....", //  6
  "..........OBHeHHHBOOO.....", //  7
  "..........OBnNNNBBO.......", //  8
  ".........OBnNNNBBBO.......", //  9
  ".........OBnNNBBBBO.......", // 10
  "........OBBBBBBBBBBO......", // 11
  ".......OBBHHHHHHHBBBO.....", // 12
  "......OBBHHHHHHHHHBBBO....", // 13
  "......OBHHHHHHHHHHBBBBO...", // 14
  ".....OBHHHHHHHHHHHBBBBBO..", // 15
  ".....OBHHHHHHHHHHBBBBBBO..", // 16
  "......OBBHHHHHHHBBBBBBO...", // 17
  ".......OBBHHHHBBBBBBO.....", // 18
  ".........OBBBBBBBBO.......", // 19
  "..........BB....BB........", // 20
  "..........B.....BB........", // 21
  "..........BB...FFf........", // 22  front foot planted, rear mid-swing
  ".......FFf................", // 23  rear foot lifted backward
];

export type PoseName = "idle" | "idleUp" | "hop" | "down" | "stepA" | "stepB";

const POSES: Record<PoseName, ReadonlyArray<string>> = {
  idle:    PIGEON_IDLE,
  idleUp:  PIGEON_IDLE_UP,
  hop:     PIGEON_HOP,
  down:    PIGEON_DOWN,
  stepA:   PIGEON_STEP_A,
  stepB:   PIGEON_STEP_B,
};

export const NATIVE_W = 26;
export const NATIVE_H = 24;

// -----------------------------------------------------------------------------
// Drawing
// -----------------------------------------------------------------------------

export interface DrawPigeonOptions {
  /** Pixel size of one grid cell. 1 = native (26×24 px sprite). 3 ≈ 78×72 display. */
  scale?: number;
  /** Top-left x of the sprite's bounding box. */
  x?: number;
  /** Top-left y. */
  y?: number;
  /** Which pose grid to render. */
  pose?: PoseName;
  /** State drives the neck-patch tint. */
  state?: PigeonState;
  /** Face left? Default false (faces right). */
  flipped?: boolean;
  /** Body palette override. */
  palette?: PigeonPalette;
  /** Skip drop shadow. */
  noShadow?: boolean;
}

export function drawPigeon(
  ctx: CanvasRenderingContext2D,
  opts: DrawPigeonOptions = {},
) {
  const scale   = opts.scale ?? 3;
  const baseX   = opts.x ?? 0;
  const baseY   = opts.y ?? 0;
  const pose    = POSES[opts.pose ?? "idle"];
  const state   = opts.state ?? "idle";
  const flipped = !!opts.flipped;
  const p       = opts.palette ?? PIGEON_PALETTE;
  const neck    = NECK_BY_STATE[state];

  ctx.imageSmoothingEnabled = false;

  // Drop shadow (soft ellipse, only when on the ground)
  const hasFeet = pose === PIGEON_HOP ? false : true;
  if (!opts.noShadow && hasFeet) {
    const shadowCx = baseX + (NATIVE_W / 2) * scale;
    const shadowCy = baseY + (NATIVE_H - 0.5) * scale;
    const shadowRx = 5 * scale;
    const shadowRy = 1.2 * scale;
    ctx.fillStyle = p.shadow;
    fillEllipse(ctx, shadowCx, shadowCy, shadowRx, shadowRy);
  } else if (!opts.noShadow && pose === PIGEON_HOP) {
    // Smaller, offset shadow for the hop
    const shadowCx = baseX + (NATIVE_W / 2) * scale;
    const shadowCy = baseY + (NATIVE_H + 0.5) * scale;
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = p.shadow;
    fillEllipse(ctx, shadowCx, shadowCy, 4 * scale, scale);
    ctx.globalAlpha = 1;
  }

  // Per-character render
  for (let row = 0; row < pose.length; row++) {
    const line = pose[row];
    for (let col = 0; col < line.length; col++) {
      const ch = line[col];
      const color = pixelColor(ch, p, neck);
      if (!color) continue;
      const drawCol = flipped ? (NATIVE_W - 1 - col) : col;
      ctx.fillStyle = color;
      ctx.fillRect(
        (baseX + drawCol * scale) | 0,
        (baseY + row * scale)     | 0,
        scale, scale,
      );
    }
  }
}

function pixelColor(
  ch: string,
  p: PigeonPalette,
  neck: { mid: string; hi: string },
): string | null {
  switch (ch) {
    case ".": return null;
    case "O": return p.outline;
    case "D": return p.bodyDark;
    case "B": return p.body;
    case "H": return p.bodyHi;
    case "h": return p.belly;
    case "N": return neck.mid;
    case "n": return neck.hi;
    case "K": return p.beak;
    case "k": return p.beakHi;
    case "E": return p.eye;
    case "e": return p.eyeHi;
    case "F": return p.foot;
    case "f": return p.footHi;
    default:  return null;
  }
}

function fillEllipse(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number) {
  // Pixel-faithful ellipse via integer scanlines (so shadow stays pixel-art-y).
  const r2 = ry * ry;
  for (let dy = -Math.ceil(ry); dy <= Math.ceil(ry); dy++) {
    const t = 1 - (dy * dy) / r2;
    if (t <= 0) continue;
    const w = Math.floor(Math.sqrt(t) * rx);
    ctx.fillRect((cx - w) | 0, (cy + dy) | 0, w * 2, 1);
  }
}

// -----------------------------------------------------------------------------
// Convenience: pick the right pose for a given state + animation tick.
// -----------------------------------------------------------------------------

export function poseForState(state: PigeonState, frame: number): PoseName {
  switch (state) {
    case "succeeded":
      return "hop";
    case "failed":
      return "down";
    case "running":
      // Fast 2-frame step animation
      return (frame % 2 === 0) ? "stepA" : "stepB";
    case "waiting":
      // Slow walk
      return (Math.floor(frame / 3) % 2 === 0) ? "stepA" : "stepB";
    case "paused":
      // Very slow idle breathing
      return (Math.floor(frame / 12) % 2 === 0) ? "idle" : "idleUp";
    case "queued":
      // Slow idle breathing
      return (Math.floor(frame / 6) % 2 === 0) ? "idle" : "idleUp";
    case "idle":
    case "skipped":
    default:
      // Normal idle breathing
      return (Math.floor(frame / 4) % 2 === 0) ? "idle" : "idleUp";
  }
}
