# LSynC UI kit

Visual language: deep-indigo "light curtain" hero bands (`.hero-bg`), a
"Sexy Blue" brand scale (`brand-50 … brand-950`, anchor `#007BFF`, accent
`powder` `#B0E0E6`), white rounded-3xl cards, pill buttons, and soft shadows.
Light/dark is driven by `data-theme` on `<html>`; never hard-code white/black
text on surfaces — use the tokens below.

## Tokens (Tailwind colors)
| token | use |
|---|---|
| `bg-page` | app background |
| `bg-surface`, `bg-surface-2` | card / subtle fill |
| `border-line` | all borders & dividers |
| `text-ink`, `text-muted` | primary / secondary text |
| `brand-*`, `indigo-500/700/900`, `powder` | accents |
| `success`, `warning`, `danger` | status (support `/10` opacity etc.) |

## CSS classes (src/index.css)
- Surfaces: `card`, `card-hover`, `card-brand` (featured blue card, white text), `glass` (on hero), `hero-bg`
- Buttons: `btn` + `btn-primary | btn-secondary | btn-ghost | btn-danger | btn-light`, sizes `btn-sm | btn-lg`, `btn-icon`; `btn-orb` = white arrow circle inside a primary button
- Forms: `label`, `input` (works on input/select/textarea)
- Chips: `chip` + `chip-brand | chip-success | chip-warning | chip-danger | chip-neutral`; `eyebrow` (pill section tag)
- `icon-tile` (outlined circle holding an icon), `data-table`, `skeleton`

## Components (`@/components/ui/*`)
- `Page` — page shell: hero band (title/subtitle/eyebrow/back/actions/hero slot) + overlapping content column
- `Modal` — every dialog (title, description, icon, size, footer)
- `ConfirmDialog` — destructive confirmations
- `Menu`, `MenuContent`, `MenuItem` (`danger`), `MenuSeparator`, `RowActionsTrigger`
- `StatCard` (`tone`, `featured`), `EmptyState`, `Skeleton` / `LoadingCard`, `Field`, `SearchInput`, `Pagination`

## Hooks
- `useSearch(items, textFn, filterAccessors)` → `{ query, setQuery, filters, setFilter, reset, filtered }`
- `usePagination(items, pageSize)` → `{ pageItems, pagination }` (spread `pagination` into `<Pagination />`)

## Motion & blending
Built on GSAP (`@/lib/gsap` registers ScrollTrigger, SplitText, useGSAP), Lenis
smooth scrolling and React Bits-style components. All JS motion is skipped when
the OS asks for reduced motion; CSS motion is neutralised by a global rule.
- Global (automatic): every button/link/tab eases state changes and scales on
  press; arrows nudge on hover; `.btn` ripples on click; `.btn-primary` /
  `.btn-light` are magnetic; `.card-hover`, `.card-brand`, `.glass` get a
  cursor spotlight (`useInteractionMotion`, mounted once in App); views
  cross-fade (`.page-enter`); theme switches cross-fade (View Transitions).
- `.blend-bottom` / `.blend-top` fade full-width bands into the page — no hard
  edges. `Page` uses `.blend-bottom` and staggers its children (`.stagger`).
- Components (`@/components/motion/*`): `SplitText` (masked word/char rise),
  `CountUp` (numbers in `StatCard`), `Reveal` (ScrollTrigger fade/rise; `stagger`
  for children), `SmoothScroll` (Lenis ↔ GSAP ticker). Scrollable areas inside
  modals need `data-lenis-prevent`.
- Grow-from-origin: whatever the user presses is remembered (`lib/transition.ts`).
  View changes (`navigate` in App) grow the new page out of it via the View
  Transitions API (`growFrom`), after preloading that page's code; the theme
  switch spreads as a circle from the toggle; every `Modal` morphs out of the
  pressed element and flows back into it on close.
- Long tables: wrap in `<div data-lenis-prevent className="table-scroll">` — the
  table scrolls inside its card with a pinned header instead of the page.
