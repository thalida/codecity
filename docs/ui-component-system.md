# UI Component System — Design Spec

Companion to `docs/ui-component-audit.md`. The audit documents what's
**in** the file today. This doc defines what the system **becomes**.

Goal: every selector composes from a shared layer of tokens and component
classes. No selector re-implements something a sibling component already
covers. Changing a token or a base class propagates everywhere.

---

## 1. Architecture

Three layers, top-down:

```
┌─────────────────────────────────────────────────────────┐
│ Layer 3 — Page / Feature CSS                            │
│   Layout-only rules for #app-header, #sidebar, etc.     │
│   No colors, fonts, radii, padding declarations of      │
│   their own — they USE the component classes.           │
├─────────────────────────────────────────────────────────┤
│ Layer 2 — Component classes (the "kit")                 │
│   .surface, .text-*, .btn-*, .row, .card, .badge,       │
│   .form-input, .label-section, .dot, .pane-body, etc.   │
│   Each defines one role end-to-end.                     │
├─────────────────────────────────────────────────────────┤
│ Layer 1 — Tokens (atomic vars)                          │
│   --cc-color-*, --cc-space-*, --cc-radius-*,            │
│   --cc-font-*, --cc-fw-*, --cc-transition-*, etc.       │
└─────────────────────────────────────────────────────────┘
```

A selector in Layer 3 should set only **layout** properties
(`display`, `flex`, `grid`, `position`, `width`, `height`, `overflow`,
container `gap`) plus references to Layer 2 classes via the DOM. Every
other property — colors, fonts, padding, radius, transitions, borders,
shadows — is provided by Layer 2 or by tokens.

---

## 2. Token system (Layer 1)

### 2.1 Spacing scale

One scale for padding, margin, gap. 4px-baseline with two off-grid steps
that are heavily used today (3px and 10px). Values not on this scale
get rounded to the nearest step at migration time (visual change ≤ 1px).

| Token | Value | Today's uses (sample) |
|---|---|---|
| `--cc-space-0` | `0` | reset, paddingless containers |
| `--cc-space-1` | `2px` | tight icon gaps, slider track radius input |
| `--cc-space-2` | `3px` | row vertical padding |
| `--cc-space-3` | `4px` | gap inside chevron-label rows |
| `--cc-space-4` | `6px` | gap on `.search-input-wrap`, `.theme-row-label` |
| `--cc-space-5` | `8px` | pane-header gap, controls-actions gap, body padding |
| `--cc-space-6` | `10px` | sidebar paddings, card vertical padding |
| `--cc-space-7` | `12px` | row gaps in modal, info-markdown table padding |
| `--cc-space-8` | `14px` | shortcuts column gap |
| `--cc-space-9` | `16px` | pane horizontal padding |
| `--cc-space-10` | `18px` | modal content padding |
| `--cc-space-11` | `24px` | section breathing |
| `--cc-space-12` | `32px` | empty-state padding |

**Drops** (consolidate to nearest token):
- `1px` (paddings like `0 1px`, `1px 4px`) → kept as raw `1px` for hairline insets only; treat as exceptional
- `5px` (`5px 8px`, `5px 10px`) → `--cc-space-3` (4px) or `--cc-space-4` (6px)
- `7px` (`2px 7px` on `.recent-row-badge`) → `--cc-space-4` (6px)
- `9px` (`4px 9px` on `#hover-tooltip`) → `--cc-space-5` (8px)

### 2.2 Radius scale

One scale for everything corner-rounded. Audit shows 7 distinct radii
(2, 3, 4, 5, 6, 8, 10px) used loosely. Collapse to 4.

| Token | Value | Role |
|---|---|---|
| `--cc-radius-0` | `0` | edge-to-edge dividers |
| `--cc-radius-sm` | `4px` | every interactive control (icons, buttons, inputs, rows, kbd, code-inline) |
| `--cc-radius-md` | `6px` | modal-context interactive controls (close, tabs, fields, submit, errors) — kept distinct so modal reads as elevated; also card-internal blocks |
| `--cc-radius-lg` | `10px` | outer modal/loading card |
| `--cc-radius-pill` | `100px` | full pill (e.g. building-selected-indicator) |
| `--cc-radius-circle` | `50%` | dots, slider thumbs, spinner |

**Consolidations (visual change accepted):**
- `2px` → `--cc-radius-sm` (slider track gets +2px radius)
- `3px` → `--cc-radius-sm` (all 3px-radius header chips/badges become 4px)
- `5px` → `--cc-radius-md` (`.btn-accent-outline` / `.controls-button` becomes 6px; `.info-markdown pre` becomes 6px)
- `8px` (`.app-header-branch-pill`) → `--cc-radius-md` (becomes 6px — slightly squarer pill)

### 2.3 Font sizes

8 size tokens. Today's 16 distinct sizes consolidate to these.

| Token | Value | Role |
|---|---|---|
| `--cc-font-xs` | `9px` | path-badge only |
| `--cc-font-sm` | `10px` | small labels, kbd, sub-data |
| `--cc-font-base` | `11px` | secondary body, hint, help, footer |
| `--cc-font-md` | `12px` | primary body, pane title, controls label |
| `--cc-font-lg` | `13px` | preview-state title, info-markdown body |
| `--cc-font-xl` | `14px` | base html/body, icon-button glyph |
| `--cc-font-2xl` | `18px` | modal-close, info-markdown h2 |
| `--cc-font-3xl` | `22px` | search-state icon |
| `--cc-font-4xl` | `28px` | preview-state icon |

**Consolidations (visual change accepted):**
- `9.5px` (app-footer-source) → `10px`
- `10.5px` (app-header-branch-pill, app-footer) → `10px` (slightly smaller footer chrome)
- `11.5px` (search-result) → `11px`
- `17px` (info-markdown h2) → `18px`
- `20px` (info-markdown h1) → keep distinct → add `--cc-font-h1: 20px` OR snap to 22px

I'll keep h1/h2/h3 (20/18/17) as `--cc-font-h{1,2,3}` if needed — or accept the 1px shifts. Default: accept shifts; keep system minimal.

### 2.4 Font weights

| Token | Value | Role |
|---|---|---|
| `--cc-fw-normal` | `400` | default body |
| `--cc-fw-medium` | `500` | row labels, button text |
| `--cc-fw-semibold` | `600` | pane title, modal title, primary CTA text |
| `--cc-fw-bold` | `700` | section labels, info-markdown headings |

### 2.5 Font families

| Token | Value |
|---|---|
| `--cc-font-sans` | `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif` |
| `--cc-font-mono` | `'SF Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace` |

**Consolidation:** The 5-item Inter stack and 3-item mono stack found in
some places get replaced with the canonical full stacks.

### 2.6 Letter-spacing (tracking)

| Token | Value | Role |
|---|---|---|
| `--cc-track-snug` | `0.02em` | wide-set title (#app-title, .pane-title) |
| `--cc-track-loose` | `0.04em` | mono badges (path-badge, recent-row-badge) |
| `--cc-track-label` | `0.08em` | uppercase section labels (consolidate 0.05/0.08/0.1) |

**Consolidation (visual change):** All four uppercase label
selectors collapse to `0.08em` tracking. `.controls-section-label`
loses 0.02em of tracking; `.info-markdown h5/h6` gain 0.03em.

### 2.7 Transition durations

| Token | Value | Role |
|---|---|---|
| `--cc-t-fast` | `0.1s` | row hover (high-frequency hover targets) |
| `--cc-t-base` | `0.15s` | button hover, input border-color |
| `--cc-t-slow` | `0.2s` | larger state changes (loading step color) |

Plus a single `--cc-t-hover` shorthand: `color var(--cc-t-base), background var(--cc-t-base), border-color var(--cc-t-base)`.

### 2.8 Color tokens

Already done. The full set (~70 tokens) carries over from b832775 +
prior commits. One consolidation pending: the modal-error red
(`rgba(220, 50, 70, X)`) collapses to `--cc-error` (#ef4444) per your
earlier direction.

### 2.9 Overlay alpha tokens (new)

The audit found `--cc-hover-overlay` and `--cc-hover-overlay-sm` are
**defined but never used**. Adopting them. Plus filling in the gaps:

| Token | Value |
|---|---|
| `--cc-overlay-3` | `rgba(255, 255, 255, 0.03)` |
| `--cc-overlay-4` | `rgba(255, 255, 255, 0.04)` (was `--cc-hover-overlay-sm`) |
| `--cc-overlay-5` | `rgba(255, 255, 255, 0.05)` |
| `--cc-overlay-6` | `rgba(255, 255, 255, 0.06)` (was `--cc-hover-overlay`) |
| `--cc-overlay-8` | `rgba(255, 255, 255, 0.08)` |
| `--cc-overlay-10` | `rgba(255, 255, 255, 0.10)` |
| `--cc-overlay-12` | `rgba(255, 255, 255, 0.12)` |
| `--cc-overlay-15` | `rgba(255, 255, 255, 0.15)` |
| `--cc-overlay-18` | `rgba(255, 255, 255, 0.18)` |
| `--cc-overlay-20` | `rgba(255, 255, 255, 0.20)` |
| `--cc-overlay-25` | `rgba(255, 255, 255, 0.25)` |
| `--cc-overlay-35` | `rgba(255, 255, 255, 0.35)` |

Existing `--cc-hover-overlay{,-sm}` become aliases of the numeric form.

### 2.10 Accent alpha tokens (rename existing + fill in)

Current `--cc-accent-dim/mid/strong` rename to numeric form for
consistency. New alphas added.

| Token | Value | Old name |
|---|---|---|
| `--cc-accent-04` | `rgba(91, 157, 255, 0.04)` | — |
| `--cc-accent-06` | `rgba(91, 157, 255, 0.06)` | — |
| `--cc-accent-08` | `rgba(91, 157, 255, 0.08)` | — |
| `--cc-accent-10` | `rgba(91, 157, 255, 0.10)` | `--cc-accent-dim` |
| `--cc-accent-12` | `rgba(91, 157, 255, 0.12)` | — |
| `--cc-accent-14` | `rgba(91, 157, 255, 0.14)` | — |
| `--cc-accent-15` | `rgba(91, 157, 255, 0.15)` | — |
| `--cc-accent-18` | `rgba(91, 157, 255, 0.18)` | `--cc-accent-mid` |
| `--cc-accent-22` | `rgba(91, 157, 255, 0.22)` | — |
| `--cc-accent-24` | `rgba(91, 157, 255, 0.24)` | — |
| `--cc-accent-25` | `rgba(91, 157, 255, 0.25)` | `--cc-accent-strong` |
| `--cc-accent-30` | `rgba(91, 157, 255, 0.30)` | — |
| `--cc-accent-35` | `rgba(91, 157, 255, 0.35)` | — |
| `--cc-accent-40` | `rgba(91, 157, 255, 0.40)` | — |
| `--cc-accent-45` | `rgba(91, 157, 255, 0.45)` | — |
| `--cc-accent-50` | `rgba(91, 157, 255, 0.50)` | — |
| `--cc-accent-55` | `rgba(91, 157, 255, 0.55)` | — |
| `--cc-accent-85` | `rgba(91, 157, 255, 0.85)` | — |

Old names kept as aliases so commits that already reference
`--cc-accent-dim/mid/strong` keep working.

### 2.11 Shadow tokens

| Token | Value |
|---|---|
| `--cc-shadow-sm` | `0 1px 3px rgba(0, 0, 0, 0.4)` (slider thumb) |
| `--cc-shadow-md` | `0 2px 10px rgba(0, 0, 0, 0.4)` (tooltip) |
| `--cc-shadow-lg` | `0 10px 40px rgba(0, 0, 0, 0.6)` (modal, loading card) |
| `--cc-glow-accent` | `0 0 6px rgba(91, 157, 255, 0.35)` (range pair) |

### 2.12 Backdrop / black tokens

| Token | Value |
|---|---|
| `--cc-black` | `#000000` |
| `--cc-bg-backdrop` | `rgba(0, 0, 0, 0.55)` |
| `--cc-bg-tooltip` | `rgba(15, 17, 26, 0.94)` |

---

## 3. Component classes (Layer 2)

Each class below is a complete role. Selectors using the role get this
class on the DOM (often alongside the legacy class name for backward
compat).

### 3.1 Surfaces (`.surface-*`)

| Class | Background | Border | Replaces |
|---|---|---|---|
| `.surface-app` | `var(--cc-bg-app)` | — | `html/body`, `canvas`, `.editor-body`, `.code-editor` |
| `.surface-chrome` | `var(--cc-bg-chrome)` | `1px solid var(--cc-border-subtle)` (configurable side via modifier) | `#app-header`, `#app-footer`, `.activity-bar`, `.code-editor-gutter`, `.code-editor-banner` bg (without the accent tint variant), form-input backgrounds |
| `.surface-sidebar` | `var(--cc-bg-sidebar)` | (border via parent layout) | `#sidebar`, `#tree-sidebar`, `.controls-actions` |
| `.surface-modal` | `var(--cc-bg-modal)` | — | `.modal-card`, `.loading-card` |
| `.surface-tooltip` | `var(--cc-bg-tooltip)` | `1px solid var(--cc-border-tooltip)` | `#hover-tooltip` |

Class only sets `background` + (optionally) `border`. Border-radius and
shadow come from the **card** classes (3.6) when applicable.

### 3.2 Text styles (`.text-*`)

The big win — every selector currently re-declares
`color + font-size + font-weight + font-family + (sometimes) letter-spacing`.
Replace with one class per role.

| Class | font-size | weight | color | family | letter-spacing |
|---|---|---|---|---|---|
| `.text-primary` | `--cc-font-md` (12px) | `--cc-fw-normal` | `--cc-text-primary` | `--cc-font-sans` | — |
| `.text-secondary` | `--cc-font-md` | `--cc-fw-normal` | `--cc-text-secondary` | `--cc-font-sans` | — |
| `.text-muted` | `--cc-font-base` (11px) | `--cc-fw-normal` | `--cc-text-muted` | `--cc-font-sans` | — |
| `.text-faint` | `--cc-font-base` | `--cc-fw-normal` | `--cc-text-faint` | `--cc-font-sans` | — |
| `.text-faintest` | `--cc-font-sm` (10px) | `--cc-fw-normal` | `--cc-text-faintest` | `--cc-font-sans` | — |
| `.text-mono` | inherit | inherit | inherit | `--cc-font-mono` | — |
| `.text-label` | `--cc-font-sm` (10px) | `--cc-fw-bold` | `--cc-text-secondary` | `--cc-font-sans` | `--cc-track-label` (0.08em) — uppercase via `text-transform` |

Plus title/heading classes:

| Class | font-size | weight | color | role |
|---|---|---|---|---|
| `.text-pane-title` | `--cc-font-md` (12px) | `--cc-fw-semibold` | `--cc-text-secondary` | pane header titles |
| `.text-card-title` | `--cc-font-lg` (13px) | `--cc-fw-semibold` | `--cc-text-secondary` | empty-state titles, loading title |
| `.text-card-sub` | `--cc-font-base` (11px) | `--cc-fw-normal` | `--cc-text-faint` | empty-state subtitles |
| `.text-on-modal` | inherit | inherit | `--cc-text-on-modal` | text inside modal/loading-card |

Modifier classes for variants:
- `.text-uppercase` — `text-transform: uppercase` (composed with `.text-label`)
- `.text-truncate` — the `nowrap + overflow:hidden + ellipsis` trio (used in 6+ places)
- `.text-tracking-snug` (0.02em), `.text-tracking-loose` (0.04em) — for non-label-class uses

### 3.3 Buttons (`.btn-*`)

Already partially done. Finish by adding `.btn-primary`.

| Class | Role | Notes |
|---|---|---|
| `.btn-primary` | Solid accent CTA | NEW — was `.modal-actions button` |
| `.btn-secondary` | Outlined neutral | EXISTS — used as a modifier with `.btn-accent-outline` |
| `.btn-accent-outline` | Outlined accent-tinted | EXISTS |
| `.btn-icon` | 24×24 icon button | EXISTS, consolidate radii to `--cc-radius-sm` |
| `.btn-toggle` | One-of-N option | EXISTS, normalize `.is-active` class everywhere |
| `.btn-reset-inline` | Tiny inline reset (current `.controls-section-reset` + `.theme-row-reset`) | NEW — collapse the two duplicate rules |

### 3.4 Rows (`.row-*`)

Six row patterns collapse to a `.row` base + variants.

| Class | Role | Replaces |
|---|---|---|
| `.row` | base: `display:flex; align-items:center; gap:var(--cc-space-2); padding:var(--cc-space-2) var(--cc-space-9); border-radius:var(--cc-radius-sm); cursor:pointer; user-select:none; transition: background var(--cc-t-fast)` | base for all rows |
| `.row-hover` | adds `:hover { background: var(--cc-overlay-4) }` | base hover behavior |
| `.row-selected` | adds selected state via `.is-selected` modifier — `background: var(--cc-accent-18)` | tree-row selected, btn-toggle.is-active |
| `.row-bleed` | adds `margin-left: calc(-1 * var(--cc-space-9)); margin-right: calc(-1 * var(--cc-space-9))` to extend hover to pane edges | `.controls-section-summary`, `.theme-subgroup-collapsible summary` |
| `.row-rail` | adds 2px left border + accent-on-active treatment | `.activity-bar-icon`, `.search-result` |
| `.row-recent` | radius `--cc-radius-md`, padding `--cc-space-5 --cc-space-3`, gap `--cc-space-6` | `.recent-row` |

The variants compose: `.tree-row` becomes `<div class="row row-hover">`; `.controls-section-summary` becomes `<summary class="row row-hover row-bleed">`; etc.

### 3.5 Labels (`.label-*`)

`.text-label` (3.2) already covers most cases. Just one named class:
- `.label-section` = `.text-label` + `text-transform: uppercase` + `margin-bottom: var(--cc-space-3)`

Replaces `.controls-section-label`, `.theme-subgroup-label`, `.recents-list h3`, `.info-markdown h5/h6`.

### 3.6 Cards (`.card-*`)

| Class | Background | Border | Radius | Padding | Shadow |
|---|---|---|---|---|---|
| `.card-modal` | `--cc-bg-modal` | — | `--cc-radius-lg` (10px) | — (children pad) | `--cc-shadow-lg` |
| `.card-loading` | `--cc-bg-modal` | — | `--cc-radius-lg` | `--cc-space-11 --cc-space-12` | `--cc-shadow-lg` |
| `.card-info` | `--cc-bg-chrome` | `1px solid var(--cc-track)` | `--cc-radius-md` | `--cc-space-6 --cc-space-7` | — |
| `.card-banner` | `--cc-accent-06` | `border-bottom: 1px solid var(--cc-accent-18)` | — | `--cc-space-4 --cc-space-7` | — |
| `.card-error` | `--cc-error-18` | `1px solid var(--cc-error-45)` | `--cc-radius-md` | `--cc-space-5 --cc-space-6` | — |
| `.card-tooltip` | `--cc-bg-tooltip` | `1px solid var(--cc-border-tooltip)` | `--cc-radius-sm` | `--cc-space-3 --cc-space-5` | `--cc-shadow-md` |
| `.card-kbd` | `--cc-accent-10` | `1px solid var(--cc-accent-30)` | `--cc-radius-sm` | `1px var(--cc-space-3)` | — |

Replaces `.modal-card`, `.loading-card`, `.info-markdown pre`, `.code-editor-banner`, `.modal-error`, `#hover-tooltip`, `.controls-section-hint kbd` + `.shortcuts-list kbd` + `.shortcuts-list .shortcuts-mouse`.

### 3.7 Badges / pills (`.badge-*`)

| Class | Bg | Border | Radius | Padding | Font |
|---|---|---|---|---|---|
| `.badge-accent` | `--cc-accent-15` | `1px solid var(--cc-accent-35)` | `--cc-radius-md` | `--cc-space-1 --cc-space-4` | mono 10px |
| `.badge-pill` | `--cc-accent-15` | `1px solid var(--cc-accent-35)` | `--cc-radius-pill` | `--cc-space-4 --cc-space-9` | 12px |
| `.badge-mono` | `--cc-accent-14` | — | `--cc-radius-md` | `0 --cc-space-4` | mono 10px, color `--cc-accent-light` |
| `.badge-hue` | HSL-driven | — | `--cc-radius-sm` | `1px --cc-space-4` | mono 9px lowercase tracking |

Replaces `.recent-row-badge`, `.building-selected-indicator`, `.app-header-branch-pill`, `.path-badge`.

### 3.8 Status dots (`.dot-*`)

| Class | Background |
|---|---|
| `.dot` (base) | size 6×6, radius 50%, flex item |
| `.dot-success` | `--cc-success` |
| `.dot-warning` | `--cc-warning` + pulse animation |
| `.dot-error` | `--cc-error` |

Replaces the inline `.app-footer-status-dot` ruleset.

### 3.9 Form inputs (`.form-*`)

| Class | Replaces |
|---|---|
| `.form-input` | `.search-input`, `.modal-field input`, `.theme-number` |
| `.form-input-mono` | mono variant — `.theme-number` |
| `.form-color` | `.theme-color` |
| `.form-range` | `.theme-slider`, `.theme-range-pair input[type='range']` |
| `.form-toggle` | `.theme-toggle` (checkbox) |

`.form-input` base:
- background `--cc-bg-chrome`, border `1px solid var(--cc-border-input)`,
- radius `--cc-radius-sm`, padding `--cc-space-3 --cc-space-5`,
- font inherit, color `--cc-text-primary`,
- focus: border-color `--cc-accent-50`.

**Consolidation:** modal-field input drops its `outline: 2px solid` focus
style and uses the border-color shift like the rest. Background `rgba(255, 255, 255, 0.05)` overrides via context-specific modifier `.form-input--on-modal`.

### 3.10 Pane structure

- `.pane` = `display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0`
- `.pane-body` = `flex: 1 1 auto; min-height: 0; overflow-y: auto` (or `overflow: hidden` modifier)
- `.pane-body--padded` = adds `padding: var(--cc-space-9)`
- `.pane-header` exists (kept).

Replaces `.left-pane`, `.search-body`, `.info-body`, `.file-preview-pane`, `.controls-body` (gets `--padded`), `.editor-body`.

### 3.11 Resize handles (`.resize-handle`)

One class. Modifiers for `--left` / `--right` edge attachment.
Collapses `.sidebar-resize-handle` + `.sidebar-resize-handle-right` to one rule.

### 3.12 Chevrons (`.chevron`)

One class. Modifier `.chevron--open` flips rotation.
Collapses `.controls-section-chevron` + `.theme-subgroup-chevron`.

### 3.13 Scrollbars

Use a shared selector group (one rule) on both sidebars instead of two
parallel `::-webkit-scrollbar*` blocks. No new class needed.

### 3.14 Empty states (`.empty-state`)

`.empty-state` = column flex, gap `--cc-space-6`, padding `--cc-space-12 --cc-space-10`,
text-align center.

Plus subclasses:
- `.empty-state__icon` (font-size `--cc-font-3xl` or `--cc-font-4xl`, opacity 0.55, margin-bottom `--cc-space-3`)
- `.empty-state__title` = `.text-card-title`
- `.empty-state__sub` = `.text-card-sub`

Replaces `.search-state` + `.preview-state` (today: two near-identical rules).

---

## 4. Migration order

One commit per family. Each commit:
1. Adds the component class to styles.css.
2. Adds it to the selector list of every selector that re-implements it (alias pattern).
3. Reduces those selectors' rules to per-class overrides only.
4. Updates DOM in TypeScript where needed (additive — keep old class names).
5. Verifies tsc + build + tests + spot-check.

Order optimizes for line-count win and reduces future risk:

1. **Tokens layer** (one commit) — add spacing/radius/font/weight/transition/letter-spacing tokens + the new accent/overlay numeric naming + shadow/backdrop tokens. Zero rule changes; purely additive. Existing tokens that get renamed (accent-dim/mid/strong, hover-overlay-sm/_) keep aliases.
2. **Color/rgba migration** — convert every remaining inline rgba to a token (the rgba-pass from before, now grounded in the new accent/overlay tokens). Modal-error red consolidates to `--cc-error`.
3. **Text styles** — biggest win in line-count. Apply `.text-*` classes across all selectors. Drops ~40 redundant `color/font-size/font-weight/font-family` declarations.
4. **Buttons** — add `.btn-primary`, collapse the two reset-button rules to `.btn-reset-inline`, snap `.btn-icon` radii to `--cc-radius-sm`.
5. **Form inputs** — `.form-input` family. Modal field input loses `outline: 2px` focus, gains border-color focus.
6. **Rows** — biggest structural change. Six row-style components collapse into `.row` + variants.
7. **Cards / badges / dots / chevrons / resize-handles / scrollbars / empty-states** — smaller migrations, batched.
8. **Pane structure** — `.pane`, `.pane-body`.
9. **Surfaces** — `.surface-*` classes.
10. **Layer 3 cleanup** — make sure page-level selectors only set layout (sweep for stray colors/fonts/etc.).

Estimated ~10–12 commits.

---

## 5. Visual changes consolidated in this migration

Cumulative list of intentional visual shifts:

| Where | Today | After | Reason |
|---|---|---|---|
| All 3px radii | `3px` | `4px` | Single interactive radius |
| All 5px radii (`.btn-accent-outline`, `.info-markdown pre`) | `5px` | `6px` | Snap to `--cc-radius-md` |
| `.app-header-branch-pill` radius | `8px` | `6px` | Snap to `--cc-radius-md` (slightly squarer pill) |
| `.theme-slider` track radius | `2px` | `4px` | Snap to `--cc-radius-sm` |
| Footer & app-header-branch-pill font | `10.5px` | `10px` | Snap to scale |
| `.search-result` font | `11.5px` | `11px` | Snap to scale |
| `.app-footer-source` font | `9.5px` | `10px` | Snap to scale |
| `.info-markdown h2` font | `17px` | `18px` | Snap to `--cc-font-2xl` |
| `.controls-section-label` tracking | `0.1em` | `0.08em` | One label tracking |
| `.info-markdown h5/h6` tracking | `0.05em` | `0.08em` | One label tracking |
| Row hover transition | `0.1s` (rows) | keep `0.1s` (rows) | No change — keep two tiers |
| Modal-error red | `#dc3246` | `#ef4444` (`--cc-error`) | Consolidate error red |
| Modal-field input focus | `outline: 2px` | border-color shift | Match other inputs |
| Modal borders (rgba 0.08/0.12) | inline rgba | `--cc-border-subtle` (`#1e2030`) | Token-driven; visible shift from semi-transparent to opaque |

All other rules visually unchanged.

---

## 6. What stays as-is

- Layout primitives — `display: flex/grid`, `position`, `width/height`, `flex: ...`, `overflow`, `gap` declarations on layout containers stay on their existing selectors. They're Layer 3 concerns.
- Animations (`@keyframes` and the rules that consume them) — keep the existing names; only the dot-class consumes them.
- The accent unification, modal radius convention, and prior tokenization (commits 6e0d3d6..b832775) are not revisited.
- Audit-doc file (`docs/ui-component-audit.md`) and this spec file stay untracked per the gitignored-spec convention.

---

## 7. Out-of-scope

- HTML/DOM restructuring beyond `classList` additions. Existing element structure (the `pane-header` + `pane-body` + `paneHeader.ts` factory) stays.
- Test query rewrites. Tests query the old class names; those names remain on DOM as aliases until a final hard-rename pass.
- The `paneHeader.ts` factory itself. No new factories.
- Dark-mode / theming infrastructure. Tokens hard-code values; a future commit could split them into a default theme layer if desired.
