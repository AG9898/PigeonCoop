# Visual Identity Guide

This guide defines Agent Arcade's game-forward visual identity. It is the
authoritative reference for generated artwork, node-role identity, color,
typography, motion, and canvas atmosphere.

## 1. Identity

Agent Arcade should feel like an RPG command interface built with the rigor of
a modern creative tool. The game influence is central, but the language and
interaction model remain developer-native.

The visual metaphor is a **campaign command table**:

- workflows are composed operations, not decorative flowcharts
- node roles read like a coordinated party without renaming technical concepts
- a live run feels active and consequential
- replay feels like inspecting the record of an encounter

Avoid faux-medieval copy, ornamental overload, pixel-art nostalgia, generic
cyberpunk neon, and fantasy decoration that competes with execution state.

## 2. Visual principles

1. **Technical clarity first.** Labels, status, configuration, event payloads,
   terminal output, and validation errors remain the strongest information.
2. **Game identity through hierarchy.** Portraits, role marks, resource meters,
   illuminated routes, and deliberate motion carry the RPG layer.
3. **Creative-tool discipline.** Use compact controls, stable panel geometry,
   consistent spacing, familiar icons, and predictable selection behavior.
4. **Atmosphere behind content.** Artwork sits below nodes and data with enough
   contrast suppression to preserve legibility at every zoom level.
5. **State is never decorative.** Color and motion always correspond to engine
   state or user focus.

## 3. Palette

The product is dark-only in this phase. Use a neutral graphite foundation with
several distinct semantic families rather than a one-note blue or purple UI.

| Role | Direction |
|---|---|
| Base | near-black graphite with a cool cast |
| Raised surfaces | charcoal and gunmetal |
| Primary accent | pale arcane cyan |
| Focus / premium action | muted antique gold |
| Running | cyan |
| Waiting / review | amber |
| Succeeded | verdant green |
| Failed | crimson |
| Technical metadata | cool grey |

Gold is reserved for focus, selection, and primary action. Cyan communicates
active systems. Neither color should flood entire panels.

## 4. Typography and iconography

- Use bundled **Manrope Variable** for controls, labels, node content, and dense
  information. Do not depend on platform font availability.
- Use bundled **Marcellus** only for the Agent Arcade product mark and similarly
  rare identity moments.
- Use bundled **IBM Plex Mono** for ids, paths, timestamps, commands, payloads,
  keyboard hints, and terminal-adjacent data.
- Letter spacing is `0`; hierarchy comes from weight, size, case, and contrast.
- Use Lucide icons for familiar actions. Do not use Unicode symbols as toolbar
  icons when a standard icon exists.
- Pair unfamiliar icon-only controls with tooltips and accessible labels.

## 5. Generated art system

Generated assets are authored as one coherent dark-fantasy operations family:

- painterly game-interface illustration, not photorealism or pixel art
- strong silhouettes and readable subjects at small sizes
- graphite, steel, muted cyan, old gold, crimson, and moss-green accents
- no embedded text, logos, watermarks, UI chrome, or critical status information
- controlled lighting and restrained detail at the edges

Runtime assets live in `apps/desktop/public/assets/command-deck/`. Source-quality
outputs may live under `assets/generated/command-deck/` when retention is useful.

### 5.1 Canvas environment

The canvas uses a wide illustrated campaign-map surface: dark stone or metal,
faint cartographic markings, route traces, and subtle table illumination. It must
tile or cover without exposing a focal subject behind nodes. A dark overlay and
code-native grid sit above it.

### 5.2 Animated role sprites and portrait fallbacks

Every role has a four-frame animated character or landmark sprite. Humanoid roles
use full-body character loops; Start and End use animated landmarks. Square
portrait art remains behind each sprite as atmosphere and as a fallback if a
sprite request fails.

| Node | Identity |
|---|---|
| Start | lit gateway or expedition standard |
| Agent | focused arcane operator / tactician |
| Tool | armored artificer / machine specialist |
| Router | pathfinder at a branching map |
| Memory | archivist or guarded memory vault |
| Human Review | commanding adjudicator |
| End | secured destination or completed seal |

Generated frames are identity and pose, not execution truth. Runtime state remains
code-native through borders, badges, meters, tint, and cadence so replay stays
deterministic and accessible.

Runtime sprite sheets live under
`apps/desktop/public/assets/command-deck/sprites/`. Each strip contains four
128x128 frames in a single 512x128 transparent WebP. The source generation layout
is a 2x2 chroma-key sheet; local post-processing removes the key, extracts the
four cells in reading order, and composes the runtime strip.

All node instances subscribe to the singleton `useAnimationTick()` clock. Never
create a timer per node. Cadence is state-dependent: running is fast, idle is
deliberate, waiting is slow, and paused/terminal states hold a deterministic frame.

### 5.3 Empty states

Empty-state art may use a quiet command table or dormant map motif. It must not
replace the visible action required to create or import a workflow.

## 6. Node presentation

All node types share a stable card footprint and anatomy:

1. animated role sprite over its portrait fallback
2. technical node-kind label
3. user-defined label
4. state badge
5. optional resource or token meter
6. explicit connection handles

Selection uses a gold focus edge plus a restrained outer highlight. Running uses
cyan route energy, waiting/review uses amber, success uses a stable green mark,
and failure uses a high-contrast crimson treatment. Color is always paired with
text or icon shape.

## 7. Canvas atmosphere

- The generated environment is rendered as a non-interactive layer below graph
  content and above the base surface.
- A code-native grid and vignette keep graph positions readable.
- Nodes and edges must remain clear at minimum and maximum supported zoom.
- Mini-map, controls, selection rectangles, and dialogs use the same panel system.
- The old procedural city and pigeon/wrench sprite renderers are retired rather
  than extended.

## 8. Motion

- Running nodes use a controlled cyan perimeter sweep or pulse.
- Active edges use directional motion.
- Waiting and review states use a slow amber hold signal.
- Failure gets one brief impact treatment, then becomes static.
- Panels use short opacity/transform transitions only when spatial continuity is
  useful.
- `prefers-reduced-motion` disables nonessential animation while retaining state.

Short sprite loops are the primary ambient motion on the canvas. Avoid adding
independent portrait, backdrop, or panel motion around them.

## 9. Accessibility and asset fallbacks

- Generated images are `aria-hidden` when decorative.
- Role and state names are always available as text.
- Every important state meets contrast requirements and is not color-only.
- Missing images fall back to code-native role icons without changing layout.
- Artwork loading must not shift panels or node dimensions.
- `prefers-reduced-motion` prevents the shared tick from starting and holds frame
  zero.
- At 1280x720 and larger, labels, controls, inspector fields, timeline, and output
  remain usable without incoherent overlap.

## 10. Verification

Before visual work is considered complete:

- capture the full workspace at 1280x720, 1440x900, and 1920x1080
- inspect design, live-tail, scrubbed replay, waiting review, failed run, and empty
  states where fixtures allow
- verify generated asset requests succeed and fallback icons preserve layout
- verify at least one idle sprite advances frames and reduced motion freezes it
- verify reduced motion and keyboard focus indicators
- run frontend unit tests, production build, and the headed E2E suite
