## NivaAd — Ultra-Modern Redesign

A full visual overhaul of NivaAd (marketing landing + in-app dashboard) using a **Noir & Gold** editorial aesthetic, **Space Grotesk / DM Sans** typography, and a **dashboard-panels** shell. No backend/logic changes — pure UI/presentation refresh across existing screens.

### Design direction

- **Palette (dark, high-contrast, luxury):**
  - Background `#0d0d0d`, surface `#141414`, elevated `#1a1a1a`
  - Border/hairline `#2a2620` (warm charcoal, not blue)
  - Primary gold `#c9a84c`, gold glow `#f0d78c`, gold muted `#8a7333`
  - Text primary `#f5f0e0`, muted `#8a8578`
  - Replace ALL current purple/cyan gradients — no `#4f46e5`, no `#22d3ee`
- **Typography:** Space Grotesk (headings, tight tracking, weight 500–700) + DM Sans (body/UI, 400/500). Loaded via `<link>` in `__root.tsx`.
- **Feel:** editorial luxury — thin gold hairlines, generous whitespace, restrained motion, subtle grain overlay on hero, gold-only accents (no rainbow gradients).

### Landing page (image 01)

- Eyebrow chip in hairline gold border, not filled
- Hero: Space Grotesk display, "Post everywhere." accented in gold gradient (`#c9a84c → #f0d78c`) — not blue
- Primary CTA: solid gold on black; secondary: ghost with hairline border
- Feature cards: flat, hairline borders, gold icon glyphs
- "Fresh from the studio" cards: keep 4-up grid, restyle chips to platform-neutral gold-tinted
- Footer: minimal, single row

### App shell (all in-app screens)

- **Sidebar:** black `#0d0d0d`, gold "NivaAd" wordmark, active item = gold left-bar + faint gold tint bg (replaces purple pill)
- **Credits card:** hairline border, gold progress bar, gold "Buy credits" button
- **Top area:** section title in Space Grotesk 32/40, gold underline accent
- **Cards/panels:** `#141414` bg, 1px `#2a2620` border, `rounded-xl`, subtle inner highlight

### Per-screen restyle (composition preserved)

1. **Create Ad** — stepper chips: active gold-filled, inactive hairline. Inputs dark with gold focus ring. Chips (Drive sales / Professional) gold when active.
2. **Campaigns** — form panel + empty state, gold "Generate" gradient button.
3. **Products / Schedule** — dashed empty-state borders switch to gold-tinted dashed.
4. **Brand Kit** — logo tile with gold gradient default; swatch row kept but swatches get gold ring on selected.
5. **Settings** — connection rows with platform mono-glyphs, "Connected" dot in gold-green, "Disconnect" as ghost. Plan card with gold "Buy credits" pill.
6. **Analytics** — 4 stat cards restyled; big numbers in Space Grotesk gold.
7. **Admin** — tab pills gold; stat grid restyled to match Analytics.

### Technical details

- Update `src/styles.css`:
  - Add Space Grotesk + DM Sans via root `<link>` (not `@import`)
  - Rewrite `:root` and `.dark` OKLCH tokens to Noir & Gold values (both light and dark map to dark palette — this is a dark-only app)
  - Add `--gradient-gold`, `--shadow-gold`, `--ring-gold` custom tokens
- Update `src/routes/__root.tsx` head(): real title/description "NivaAd — AI ad studio for product launches", og/twitter meta, Google Fonts `<link>` for Space Grotesk + DM Sans.
- Audit every route file under `src/routes/` and replace hardcoded colors (any `bg-purple-*`, `text-cyan-*`, `from-indigo-*`, hex literals) with semantic tokens.
- Refactor shared shell (sidebar, credits card, top nav) into `src/components/app-shell/` if not already extracted, so styles propagate everywhere.
- Add a `.grain` `@utility` (subtle noise overlay) applied to the landing hero only.
- No changes to routing, data, server functions, forms, or business logic.

### Out of scope

- No new features, no auth changes, no schema/DB work
- Icons: keep existing emojis for now (redesigning iconography is a separate pass)
- Mobile responsive polish beyond preserving current breakpoints