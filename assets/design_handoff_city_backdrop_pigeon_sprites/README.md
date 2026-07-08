# Handoff: Pixel-Art City Backdrop & Pigeon Agent Sprites

## Overview

Two connected visual pieces for PigeonCoop's Builder/Live Run canvas:

1. **City Backdrop** — a procedurally-drawn, seamless pixel-art night cityscape that
   sits behind the React Flow graph as the "game world" the workflow lives in
   (per `docs/VISUAL_IDENTITY.md` §6).
2. **Pigeon Agent Sprite** — a procedurally-drawn pixel-art pigeon character used
   to represent Agent nodes, matched to the backdrop's palette, with no
   surrounding frame/box. It replaces the flat sprite-sheet approach described
   in `VISUAL_IDENTITY.md` §2 with a code-driven drawing routine (still
   exportable to sprite sheets later if you want static WebP assets instead).

Both pieces are **built entirely with `<canvas>` 2D drawing calls** — no SVG, no
raster source images. Everything is procedural and seeded/deterministic, so
the same seed always produces the same output.

## About the Design Files

The files in this bundle are **design references built in HTML/TS/JSX** —
prototypes proving out the visual language, scale, and drawing approach. They
are not meant to be copied into the Tauri app verbatim as pages. However,
unlike a typical hifi mockup, the two core `.ts` drawing modules
(`cityDrawing.ts`, `pigeonDrawing.ts`) and the React wrapper
(`CityBackdrop.tsx`) **are already written as real TypeScript/React source**
targeting this repo's actual paths and conventions — they should be usable
close to as-is inside `apps/desktop/src/components/canvas/`, with light
integration work (see Files section below).

The `index.html` / `Pigeon Sprites.html` pages and their `*-app.jsx` /
`*-loader.js` companions exist only so the drawing logic could be previewed
live in this design tool (which runs plain HTML/Babel, not a Vite+TS build).
Do not port those loader/demo files into the app — they are scaffolding to
view the real `.ts` modules, not app code.

## Fidelity

**High-fidelity.** Exact colors, exact pixel layout (down to the individual
pixel grid for the pigeon), and exact scale/dimensional relationships are
final and intended to be used as-is. The developer should integrate the two
`.ts` drawing modules directly rather than re-deriving the pixel art.

## Screens / Views

### 1. City Backdrop (`index.html` preview)

**Purpose:** Behind-the-graph environment for the Builder/Live Run canvas —
gives the workflow a "game map" feel per the mission-control visual philosophy.

**Layout / scale contract** (all constants live in `cityDrawing.ts`):
- Reference unit: the existing pigeon agent node sprite = **86×86 px**
  (from `VISUAL_IDENTITY.md` §2 frame size).
- Tile size: **1024×1024 px**, seamless on all four edges (adjacent tiles
  tile with zero visible seam — half-streets on every outer edge join into
  full streets when repeated).
- City block (rooftop): **400×400 px** (~4.6× a node — large enough to host
  a small flock of agent nodes on one rooftop).
- Street width: **80 px** (mid-tile cross streets).
- Edge half-street width: **40 px** (so the seam lands mid-street).
- Sidewalk width: **16 px**.
- Layout: 2×2 grid of distinct city blocks separated by a cross-street, with
  half-streets framing the tile edge so tiles repeat cleanly:
  - Top-left: **Apartment** block — slate roof, pyramid skylight/atrium glow,
    water tower, AC row, roof access door, lit stairwell windows, antennas,
    satellite dish, pipe runs.
  - Top-right: **Park/Plaza** block — grass, cross paths, central fountain
    plaza, ~14 scattered trees, benches, corner lamps.
  - Bottom-left: **Industrial** block — tar roof, 5×3 sawtooth skylight grid
    (warm/cool mixed glass), two smokestacks, large twin-fan HVAC unit, roof
    access bunker, stencil roof marking.
  - Bottom-right: **Commercial** block — brick roof, helipad with "H" and
    corner markers, LED billboard (abstract pigeon-dot logo + animated-style
    bar graph — no literal text), solar panel array, AC row, neon corner
    sign, faint helipad approach-lane markings.
- Streets carry: dashed yellow lane lines, white crosswalk stripes at the
  intersection, manhole covers, and parked cars (top-down, two orientations,
  4 body colors, randomly placed along curbs).
- 16 streetlamps at block corners, each with a layered radial glow that
  bleeds onto the street (drawn last, on top of everything).

**Components / values:**
- Palette: `NIGHT_PALETTE` object in `cityDrawing.ts` — ~50 named colors
  covering asphalt, sidewalk, roof materials (slate/brick/tar/copper),
  equipment (AC/water/metal), glows (warm/cool window, lamp), park
  (grass/path/tree/water), cars, and signage. All hex values are final.
- No typography (pixel-art only, no text rendering — the billboard uses an
  abstract dot-logo + bar graph rather than literal letterforms, since
  cramped pixel-font text did not read well at this scale).
- Rendering: `image-rendering: pixelated` throughout; the whole tile is drawn
  with hard 1px-aligned `fillRect` calls (no anti-aliasing, no gradients
  except the `radial`-style pixel glows built from concentric filled circles).

**Hover/active/focus states:** none — this is a static background layer,
non-interactive (`pointer-events: none`), consistent with
`VISUAL_IDENTITY.md §6`'s "must never reduce legibility, must be static or
very subtly animated" constraint.

**Content/copy:** none (no literal text anywhere in the tile).

### 2. Pigeon Agent Sprite (`Pigeon Sprites.html` preview)

**Purpose:** Visual identity for Agent nodes — a pixel-art pigeon character,
matched stylistically to the city backdrop, that communicates run state
through its own coloring rather than a separate frame/box/ring.

**Layout / scale:**
- Native pixel grid: **26 × 24 px** (close to, but not required to exactly
  match, the existing 86×86 frame budget — the character itself is smaller
  than the frame with headroom for the drop shadow; see Integration Notes).
- Side-view (profile), faces **right** by default; `flipped` flag mirrors
  horizontally for left-facing use.
- No background box, no square frame, no border — the sprite is drawn on a
  fully transparent canvas with a soft pixel-art drop shadow ellipse under
  the feet (a set of filled horizontal scanlines, not a CSS box-shadow).

**Components:**
- Body drawn from a hand-authored ASCII pixel grid (one string array per
  pose) mapped through a character→color legend — see "Pixel legend" in
  `pigeonDrawing.ts` header comment.
- **Poses** (`PoseName` union): `idle`, `idleUp` (1px head-raise breathing
  variant), `stepA`/`stepB` (2-frame walk/run leg-cycle — rear-planted vs.
  front-planted), `hop` (feet tucked under, used for `succeeded`), `down`
  (head slumped, eyes closed, used for `failed`).
- `poseForState(state, frame)` maps each of the 8 node states to a pose and
  an animation cadence:
  - `idle` / `skipped`: idle↔idleUp every 4 ticks (normal breathing)
  - `queued`: idle↔idleUp every 6 ticks (slower)
  - `paused`: idle↔idleUp every 12 ticks (very slow — "waiting on you")
  - `waiting`: stepA↔stepB every 3 ticks (slow walk)
  - `running`: stepA↔stepB every 1 tick (fast run)
  - `succeeded`: `hop` (single pose; caller should freeze/hold last frame if
    exporting to a one-shot sprite sheet)
  - `failed`: `down` (single pose; hold last frame)

**Colors (exact hex, `PIGEON_PALETTE` in `pigeonDrawing.ts`):**
| Token | Hex | Use |
|---|---|---|
| outline | `#0c0e14` | body outline, beak dark edge |
| bodyDark | `#22293a` | crown/shadow-side feathers |
| body | `#3a4256` | main body — matches backdrop's `roofSlateHi`/`sidewalkLight` family |
| bodyHi | `#525a72` | wing highlight |
| belly | `#6a7388` | chest/belly lighter feathers |
| beak | `#181922` | beak base |
| beakHi | `#2a2330` | beak highlight pixel |
| eye | `#0a0c10` | eye |
| eyeHi | `#d8dde8` | eye catch-light pixel |
| foot | `#d65a3a` | legs/feet — pulled from backdrop's warm window-glow family |
| footHi | `#f08458` | foot highlight |
| shadow | `rgba(0,0,0,0.55)` | drop-shadow ellipse under feet |

**State neck-patch tints (`NECK_BY_STATE`)** — this is the state indicator,
replacing a separate glow ring around a frame:
| State | Mid | Highlight |
|---|---|---|
| idle | `#6a7388` | `#8d96aa` (neutral grey) |
| queued | `#6a7388` | `#8d96aa` (same as idle) |
| running | `#3e8ec0` | `#7cc0e8` (cool blue) |
| waiting | `#b8862a` | `#f0b048` (warm amber) |
| paused | `#c87a28` | `#f0a058` (deeper amber) |
| succeeded | `#3a9358` | `#6ec880` (green) |
| failed | `#a83828` | `#e0644c` (red) |
| skipped | `#4a5266` | `#6a7388` (dim grey) |

These state colors intentionally reuse the same semantic hues as the
existing node-state glow system in `global.css` (blue=running,
amber=waiting/paused, green=success, red=failed) so the pigeon reads
consistently with the rest of the state language.

**Hover/active/focus states:** not defined at the sprite-drawing layer — the
existing `.wf-node` border/glow states (`node-pulse`, `node-fail-flash`,
`node-paused-blink`) should still be applied at the node-container level, the
same way `AgentNode.tsx` currently layers them around the sprite (see
`VISUAL_IDENTITY.md` §4, "Component structure").

**Content/copy:** none — visual-only.

## Interactions & Behavior

- **City backdrop:** none. Static/non-interactive layer, `pointer-events: none`.
- **Pigeon sprite:** the demo page's `useAnimationTick` hook advances a frame
  counter roughly every 100ms (~10 ticks/sec) and calls `poseForState` to
  choose the current pose. In the real app this cadence should be driven the
  same way the existing CSS `steps()` sprite-sheet animations are timed (see
  `VISUAL_IDENTITY.md` §3 table) — i.e. `running` should feel urgent/fast,
  `paused` should feel almost still.
- No click handlers, drag, or navigation logic in either piece — both are
  purely decorative/representational layers meant to sit behind or inside
  existing interactive React Flow nodes.
- `succeeded` and `failed` are conceptually one-shot poses (matching the
  existing `animation-iteration-count: 1; animation-fill-mode: forwards`
  approach for `character_jump`/`character_death`) — hold on `hop`/`down`
  rather than looping, if wiring into a state machine rather than the demo's
  free-running tick.
- Respect `prefers-reduced-motion: reduce` — pause the tick advance (freeze
  on the current pose) the same way `VISUAL_IDENTITY.md` §9 requires for the
  existing sprite-sheet system.

## State Management

- City backdrop: none beyond a `seed` (number) and optional `palette` object,
  both passed as props to `<CityBackdrop>`/`<CityBackdropViewportSynced>`.
- Pigeon sprite: needs the node's current lifecycle `state` (one of the 8
  values already defined by the app's node/run state machine — no new states
  introduced) and a running `frame`/tick counter for animation. No data
  fetching; purely a function of `(state, frame, flipped, scale)`.

## Design Tokens

**Colors** — see full tables above (`NIGHT_PALETTE` ~50 tokens in
`cityDrawing.ts`; `PIGEON_PALETTE` + `NECK_BY_STATE` in `pigeonDrawing.ts`).
All values are also directly importable as TS consts — no need to
re-transcribe hex codes by hand.

**Spacing / scale:**
- City: `TILE_SIZE=1024`, `BLOCK=400`, `MID_STREET=80`, `EDGE_STREET=40`,
  `SIDEWALK=16` (all exported consts).
- Pigeon: `NATIVE_W=26`, `NATIVE_H=24` (exported consts). Demo default hero
  scale is 10× (260×240 px display); state-row default is 3× (78×72 px).

**Typography:** none in either asset (pixel-art only). The demo *pages'* own
UI chrome (HUD labels, inspector panel) uses
`ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace`
at 9–14px — matches the existing app's developer-tool aesthetic but is not
part of the deliverable itself.

**Border radius / shadows:** none on the pixel-art itself (deliberately hard
pixel edges, no rounding, no CSS box-shadow — the only "shadow" is the
pixel-drawn drop-shadow ellipse under the pigeon's feet, and drop-shadow
filters on canvases in the demo UI chrome for depth, which are cosmetic to
the preview, not the asset).

## Screenshots

Located in `screenshots/`:
- `city-backdrop-overview.png` — the city tile at ~85% zoom with the sample
  Plan→Execute→Critique→Approve workflow (placeholder nodes) overlaid to show
  node-to-city scale.
- `city-backdrop-tile-full.png` — same view, for reference.
- `pigeon-sprite-hero-running.png` — hero pigeon at 10× scale in the
  `running` state (cyan neck patch), city backdrop visible behind.
- `pigeon-sprite-states-succeeded.png` — `succeeded` state (green neck patch,
  hop pose).
- `pigeon-sprite-states-failed.png` — `failed` state (red neck patch, slumped
  pose, closed eye).
- `pigeon-sprite-pixel-grid.png` — reference pixel-grid overlay on the hero
  sprite, useful for confirming the 26×24 native grid alignment.

## Assets

No external image/font/icon assets used. Everything is generated at runtime
by canvas draw calls in `cityDrawing.ts` and `pigeonDrawing.ts`. A reference
sprite sheet was reviewed for style calibration only (not copied or reused):
`assets/character-sprites/assets_2026-03-27/character_idle.png` (existing
repo asset — informed proportions/pose language, none of its pixels were
copied).

If you want static exported sprite sheets (matching the WebP pipeline
described in `VISUAL_IDENTITY.md` §2/§10) instead of runtime canvas drawing,
that's a follow-up: render each pose to an offscreen canvas per frame and
stitch horizontally, then export as WebP into
`apps/desktop/public/sprites/`. Not done in this handoff — ask if you want it.

## Files

### Ready to integrate (real TS/TSX, repo-pathed)
- `src/cityDrawing.ts` → target: `apps/desktop/src/components/canvas/cityDrawing.ts`
  Procedural city tile renderer. Exports `drawCityTile(ctx, {seed, palette})`,
  `NIGHT_PALETTE`, `TILE_SIZE`, `mulberry32` (seeded RNG), and layout consts.
- `src/pigeonDrawing.ts` → target: `apps/desktop/src/components/canvas/pigeonDrawing.ts`
  Procedural pigeon sprite renderer. Exports `drawPigeon(ctx, opts)`,
  `PIGEON_PALETTE`, `NECK_BY_STATE`, `NATIVE_W`, `NATIVE_H`, `poseForState`.
- `src/CityBackdrop.tsx` → target: `apps/desktop/src/components/canvas/CityBackdrop.tsx`
  React wrapper exporting three variants: `<CityBackdrop>` (static tiled div),
  `<CityBackdropViewportSynced>` (must be mounted inside `<ReactFlow>`, uses
  `useViewport()` to pan/scale with the graph), `<CityBackdropCanvas>` (bare
  canvas for future animated overlay layering).
- `src/cityBackdrop.css` → target: `apps/desktop/src/styles/cityBackdrop.css`
  (or append into existing `global.css`). Positioning, `image-rendering`,
  z-index, and `prefers-reduced-motion` hook for the backdrop div/canvas.

### Integration notes (not yet written — do in the target repo)
- **No `PigeonSprite.tsx` component exists yet.** Build one following the
  `AgentNode.tsx` structure already documented in `VISUAL_IDENTITY.md` §4,
  but swap the `<div className="ag-node-sprite">` (CSS sprite-sheet
  background) for a `<canvas>` that calls `drawPigeon` on mount/state change,
  or wire `poseForState` into the existing CSS `steps()` keyframe system if
  you'd rather pre-render frame strips (see Assets section above).
- Decide whether to replace the existing WebP-based pigeon sprite pipeline
  (`character_idle.webp` etc., §2 of `VISUAL_IDENTITY.md`) entirely with this
  procedural approach, or keep both (e.g. procedural for the canvas backdrop
  preview / this new smaller sprite scale, WebP frames for the main node
  sprite at 86×86). This handoff does not make that call — flag it as an
  open decision for `docs/DECISIONS.md`.
- `docs/VISUAL_IDENTITY.md` §6 ("Game backdrop") and §2/§3 (character sprite
  system) should be updated to reference this procedural approach once
  integrated, since they currently describe a WebP-sheet-only pipeline.

### Reference/preview only — do not port into the app
- `index.html`, `demo-app.jsx`, `demo.css`, `loader.js` — live preview of the
  city backdrop with placeholder pigeon nodes and a sample
  Plan→Execute→Critique→Approve workflow overlaid for scale-checking. The
  loader fetches and Babel-transpiles the real `.ts` files at runtime purely
  so this design tool (plain HTML, no Vite/TS build step) could preview them
  live — this fetch+transpile mechanism has no equivalent need in the actual
  Vite/TS app, which compiles `.ts` natively.
- `Pigeon Sprites.html`, `sprites-app.jsx`, `sprites.css`, `sprites-loader.js`
  — same purpose, focused on the pigeon sprite alone (hero view + all 8
  states + palette inspector).
- `tweaks-panel.jsx` — this design tool's in-page tweak-control shell, used
  by `demo-app.jsx` for the seed/overlay toggles. Not part of the product.
