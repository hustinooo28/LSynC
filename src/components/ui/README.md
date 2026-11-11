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
