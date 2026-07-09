# Visual Identity Guide

This is the authoritative reference for PigeonCoop's game visual identity system. Any agent implementing visual features — node sprites, animations, backdrops, health bars, or the design system — must read this document first and keep it in sync with changes.

Other docs (`DESIGN_SPEC.md`, `PRD.md`, `DECISIONS.md`) reference this document rather than duplicating its content.

---

## 1. Visual philosophy

PigeonCoop sits at the intersection of a developer tool and a strategy game. The two references to hold in mind simultaneously:

- **Developer tool side:** `k9s`, `lazygit`, Insomnia — functional, keyboard-first, information-dense, never dumbed down
- **Game side:** classic 2D strategy games — units with identity, a living world map, resource bars, state changes you can feel

The result is not an arcade game reskin of a node editor. It is a systems monitor where the nodes feel like agents in the world, not boxes on a diagram.

### What this means in practice
- Every animation must communicate state, not just look good
- Sprites should be crisp and readable at the sizes they actually appear on canvas
- The backdrop enriches the environment without competing with node readability
- Health bars and resource indicators are data visualizations, not decorations
- When visual polish conflicts with clarity, clarity wins (same as DESIGN_SPEC.md §3)

---

## 2. Character sprite system

### Concept
Each node type is represented by a pixel-art character sprite. The sprite is the node's primary visual identity. It replaces the generic icon-in-header approach for node types that have dedicated characters.

The inaugural character is the **pigeon** — the PigeonCoop mascot — used for Agent nodes. As more characters are authored, each node type will receive its own.

### Rendering approach — procedural canvas (DEC-008)

Characters are drawn **procedurally on `<canvas>`** at runtime — no image assets. Each character is a hand-authored ASCII pixel grid (one string array per pose) mapped through a character→color legend, rendered by a drawing module. The canonical implementation is `apps/desktop/src/components/canvas/pigeonDrawing.ts`, integrated from the design handoff at `assets/design_handoff_city_backdrop_pigeon_sprites/` (high-fidelity: palettes and pixel grids are final — do not re-derive).

**Pigeon character contract** (`pigeonDrawing.ts` exports):
- Native grid: **26×24 px** (`NATIVE_W`, `NATIVE_H`), rendered at an integer scale with `image-rendering: pixelated`
- Side-view profile, faces right; `flipped` flag mirrors horizontally
- No background box, frame, or border — transparent canvas with a pixel-drawn drop-shadow ellipse under the feet
- Poses (`PoseName`): `idle`, `idleUp` (breathing variant), `stepA`/`stepB` (2-frame walk/run cycle), `hop` (succeeded), `down` (failed)
- `drawPigeon(ctx, opts)` renders one pose; `poseForState(state, frame)` maps the 8 node states to poses and cadences (see §3)
- Body palette: `PIGEON_PALETTE` — slate-grey body family matched to the city backdrop's palette, warm orange feet
- **State indication:** the neck-patch tint (`NECK_BY_STATE`) carries run state in the sprite itself — blue running, amber waiting/paused, green succeeded, red failed, grey idle/queued/skipped. Same semantic hues as the node glow system in `global.css`, so the sprite and border speak one state language.

**New character requirements** (Tool, Router, etc. — see §8):
- Hand-authored ASCII pixel grid + color legend in code, following the `pigeonDrawing.ts` pattern
- Native grid in the same scale family as the pigeon (~26×24)
- Hard pixel edges, transparent background, pixel-drawn drop shadow
- Colors drawn from the `NIGHT_PALETTE` / `PIGEON_PALETTE` families
- At minimum: idle, running, and one terminal pose; a state-tint area where the character design allows

### Legacy WebP sprite sheets

The original pipeline (superseded by DEC-008, retained as fallback assets only — do not extend):

Source: `assets/character-sprites/assets_2026-03-27/` · Runtime: `apps/desktop/public/sprites/` (Vite static, `/sprites/<filename>`)

| File | Dimensions | Frames | Frame size |
|---|---|---|---|
| `character_idle.webp` | 688×86px | 8 | 86×86px |
| `character_walk.webp` | 688×86px | 8 | 86×86px |
| `character_front_run_run.webp` | 688×86px | 8 | 86×86px |
| `character_jump.webp` | 688×86px | 8 | 86×86px |
| `character_hurt.webp` | 688×86px | 8 | 86×86px |
| `character_death.webp` | 1032×86px | 12 | 86×86px |

If static sheets are ever needed again (palette previews, export), render procedural poses to offscreen canvases and stitch — do not hand-author new image frames.

---

## 3. State-to-animation mapping

### Agent node (pigeon character)

Poses and cadences are defined by `poseForState(state, frame)` in `pigeonDrawing.ts`. The animation tick runs at ~100ms (~10 ticks/sec); "every N ticks" below is the pose-alternation cadence.

| Node state | Poses | Cadence | Neck tint | Notes |
|---|---|---|---|---|
| `idle` | `idle` ↔ `idleUp` | every 4 ticks | neutral grey | normal breathing |
| `queued` | `idle` ↔ `idleUp` | every 6 ticks | neutral grey | slower — pending, not active |
| `running` | `stepA` ↔ `stepB` | every tick | cool blue | fast run — conveys urgency |
| `waiting` | `stepA` ↔ `stepB` | every 3 ticks | warm amber | slow walk — moving, not progressing |
| `paused` | `idle` ↔ `idleUp` | every 12 ticks | deeper amber | very slow — system waiting on user |
| `succeeded` | `hop` | one-shot, holds | green | feet tucked, celebratory |
| `failed` | `down` | one-shot, holds | red | head slumped, eyes closed |
| `skipped` | `idle` ↔ `idleUp` | every 4 ticks | dim grey | plus node opacity 0.45 |

Exact tint hex values live in `NECK_BY_STATE` — import them, never re-transcribe.

### Implementation note — one-shot poses
`succeeded` and `failed` are single poses: draw once and hold. Do not keep alternating the tick for terminal states (matches the legacy `animation-iteration-count: 1; animation-fill-mode: forwards` behavior).

### Other node types
Tool nodes now use the procedural wrench-bot character (`ToolNode` + `ToolSprite`) with the same state tint and container glow language as the pigeon. Node types without dedicated characters continue using the text-based `WorkflowNode` component (icon + type abbreviation + state badge). State-based glow/ring animations from `global.css` still apply to these nodes. Procedural characters for the remaining node types are tracked in §8 — Roadmap.

---

## 4. Technical implementation

### Canvas rendering with a shared animation tick (DEC-008)
Sprites are drawn onto a `<canvas>` per node by the character's drawing module (`drawPigeon`). Animation is driven by a **single shared ~100ms tick** — one interval/rAF source feeding a frame counter to every sprite on the canvas. Never create one timer per node. On each tick, each sprite calls `poseForState(state, frame)` and redraws only if its pose changed.

Rules:
- One tick source for all sprites (a shared hook/context), ~10 ticks/sec
- Terminal states (`succeeded`/`failed`) draw once and hold — no further redraws
- `prefers-reduced-motion: reduce` freezes the tick; sprites hold their current pose
- Canvas size = native grid × integer scale; never fractional scales

**Implementation (SPRITE-002):** the shared tick lives in `apps/desktop/src/hooks/useAnimationTick.ts` as `useAnimationTick()`. It is a module-level singleton, not a React context: a single `setInterval(100ms)` starts on the first subscriber and stops when the last one unmounts, so any number of `PigeonSprite` instances share exactly one timer. `useAnimationTick` checks `window.matchMedia('(prefers-reduced-motion: reduce)')` before starting the interval — when reduced motion is requested, no interval is created and every sprite stays pinned to frame 0, which freezes each on its current pose. `PigeonSprite.tsx` (`apps/desktop/src/components/nodes/`) renders a `26×24` native-grid `<canvas>` at 3x integer scale (78×72 px display), calls `drawPigeon` in a `useEffect` keyed on `(state, frame, flipped)`, and guards `ctx === null` so it degrades safely in environments without 2D canvas support (e.g. jsdom in tests).

*(The previous CSS `steps()` sprite-sheet system remains documented in git history and applies only to the legacy WebP assets in §2. Do not build new animation on it.)*

### Pixel rendering
Always apply `image-rendering: pixelated` to sprite canvases. This preserves the crisp pixel-art appearance when React Flow zooms the canvas in or out. Draw with 1px-aligned `fillRect` calls only — no anti-aliasing, no CSS box-shadows on the art itself.

### Component structure (`AgentNode.tsx` + `PigeonSprite.tsx`)
```
<div className="ag-node wf-node wf-node--agent [state-classes]">
  <Handle type="target" position={Position.Top} />
  <PigeonSprite state={state} frame={sharedTick} />   ← <canvas className="ag-node-sprite">
  <div className="ag-node-health-bar" style={{ '--fill': contextPct }} />  ← optional
  <div className="ag-node-footer">
    <span className="ag-node-label">{label}</span>
    <span className="ag-node-state-badge">{state}</span>
  </div>
  <Handle type="source" position={Position.Bottom} />
</div>
```

The `AgentNode` component reuses `.wf-node` base classes so all existing state glow/ring animations (node-pulse, node-fail-flash, node-paused-blink) still apply at the border level. The sprite itself carries state via the neck-patch tint (§2); the character has no frame or box of its own.

### CSS class namespacing
- `.ag-node` — root element, agent-node specific overrides
- `.ag-node-sprite` — the sprite `<div>` (animation target)
- `.ag-node-health-bar` — context usage bar (see §5)
- `.ag-node-footer` — label + state badge row
- `.ag-node-label` — the node's display label
- `.ag-node-state-badge` — small text state indicator

---

## 5. Health bar — context / token usage

### Concept
Agent nodes that interact with an LLM provider have a finite context window. As the context fills, the agent node shows a visual health bar, communicating remaining capacity at a glance — the same way an RPG character's health bar communicates vitality.

### Data source
Token usage is emitted as part of agent lifecycle events (`agent.completed`; imported/provider-normalized `agent.response` events use the same token fields when present). The payload may include `tokens_used` and `context_limit`; consumers may derive `tokens_used` from `input_tokens + output_tokens` when `context_limit` is present. When token data is unavailable (provider does not expose it, or run has not started), the bar is hidden.

### Visual specification
- **Position:** narrow horizontal bar immediately below the sprite, above the footer
- **Height:** 4px
- **Width:** matches the rendered procedural pigeon sprite width (**78px**, 26px native grid at 3x scale)
- **Fill colors:**
  - <60% used: `#22c55e` (green — healthy)
  - 60–85% used: `#f59e0b` (amber — caution)
  - >85% used: `#ef4444` (red — critical)
- **Background:** `var(--color-border)` (empty portion)
- **Border-radius:** 2px
- **Transitions:** smooth fill changes via `transition: width 0.3s ease`
- **Hidden state:** `display: none` when `tokens_used` is null/undefined

### CSS
```css
.ag-node-health-bar {
  width: 78px;
  height: 4px;
  border-radius: 2px;
  background: var(--color-border);
  margin: 2px auto 0;
  overflow: hidden;
}

.ag-node-health-bar::after {
  content: '';
  display: block;
  height: 100%;
  width: calc(var(--fill, 0) * 1%);
  background: var(--health-color, #22c55e);
  border-radius: 2px;
  transition: width 0.3s ease, background 0.3s ease;
}
```

The `--fill` and `--health-color` CSS custom properties are set inline by the component based on the current token percentage.

### Considerations
- Do not show the bar during builder/design-time view — it has no runtime data
- In replay view, derive the bar fill from the event log at the scrubbed position
- If the provider caps context and the agent is approaching the limit, this is a key signal for the user — the bar should be impossible to miss at red

---

## 6. Game backdrop

### Concept
The canvas background is not a blank dark surface. It is a stylized game world — a top-down or isometric landscape through which the workflow graph is positioned. The backdrop provides environmental depth, reinforcing the "game map" feel without interfering with node readability.

### Design constraints
- The backdrop must never reduce the legibility of nodes, edges, or state indicators
- It must be static or very subtly animated (no motion that competes with node animations)
- It must work at all React Flow zoom levels (scale-agnostic or tiled)
- It must respect `prefers-reduced-motion: reduce` — animated backdrop elements must pause

### The city tile (DEC-008)
The backdrop is a **procedurally drawn, seeded pixel-art night cityscape** — no image assets. It is rendered by `drawCityTile(ctx, {seed, palette})` in `apps/desktop/src/components/canvas/cityDrawing.ts`, integrated from the design handoff at `assets/design_handoff_city_backdrop_pigeon_sprites/`. Same seed → same city, always.

Layout contract (all values are exported consts in `cityDrawing.ts` — import, never re-transcribe):
- **Tile:** 1024×1024 px (`TILE_SIZE`), seamless on all four edges — half-streets (`EDGE_STREET` = 40px) frame the tile so adjacent tiles join into full streets
- **City blocks:** 2×2 grid of 400×400 px rooftops (`BLOCK`) — Apartment, Park/Plaza, Industrial, Commercial — separated by 80px cross streets (`MID_STREET`), 16px sidewalks (`SIDEWALK`)
- **Scale anchor:** one block is ~4.6× a node — big enough to host a small flock of agent nodes on one rooftop
- **Palette:** `NIGHT_PALETTE` (~50 named colors); the pigeon's body palette is drawn from the same family
- **No text anywhere in the tile** (the billboard uses an abstract dot-logo + bar graph)
- Rendering: hard 1px-aligned `fillRect` calls, `image-rendering: pixelated`, streetlamp glows drawn last on top

### Implementation approach
- `CityBackdrop.tsx` (same handoff, target `apps/desktop/src/components/canvas/`) exports three variants:
  - `<CityBackdrop>` — static tiled div (repeating tile as background)
  - `<CityBackdropViewportSynced>` — **the one to use on the workflow canvas**; must be mounted inside `<ReactFlow>`, uses `useViewport()` to pan/scale with the graph so tiles never drift during zoom
  - `<CityBackdropCanvas>` — bare canvas, reserved for a future animated overlay layer
- Positioning/z-index/`prefers-reduced-motion` hooks live in `cityBackdrop.css` (target `apps/desktop/src/styles/`)
- The layer is non-interactive: `pointer-events: none`, below nodes/edges, above the app background; React Flow's `.react-flow__background` is hidden or replaced
- **Grid overlay:** the existing 48px CSS grid (`linear-gradient` at `--grid-color`) remains on top of the city tile, maintaining tactical-map readability — reduce its opacity if it fights the backdrop rather than removing it
- The backdrop is static in v1 (no animation loop); any future ambient animation goes through the `CityBackdropCanvas` variant and must honor the §6 constraints above

**Implementation (SPRITE-003):** `CityBackdropViewportSynced` is mounted inside the Builder and Live Run React Flow canvases so the seeded tile pans and scales with the graph viewport. React Flow's dot background is replaced by the shared `.wf-canvas-grid` 48px overlay above the tile and below graph nodes/edges. Replay's current graph-state panel is not a React Flow canvas yet, so it uses the static `CityBackdrop` variant behind derived node-state rows until the replay graph canvas is promoted.

---

## 7. Node palette preview

Once a procedural character exists for a node type, the drag-and-drop tile in `NodePalette.tsx` should show a static preview of the character's idle pose (render the `idle` pose once to a small canvas — no tick needed). This gives the user a visual match between the palette and the canvas.

Until a character exists: label-based tiles remain as-is.

---

## 8. Roadmap — future node type sprites

The target is one unique character per node type. Design priority order reflects how often users interact with each node type:

| Node type | Current state | Target character concept |
|---|---|---|
| Agent | procedural pigeon integrated (SPRITE-002) — `AgentNode` registered for the `agent` node type in `WorkflowCanvas` | pigeon — the primary actor |
| Tool | procedural wrench-bot integrated (SPRITE-005 slice) — `ToolNode` registered for the `tool` node type in `WorkflowCanvas` | wrench-bot or mechanical bird |
| Router | text-based | signpost character / traffic controller |
| Human Review | text-based | human silhouette / overseer |
| Memory | text-based | filing-cabinet bird or archive unit |
| Start | text-based | launch platform / flag |
| End | text-based | destination marker / nest |

Each new character is authored **procedurally in code** (DEC-008) — a hand-drawn ASCII pixel grid + color legend following the `pigeonDrawing.ts` pattern. No external asset creation is required. Each new character should:
- Match the pigeon's pixel-art style and scale family (~26×24 native grid, hard edges, pixel drop shadow)
- Draw its colors from the `NIGHT_PALETTE` / `PIGEON_PALETTE` families
- Have at minimum: `idle`, `running`, and a terminal pose (`succeeded` or `failed`), plus a state-tint area where the design allows
- Static node types (Start, End) may be single-pose landmarks (flag, nest) rather than animated characters

---

## 9. Accessibility

- All important state information communicated by animation or color must also be present as text (state badge) — color/motion alone is not sufficient
- `prefers-reduced-motion: reduce` must disable all animation: the shared sprite tick freezes (sprites hold their current pose — check `window.matchMedia('(prefers-reduced-motion: reduce)')` in the tick hook), and any CSS animation is suppressed:
  ```css
  @media (prefers-reduced-motion: reduce) {
    .ag-node-sprite { animation: none !important; }
  }
  ```
- Health bar fill level should be communicated via `aria-label` or `title` attribute
- State badge text must remain visible even when the sprite is the dominant visual element

---

## 10. File locations reference

| Purpose | Path |
|---|---|
| Design handoff (source of truth for backdrop + pigeon) | `assets/design_handoff_city_backdrop_pigeon_sprites/` |
| Pigeon drawing module | `apps/desktop/src/components/canvas/pigeonDrawing.ts` |
| City backdrop drawing module | `apps/desktop/src/components/canvas/cityDrawing.ts` |
| City backdrop React components | `apps/desktop/src/components/canvas/CityBackdrop.tsx` |
| City backdrop CSS | `apps/desktop/src/styles/cityBackdrop.css` |
| PigeonSprite component | `apps/desktop/src/components/nodes/PigeonSprite.tsx` |
| AgentNode component | `apps/desktop/src/components/nodes/AgentNode.tsx` |
| Tool drawing module | `apps/desktop/src/components/canvas/toolDrawing.ts` |
| ToolSprite component | `apps/desktop/src/components/nodes/ToolSprite.tsx` |
| ToolNode component | `apps/desktop/src/components/nodes/ToolNode.tsx` |
| Shared animation tick hook | `apps/desktop/src/hooks/useAnimationTick.ts` |
| Sprite CSS | `apps/desktop/src/styles/global.css` (ag-node section) |
| WorkflowCanvas registration | `apps/desktop/src/components/canvas/WorkflowCanvas.tsx` |
| WorkflowNode (text-based) | `apps/desktop/src/components/nodes/WorkflowNode.tsx` |
| Legacy WebP sprite sheets | `assets/character-sprites/<dated>/` → `apps/desktop/public/sprites/` |
