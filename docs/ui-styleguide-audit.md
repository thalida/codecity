# UI Styleguide Audit — CodeCity

Branch audited: `feat/ui-source-selection`
File audited: `app/styles.css` (2 462 lines)

---

## 1. Button inventory

### 1A. Icon buttons (small, 22–26 px square)

| Component | CSS class(es) | bg (rest) | bg (hover) | color (rest) | color (hover) | Size | Radius | Border | Padding | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| Header project switcher | `.project-btn` | none | `rgba(255,255,255,.06)` | `#7279a2` | `#e0e4f5` | h:24px | 3px | none | 0 8px | text+icon; 12px font; disabled reverts to rest |
| Header copy/path icon | `.app-header-icon` | none | `rgba(255,255,255,.06)` | `#7279a2` | `#e0e4f5` | 26×24px | 3px | none | – | is-copied state: `#4ade80` / green bg |
| Header breadcrumb segment | `.app-header-segment` | none | `rgba(255,255,255,.06)` | `#8a8fa8` | `#e0e4f5` | auto | 3px | none | 1px 4px | leaf: `#e0e4f5`, no hover bg |
| Header switch-source btn | `.switch-source-btn` | none | `rgba(255,255,255,.06)` | `#7279a2` | `#e0e4f5` | 24×24px | 3px | none | – | same rule as app-header-refresh-btn |
| Header refresh btn | `.app-header-refresh-btn` | none | `rgba(255,255,255,.06)` | `#7279a2` | `#e0e4f5` | 24×24px | 3px | none | – | merged selector with switch-source |
| Header repo link | `.app-header-repo-link` | none | `rgba(255,255,255,.06)` | inherited | – | 24×24px | 4px | none | 2px 4px | `<a>` element; also in merged selector |
| Footer reset-view btn | `.app-footer-button` | none | `rgba(255,255,255,.06)` | `#7279a2` | `#e0e4f5` | 22×22px | 3px | none | – | 13px icon |
| Pane header close (×) | `.pane-header-close` | none | `rgba(255,255,255,.06)` | `#7279a2` | `#e0e4f5` | auto | 4px | none | 4px | 14px font |
| Modal close (×) | `.modal-header button.modal-close` | transparent | `rgba(255,255,255,.08)` | inherited (`#e8e8ed`) | – | auto | 6px | none | 4px 8px | 18px font; modal-context color |
| Recents row remove (×) | `.recent-remove` | transparent | – | inherited | – | auto | 0 | none | 4px 8px | opacity 0.55 rest, 1 hover |
| Per-row reset (controls) | `.theme-row-reset` | none | `rgba(108,138,255,.18)` | `rgba(108,138,255,.85)` | `#ffffff` | auto | 4px | 1px transparent → `rgba(108,138,255,.45)` | 3px 5px | 14px font; disabled: `rgba(108,138,255,.22)` |
| Activity bar tab | `.activity-bar-icon` | none | `rgba(255,255,255,.03)` | `#6a7090` | `#c0c4d8` | h:40px, w:44px | 0 | 2px left transparent → active `#6c8aff` | 0 | active: `#e0e4f5`, `rgba(108,138,255,.06)` bg |

### 1B. Full-width / block action buttons

| Component | CSS class(es) | bg (rest) | bg (hover) | color (rest) | color (hover) | Radius | Border | Padding | Font | disabled | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Controls primary (Save, debug) | `.controls-button` | `rgba(108,138,255,.10)` | `rgba(108,138,255,.18)` | `#c0c4d8` | `#e0e4f5` | 5px | `1px rgba(108,138,255,.25)` → `.40` | 8px 10px | 12px/500 | opacity 0.4, cursor not-allowed | active: `rgba(108,138,255,.25)` |
| Controls secondary (Reset all, Discard) | `.controls-button.controls-button-secondary` | `rgba(255,255,255,.04)` | `rgba(255,255,255,.10)` | `#c0c4d8` | `#e0e4f5` | 5px (inherits) | `1px rgba(255,255,255,.10)` → `.25` | (inherits 8px 10px) | (inherits) | (inherits) | same base class + modifier |
| Segmented control option | `.segmented-option` | none | – | `#7279a2` | `#c0c4d8` | 4px | none (outer border on `.segmented-control`) | 6px 10px | 12px/500 | – | active: `rgba(108,138,255,.18)` bg, `#e0e4f5` |

### 1C. Modal buttons

| Component | CSS class(es) | bg (rest) | bg (hover) | color | Radius | Border | Padding | Font | disabled |
|---|---|---|---|---|---|---|---|---|---|
| Modal submit ("Open project") | `.modal-actions button` | `#5b9dff` | – (none defined) | `#0a0a10` | 6px | none | 8px 16px | inherit/600 | opacity 0.5 |
| Modal tab (Local / Git URL) | `.modal-tabs button` | transparent | – (none defined) | inherited (`#e8e8ed`) | 6px | `1px rgba(255,255,255,.12)` | 6px 14px | inherit | – |
| Modal tab active | `.modal-tabs button.active` | `rgba(255,255,255,.10)` | – | – | – | – | – | – | – |

### 1D. Interactive list rows (not `<button>` but styled as clickable)

| Component | CSS class | bg hover | color | Padding | Radius | Notes |
|---|---|---|---|---|---|---|
| Tree row | `.tree-row` | `rgba(255,255,255,.04)` | `#a0a4bc` (file) / `#c0c4d8` (dir) | 3px 16px | 4px | selected: `rgba(108,138,255,.18)` |
| Search result | `.search-result` | `rgba(255,255,255,.04)` | `#a0a4bc` → `#e0e4f5` | 4px 12px | 0 | focus-visible: `rgba(108,138,255,.12)` + left border `#6c8aff` |
| Recent row | `.recent-row` | `rgba(255,255,255,.06)` | inherited | 8px 4px | 6px | active-row: `rgba(91,157,255,.08)` bg |
| Controls section summary | `.controls-section-summary` | `rgba(255,255,255,.04)` | inherited | 3px 16px | 4px | `<summary>` element; chevron rotates on open |
| Theme subgroup collapsible | `.theme-subgroup-collapsible summary` | `rgba(255,255,255,.04)` | inherited | 3px 16px | 4px | same pattern as above |
| Theme-select option | `.theme-select-option` | `rgba(255,255,255,.04)` | `#7279a2` → `#c0c4d8` | 3px 8px | 0 (clipped by parent 4px) | active: `rgba(108,138,255,.18)`, `#e0e4f5` |

---

## 2. Form inputs

| Component | CSS class | bg | border | color | Padding | Radius | Font | Focus ring |
|---|---|---|---|---|---|---|---|---|
| Search text input | `.search-input` | `#0c0d14` | `1px solid #252838` | `#e0e4f5` | 5px 8px | 4px | 12px inherit | border `rgba(108,138,255,.50)` |
| Modal text input | `.modal-field input` | `rgba(255,255,255,.05)` | `1px solid rgba(255,255,255,.12)` | inherited (`#e8e8ed`) | 8px 10px | 6px | inherit | outline `2px #5b9dff` |
| Controls number input | `.theme-number` | `#0c0d14` | `1px solid #252838` | `#e0e4f5` | 3px 6px | 4px | 11px monospace | border `rgba(108,138,255,.50)` |
| Color swatch input | `.theme-color` | transparent | `1px solid rgba(255,255,255,.18)` | – | 0 | 4px | – | – |
| Boolean toggle (checkbox) | `.theme-toggle` | – | – | – | – | – | – | accent-color `#6c8aff` |
| Range slider | `.theme-slider` | track `#1a1c28` | – | – | – | 2px track | – | – |

---

## 3. Text styles

| Role | CSS class | font-size | font-weight | color | letter-spacing | font-family |
|---|---|---|---|---|---|---|
| Body / default | `html, body` | 14px | 400 | `#e0e0e0` | – | Inter, system |
| Header / footer chrome | `#app-header`, `#app-footer` | 11px / 10.5px | 400 | `#c0c4d8` / `#8a8fa8` | – | monospace |
| Pane title | `.pane-title` | 12px | 600 | `#c0c4d8` | 0.02em | Inter |
| Controls section label | `.controls-section-label` | 10px | 700 | `#c0c4d8` | 0.1em | Inter, uppercase |
| Controls hint text | `.controls-section-hint` | 11px | 400 | `#7279a2` | – | Inter |
| Theme row (control label) | `.theme-row` | 11px | 400 | `#c0c4d8` | – | Inter |
| Theme subgroup label | `.theme-subgroup-label` | 10px | 700 | `#8a8fa8` | 0.08em | Inter, uppercase |
| Tree label (file) | `.tree-label` `.tree-file` | 12px | 400 | `#8a8ea0` | – | Inter |
| Tree label (dir) | `.tree-dir .tree-label` | 12px | 500 | `#c0c4d8` | – | Inter |
| Search result | `.search-result` | 11.5px | 400 | `#a0a4bc` | – | monospace |
| Modal card text | `.modal-card` | 14px (inherited) | 400 | `#e8e8ed` | – | Inter |
| Modal field label | `.modal-field label` | 12px | 400 | `rgba(232,232,237,.70)` | – | Inter |
| Modal help text | `.modal-field-help` | 11px | 400 | `rgba(232,232,237,.60)` | – | Inter |
| Path badge | `.path-badge` | 9px | 700 | computed (contrast check) | 0.04em | monospace |
| Hover tooltip | `#hover-tooltip` | 11px | 400 | `#d8dceb` | – | monospace |
| Preview state title | `.preview-state-title` | 13px | 500 | `#c0c4d8` | – | Inter |
| Preview state subtitle | `.preview-state-sub` | 11px | 400 | `#7279a2` | – | Inter |
| Info markdown body | `.info-markdown` | 13px | 400 | `#c0c4d8` | – | Inter |
| Recents heading | `.recents-list h3` | 12px | 400 | `rgba(232,232,237,.55)` | 0.08em | Inter, uppercase |

---

## 4. Color inventory (interactive elements)

### Background / surface colors
| Token (proposed) | Hex / rgba | Where used |
|---|---|---|
| `--cc-bg-app` | `#0a0b10` | Canvas, editor body |
| `--cc-bg-chrome` | `#0c0d14` | Header, footer, activity bar, input fields |
| `--cc-bg-sidebar` | `#10111a` / `#12131a` | Left sidebar, right sidebar |
| `--cc-bg-modal` | `#1d1d22` | Modal card, loading card |
| `--cc-bg-hover-subtle` | `rgba(255,255,255,.04)` | Tree rows, summary rows |
| `--cc-bg-hover-light` | `rgba(255,255,255,.06)` | Header/footer icon buttons, recent rows |
| `--cc-bg-hover-modal` | `rgba(255,255,255,.08)` | Modal close button |
| `--cc-bg-accent-dim` | `rgba(108,138,255,.10)` | Controls primary button rest |
| `--cc-bg-accent-mid` | `rgba(108,138,255,.18)` | Controls button hover, tree selected, segmented active |
| `--cc-bg-accent-strong` | `rgba(108,138,255,.25)` | Controls button active |
| `--cc-border-subtle` | `#1e2030` | Pane borders, header/footer borders |
| `--cc-border-input` | `#252838` | Input fields (search, number) |

### Foreground colors
| Token (proposed) | Hex | Where used |
|---|---|---|
| `--cc-text-primary` | `#e0e4f5` | Active/hover state text, selected labels |
| `--cc-text-secondary` | `#c0c4d8` | Pane titles, controls labels, code preview |
| `--cc-text-muted` | `#8a8fa8` | Footer, breadcrumbs, modal labels |
| `--cc-text-faint` | `#7279a2` | Icon buttons rest, hints, placeholders |
| `--cc-text-faintest` | `#6a7090` | Activity bar icons, search placeholder |
| `--cc-text-separator` | `#44485e` | Breadcrumb separators, footer dots |

### Accent / semantic colors
| Token (proposed) | Hex | Where used |
|---|---|---|
| `--cc-accent` | `#6c8aff` | Accent color (search highlight, slider thumb, links) |
| `--cc-accent-bright` | `#5b9dff` | Modal submit bg, loading spinner, branch pill text |
| `--cc-accent-light` | `#9bc1ff` | Branch pill text in header |
| `--cc-success` | `#4ade80` | Footer ready dot, copy-success icon |
| `--cc-warning` | `#fbbf24` | Footer rebuilding dot |
| `--cc-error` | `#ef4444` | Footer error dot |

---

## 5. Spacing patterns

| Value | Where used |
|---|---|
| 3px / 4px padding | Tight icon buttons (`.pane-header-close`, `.theme-row-reset`, summary rows) |
| 4px 8px padding | Modal close, recent-remove |
| 5px 8px padding | Search input |
| 6px 10px padding | Segmented control option |
| 8px 10px padding | Controls button, modal input |
| 8px 16px padding | Modal submit button |
| 16px | Standard pane body horizontal padding |
| 4px gap | Icon button groups in header |
| 6px gap | Footer items, search wrap |
| 8px gap | Controls actions, theme row |
| 12px gap | Theme row label/control |

---

## 6. Inconsistencies

### Inconsistency 1 — Close (×) button has three different shapes
The "dismiss this thing" affordance appears in three locations with inconsistent styling:

- `.pane-header-close` — 4px padding, 4px radius, `#7279a2` color, 14px font
- `.modal-header button.modal-close` — 4px 8px padding, **6px radius**, `#e8e8ed` color (modal inherit), **18px font**
- `.recent-remove` — 4px 8px padding, **0 radius**, **inherited color**, **opacity trick** instead of color change on hover

All three serve the same role (remove/dismiss) but differ on radius (3 values), color (2 systems), size (3 values), and hover mechanism (color vs. opacity).

### Inconsistency 2 — Primary accent vs. bright-accent split
The blue accent is expressed as two distinct values with no relationship between them:

- `#6c8aff` — used as the slider thumb, search focus ring, activity-bar active indicator, tree selected state, reset button foreground
- `#5b9dff` — used as the modal submit button background, loading spinner, branch pill text, `.is-active` loading step text

These are two separately maintained blues. There is no declared relationship or token; future additions will inevitably drift to a third value.

### Inconsistency 3 — Modal radius inconsistency inside a single component
Within the modal, radius values are 10px (card), 6px (tab buttons, submit button, close button, input, error), and 4px (label, color swatch). None are wrong individually but the set was assembled ad-hoc: the outer card is 10px, inputs are 6px, while the analogous sidebar inputs (`.search-input`, `.theme-number`) are 4px. If a modal input and a sidebar input were placed side by side they would visually disagree.

### Inconsistency 4 — `.app-header-repo-link` in the wrong rule block
`.app-header-repo-link` appears in two separate rule blocks: first (lines 302–314) with its own standalone definition (2px 4px padding, **4px radius**, opacity trick for dimming), and again (lines 2429–2462) merged into the `.switch-source-btn` / `.app-header-refresh-btn` selector (24×24, **3px radius**, color change on hover). The two blocks conflict: the later merged block overrides the earlier standalone, making the standalone block dead code that creates confusion.

### Inconsistency 5 — Hover mechanism: color-change vs. opacity
Most icon buttons brighten their `color` and add a `background` overlay on hover. But `.recent-remove` uses `opacity: 0.55` at rest and `opacity: 1` on hover. This is a different mental model (the element is always there, just dimmed) that doesn't compose predictably with container backgrounds.

---

## 7. Proposed standardized button system

### Token definitions

```css
:root {
  /* Surfaces */
  --cc-bg-app:          #0a0b10;
  --cc-bg-chrome:       #0c0d14;
  --cc-bg-sidebar:      #10111a;
  --cc-bg-modal:        #1d1d22;

  /* Borders */
  --cc-border-subtle:   #1e2030;
  --cc-border-input:    #252838;

  /* Text */
  --cc-text-primary:    #e0e4f5;
  --cc-text-secondary:  #c0c4d8;
  --cc-text-muted:      #8a8fa8;
  --cc-text-faint:      #7279a2;
  --cc-text-sep:        #44485e;

  /* Accent */
  --cc-accent:          #5b9dff;   /* unified — replaces both #6c8aff and #5b9dff */
  --cc-accent-dim:      rgba(91, 157, 255, 0.10);
  --cc-accent-mid:      rgba(91, 157, 255, 0.18);
  --cc-accent-strong:   rgba(91, 157, 255, 0.25);

  /* Semantic */
  --cc-success:         #4ade80;
  --cc-warning:         #fbbf24;
  --cc-error:           #ef4444;

  /* Hover overlay (applied on top of any bg) */
  --cc-hover-overlay:   rgba(255, 255, 255, 0.06);
  --cc-hover-overlay-sm: rgba(255, 255, 255, 0.04);
}
```

> **Note on accent unification:** `#6c8aff` (hue 230, S 100%, L 72%) and `#5b9dff` (hue 217, S 100%, L 68%) are different enough to be perceptible side by side. The recommended unified token `#5b9dff` keeps the brighter, more readable blue that is already used for the most prominent interactive element (modal submit). All places currently using `#6c8aff` would shift slightly warmer — a one-pass find-and-replace. If the existing darker indigo tone is preferred, flip the token to `#6c8aff` and update the modal submit instead.

---

### Button classes

#### `btn-primary`
Main CTA — modal submit ("Open project"), save action.

```css
.btn-primary {
  appearance: none;
  background: var(--cc-accent);         /* #5b9dff */
  border: none;
  color: #0a0a10;
  padding: 8px 16px;
  border-radius: 6px;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.btn-primary:hover  { background: color-mix(in srgb, var(--cc-accent) 85%, white); }
.btn-primary:active { background: color-mix(in srgb, var(--cc-accent) 70%, black); }
.btn-primary:disabled { opacity: 0.5; cursor: default; }
```

#### `btn-secondary`
Non-CTA actions within the same surface (Cancel, Reset all, Discard). Muted outline treatment.

```css
.btn-secondary {
  appearance: none;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: var(--cc-text-secondary);     /* #c0c4d8 */
  padding: 8px 16px;
  border-radius: 6px;
  font: inherit;
  font-weight: 500;
  cursor: pointer;
}
.btn-secondary:hover  { background: rgba(255,255,255,.10); border-color: rgba(255,255,255,.25); color: var(--cc-text-primary); }
.btn-secondary:active { background: rgba(255,255,255,.15); }
.btn-secondary:disabled { opacity: 0.4; cursor: not-allowed; }
```

> **Migration:** `.controls-button-secondary`, `.modal-tabs button` (non-active), any future cancel button.

#### `btn-accent-outline`
Accent-tinted outlined button — for controls-pane "Save" equivalents where a solid blue would be too loud but the action is still the primary one in the pane.

```css
.btn-accent-outline {
  background: var(--cc-accent-dim);
  border: 1px solid rgba(91,157,255,.25);
  color: var(--cc-text-secondary);
  padding: 8px 10px;
  border-radius: 5px;
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}
.btn-accent-outline:hover  { background: var(--cc-accent-mid); border-color: rgba(91,157,255,.40); color: var(--cc-text-primary); }
.btn-accent-outline:active { background: var(--cc-accent-strong); }
.btn-accent-outline:disabled { opacity: 0.4; cursor: not-allowed; }
```

> **Migration:** `.controls-button` (primary variant).

#### `btn-icon`
24×24 icon-only button. The single class covers header icons, footer icon, and pane-close ×. Radius unifies at 4px.

```css
.btn-icon {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  background: none;
  border: none;
  color: var(--cc-text-faint);          /* #7279a2 */
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}
.btn-icon:hover  { color: var(--cc-text-primary); background: var(--cc-hover-overlay); }
.btn-icon:disabled { cursor: default; }
.btn-icon.is-active  { color: var(--cc-accent); background: var(--cc-accent-dim); }
```

> **Migration:** `.app-header-icon`, `.switch-source-btn`, `.app-header-refresh-btn`, `.app-header-repo-link`, `.app-footer-button`, `.pane-header-close`, `.modal-header button.modal-close`, `.recent-remove`. The `padding: 4px 8px` on modal-close and recent-remove collapses to the fixed 24×24 square — if those need to remain slightly larger, add a `btn-icon--lg` variant at 28×28.

#### `btn-toggle` (segmented / tab)
Already unified between `.segmented-option` and `.theme-select-option` in concept; propose a single class for both.

```css
.btn-toggle {
  appearance: none;
  background: none;
  border: none;
  color: var(--cc-text-faint);
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  padding: 5px 10px;
  border-radius: 4px;
  cursor: pointer;
}
.btn-toggle:hover  { color: var(--cc-text-secondary); background: var(--cc-hover-overlay-sm); }
.btn-toggle.is-active { background: var(--cc-accent-mid); color: var(--cc-text-primary); }
```

> **Migration:** `.segmented-option`, `.theme-select-option`. The outer wrapper (`.segmented-control`, `.theme-select`) can remain as layout shells.

#### `btn-inline-reset`
Tiny inline reset icon button used in Controls rows. Distinct from `btn-icon` because it uses the accent color at rest (signals "this value has changed") and hides when disabled.

```css
.btn-inline-reset {
  appearance: none;
  display: inline-flex;
  align-items: center;
  background: none;
  border: 1px solid transparent;
  padding: 3px 5px;
  border-radius: 4px;
  color: rgba(91,157,255,.85);
  font-size: 14px;
  cursor: pointer;
}
.btn-inline-reset:not(:disabled):hover  { color: #fff; background: var(--cc-accent-mid); border-color: rgba(91,157,255,.45); }
.btn-inline-reset:not(:disabled):active { background: var(--cc-accent-strong); }
.btn-inline-reset:disabled { color: rgba(91,157,255,.22); cursor: default; }
```

> **Migration:** `.theme-row-reset` (rename or alias).

---

### Form input baseline

```css
.form-input {
  background: var(--cc-bg-chrome);     /* #0c0d14 */
  border: 1px solid var(--cc-border-input);  /* #252838 */
  border-radius: 4px;
  color: var(--cc-text-primary);
  font: inherit;
  padding: 6px 8px;
}
.form-input:focus {
  outline: none;
  border-color: rgba(91,157,255,.50);
}
.form-input::placeholder { color: var(--cc-text-faintest, #6a7090); }
```

> **Note:** `.modal-field input` currently uses `rgba(255,255,255,.05)` for its background (lighter than `--cc-bg-chrome`) to read clearly inside the `#1d1d22` modal card. A context-specific override is acceptable: `.modal-card .form-input { background: rgba(255,255,255,.05); border-color: rgba(255,255,255,.12); }`. The focus ring should change from `outline: 2px #5b9dff` to the standard border approach for visual consistency.

---

## 8. Migration plan (ordered by impact)

### Step 1 — Declare CSS custom properties (XS, ~30 min)
Add the `:root { ... }` token block to the top of `app/styles.css` (after the reset). No existing rules change; this is purely additive. Establishes the vocabulary for all subsequent steps.

**Rules touched:** 0 existing. 1 new `:root` block (~25 lines).

---

### Step 2 — Unify icon buttons into `.btn-icon` (MD, ~2–3 h)
The largest cluster of near-identical rules. Eight separate selectors currently define the same 24×24, no-border, `#7279a2` → `#e0e4f5` / `rgba(255,255,255,.06)` pattern:

`.app-header-icon`, `.switch-source-btn`, `.app-header-refresh-btn`, `.app-footer-button`, `.pane-header-close`, `.modal-close`, `.app-header-repo-link` (partial), `.recent-remove` (needs opacity→color migration).

**Action:** Add `.btn-icon` class in CSS. In each TypeScript view file that creates these buttons, add `btn-icon` to the `classList` alongside the existing specific class. The specific class can be kept as an alias (zero existing visual change) or deleted after verification.

**Rules touched:** ~8 selector groups (~40 lines) consolidated to 1 (~10 lines). Seven DOM class changes across `appHeader.ts`, `appFooter.ts`, `paneHeader.ts`, `sourcePicker.ts`.

---

### Step 3 — Unify accent color tokens (SM, ~1 h)
Replace all occurrences of `#6c8aff` and `#5b9dff` in `styles.css` with `var(--cc-accent)` and the derived `--cc-accent-dim/mid/strong` rgba values. Removes the hidden two-blues problem.

`#6c8aff` appears in: `.activity-bar-icon.active`, `.sidebar-resize-handle:hover`, `.segmented-option.active`, `.tree-item.tree-selected`, `.theme-row-reset`, `.theme-toggle`, `.theme-slider` thumbs, `.theme-range-pair` fill/thumbs, `.search-result:focus-visible`, `.info-markdown code`, `.info-markdown a`, `.building-selected-indicator`.

`#5b9dff` appears in: `.modal-actions button` bg, `.loading-spinner` border-top, `.loading-steps li[data-state=active]`, `.app-header-branch-pill` text, `.recent-row-badge` text, `.modal-field input:focus` outline.

**Rules touched:** ~25–30 property values across the file. Zero DOM changes.

---

### Step 4 — Consolidate modal radius to 6px (XS, ~20 min)
Standardize all interactive elements inside `.modal-card` to `border-radius: 6px`. This changes: `.modal-field input` (already 6px — no change), `.modal-tabs button` (already 6px — no change), `.modal-actions button` (already 6px — no change), `.modal-close` (already 6px — no change), `.modal-error` (already 6px — no change). Outer card stays 10px; inner elements stay 6px. No change needed — this step just documents the decision and prevents future drift.

**Rules touched:** 0. Primarily a documentation/guard step.

---

### Step 5 — Replace `.controls-button` with `.btn-accent-outline` / `.btn-secondary` (SM, ~1 h)
Rename `.controls-button` → `.btn-accent-outline` and `.controls-button-secondary` → `.btn-secondary` in both CSS and the TypeScript that creates them (`controlsPane.ts`). Update the `padding` on `.btn-secondary` in the controls context from `8px 10px` to match the global `8px 16px`, or keep a `.btn-secondary--compact` variant if the controls-pane's tighter padding is intentional.

**Rules touched:** 4 CSS blocks (~30 lines). ~6 `className` assignments in `controlsPane.ts`.

---

### Step 6 — Unify `.segmented-option` and `.theme-select-option` as `.btn-toggle` (SM, ~1 h)
The two classes share the same purpose (choose one of N options) but have slightly different padding and font-size (12px vs 10px). Adopt a single `.btn-toggle` class with a `--btn-toggle-font-size` local variable or a `.btn-toggle--sm` size modifier for the 10px theme-select variant. Update DOM construction in `controlsPane.ts`.

**Rules touched:** 2 CSS blocks consolidated to 1 (~12 lines). Several `createElement`/`className` calls in `controlsPane.ts`.

---

### Step 7 — Fix `.app-header-repo-link` duplicate rule (XS, ~15 min)
Delete the standalone `.app-header-repo-link` block at lines 302–314 (the opacity-based hover, 4px radius version). The merged block at lines 2429–2462 is the one that actually applies. This removes dead CSS and eliminates the radius/hover-mechanism discrepancy.

**Rules touched:** 1 block deleted (~13 lines). 0 DOM changes.

---

### Summary of estimated effort

| Step | Effort | CSS lines affected | DOM changes |
|---|---|---|---|
| 1 — Token block | XS | +25 | 0 |
| 2 — Icon button unification | MD | ~40 consolidated | 7 files |
| 3 — Accent color tokens | SM | ~30 values | 0 |
| 4 — Modal radius audit | XS | 0 | 0 |
| 5 — controls-button rename | SM | ~30 | 1 file |
| 6 — toggle unification | SM | ~12 | 1 file |
| 7 — dead rule deletion | XS | -13 | 0 |
| **Total** | **SM–MD** | **~135 lines touched** | **~9 files** |
