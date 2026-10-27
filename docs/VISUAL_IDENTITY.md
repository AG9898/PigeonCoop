# Visual Identity Guide

**Accepted target, 2026-10-27 (DEC-014, refined by DEC-015). Implementation pending.**

## 1. Identity

PigeonCoop is a local project workflow and inspection tool used alongside a coding
assistant. Its visual identity should help developers read activity, task
dependencies, changes, evidence, and interventions quickly.

The new direction is a **pixel-character workspace**: small bit/pixel characters
make agents and their activity recognizable within a working project. Design a
new interface, composition, and asset family. The existing RPG/MMO art, portraits,
sprites, fantasy chrome, and backdrops are retired design inputs; do not recolor
them or use them as new-UI fallback art. Earlier pigeon sprites and procedural
city assets are not a ready-made substitute either.

The visualizer still explains project work, evidence, intervention, and replay.
Pixel characters give that work identity without replacing technical vocabulary,
readable controls, or recorded state.

### Character and workspace vocabulary

- A character represents an identified assistant/worker session. A fresh worker
  cycle keeps its own identity; do not imply one persistent worker did all tasks.
- A station represents a task/phase context, such as planning, working, checking,
  or review. It does not create a new workflow node type.
- Dependencies and routing are explicit relationships, not guessed paths through
  a decorative room. Default connections appear as one agent visiting another:
  approach, face the other character, interact, then settle. Stations/props are
  optional. Selection/diagnostic inspection reveals the exact underlying graph;
  spatial moves and animation are presentation only.
- Selecting a character/station reveals its task/run/evidence. State labels and
  unknown/stale coverage remain readable without animation.
- More characters do not grant permission to spawn workers or change the
  template's one-worker-per-cycle execution contract.

Character species, room/board composition, sprite dimensions, and palette belong
to the fresh design pass. The name does not require reusing existing pigeon art.
No new assets or application redesign have shipped yet.

The user prefers the second generated character study (V2). Its
[retained concept](../assets/concepts/pigeoncoop-character-v2-draft.png) is the
character direction for further studies, not an animation-ready atlas. See
[VISUAL_PROTOTYPE_PLAN.md](VISUAL_PROTOTYPE_PLAN.md) for the proposed asset pipeline
and first scene test. Renderer/library recommendations there are not yet decisions.

The visual reference is the compact, warm, living-world pixel language and
elevated three-quarter top-down framing of
[Sunnyside World](https://danieldiggle.itch.io/sunnyside). Prefer square-aligned
orthographic terrain/stations with visible tops and fronts, not diagonal diamond
isometric tiles. Character studies and proposed idle frames are drafts; pixel
alignment, transparency, frame anchors, and animation timing require validation
before deployment.

Production assets target sprite-sheet/atlas playback: idle, walking and
interaction clips with consistent frame bounds, foot anchors, facing, timing and
interaction offsets. Keep identity stable across clips. A Rust visual runtime
can sample clips independently of desktop drawing; terminal equivalents preserve
the visit/interaction meaning without raster playback. Walking does not prove
routing, communication, work starting or completion.

## 2. Information hierarchy

1. Project/task/run identity and current recorded state.
2. Current operation, blocking reason, review request, or failure.
3. Evidence: changed files, checks, artifacts, prompts, commands, and output.
4. Timing, source, ownership, recording coverage, and other supporting context.

Keep workflow structure, task dependencies, and file changes visually distinct.
Topology helps explain relationships; it should not compete with evidence or
become the mandatory entry point for every action.

## 3. Shared semantics

Use text labels plus consistent status accents across desktop and terminal:

| Meaning | Presentation |
|---|---|
| Active recorded operation | restrained active accent + label |
| Human attention / blocked work | amber + specific reason |
| Recorded success | green + source/evidence context |
| Recorded failure | red + failure detail |
| Cancelled / skipped | neutral treatment + explicit label |
| Missing/stale coverage | separate warning/unknown cue, not a terminal status |
| Pending control request | pending label, distinct from acknowledgment/outcome |
| Simulation / replay | persistent explicit mode label |

Do not invent percentages, confidence, token totals, or health bars where the
source has not supplied measurable data. Animation may indicate an active
recorded operation; it cannot prove liveness after contact is lost.

## 4. Desktop direction

Build a fresh workspace composition rather than reskin the current node editor.
Pair crisp pixel characters and compact task/phase stations with readable normal
interface typography and evidence panels. Use intentional pixel grids and integer
art scaling where practical; do not pixelate output, diffs, labels, or the entire
webview. Pixel styling does not require a game engine or new desktop renderer.

Use restrained surfaces, readable contrast, compact but comfortable density,
stable selection, familiar controls, clear typography, and limited motion.
Paths, IDs, commands, and code use a legible monospace face; ordinary navigation
uses a readable interface font. Existing bundled fonts may be reused without
preserving the fantasy product mark.

Support keyboard focus and non-color state cues. Avoid ornamental borders,
large atmospheric artwork, or a required full-screen canvas obscuring work.
Choose detailed palette, spacing, and component tokens in the implementation
design pass; this document does not imply a new theme has shipped.

## 5. Terminal direction

Translate identities and stations into small cell-based portraits, block/ASCII
characters, status markers, and task lists. Desktop sprites need not render
literally in terminal cells. Provide plain ASCII/text fallback when block glyphs,
color, or width support is limited. Preserve identity and selection in fallback.

Use layouts that remain legible in native Windows and Linux terminals. Provide
text labels, keyboard hints, truncation/wrapping rules for long paths, and
scrollable details. Handle terminal resizing and reduced color capability.
Avoid relying on emoji, wide glyphs, or exact font metrics to convey state.

The full-screen terminal workspace is optional. CLI structured output and MCP
protocol streams contain no decorative styling or terminal control sequences.

## 6. Existing assets and verification

Artwork under apps/desktop/public/assets/command-deck/ and
assets/generated/command-deck/ is retired from the new design. Older public
sprite/backdrop assets and procedural city/pigeon renderers are also legacy,
not replacement-UI fallbacks. Files remain solely to keep the current app working
until replacement. Remove active imports/deployed legacy art during migration;
handle source/archive cleanup explicitly. This doc pass deletes no assets.

Create a fresh coherent pixel asset family after desktop and terminal design
studies establish shared shapes, identities, and reduced-detail fallbacks.
Asset tooling and raster versus code-native generation are not fixed here.

Check desktop and terminal layouts using real project names, long paths, dense
task lists, failed checks, lost owner contact, and missing artifacts. Record
native Windows and Linux verification separately. Semantics must match across
clients even when their layouts differ. Include reduced-motion/static characters,
missing-new-art text fallbacks, small terminal sizes, and ASCII-only rendering.
Old RPG art must not reappear when new art is missing.
