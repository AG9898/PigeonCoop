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
Each node type is represented by a pixel-art character sprite. The sprite is the node's primary visual identity. It replaces the generic icon-in-header approach for node types that have dedicated assets.

The inaugural character is the **pigeon** — the PigeonCoop mascot — used for Agent nodes. As more assets are created, each node type will receive its own character.

### Current sprite assets

Location: `assets/character-sprites/assets_2026-03-27/`
Runtime location: `apps/desktop/public/sprites/` (served as Vite static assets)

| File | Dimensions | Frames | Frame size | Intended state(s) |
|---|---|---|---|---|
| `character_idle.webp` | 688×86px | 8 | 86×86px | idle, queued, paused, skipped |
| `character_walk.webp` | 688×86px | 8 | 86×86px | waiting |
| `character_front_run_run.webp` | 688×86px | 8 | 86×86px | running |
| `character_jump.webp` | 688×86px | 8 | 86×86px | succeeded |
| `character_hurt.webp` | 688×86px | 8 | 86×86px | (reserved — transition to death) |
| `character_death.webp` | 1032×86px | 12 | 86×86px | failed |

PNG versions exist alongside each WebP as fallback. Prefer WebP (40–55% smaller).

### Asset format requirements
- **Format:** WebP sprite sheets; PNG as explicit fallback
- **Layout:** horizontal strip, left-to-right frame order
- **Frame size:** must be square; document the px value per character set
- **Background:** transparent (RGBA)
- **Naming:** `character_<animation_name>.webp` for the Agent/pigeon set; `<node_type>_<animation_name>.webp` for other node types once those assets exist
- **Storage:** source assets in `assets/character-sprites/<dated-folder>/`; built/deployed copies in `apps/desktop/public/sprites/`

---

## 3. State-to-animation mapping

### Agent node (pigeon character)

| Node state | Sprite | Loop | Speed | Notes |
|---|---|---|---|---|
| `idle` | `character_idle` | ∞ | 1.0s / 8 steps | default, resting |
| `queued` | `character_idle` | ∞ | 1.6s / 8 steps | slower — pending, not active |
| `running` | `character_front_run_run` | ∞ | 0.55s / 8 steps | fast — conveys urgency |
| `waiting` | `character_walk` | ∞ | 1.0s / 8 steps | moving but not progressing |
| `paused` | `character_idle` | ∞ | 2.5s / 8 steps | very slow — system waiting on user |
| `succeeded` | `character_jump` | 1× | 0.6s / 8 steps | plays once, holds last frame |
| `failed` | `character_death` | 1× | 1.0s / 12 steps | plays once, holds last frame |
| `skipped` | `character_idle` | ∞ | 1.0s / 8 steps | same as idle but node opacity 0.45 |

### Implementation note — one-shot animations
For `succeeded` and `failed`, use `animation-iteration-count: 1` with `animation-fill-mode: forwards`. The sprite freezes on the final frame after playing once.

### Other node types
Node types without dedicated sprite assets continue using the text-based `WorkflowNode` component (icon + type abbreviation + state badge). State-based glow/ring animations from `global.css` still apply to these nodes. Sprite assets for the remaining node types will be added in future sprints (see §8 — Roadmap).

---

## 4. Technical implementation

### CSS sprite sheet animation
All animation is driven by CSS `steps()` keyframes on `background-position-x`. No JavaScript animation timers.

```css
/* Generic 8-frame keyframe */
@keyframes ag-sprite-8 {
  to { background-position-x: -688px; }
}

/* Generic 12-frame keyframe */
@keyframes ag-sprite-12 {
  to { background-position-x: -1032px; }
}

/* Per-state example */
.ag-node-sprite[data-state="running"] {
  background-image: url('/sprites/character_front_run_run.webp');
  background-size: 688px 86px;
  animation: ag-sprite-8 0.55s steps(8) infinite;
}

.ag-node-sprite[data-state="failed"] {
  background-image: url('/sprites/character_death.webp');
  background-size: 1032px 86px;
  animation: ag-sprite-12 1.0s steps(12) 1 forwards;
}
```

### Pixel rendering
Always apply `image-rendering: pixelated` to sprite elements. This preserves the crisp pixel-art appearance when React Flow zooms the canvas in or out.

### Component structure (`AgentNode.tsx`)
```
<div className="ag-node wf-node wf-node--agent [state-classes]">
  <Handle type="target" position={Position.Top} />
  <div className="ag-node-sprite" data-state={state} />
  <div className="ag-node-health-bar" style={{ '--fill': contextPct }} />  ← optional
  <div className="ag-node-footer">
    <span className="ag-node-label">{label}</span>
    <span className="ag-node-state-badge">{state}</span>
  </div>
  <Handle type="source" position={Position.Bottom} />
</div>
```

The `AgentNode` component reuses `.wf-node` base classes so all existing state glow/ring animations (node-pulse, node-fail-flash, node-paused-blink) still apply at the border level. The sprite layer adds the character identity on top.

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
Token usage is emitted as part of agent lifecycle events (`agent.completed`, `agent.response`). The Rust adapter populates `tokens_used` and `context_limit` in the event payload when the provider exposes this data. When token data is unavailable (provider does not expose it, or run has not started), the bar is hidden.

### Visual specification
- **Position:** narrow horizontal bar immediately below the sprite, above the footer
- **Height:** 4px
- **Width:** matches sprite width (86px at native scale)
- **Fill colors:**
  - 0–60% used: `#22c55e` (green — healthy)
  - 60–85% used: `#f59e0b` (amber — caution)
  - 85–100% used: `#ef4444` (red — critical)
- **Background:** `var(--color-border)` (empty portion)
- **Border-radius:** 2px
- **Transitions:** smooth fill changes via `transition: width 0.3s ease`
- **Hidden state:** `display: none` when `tokens_used` is null/undefined

### CSS
```css
.ag-node-health-bar {
  width: 86px;
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

### Planned visual elements
- **Ground layer:** pixel-art terrain tiles (grass, cobblestone, or circuit-board motif) as a repeating background behind the canvas
- **Environmental details:** scattered ambient elements (small pixel objects, shadows) that add life without cluttering
- **Grid overlay:** the existing 48px CSS grid (`linear-gradient` at `--grid-color`) remains on top of the terrain, maintaining the tactical-map readability
- **Parallax (optional):** very subtle parallax between backdrop and node layer when panning — depth effect, not distraction

### Implementation approach
- Backdrop is a `<div>` positioned behind the React Flow canvas, using `background-image` with a tiled PNG/WebP terrain sheet
- React Flow's `.react-flow__background` is hidden or replaced
- Zoom sync: backdrop scale is tied to React Flow's transform via a CSS variable or inline style, so terrain tiles don't drift as the user zooms

### Asset requirements
- Terrain tile: seamless repeating square (e.g. 64×64px or 128×128px)
- Format: WebP, pixel-art style matching the character sprites
- Storage: `assets/backdrops/<name>.webp` → deployed to `apps/desktop/public/backdrops/`

---

## 7. Node palette preview

Once sprite assets exist for a node type, the drag-and-drop tile in `NodePalette.tsx` should show a static 1-frame preview of the character's idle pose (first frame = `background-position-x: 0`). This gives the user a visual match between the palette and the canvas.

Until assets exist: label-based tiles remain as-is.

---

## 8. Roadmap — future node type sprites

The target is one unique character per node type. Design priority order reflects how often users interact with each node type:

| Node type | Current state | Target character concept |
|---|---|---|
| Agent | pigeon sprite (implemented) | pigeon — the primary actor |
| Tool | text-based | wrench-bot or mechanical bird |
| Router | text-based | signpost character / traffic controller |
| Human Review | text-based | human silhouette / overseer |
| Memory | text-based | filing-cabinet bird or archive unit |
| Start | text-based | launch platform / flag |
| End | text-based | destination marker / nest |

Each new character should:
- Match the pixel-art style and frame dimensions of the existing pigeon set (86×86px per frame)
- Have at minimum: `idle`, `running`, and a terminal state (`succeeded` or `failed`)
- Be stored in a dated asset folder matching the convention in §2

---

## 9. Accessibility

- All important state information communicated by animation or color must also be present as text (state badge) — color/motion alone is not sufficient
- `prefers-reduced-motion: reduce` must disable all CSS animations, including sprite sheet animation and backdrop motion. Apply:
  ```css
  @media (prefers-reduced-motion: reduce) {
    .ag-node-sprite { animation: none !important; }
  }
  ```
- Health bar fill level should be communicated via `aria-label` or `title` attribute
- State badge text must remain visible even when the sprite is the dominant visual element

---

## 10. File locations reference

| Purpose | Source path | Deployed path |
|---|---|---|
| Character sprite assets | `assets/character-sprites/<dated>/` | `apps/desktop/public/sprites/` |
| Backdrop tile assets | `assets/backdrops/` | `apps/desktop/public/backdrops/` |
| AgentNode component | `apps/desktop/src/components/nodes/AgentNode.tsx` | — |
| Sprite CSS | `apps/desktop/src/styles/global.css` (ag-node section) | — |
| WorkflowCanvas registration | `apps/desktop/src/components/canvas/WorkflowCanvas.tsx` | — |
| WorkflowNode (text-based) | `apps/desktop/src/components/nodes/WorkflowNode.tsx` | — |
