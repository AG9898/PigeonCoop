// cityDrawing.ts
// -----------------------------------------------------------------------------
// Procedural pixel-art night cityscape for the PigeonCoop canvas backdrop.
// Renders a single seamless tile to a CanvasRenderingContext2D.
//
// Scale contract (matches docs/VISUAL_IDENTITY.md):
//   - Agent node sprite = 86×86 px
//   - City block (rooftop)  = 400×400 px      (≈4.6× a node)
//   - Street width           = 80 px
//   - Sidewalk width         = 16 px
//   - Tile size              = 1024×1024 px   (seamless on all 4 edges)
//
// Tile composition (4 blocks in a 2×2, with cross streets through the middle
// and half-streets on every outer edge so adjacent tiles join cleanly):
//
//   ┌─ half-street ─┬── apartment rooftops ──┬─ street ─┬──── plaza / park ───┬─ half-street ─┐
//   │               │                         │          │                    │               │
//   ├ half-street ──┼── industrial / sawtooth─┼─ street ─┼─── mixed commercial─┼─ half-street ─┤
//   └───────────────┴─────────────────────────┴──────────┴────────────────────┴───────────────┘
//
// All randomness is seeded so the tile is deterministic — a given seed always
// produces the same image, which makes it tile-stable across reloads.
// -----------------------------------------------------------------------------

export const TILE_SIZE = 1024;

// Layout constants (must sum to TILE_SIZE).
export const EDGE_STREET = 40;   // half-street at outer edges
export const SIDEWALK   = 16;
export const BLOCK      = 400;
export const MID_STREET = 80;
// 40 + 16 + 400 + 16 + 80 + 16 + 400 + 16 + 40 = 1024 ✓

// Block origins (top-left corner of each block's roof rectangle).
const BLOCKS = {
  TL: { x: EDGE_STREET + SIDEWALK,                                          y: EDGE_STREET + SIDEWALK },
  TR: { x: EDGE_STREET + SIDEWALK + BLOCK + SIDEWALK + MID_STREET + SIDEWALK, y: EDGE_STREET + SIDEWALK },
  BL: { x: EDGE_STREET + SIDEWALK,                                          y: EDGE_STREET + SIDEWALK + BLOCK + SIDEWALK + MID_STREET + SIDEWALK },
  BR: { x: EDGE_STREET + SIDEWALK + BLOCK + SIDEWALK + MID_STREET + SIDEWALK, y: EDGE_STREET + SIDEWALK + BLOCK + SIDEWALK + MID_STREET + SIDEWALK },
};

// Street centers — useful for lane markings and crosswalks.
const MID_H_STREET_Y = EDGE_STREET + SIDEWALK + BLOCK + SIDEWALK;          // top of horizontal mid-street band
const MID_V_STREET_X = EDGE_STREET + SIDEWALK + BLOCK + SIDEWALK;          // left of vertical mid-street band

export interface CityPalette {
  // Asphalt + lane markings
  asphalt: string;
  asphaltDark: string;
  asphaltLight: string;
  laneYellow: string;
  laneWhite: string;
  // Sidewalks
  sidewalk: string;
  sidewalkLight: string;
  sidewalkDark: string;
  // Roof bodies
  roofSlate: string;
  roofSlateHi: string;
  roofBrick: string;
  roofBrickHi: string;
  roofTar: string;
  roofTarHi: string;
  roofCopper: string;
  roofCopperHi: string;
  parapet: string;
  parapetHi: string;
  // Roof equipment
  ac: string;
  acDark: string;
  acHi: string;
  water: string;
  waterDark: string;
  waterHi: string;
  metal: string;
  metalDark: string;
  metalHi: string;
  // Glows
  windowGlowWarm: string;
  windowGlowWarmDim: string;
  windowGlowCool: string;
  windowGlowCoolDim: string;
  lampCore: string;
  lampGlow: string;
  lampGlowOuter: string;
  // Park
  grass: string;
  grassDark: string;
  grassHi: string;
  path: string;
  pathHi: string;
  tree: string;
  treeShadow: string;
  treeHi: string;
  treeTrunk: string;
  waterBlue: string;
  waterBlueHi: string;
  // Cars
  car1: string;
  car2: string;
  car3: string;
  car4: string;
  carGlass: string;
  // Signage
  sign: string;
  signHi: string;
  signLight: string;
}

export const NIGHT_PALETTE: CityPalette = {
  asphalt:           "#15171e",
  asphaltDark:       "#0e1015",
  asphaltLight:      "#1e2129",
  laneYellow:        "#8e6f24",
  laneWhite:         "#6f6f6c",
  sidewalk:          "#2a2e38",
  sidewalkLight:     "#353a4a",
  sidewalkDark:      "#1f2330",
  roofSlate:         "#1d242f",
  roofSlateHi:       "#2a3140",
  roofBrick:         "#3a2b21",
  roofBrickHi:       "#4d3a2c",
  roofTar:           "#181a21",
  roofTarHi:         "#262932",
  roofCopper:        "#2a3a36",
  roofCopperHi:      "#3a5044",
  parapet:           "#10131a",
  parapetHi:         "#262b36",
  ac:                "#3a3e4a",
  acDark:            "#1d2028",
  acHi:              "#4e5260",
  water:             "#3a322a",
  waterDark:         "#221c14",
  waterHi:           "#5a4a36",
  metal:             "#383e4a",
  metalDark:         "#1d2128",
  metalHi:           "#4e5364",
  windowGlowWarm:    "#f0b048",
  windowGlowWarmDim: "#8a5e1f",
  windowGlowCool:    "#5fa0c8",
  windowGlowCoolDim: "#2f5e7c",
  lampCore:          "#fff3c0",
  lampGlow:          "#f5d068",
  lampGlowOuter:     "#7a5818",
  grass:             "#1c3326",
  grassDark:         "#13231a",
  grassHi:           "#2c4933",
  path:              "#3a342a",
  pathHi:            "#4a4438",
  tree:              "#1c3a25",
  treeShadow:        "#0e1d14",
  treeHi:            "#326238",
  treeTrunk:         "#241a14",
  waterBlue:         "#2c4d68",
  waterBlueHi:       "#3e6e90",
  car1:              "#582a22",
  car2:              "#222e4d",
  car3:              "#1d1d22",
  car4:              "#4d4332",
  carGlass:          "#1a2028",
  sign:              "#262932",
  signHi:            "#3a3f4c",
  signLight:         "#d65a45",
};

// -----------------------------------------------------------------------------
// Seeded PRNG (mulberry32) — deterministic so tiles are reproducible.
// -----------------------------------------------------------------------------

export type RNG = () => number;

export function mulberry32(seed: number): RNG {
  let a = seed | 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: RNG, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

// -----------------------------------------------------------------------------
// Pixel primitives. All coordinates are integer pixels; no anti-aliasing.
// -----------------------------------------------------------------------------

function px(ctx: CanvasRenderingContext2D, x: number, y: number, c: string) {
  ctx.fillStyle = c;
  ctx.fillRect(x | 0, y | 0, 1, 1);
}

function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string) {
  ctx.fillStyle = c;
  ctx.fillRect(x | 0, y | 0, w | 0, h | 0);
}

function rectStroke(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string) {
  ctx.fillStyle = c;
  ctx.fillRect(x, y, w, 1);
  ctx.fillRect(x, y + h - 1, w, 1);
  ctx.fillRect(x, y, 1, h);
  ctx.fillRect(x + w - 1, y, 1, h);
}

// Sparse "salt and pepper" texture for asphalt/concrete grain.
function ditherFill(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  c: string, rng: RNG, density = 0.06,
) {
  ctx.fillStyle = c;
  for (let py = 0; py < h; py++) {
    for (let px2 = 0; px2 < w; px2++) {
      if (rng() < density) ctx.fillRect(x + px2, y + py, 1, 1);
    }
  }
}

function filledCircle(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  // Midpoint circle, filled scanlines.
  for (let dy = -r; dy <= r; dy++) {
    const dx = Math.floor(Math.sqrt(r * r - dy * dy));
    ctx.fillRect(cx - dx, cy + dy, dx * 2 + 1, 1);
  }
}

// -----------------------------------------------------------------------------
// Public entry point.
// -----------------------------------------------------------------------------

export interface DrawOptions {
  seed?: number;
  palette?: CityPalette;
}

export function drawCityTile(ctx: CanvasRenderingContext2D, opts: DrawOptions = {}) {
  const seed    = opts.seed ?? 1729;
  const palette = opts.palette ?? NIGHT_PALETTE;
  ctx.imageSmoothingEnabled = false;

  // 1. Asphalt base everywhere — visible only on streets, but full-fill keeps
  //    seams invisible if any block math is off by a pixel.
  rect(ctx, 0, 0, TILE_SIZE, TILE_SIZE, palette.asphaltDark);

  // 2. Streets (cross + edge halves)
  drawStreets(ctx, palette, mulberry32(seed));

  // 3. Sidewalks framing every block
  drawSidewalks(ctx, palette, mulberry32(seed + 7));

  // 4. Four distinct blocks
  drawApartmentBlock  (ctx, BLOCKS.TL.x, BLOCKS.TL.y, BLOCK, BLOCK, palette, mulberry32(seed + 11));
  drawParkBlock       (ctx, BLOCKS.TR.x, BLOCKS.TR.y, BLOCK, BLOCK, palette, mulberry32(seed + 19));
  drawIndustrialBlock (ctx, BLOCKS.BL.x, BLOCKS.BL.y, BLOCK, BLOCK, palette, mulberry32(seed + 29));
  drawCommercialBlock (ctx, BLOCKS.BR.x, BLOCKS.BR.y, BLOCK, BLOCK, palette, mulberry32(seed + 37));

  // 5. Streetlamps & lit glows — drawn last so they sit above everything.
  drawStreetlamps(ctx, palette);
}

// -----------------------------------------------------------------------------
// Streets — asphalt fill, lane markings, parked cars, crosswalks, manholes.
// -----------------------------------------------------------------------------

function drawStreets(ctx: CanvasRenderingContext2D, p: CityPalette, rng: RNG) {
  // Asphalt base for every street segment
  // Top half-street
  rect(ctx, 0, 0, TILE_SIZE, EDGE_STREET, p.asphalt);
  // Bottom half-street
  rect(ctx, 0, TILE_SIZE - EDGE_STREET, TILE_SIZE, EDGE_STREET, p.asphalt);
  // Left half-street
  rect(ctx, 0, 0, EDGE_STREET, TILE_SIZE, p.asphalt);
  // Right half-street
  rect(ctx, TILE_SIZE - EDGE_STREET, 0, EDGE_STREET, TILE_SIZE, p.asphalt);
  // Horizontal mid-street
  rect(ctx, 0, MID_H_STREET_Y, TILE_SIZE, MID_STREET, p.asphalt);
  // Vertical mid-street
  rect(ctx, MID_V_STREET_X, 0, MID_STREET, TILE_SIZE, p.asphalt);

  // Asphalt grain — light specks
  ditherFill(ctx, 0, 0, TILE_SIZE, EDGE_STREET, p.asphaltLight, rng, 0.04);
  ditherFill(ctx, 0, TILE_SIZE - EDGE_STREET, TILE_SIZE, EDGE_STREET, p.asphaltLight, rng, 0.04);
  ditherFill(ctx, 0, 0, EDGE_STREET, TILE_SIZE, p.asphaltLight, rng, 0.04);
  ditherFill(ctx, TILE_SIZE - EDGE_STREET, 0, EDGE_STREET, TILE_SIZE, p.asphaltLight, rng, 0.04);
  ditherFill(ctx, 0, MID_H_STREET_Y, TILE_SIZE, MID_STREET, p.asphaltLight, rng, 0.04);
  ditherFill(ctx, MID_V_STREET_X, 0, MID_STREET, TILE_SIZE, p.asphaltLight, rng, 0.04);

  // ----- Mid-street center yellow dashed line (horizontal) -----
  const midHy = MID_H_STREET_Y + MID_STREET / 2;
  // dashes 16 on / 12 off, but break around the intersection (crosswalks)
  const intersectionLeft  = MID_V_STREET_X - 8;
  const intersectionRight = MID_V_STREET_X + MID_STREET + 8;
  for (let x = 0; x < TILE_SIZE; x += 28) {
    if (x + 16 < intersectionLeft || x > intersectionRight) {
      rect(ctx, x, midHy - 1, 16, 2, p.laneYellow);
    }
  }
  // Vertical
  const midVx = MID_V_STREET_X + MID_STREET / 2;
  const intersectionTop    = MID_H_STREET_Y - 8;
  const intersectionBottom = MID_H_STREET_Y + MID_STREET + 8;
  for (let y = 0; y < TILE_SIZE; y += 28) {
    if (y + 16 < intersectionTop || y > intersectionBottom) {
      rect(ctx, midVx - 1, y, 2, 16, p.laneYellow);
    }
  }

  // ----- Outer-edge half-street center lines (tile join, half each side) -----
  for (let x = 0; x < TILE_SIZE; x += 28) {
    rect(ctx, x, EDGE_STREET / 2 - 1, 16, 2, p.laneYellow); // top edge
    rect(ctx, x, TILE_SIZE - EDGE_STREET / 2 - 1, 16, 2, p.laneYellow); // bottom edge
  }
  for (let y = 0; y < TILE_SIZE; y += 28) {
    rect(ctx, EDGE_STREET / 2 - 1, y, 2, 16, p.laneYellow);
    rect(ctx, TILE_SIZE - EDGE_STREET / 2 - 1, y, 2, 16, p.laneYellow);
  }

  // ----- Crosswalks at center intersection -----
  // Four crosswalks, one across each side of the intersection.
  const cwGap = 4;
  const cwStripe = 4;
  // North crosswalk (above intersection, on the vertical street)
  for (let x = MID_V_STREET_X + 6; x < MID_V_STREET_X + MID_STREET - 6; x += cwGap + cwStripe) {
    rect(ctx, x, MID_H_STREET_Y - 14, cwStripe, 10, p.laneWhite);
  }
  // South crosswalk
  for (let x = MID_V_STREET_X + 6; x < MID_V_STREET_X + MID_STREET - 6; x += cwGap + cwStripe) {
    rect(ctx, x, MID_H_STREET_Y + MID_STREET + 4, cwStripe, 10, p.laneWhite);
  }
  // West crosswalk (on horizontal street, left of intersection)
  for (let y = MID_H_STREET_Y + 6; y < MID_H_STREET_Y + MID_STREET - 6; y += cwGap + cwStripe) {
    rect(ctx, MID_V_STREET_X - 14, y, 10, cwStripe, p.laneWhite);
  }
  // East crosswalk
  for (let y = MID_H_STREET_Y + 6; y < MID_H_STREET_Y + MID_STREET - 6; y += cwGap + cwStripe) {
    rect(ctx, MID_V_STREET_X + MID_STREET + 4, y, 10, cwStripe, p.laneWhite);
  }

  // ----- Manhole covers, scattered, deterministic -----
  const manholes: Array<[number, number]> = [
    [EDGE_STREET / 2,             MID_H_STREET_Y + 22],
    [TILE_SIZE - EDGE_STREET / 2, MID_H_STREET_Y + 58],
    [MID_V_STREET_X + 22,         EDGE_STREET / 2],
    [MID_V_STREET_X + 58,         TILE_SIZE - EDGE_STREET / 2],
    [MID_V_STREET_X + MID_STREET / 2, MID_H_STREET_Y + MID_STREET / 2],
  ];
  for (const [mx, my] of manholes) {
    rect(ctx, mx - 7, my - 5, 14, 10, p.asphaltDark);
    rect(ctx, mx - 6, my - 4, 12, 8, p.metalDark);
    // cross-hatch detail
    rect(ctx, mx - 6, my, 12, 1, p.asphaltDark);
    rect(ctx, mx, my - 4, 1, 8, p.asphaltDark);
  }

  // ----- Parked cars — top-down, varied colors -----
  drawParkedCars(ctx, p, rng);
}

function drawParkedCars(ctx: CanvasRenderingContext2D, p: CityPalette, rng: RNG) {
  // Cars are ~22w × 38h facing north (windshield = north end).
  // Place along the right shoulder of every vertical street, bottom shoulder of every horizontal street.
  const colors = [p.car1, p.car2, p.car3, p.car4];

  // Cars on the vertical mid-street — parked along the curb adjacent to TR block (right lane facing up)
  let y = EDGE_STREET + SIDEWALK + 12;
  while (y < MID_H_STREET_Y - 50) {
    if (rng() > 0.30) {
      drawCarV(ctx, MID_V_STREET_X + MID_STREET - 26, y, pick(rng, colors), p, rng() < 0.5);
    }
    y += 48 + Math.floor(rng() * 14);
  }
  y = MID_H_STREET_Y + MID_STREET + 12;
  while (y < TILE_SIZE - EDGE_STREET - 40) {
    if (rng() > 0.35) {
      drawCarV(ctx, MID_V_STREET_X + 4, y, pick(rng, colors), p, rng() < 0.5);
    }
    y += 48 + Math.floor(rng() * 14);
  }

  // Cars on horizontal mid-street — parked along the curb at top
  let x = EDGE_STREET + SIDEWALK + 12;
  while (x < MID_V_STREET_X - 50) {
    if (rng() > 0.35) {
      drawCarH(ctx, x, MID_H_STREET_Y + 4, pick(rng, colors), p, rng() < 0.5);
    }
    x += 48 + Math.floor(rng() * 14);
  }
  x = MID_V_STREET_X + MID_STREET + 12;
  while (x < TILE_SIZE - EDGE_STREET - 40) {
    if (rng() > 0.30) {
      drawCarH(ctx, x, MID_H_STREET_Y + MID_STREET - 26, pick(rng, colors), p, rng() < 0.5);
    }
    x += 48 + Math.floor(rng() * 14);
  }
}

// 22w × 38h, facing north (or south if flipped)
function drawCarV(ctx: CanvasRenderingContext2D, x: number, y: number, body: string, p: CityPalette, flipped: boolean) {
  const w = 22, h = 38;
  // Shadow
  rect(ctx, x + 1, y + 1, w, h, p.asphaltDark);
  // Body
  rect(ctx, x, y, w, h, body);
  // Top highlight
  rect(ctx, x, y, w, 1, "#ffffff10");
  // Roof / cabin band
  rect(ctx, x + 3, y + 10, w - 6, 18, p.asphaltDark);
  // Windshield
  if (flipped) {
    rect(ctx, x + 4, y + 22, w - 8, 6, p.carGlass);
    // headlights at south end
    rect(ctx, x + 2, y + h - 3, 4, 2, "#f4e1a8");
    rect(ctx, x + w - 6, y + h - 3, 4, 2, "#f4e1a8");
  } else {
    rect(ctx, x + 4, y + 11, w - 8, 6, p.carGlass);
    // headlights at north end
    rect(ctx, x + 2, y + 1, 4, 2, "#f4e1a8");
    rect(ctx, x + w - 6, y + 1, 4, 2, "#f4e1a8");
  }
  // Wheel wells
  rect(ctx, x - 1, y + 8, 2, 5, p.asphaltDark);
  rect(ctx, x + w - 1, y + 8, 2, 5, p.asphaltDark);
  rect(ctx, x - 1, y + h - 13, 2, 5, p.asphaltDark);
  rect(ctx, x + w - 1, y + h - 13, 2, 5, p.asphaltDark);
}

// 38w × 22h, facing east (or west if flipped)
function drawCarH(ctx: CanvasRenderingContext2D, x: number, y: number, body: string, p: CityPalette, flipped: boolean) {
  const w = 38, h = 22;
  rect(ctx, x + 1, y + 1, w, h, p.asphaltDark);
  rect(ctx, x, y, w, h, body);
  rect(ctx, x, y, 1, h, "#ffffff10");
  rect(ctx, x + 10, y + 3, 18, h - 6, p.asphaltDark);
  if (flipped) {
    rect(ctx, x + 22, y + 4, 6, h - 8, p.carGlass);
    rect(ctx, x + 1, y + 2, 2, 4, "#f4e1a8");
    rect(ctx, x + 1, y + h - 6, 2, 4, "#f4e1a8");
  } else {
    rect(ctx, x + 11, y + 4, 6, h - 8, p.carGlass);
    rect(ctx, x + w - 3, y + 2, 2, 4, "#f4e1a8");
    rect(ctx, x + w - 3, y + h - 6, 2, 4, "#f4e1a8");
  }
  rect(ctx, x + 8, y - 1, 5, 2, p.asphaltDark);
  rect(ctx, x + 8, y + h - 1, 5, 2, p.asphaltDark);
  rect(ctx, x + w - 13, y - 1, 5, 2, p.asphaltDark);
  rect(ctx, x + w - 13, y + h - 1, 5, 2, p.asphaltDark);
}

// -----------------------------------------------------------------------------
// Sidewalks — concrete tiles with seam lines and occasional details.
// -----------------------------------------------------------------------------

function drawSidewalks(ctx: CanvasRenderingContext2D, p: CityPalette, rng: RNG) {
  // The sidewalk forms a frame around each block AND wraps around each city
  // corner. Easier to paint as 12 rectangles (4 per block × 4 blocks would
  // double-paint internal corners) — instead, paint the whole sidewalk frame
  // as two big H-bands and two big V-bands, then subtract the intersection
  // by overpainting asphalt back where the streets cross.

  // Horizontal sidewalk bands
  rect(ctx, 0, EDGE_STREET, TILE_SIZE, SIDEWALK, p.sidewalk);                                          // top
  rect(ctx, 0, MID_H_STREET_Y - SIDEWALK, TILE_SIZE, SIDEWALK, p.sidewalk);                            // above mid-h
  rect(ctx, 0, MID_H_STREET_Y + MID_STREET, TILE_SIZE, SIDEWALK, p.sidewalk);                          // below mid-h
  rect(ctx, 0, TILE_SIZE - EDGE_STREET - SIDEWALK, TILE_SIZE, SIDEWALK, p.sidewalk);                   // bottom
  // Vertical sidewalk bands
  rect(ctx, EDGE_STREET, 0, SIDEWALK, TILE_SIZE, p.sidewalk);
  rect(ctx, MID_V_STREET_X - SIDEWALK, 0, SIDEWALK, TILE_SIZE, p.sidewalk);
  rect(ctx, MID_V_STREET_X + MID_STREET, 0, SIDEWALK, TILE_SIZE, p.sidewalk);
  rect(ctx, TILE_SIZE - EDGE_STREET - SIDEWALK, 0, SIDEWALK, TILE_SIZE, p.sidewalk);

  // Paint asphalt back where the sidewalks cross the streets
  // (the four mid-street crossings + four edge-street crossings)
  const streetXs = [0, MID_V_STREET_X, TILE_SIZE - EDGE_STREET];
  const streetWs = [EDGE_STREET, MID_STREET, EDGE_STREET];
  const streetYs = [0, MID_H_STREET_Y, TILE_SIZE - EDGE_STREET];
  const streetHs = [EDGE_STREET, MID_STREET, EDGE_STREET];
  for (let i = 0; i < 3; i++) {
    rect(ctx, streetXs[i], 0, streetWs[i], TILE_SIZE, p.asphalt);
  }
  for (let i = 0; i < 3; i++) {
    rect(ctx, 0, streetYs[i], TILE_SIZE, streetHs[i], p.asphalt);
  }
  // Re-grain asphalt and re-draw lane markings & cars (they got overpainted).
  // Cheaper: just re-call drawStreets and skip cars to avoid doubling.
  // We DO want to re-draw lane markings & crosswalks, so re-run the streets pass
  // without cars. Trick: re-grain + re-stripe.
  ditherFill(ctx, 0, 0, TILE_SIZE, EDGE_STREET, p.asphaltLight, rng, 0.04);
  ditherFill(ctx, 0, TILE_SIZE - EDGE_STREET, TILE_SIZE, EDGE_STREET, p.asphaltLight, rng, 0.04);
  ditherFill(ctx, 0, 0, EDGE_STREET, TILE_SIZE, p.asphaltLight, rng, 0.04);
  ditherFill(ctx, TILE_SIZE - EDGE_STREET, 0, EDGE_STREET, TILE_SIZE, p.asphaltLight, rng, 0.04);
  ditherFill(ctx, 0, MID_H_STREET_Y, TILE_SIZE, MID_STREET, p.asphaltLight, rng, 0.04);
  ditherFill(ctx, MID_V_STREET_X, 0, MID_STREET, TILE_SIZE, p.asphaltLight, rng, 0.04);

  // Re-draw lane markings (yellow dashes)
  const midHy = MID_H_STREET_Y + MID_STREET / 2;
  const midVx = MID_V_STREET_X + MID_STREET / 2;
  const intersectionLeft   = MID_V_STREET_X - 8;
  const intersectionRight  = MID_V_STREET_X + MID_STREET + 8;
  const intersectionTop    = MID_H_STREET_Y - 8;
  const intersectionBottom = MID_H_STREET_Y + MID_STREET + 8;
  for (let x = 0; x < TILE_SIZE; x += 28) {
    if (x + 16 < intersectionLeft || x > intersectionRight) rect(ctx, x, midHy - 1, 16, 2, p.laneYellow);
    rect(ctx, x, EDGE_STREET / 2 - 1, 16, 2, p.laneYellow);
    rect(ctx, x, TILE_SIZE - EDGE_STREET / 2 - 1, 16, 2, p.laneYellow);
  }
  for (let y = 0; y < TILE_SIZE; y += 28) {
    if (y + 16 < intersectionTop || y > intersectionBottom) rect(ctx, midVx - 1, y, 2, 16, p.laneYellow);
    rect(ctx, EDGE_STREET / 2 - 1, y, 2, 16, p.laneYellow);
    rect(ctx, TILE_SIZE - EDGE_STREET / 2 - 1, y, 2, 16, p.laneYellow);
  }
  // Crosswalks
  const cwGap = 4, cwStripe = 4;
  for (let x = MID_V_STREET_X + 6; x < MID_V_STREET_X + MID_STREET - 6; x += cwGap + cwStripe) {
    rect(ctx, x, MID_H_STREET_Y - 14, cwStripe, 10, p.laneWhite);
    rect(ctx, x, MID_H_STREET_Y + MID_STREET + 4, cwStripe, 10, p.laneWhite);
  }
  for (let y = MID_H_STREET_Y + 6; y < MID_H_STREET_Y + MID_STREET - 6; y += cwGap + cwStripe) {
    rect(ctx, MID_V_STREET_X - 14, y, 10, cwStripe, p.laneWhite);
    rect(ctx, MID_V_STREET_X + MID_STREET + 4, y, 10, cwStripe, p.laneWhite);
  }

  // Manholes
  const manholes: Array<[number, number]> = [
    [EDGE_STREET / 2,             MID_H_STREET_Y + 22],
    [TILE_SIZE - EDGE_STREET / 2, MID_H_STREET_Y + 58],
    [MID_V_STREET_X + 22,         EDGE_STREET / 2],
    [MID_V_STREET_X + 58,         TILE_SIZE - EDGE_STREET / 2],
    [MID_V_STREET_X + MID_STREET / 2, MID_H_STREET_Y + MID_STREET / 2],
  ];
  for (const [mx, my] of manholes) {
    rect(ctx, mx - 7, my - 5, 14, 10, p.asphaltDark);
    rect(ctx, mx - 6, my - 4, 12, 8, p.metalDark);
    rect(ctx, mx - 6, my, 12, 1, p.asphaltDark);
    rect(ctx, mx, my - 4, 1, 8, p.asphaltDark);
  }

  // Re-draw parked cars
  drawParkedCars(ctx, p, rng);

  // ----- Sidewalk slab seam lines -----
  const seam = p.sidewalkDark;
  // Horizontal slab seams every 32px in the horizontal bands
  for (let x = 0; x < TILE_SIZE; x += 32) {
    rect(ctx, x, EDGE_STREET, 1, SIDEWALK, seam);
    rect(ctx, x, MID_H_STREET_Y - SIDEWALK, 1, SIDEWALK, seam);
    rect(ctx, x, MID_H_STREET_Y + MID_STREET, 1, SIDEWALK, seam);
    rect(ctx, x, TILE_SIZE - EDGE_STREET - SIDEWALK, 1, SIDEWALK, seam);
  }
  // Vertical slab seams every 32px in the vertical bands
  for (let y = 0; y < TILE_SIZE; y += 32) {
    rect(ctx, EDGE_STREET, y, SIDEWALK, 1, seam);
    rect(ctx, MID_V_STREET_X - SIDEWALK, y, SIDEWALK, 1, seam);
    rect(ctx, MID_V_STREET_X + MID_STREET, y, SIDEWALK, 1, seam);
    rect(ctx, TILE_SIZE - EDGE_STREET - SIDEWALK, y, SIDEWALK, 1, seam);
  }

  // Top highlight on each sidewalk band (1px lighter on the north edge)
  rect(ctx, 0, EDGE_STREET, TILE_SIZE, 1, p.sidewalkLight);
  rect(ctx, 0, MID_H_STREET_Y - SIDEWALK, TILE_SIZE, 1, p.sidewalkLight);
  rect(ctx, 0, MID_H_STREET_Y + MID_STREET, TILE_SIZE, 1, p.sidewalkLight);
  rect(ctx, 0, TILE_SIZE - EDGE_STREET - SIDEWALK, TILE_SIZE, 1, p.sidewalkLight);
}

// -----------------------------------------------------------------------------
// Block 1: APARTMENT — slate roof with parapet, mechanical equipment, skylights.
// -----------------------------------------------------------------------------

function drawApartmentBlock(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, p: CityPalette, rng: RNG) {
  drawRoofBase(ctx, x, y, w, h, p.roofSlate, p.roofSlateHi, p.parapet, p.parapetHi, rng);

  // Central pyramid skylight (lit atrium glow) — replaces the dark courtyard
  const cwx = x + 130, cwy = y + 150, cww = 140, cwh = 100;
  // Outer frame (raised parapet around skylight)
  rect(ctx, cwx - 4, cwy - 4, cww + 8, cwh + 8, p.parapet);
  rect(ctx, cwx - 4, cwy - 4, cww + 8, 1, p.parapetHi);
  rect(ctx, cwx - 4, cwy - 4, 1, cwh + 8, p.parapetHi);
  // Pyramid skylight — four triangular panels meeting at center
  const ccx = cwx + cww / 2;
  const ccy = cwy + cwh / 2;
  // Glow base
  rect(ctx, cwx, cwy, cww, cwh, p.windowGlowWarmDim);
  // Four "facets" approximated with diagonal scanlines
  for (let i = 0; i < cwh / 2; i++) {
    const inset = Math.floor(i * (cww / cwh));
    rect(ctx, cwx + inset, cwy + i, cww - inset * 2, 1, p.windowGlowWarm);
    rect(ctx, cwx + inset, cwy + cwh - 1 - i, cww - inset * 2, 1, p.windowGlowWarm);
  }
  // Bright center
  rect(ctx, ccx - 8, ccy - 4, 16, 8, "#fff2c0");
  rect(ctx, ccx - 4, ccy - 2, 8, 4, "#ffffff");
  // Cross muntins
  rect(ctx, ccx - 1, cwy, 2, cwh, p.metalDark);
  rect(ctx, cwx, ccy - 1, cww, 2, p.metalDark);
  // Diagonal muntins
  for (let i = 0; i < Math.min(cww, cwh) / 2; i += 2) {
    px(ctx, cwx + i, cwy + Math.floor(i * cwh / cww), p.metalDark);
    px(ctx, cwx + cww - 1 - i, cwy + Math.floor(i * cwh / cww), p.metalDark);
    px(ctx, cwx + i, cwy + cwh - 1 - Math.floor(i * cwh / cww), p.metalDark);
    px(ctx, cwx + cww - 1 - i, cwy + cwh - 1 - Math.floor(i * cwh / cww), p.metalDark);
  }

  // Row of AC units along the east edge
  for (let i = 0; i < 4; i++) {
    drawAC(ctx, x + w - 60, y + 40 + i * 70, p);
  }

  // Water tower in the NW corner area
  drawWaterTower(ctx, x + 40, y + 40, p);

  // Roof access door SW
  drawRoofAccess(ctx, x + 50, y + h - 80, p);

  // Small lit windows around the SW corner (suggests a stairwell)
  for (let i = 0; i < 3; i++) {
    rect(ctx, x + 40, y + h - 130 - i * 16, 28, 10, p.windowGlowWarmDim);
    rect(ctx, x + 42, y + h - 128 - i * 16, 24, 6, p.windowGlowWarm);
    // Window cross
    rect(ctx, x + 53, y + h - 128 - i * 16, 2, 6, p.windowGlowWarmDim);
  }

  // Antennas / satellite dishes
  drawSatDish(ctx, x + 240, y + 40, p);
  drawAntenna(ctx, x + 320, y + 40, p);
  drawAntenna(ctx, x + 90,  y + 280, p);

  // Pipe runs — long horizontal pipes connecting equipment
  rect(ctx, x + 90, y + 320, 220, 3, p.metalDark);
  rect(ctx, x + 90, y + 320, 220, 1, p.metalHi);
  rect(ctx, x + 90, y + 320, 3, 30, p.metalDark);
  rect(ctx, x + 308, y + 320, 3, 30, p.metalDark);

  // Pipes/vents scatter (south half)
  for (let i = 0; i < 4; i++) {
    const px2 = x + 40 + Math.floor(rng() * (w - 80));
    const py2 = y + 320 + Math.floor(rng() * 50);
    drawVent(ctx, px2, py2, p);
  }
}

// -----------------------------------------------------------------------------
// Block 2: PARK / PLAZA — grass, paths, trees, fountain, benches.
// -----------------------------------------------------------------------------

function drawParkBlock(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, p: CityPalette, rng: RNG) {
  // Grass base — slightly raised over street level, with stone perimeter
  rect(ctx, x, y, w, h, p.grass);
  // Grass dither — patches of darker and lighter grass
  ditherFill(ctx, x, y, w, h, p.grassDark, rng, 0.10);
  ditherFill(ctx, x, y, w, h, p.grassHi, rng, 0.05);

  // Stone perimeter wall (like a low park wall)
  rectStroke(ctx, x, y, w, h, p.sidewalkDark);
  rect(ctx, x + 1, y + 1, w - 2, 1, p.sidewalkLight);
  rect(ctx, x + 1, y + 1, 1, h - 2, p.sidewalkLight);

  // Cross path through the park (slightly bent)
  // Vertical path
  const pvx = x + Math.floor(w / 2) - 8;
  rect(ctx, pvx, y + 4, 16, h - 8, p.path);
  ditherFill(ctx, pvx, y + 4, 16, h - 8, p.pathHi, rng, 0.12);
  // Horizontal path
  const phy = y + Math.floor(h / 2) - 8;
  rect(ctx, x + 4, phy, w - 8, 16, p.path);
  ditherFill(ctx, x + 4, phy, w - 8, 16, p.pathHi, rng, 0.12);

  // Central circular plaza with fountain
  const cx = x + Math.floor(w / 2);
  const cy = y + Math.floor(h / 2);
  // Plaza ring (40px radius)
  ctx.fillStyle = p.path;
  filledCircle(ctx, cx, cy, 38);
  // Lighter inner ring
  ctx.fillStyle = p.pathHi;
  filledCircle(ctx, cx, cy, 30);
  ctx.fillStyle = p.path;
  filledCircle(ctx, cx, cy, 24);
  // Fountain basin (water)
  ctx.fillStyle = p.waterBlue;
  filledCircle(ctx, cx, cy, 18);
  ctx.fillStyle = p.waterBlueHi;
  filledCircle(ctx, cx, cy, 14);
  ctx.fillStyle = p.waterBlue;
  filledCircle(ctx, cx, cy, 8);
  // Center spray pillar
  rect(ctx, cx - 2, cy - 6, 4, 14, p.metal);
  rect(ctx, cx - 1, cy - 6, 2, 14, p.metalHi);
  // Highlight glints on water
  px(ctx, cx - 8, cy - 4, p.waterBlueHi);
  px(ctx, cx + 6, cy + 6, p.waterBlueHi);
  px(ctx, cx - 10, cy + 8, p.waterBlueHi);

  // Trees — clustered in the 4 quadrants away from paths
  const treeSpots: Array<[number, number]> = [];
  for (let i = 0; i < 14; i++) {
    let tx = x + 20 + Math.floor(rng() * (w - 40));
    let ty = y + 20 + Math.floor(rng() * (h - 40));
    // Stay off the paths and plaza
    if (Math.abs(tx - (x + w / 2)) < 18) continue;
    if (Math.abs(ty - (y + h / 2)) < 18) continue;
    if (Math.hypot(tx - cx, ty - cy) < 60) continue;
    treeSpots.push([tx, ty]);
  }
  // Sort south-to-north so trees overlap correctly
  treeSpots.sort((a, b) => a[1] - b[1]);
  for (const [tx, ty] of treeSpots) drawTree(ctx, tx, ty, p);

  // Benches along the paths
  drawBench(ctx, x + Math.floor(w / 2) - 32, phy - 12, "h", p);
  drawBench(ctx, x + Math.floor(w / 2) + 12, phy - 12, "h", p);
  drawBench(ctx, pvx - 12, y + Math.floor(h / 2) - 32, "v", p);
  drawBench(ctx, pvx - 12, y + Math.floor(h / 2) + 12, "v", p);

  // Park lamps at the four entry points (where paths meet wall)
  drawParkLamp(ctx, x + Math.floor(w / 2), y + 10, p);
  drawParkLamp(ctx, x + Math.floor(w / 2), y + h - 10, p);
  drawParkLamp(ctx, x + 10, y + Math.floor(h / 2), p);
  drawParkLamp(ctx, x + w - 10, y + Math.floor(h / 2), p);
}

// -----------------------------------------------------------------------------
// Block 3: INDUSTRIAL — flat roof, sawtooth skylight grid, smokestacks.
// -----------------------------------------------------------------------------

function drawIndustrialBlock(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, p: CityPalette, rng: RNG) {
  drawRoofBase(ctx, x, y, w, h, p.roofTar, p.roofTarHi, p.parapet, p.parapetHi, rng);

  // Sawtooth skylight pattern — 5 rows × 3 columns of north-facing skylights
  const startX = x + 50;
  const startY = y + 60;
  const cols = 3;
  const rows = 5;
  const cellW = 90;
  const cellH = 55;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const sx = startX + c * cellW;
      const sy = startY + r * cellH;
      drawSawtoothSkylight(ctx, sx, sy, 76, 40, p, rng);
    }
  }

  // Two smokestacks at the north edge
  drawSmokestack(ctx, x + 110, y + 28, p);
  drawSmokestack(ctx, x + 270, y + 28, p);

  // Big HVAC unit south-west
  drawBigHVAC(ctx, x + 30, y + h - 80, p);

  // Roof access bunker
  drawRoofAccess(ctx, x + w - 80, y + h - 70, p);

  // Stencil / industrial mark on the roof — a faint "C-7"
  rect(ctx, x + w - 70, y + 50, 28, 4, p.parapetHi);
  rect(ctx, x + w - 70, y + 50, 4, 24, p.parapetHi);
  rect(ctx, x + w - 70, y + 70, 28, 4, p.parapetHi);
  rect(ctx, x + w - 36, y + 50, 4, 28, p.parapetHi);
  rect(ctx, x + w - 36, y + 50, 16, 4, p.parapetHi);
}

// -----------------------------------------------------------------------------
// Block 4: COMMERCIAL — billboard, helipad, signage, mixed equipment.
// -----------------------------------------------------------------------------

function drawCommercialBlock(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, p: CityPalette, rng: RNG) {
  drawRoofBase(ctx, x, y, w, h, p.roofBrick, p.roofBrickHi, p.parapet, p.parapetHi, rng);

  // Helipad — large circle with "H" on the east side
  const hpx = x + w - 130;
  const hpy = y + 130;
  rect(ctx, hpx - 60, hpy - 60, 120, 120, p.roofTar);
  ctx.fillStyle = p.parapetHi;
  filledCircle(ctx, hpx, hpy, 54);
  ctx.fillStyle = p.roofTar;
  filledCircle(ctx, hpx, hpy, 50);
  ctx.fillStyle = p.laneWhite;
  filledCircle(ctx, hpx, hpy, 48);
  ctx.fillStyle = p.roofTar;
  filledCircle(ctx, hpx, hpy, 44);
  // "H" letter
  rect(ctx, hpx - 14, hpy - 16, 6, 32, p.laneWhite);
  rect(ctx, hpx + 8,  hpy - 16, 6, 32, p.laneWhite);
  rect(ctx, hpx - 14, hpy - 3,  28, 6, p.laneWhite);
  // Helipad corner markers
  for (const [cx2, cy2] of [[hpx - 52, hpy - 52], [hpx + 52, hpy - 52], [hpx - 52, hpy + 52], [hpx + 52, hpy + 52]] as const) {
    rect(ctx, cx2 - 2, cy2 - 2, 4, 4, p.signLight);
  }

  // Billboard — north edge, with an abstract LED-panel face (not text)
  const bbx = x + 30, bby = y + 28;
  const bbw = 180, bbh = 70;
  // Back support shadow
  rect(ctx, bbx - 4, bby + bbh - 2, bbw + 8, 6, p.parapet);
  // Mounting posts on roof
  rect(ctx, bbx + 14, bby + bbh, 4, 12, p.metalDark);
  rect(ctx, bbx + bbw - 18, bby + bbh, 4, 12, p.metalDark);
  // Frame
  rect(ctx, bbx, bby, bbw, bbh, p.sign);
  rect(ctx, bbx, bby, bbw, 2, p.signHi);
  rect(ctx, bbx, bby, 2, bbh, p.signHi);
  rect(ctx, bbx + bbw - 2, bby, 2, bbh, p.parapet);
  rect(ctx, bbx, bby + bbh - 2, bbw, 2, p.parapet);
  // Black inner panel
  rect(ctx, bbx + 6, bby + 6, bbw - 12, bbh - 12, "#0d1018");
  // LED-panel abstract content — a logo glyph on the left + a row of bars on the right
  // Logo: a stylized pigeon dot pattern (5x5 grid)
  const lgx = bbx + 14, lgy = bby + 16;
  const dot = (cx: number, cy: number, c: string) => rect(ctx, lgx + cx * 6, lgy + cy * 6, 5, 5, c);
  // "◉" looking pigeon silhouette in dots
  const logo: ReadonlyArray<readonly [number, number]> = [
    [2, 0],
    [1, 1], [2, 1], [3, 1],
    [0, 2], [1, 2], [2, 2], [3, 2], [4, 2],
    [1, 3], [2, 3], [3, 3],
    [0, 4], [4, 4],
  ];
  for (const [dx, dy] of logo) dot(dx, dy, p.signLight);
  // EQ-style bar graph (suggests "live data" / advertising)
  const barX0 = bbx + 70;
  const barY  = bby + bbh - 14;
  for (let i = 0; i < 12; i++) {
    const barH = 6 + Math.floor(rng() * 30);
    const cool = i % 3 === 0;
    rect(ctx, barX0 + i * 8, barY - barH, 5, barH, cool ? p.windowGlowCool : p.signLight);
    rect(ctx, barX0 + i * 8, barY - barH, 5, 1, "#ffffff");
  }
  // Two billboard floodlights mounted above
  rect(ctx, bbx + 20,         bby - 6, 14, 4, p.metalHi);
  rect(ctx, bbx + 20,         bby - 8, 14, 2, p.metalDark);
  rect(ctx, bbx + bbw - 34,   bby - 6, 14, 4, p.metalHi);
  rect(ctx, bbx + bbw - 34,   bby - 8, 14, 2, p.metalDark);

  // Solar panel array — fills the SW quadrant, slightly catches moonlight
  drawSolarArray(ctx, x + 30, y + h - 170, 140, 90, p);

  // AC unit row along south edge (bottom)
  for (let i = 0; i < 3; i++) {
    drawAC(ctx, x + 200 + i * 50, y + h - 50, p);
  }

  // Small lit corner sign post (illuminated signage on SE corner)
  rect(ctx, x + w - 32, y + h - 36, 4, 20, p.metalDark);
  rect(ctx, x + w - 56, y + h - 50, 42, 18, p.sign);
  rect(ctx, x + w - 56, y + h - 50, 42, 2, p.signHi);
  rect(ctx, x + w - 56, y + h - 50, 2, 18, p.signHi);
  // Sign content — three blinking-light dots and an arrow shape
  rect(ctx, x + w - 52, y + h - 44, 4, 4, p.signLight);
  rect(ctx, x + w - 44, y + h - 44, 4, 4, p.windowGlowWarm);
  rect(ctx, x + w - 36, y + h - 44, 4, 4, p.signLight);
  // arrow
  rect(ctx, x + w - 30, y + h - 42, 12, 2, p.windowGlowCool);
  rect(ctx, x + w - 22, y + h - 44, 2, 6, p.windowGlowCool);

  // Faint smaller helipad markings — outline of an approach lane on the NE corner
  rect(ctx, x + w - 80, y + 36, 28, 3, p.laneYellow);
  rect(ctx, x + w - 80, y + 44, 28, 3, p.laneYellow);
}

function drawSolarArray(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  p: CityPalette,
) {
  // Frame plinth
  rect(ctx, x, y, w, h, p.parapet);
  rect(ctx, x, y, w, 1, p.parapetHi);
  // Panels: 3 rows × 4 cols
  const cols = 4, rows = 3;
  const padX = 6, padY = 6;
  const gap = 3;
  const panelW = Math.floor((w - 2 * padX - (cols - 1) * gap) / cols);
  const panelH = Math.floor((h - 2 * padY - (rows - 1) * gap) / rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const px2 = x + padX + c * (panelW + gap);
      const py2 = y + padY + r * (panelH + gap);
      // Panel body — dark indigo
      rect(ctx, px2, py2, panelW, panelH, "#1a2236");
      // Cell grid (3x2 cells per panel)
      const cellW = Math.floor((panelW - 2) / 3);
      const cellH = Math.floor((panelH - 2) / 2);
      for (let cr = 0; cr < 2; cr++) {
        for (let cc = 0; cc < 3; cc++) {
          rect(ctx, px2 + 1 + cc * cellW, py2 + 1 + cr * cellH, cellW - 1, cellH - 1, "#22304a");
        }
      }
      // Highlight (suggests moonlight catch)
      rect(ctx, px2, py2, panelW, 1, "#3a5278");
      rect(ctx, px2, py2, 1, panelH, "#28385a");
    }
  }
}

// -----------------------------------------------------------------------------
// Shared building primitives
// -----------------------------------------------------------------------------

function drawRoofBase(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  body: string, hi: string, parapet: string, parapetHi: string,
  rng: RNG,
) {
  // Body
  rect(ctx, x, y, w, h, body);
  // Subtle grain
  ditherFill(ctx, x, y, w, h, hi, rng, 0.05);
  // Parapet — outer ring of 6px
  const t = 6;
  rect(ctx, x, y, w, t, parapet);             // top
  rect(ctx, x, y + h - t, w, t, parapet);     // bottom
  rect(ctx, x, y, t, h, parapet);             // left
  rect(ctx, x + w - t, y, t, h, parapet);     // right
  // Parapet top highlight (1px lighter on the north-facing side)
  rect(ctx, x, y, w, 1, parapetHi);
  rect(ctx, x, y, 1, h, parapetHi);
  // South shadow on parapet
  rect(ctx, x, y + h - 1, w, 1, "#000000");
  rect(ctx, x + w - 1, y, 1, h, "#000000");
}

function drawAC(ctx: CanvasRenderingContext2D, x: number, y: number, p: CityPalette) {
  // 28w × 22h
  rect(ctx, x + 1, y + 22, 28, 2, "#000a"); // shadow
  rect(ctx, x, y, 28, 22, p.ac);
  rect(ctx, x, y, 28, 1, p.acHi);
  rect(ctx, x, y, 1, 22, p.acHi);
  rect(ctx, x + 27, y, 1, 22, p.acDark);
  rect(ctx, x, y + 21, 28, 1, p.acDark);
  // Grille — horizontal vents
  for (let v = 0; v < 5; v++) {
    rect(ctx, x + 4, y + 4 + v * 4, 20, 2, p.acDark);
    rect(ctx, x + 4, y + 4 + v * 4, 20, 1, "#10131a");
  }
  // Fan circle on side
  // (omitted; top-down keeps it simple)
}

function drawWaterTower(ctx: CanvasRenderingContext2D, x: number, y: number, p: CityPalette) {
  // Footprint: 60×60 with circular tank
  // Legs at corners (small dark squares)
  rect(ctx, x, y, 8, 8, p.metalDark);
  rect(ctx, x + 52, y, 8, 8, p.metalDark);
  rect(ctx, x, y + 52, 8, 8, p.metalDark);
  rect(ctx, x + 52, y + 52, 8, 8, p.metalDark);
  // Frame
  rect(ctx, x + 4, y + 4, 52, 4, p.metal);
  rect(ctx, x + 4, y + 52, 52, 4, p.metal);
  rect(ctx, x + 4, y + 4, 4, 52, p.metal);
  rect(ctx, x + 52, y + 4, 4, 52, p.metal);
  // Cross bracing
  // Tank — circle
  const cx = x + 30, cy = y + 30;
  ctx.fillStyle = p.waterDark;
  filledCircle(ctx, cx, cy, 22);
  ctx.fillStyle = p.water;
  filledCircle(ctx, cx, cy, 20);
  ctx.fillStyle = p.waterHi;
  // Curved highlight on NW
  for (let dy = -18; dy <= -4; dy++) {
    const dx = Math.floor(Math.sqrt(20 * 20 - dy * dy));
    ctx.fillRect(cx - dx + 1, cy + dy, 4, 1);
  }
  // Conical cap (lid)
  ctx.fillStyle = p.waterDark;
  rect(ctx, cx - 4, cy - 24, 8, 4, p.waterDark);
  rect(ctx, cx - 2, cy - 26, 4, 2, p.waterDark);
  // Pipe going down
  rect(ctx, cx - 2, cy + 18, 4, 14, p.metal);
}

function drawSawtoothSkylight(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  p: CityPalette, rng: RNG,
) {
  // 3-bay sawtooth — vertical lit strips with metal supports
  // Footprint
  rect(ctx, x, y, w, h, p.metalDark);
  const bays = 3;
  const bayW = Math.floor((w - 4) / bays);
  for (let b = 0; b < bays; b++) {
    const bx = x + 2 + b * bayW;
    // Glass strip (warm or cool depending on rng)
    const warm = rng() < 0.55;
    const glow    = warm ? p.windowGlowWarm    : p.windowGlowCool;
    const glowDim = warm ? p.windowGlowWarmDim : p.windowGlowCoolDim;
    rect(ctx, bx, y + 2, bayW - 2, h - 4, glowDim);
    rect(ctx, bx + 1, y + 3, bayW - 4, h - 6, glow);
    // Mullion
    rect(ctx, bx + Math.floor(bayW / 2) - 1, y + 2, 1, h - 4, p.metalDark);
    // Support
    rect(ctx, bx, y + 2, 1, h - 4, p.metalHi);
  }
  // Top metal cap
  rect(ctx, x, y, w, 2, p.metal);
  rect(ctx, x, y, w, 1, p.metalHi);
  rect(ctx, x, y + h - 2, w, 2, p.metal);
}

function drawAntenna(ctx: CanvasRenderingContext2D, x: number, y: number, p: CityPalette) {
  rect(ctx, x, y, 6, 6, p.metalDark);
  rect(ctx, x + 2, y - 18, 2, 18, p.metalDark);
  rect(ctx, x - 2, y - 8, 10, 1, p.metalDark);
  rect(ctx, x - 1, y - 14, 8, 1, p.metalDark);
  // Red warning light
  px(ctx, x + 3, y - 19, "#ff5544");
}

function drawSatDish(ctx: CanvasRenderingContext2D, x: number, y: number, p: CityPalette) {
  // Base
  rect(ctx, x, y, 14, 8, p.metalDark);
  // Mount post
  rect(ctx, x + 6, y - 6, 2, 6, p.metalDark);
  // Dish (oval, top-down)
  ctx.fillStyle = p.metalHi;
  filledCircle(ctx, x + 7, y - 8, 8);
  ctx.fillStyle = p.metalDark;
  filledCircle(ctx, x + 7, y - 8, 6);
  ctx.fillStyle = p.metal;
  filledCircle(ctx, x + 7, y - 8, 5);
  px(ctx, x + 7, y - 8, p.metalHi);
}

function drawVent(ctx: CanvasRenderingContext2D, x: number, y: number, p: CityPalette) {
  rect(ctx, x, y, 10, 10, p.metalDark);
  rect(ctx, x + 1, y + 1, 8, 8, p.metal);
  rect(ctx, x + 2, y + 2, 6, 1, p.metalDark);
  rect(ctx, x + 2, y + 4, 6, 1, p.metalDark);
  rect(ctx, x + 2, y + 6, 6, 1, p.metalDark);
}

function drawRoofAccess(ctx: CanvasRenderingContext2D, x: number, y: number, p: CityPalette) {
  rect(ctx, x, y, 36, 28, p.parapet);
  rect(ctx, x + 2, y + 2, 32, 24, p.roofSlate);
  rect(ctx, x + 2, y + 2, 32, 1, p.roofSlateHi);
  // Door
  rect(ctx, x + 12, y + 8, 12, 18, p.parapet);
  rect(ctx, x + 14, y + 10, 8, 14, p.metalDark);
  // Handle
  px(ctx, x + 21, y + 17, p.metalHi);
}

function drawSmokestack(ctx: CanvasRenderingContext2D, x: number, y: number, p: CityPalette) {
  const r = 7;
  ctx.fillStyle = p.parapet;
  filledCircle(ctx, x, y, r + 2);
  ctx.fillStyle = p.metalDark;
  filledCircle(ctx, x, y, r);
  ctx.fillStyle = p.metal;
  filledCircle(ctx, x, y, r - 2);
  ctx.fillStyle = p.asphaltDark;
  filledCircle(ctx, x, y, r - 4);
  // Warning band
  rect(ctx, x - r, y - 2, r * 2, 1, "#d65a45");
}

function drawBigHVAC(ctx: CanvasRenderingContext2D, x: number, y: number, p: CityPalette) {
  // 60w × 50h industrial unit
  rect(ctx, x + 1, y + 50, 60, 2, "#000a");
  rect(ctx, x, y, 60, 50, p.ac);
  rect(ctx, x, y, 60, 2, p.acHi);
  rect(ctx, x, y + 48, 60, 2, p.acDark);
  rect(ctx, x, y, 2, 50, p.acHi);
  rect(ctx, x + 58, y, 2, 50, p.acDark);
  // Two big fans
  ctx.fillStyle = p.acDark;
  filledCircle(ctx, x + 16, y + 24, 12);
  filledCircle(ctx, x + 44, y + 24, 12);
  ctx.fillStyle = p.metal;
  filledCircle(ctx, x + 16, y + 24, 10);
  filledCircle(ctx, x + 44, y + 24, 10);
  // Fan blades — simple plus
  rect(ctx, x + 6, y + 23, 20, 2, p.acDark);
  rect(ctx, x + 15, y + 14, 2, 20, p.acDark);
  rect(ctx, x + 34, y + 23, 20, 2, p.acDark);
  rect(ctx, x + 43, y + 14, 2, 20, p.acDark);
}

// -----------------------------------------------------------------------------
// Park primitives
// -----------------------------------------------------------------------------

function drawTree(ctx: CanvasRenderingContext2D, x: number, y: number, p: CityPalette) {
  // Tree canopy ~24px diameter
  // Shadow
  ctx.fillStyle = p.treeShadow;
  filledCircle(ctx, x + 1, y + 3, 11);
  // Mid
  ctx.fillStyle = p.tree;
  filledCircle(ctx, x, y, 11);
  // Inner texture
  ctx.fillStyle = p.treeShadow;
  filledCircle(ctx, x + 2, y + 2, 5);
  // Highlights
  ctx.fillStyle = p.treeHi;
  filledCircle(ctx, x - 3, y - 3, 4);
  px(ctx, x - 5, y - 5, p.treeHi);
  px(ctx, x - 4, y, p.treeHi);
  px(ctx, x + 3, y - 4, p.treeHi);
}

function drawBench(ctx: CanvasRenderingContext2D, x: number, y: number, orient: "h" | "v", p: CityPalette) {
  if (orient === "h") {
    rect(ctx, x, y, 20, 4, p.water);
    rect(ctx, x, y, 20, 1, p.waterHi);
    // Legs
    rect(ctx, x + 1, y + 4, 2, 3, p.metalDark);
    rect(ctx, x + 17, y + 4, 2, 3, p.metalDark);
  } else {
    rect(ctx, x, y, 4, 20, p.water);
    rect(ctx, x, y, 1, 20, p.waterHi);
    rect(ctx, x + 4, y + 1, 3, 2, p.metalDark);
    rect(ctx, x + 4, y + 17, 3, 2, p.metalDark);
  }
}

function drawParkLamp(ctx: CanvasRenderingContext2D, x: number, y: number, p: CityPalette) {
  rect(ctx, x - 1, y - 1, 3, 3, p.metalDark);
  rect(ctx, x, y, 1, 1, p.lampCore);
  // Glow
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = p.lampGlow;
  filledCircle(ctx, x, y, 8);
  ctx.globalAlpha = 0.2;
  ctx.fillStyle = p.lampGlowOuter;
  filledCircle(ctx, x, y, 14);
  ctx.globalAlpha = 1;
}

// -----------------------------------------------------------------------------
// Streetlamps at corners, with glow pools that bleed across the street.
// -----------------------------------------------------------------------------

function drawStreetlamps(ctx: CanvasRenderingContext2D, p: CityPalette) {
  // Place lamps at the 8 corner positions of each block (corner-of-sidewalk).
  const lampSpots: Array<[number, number]> = [
    // Around TL block (corners outside)
    [EDGE_STREET + 8,                                                 EDGE_STREET + 8],
    [BLOCKS.TL.x + BLOCK + SIDEWALK / 2,                              EDGE_STREET + 8],
    [BLOCKS.TL.x + BLOCK + SIDEWALK / 2,                              MID_H_STREET_Y - 8],
    [EDGE_STREET + 8,                                                 MID_H_STREET_Y - 8],
    // Around TR
    [MID_V_STREET_X + MID_STREET + SIDEWALK / 2,                      EDGE_STREET + 8],
    [TILE_SIZE - EDGE_STREET - 8,                                     EDGE_STREET + 8],
    [TILE_SIZE - EDGE_STREET - 8,                                     MID_H_STREET_Y - 8],
    [MID_V_STREET_X + MID_STREET + SIDEWALK / 2,                      MID_H_STREET_Y - 8],
    // Around BL
    [EDGE_STREET + 8,                                                 MID_H_STREET_Y + MID_STREET + 8],
    [BLOCKS.BL.x + BLOCK + SIDEWALK / 2,                              MID_H_STREET_Y + MID_STREET + 8],
    [BLOCKS.BL.x + BLOCK + SIDEWALK / 2,                              TILE_SIZE - EDGE_STREET - 8],
    [EDGE_STREET + 8,                                                 TILE_SIZE - EDGE_STREET - 8],
    // Around BR
    [MID_V_STREET_X + MID_STREET + SIDEWALK / 2,                      MID_H_STREET_Y + MID_STREET + 8],
    [TILE_SIZE - EDGE_STREET - 8,                                     MID_H_STREET_Y + MID_STREET + 8],
    [TILE_SIZE - EDGE_STREET - 8,                                     TILE_SIZE - EDGE_STREET - 8],
    [MID_V_STREET_X + MID_STREET + SIDEWALK / 2,                      TILE_SIZE - EDGE_STREET - 8],
  ];

  for (const [x, y] of lampSpots) drawStreetlamp(ctx, x, y, p);
}

function drawStreetlamp(ctx: CanvasRenderingContext2D, x: number, y: number, p: CityPalette) {
  // Glow pool first, underneath the post
  ctx.globalAlpha = 0.10;
  ctx.fillStyle = p.lampGlowOuter;
  filledCircle(ctx, x, y, 22);
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = p.lampGlow;
  filledCircle(ctx, x, y, 14);
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = p.lampGlow;
  filledCircle(ctx, x, y, 6);
  ctx.globalAlpha = 1;
  // Base
  rect(ctx, x - 2, y - 2, 4, 4, p.metalDark);
  // Lamp head
  rect(ctx, x - 1, y - 1, 2, 2, p.lampCore);
  // Bright single-pixel highlight
  px(ctx, x, y, "#ffffff");
}
