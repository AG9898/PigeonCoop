# Command Deck Generated Asset Manifest

Generated with the built-in Codex image generation tool on 2026-07-10. Runtime
copies are resized WebP assets in `apps/desktop/public/assets/command-deck/`.

Shared direction for role art: premium painterly MMO interface portrait,
refined concept-art finish, dark practical armor and materials, strong thumbnail
silhouette, graphite/steel/antique-gold palette, restrained cyan where relevant,
quiet dark background, no border or embedded UI. Every prompt excluded text,
letters, logos, watermarks, pigeons, birds, purple, and runtime status treatment.

| Runtime asset | Final subject prompt |
|---|---|
| `campaign-table.webp` | Overhead dark stone and gunmetal campaign command table with faint cartographic contours, branching routes, sparse brass inlay, and restrained cyan traces; wide, evenly detailed, low-contrast center |
| `role-start.webp` | Open blackened-steel expedition gateway with a raised dark campaign standard and a narrow path beginning beyond it |
| `role-agent.webp` | Focused arcane operator and tactician studying a small cyan projection between gloved hands |
| `role-tool.webp` | Battle-worn artificer and machine specialist holding a precision mechanism and short forging hammer |
| `role-router.webp` | Sharp-eyed pathfinder indicating a three-way illuminated route on a physical map |
| `role-memory.webp` | Vigilant archivist guarding a compact luminous memory reliquary made of glass, steel, and engraved brass |
| `role-review.webp` | Seasoned commander and adjudicator holding a decision seal with an open palm signaling deliberate pause |
| `role-end.webp` | Secured destination chamber with a completed expedition seal locked into a blackened-steel dais |

Role assets were generated as 1254x1254 PNG sources and resized to 384x384
WebP at quality 84. The canvas source was generated at 1672x941 and converted to
WebP at quality 86. Original tool outputs remain in the Codex generated-image
store; the application references only the optimized project copies.

## Animated sprite extension

Each role image was used as the identity reference for a second built-in
image-generation pass. The prompt requested a hand-painted full-body 2D RPG/MMO
sprite in an exact 2x2 grid on a flat `#ff00ff` key background. The four frames
form a short role-specific loop:

| Runtime strip | Loop |
|---|---|
| `sprites/role-agent-idle.webp` | arcane projection breath, brighten, adjust, settle |
| `sprites/role-tool-idle.webp` | inspect mechanism, raise, adjust, return |
| `sprites/role-router-idle.webp` | study map, open route, select branch, return |
| `sprites/role-memory-idle.webp` | hold reliquary, open, reveal glyphs, close |
| `sprites/role-review-idle.webp` | neutral, pause gesture, inspect seal, return |
| `sprites/role-start-idle.webp` | dormant gateway, brighten, activate, settle |
| `sprites/role-end-idle.webp` | dormant seal, ring light, completion pulse, settle |

The installed image-generation chroma-key helper removed the key with a soft
matte and despill. Pillow then extracted the four cells, resized them to 128x128,
and composed transparent 512x128 WebP strips at quality 88. Runtime state changes
the shared-clock cadence or holds a deterministic frame; the images do not encode
execution state.
