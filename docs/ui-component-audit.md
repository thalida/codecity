# UI Component Inventory — styles.css

Source: `/Users/thalida/Documents/Repos/codecity/web/styles.css` (2666 lines).

Reference material for the component-system refactor. Inventory only —
no proposed names. Line numbers refer to the declaration line (not the
selector line) unless noted.

---

## 1. Font sizes

| Value | Lines | Selectors |
|---|---|---|
| `0` | 1769 | `.file-icon` (hides broken-image alt glyph) |
| `9px` | 308 | `.path-badge` |
| `9.5px` | 548 | `.app-footer-source` |
| `10px` | 734, 995, 1018, 1124, 1294, 1471, 1553, 2544, 2635 | `.street-label`; `.controls-section-label`; `.controls-section-hint kbd, .shortcuts-list kbd, .shortcuts-list .shortcuts-mouse`; `.shortcuts-list .shortcuts-or`; `.theme-subgroup-label`; `.theme-select-option`; `.theme-slider-readout`; `.recent-row-badge`; `.loading-steps li[data-state="done"]::before` |
| `10.5px` | 450, 509 | `.app-header-branch-pill`; `#app-footer` |
| `11px` | 208, 714, 1003, 1111, 1366, 1498, 1887, 2195, 2236, 2523, 2556, 2615 | `#app-header`; `#hover-tooltip`; `.controls-section-hint`; `.shortcuts-list`; `.theme-row`; `.theme-number`; `.search-state-sub`; `.preview-state-sub`; `.code-editor-banner`; `.recent-row .recent-sub`; `.modal-field-help`; `.loading-steps li::before` |
| `11.5px` | 1903 | `.search-result` |
| `12px` | 356, 385, 416, 696, 954, 1176, 1186, 1205, 1783, 1795, 1838, 1880, 1998, 2056, 2072, 2091, 2254, 2449, 2502, 2601 | `.app-header-sep`; `.file-path-sep`; `.project-btn`; `.building-selected-indicator`; `.pane-title`; `.btn-toggle`; `.segmented-option`; `.btn-accent-outline, .controls-button`; `.tree-icon`; `.tree-label`; `.search-input`; `.search-state-title`; `.info-markdown h5, h6`; `.info-markdown code`; `.info-markdown pre`; `.info-markdown table`; `.code-editor`; `.modal-field label`; `.recents-list h3`; `.loading-steps li` |
| `13px` | 572, 1958, 1993, 2188, 2472, 2586 | `.app-footer-button .lucide-icon`; `.info-markdown`; `.info-markdown h4`; `.preview-state-title`; `.modal-error`; `.loading-title` |
| `14px` | 137, 163, 235, 437, 808, 826, 1085, 1405, 1826, 1990, 2241, 2626, 2662 | `.btn-icon`; `html, body`; `.app-header-icon .lucide-icon`; `.project-btn .lucide-icon`; `.pane-header-close`; `.pane-header-action`; `.controls-section-reset`; `.theme-row-reset`; `.search-input-icon`; `.info-markdown h3`; `.code-editor-banner .lucide-icon`; `.loading-steps li[data-state="active"]::before`; `.switch-source-btn .lucide-icon, .app-header-refresh-btn .lucide-icon, .app-header-repo-link .lucide-icon` |
| `17px` | 1985 | `.info-markdown h2` |
| `18px` | 2409 | `.modal-header button.modal-close` |
| `20px` | 1980 | `.info-markdown h1` |
| `22px` | 1874 | `.search-state .lucide-icon` |
| `28px` | 2182 | `.preview-state .lucide-icon` |
| `inherit` | 2080 | `.info-markdown pre code` |

**Near-duplicates (same role, different value):**
- Footer text: `9.5px` (`.app-footer-source` 548) vs `10.5px` (`#app-footer` 509) vs `11px` (used elsewhere)
- Mono buttons: `10px` (`.theme-select-option` 1471) vs `10.5px` (`.app-header-branch-pill` 450) vs `11px` (`.theme-number` 1498)
- Hint/help body text: `11px` (`.controls-section-hint` 1003, `.modal-field-help` 2556) vs `12px` (`.modal-field label` 2449) — both "secondary copy"
- Body text in cards: `12px` (`.recent-row .recent-sub` 2523 — but this is `11px` actually) and `13px` (`.modal-error` 2472, `.loading-title` 2586)
- "Section title" sizes: 12px (`.pane-title` 954, `.controls-section-label` is 10px), 13px (preview-state-title), 14px (info-markdown h3) — same role at different scopes

---

## 2. Font weights

| Value | Lines | Selectors |
|---|---|---|
| `500` | 735, 1177, 1187, 1206, 1804, 1881, 2189, 2520 | `.street-label`; `.btn-toggle`; `.segmented-option`; `.btn-accent-outline, .controls-button`; `.tree-dir > .tree-row > .tree-label`; `.search-state-title`; `.preview-state-title`; `.recent-row .recent-label` |
| `600` | 955, 2355, 2401, 2489, 2545, 2587 | `.pane-title`; `.hljs-strong`; `.modal-header`; `.modal-actions button`; `.recent-row-badge`; `.loading-title` |
| `700` | 309, 996, 1295, 1922, 1970, 2018, 2627 | `.path-badge`; `.controls-section-label`; `.theme-subgroup-label`; `.search-result mark`; `.info-markdown h1–h6`; `.info-markdown strong`; `.loading-steps li[data-state="active"]::before` |

No `400` / `normal` explicit declarations (defaults apply).

**Near-duplicate:** `.pane-title` uses 600 (line 955) while `.controls-section-label` and `.theme-subgroup-label` (both also "section heading" roles) use 700 (lines 996, 1295).

---

## 3. Font families

Two families confirmed.

### Sans (Inter stack)
Full declaration:
```
'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif
```
Lines: 154 (`html, body`).

Shortened variant (no Roboto/Oxygen/Ubuntu tail):
```
'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif
```
Lines: 728 (`.street-label`); 2174 (`.preview-state`); 2230 (`.code-editor-banner`).

### Monospace
```
'SF Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace
```
Lines: 207 (`#app-header`); 312 (`.path-badge`); 508 (`#app-footer`); 719 (`#hover-tooltip`); 968 (`.pane-title.is-mono`); 1017 (`.controls-section-hint kbd, .shortcuts-list kbd, .shortcuts-list .shortcuts-mouse`); 1497 (`.theme-number`); 1552 (`.theme-slider-readout`); 1902 (`.search-result`); 2055 (`.info-markdown code`); 2071 (`.info-markdown pre`); 2253 (`.code-editor`).

Shortened mono variant (only Fira Code fallback):
```
'SF Mono', 'Fira Code', monospace
```
Lines: 451 (`.app-header-branch-pill`).

### `inherit`
Lines: 1154 (`.btn-toggle, .segmented-option, .theme-select-option`); 1204 (`.btn-accent-outline, .controls-button`); 1837 (`.search-input`); 2293 (`.code-editor-code`); 2392 (`.modal-card`).

**Inconsistency:** Inter stack appears in three slightly different forms (full 8-item; trimmed 5-item; the `font:` shorthand `font: inherit` 335, 415, 1436). `.app-header-branch-pill` (line 451) uses a 3-item mono stack vs everywhere else's 5-item — appears accidental.

---

## 4. Border-radius

| Value | Lines | Selectors |
|---|---|---|
| `2px` | 1526, 1580, 1588 | `.theme-slider`; `.theme-range-pair-track`; `.theme-range-pair-fill` |
| `3px` | 231, 307, 338, 414, 569, 1015, 1438, 1442, 1452, 2059, 2652 | `.app-header-icon`; `.path-badge`; `.app-header-segment`; `.project-btn`; `.app-footer-button`; `.controls-section-hint kbd, .shortcuts-list kbd, .shortcuts-list .shortcuts-mouse`; `.theme-color::-webkit-color-swatch`; `.theme-color::-moz-color-swatch`; `.theme-hue-preview`; `.info-markdown code`; `.switch-source-btn, .app-header-refresh-btn, .app-header-repo-link` |
| `4px` | 136, 668, 716, 807, 822, 1047, 1083, 1138 (wait `6px`), 1179, 1189, 1317, 1404, 1430, 1464, 1495, 1672, 1714, 1835, 2085 | `.btn-icon`; `#sidebar ::-webkit-scrollbar-thumb`; `#hover-tooltip`; `.pane-header-close`; `.pane-header-action`; `.controls-section > summary.controls-section-summary`; `.controls-section-reset`; `.btn-toggle`; `.segmented-option`; `.theme-subgroup-collapsible > summary.theme-subgroup-label`; `.theme-row-reset`; `.theme-color`; `.theme-select`; `.theme-number`; `#tree-sidebar ::-webkit-scrollbar-thumb`; `.tree-row`; `.search-input`; `.info-markdown img` |
| `5px` | 1202, 2067 | `.btn-accent-outline, .controls-button`; `.info-markdown pre` |
| `6px` | 1138, 2411, 2434, 2457, 2470, 2486, 2513 | `.segmented-control`; `.modal-header button.modal-close`; `.modal-tabs button`; `.modal-field input`; `.modal-error`; `.modal-actions button`; `.recent-row` |
| `8px` | 447 | `.app-header-branch-pill` |
| `10px` | 2389, 2550, 2570 | `.modal-card`; `.recent-row-badge`; `.loading-card` |
| `50%` | 590, 1536, 1544, 1639, 1649, 2579 | `.app-footer-status-dot`; `.theme-slider::-webkit-slider-thumb`; `.theme-slider::-moz-range-thumb`; `.theme-range-pair input[type='range']::-webkit-slider-thumb`; `.theme-range-pair input[type='range']::-moz-range-thumb`; `.loading-spinner` |
| `100px` | 694 | `.building-selected-indicator` (full pill) |

**Near-duplicates (same role, different value):**
- "Interactive control" radius: 3px (`.app-header-icon`, `.app-header-segment`, `.project-btn`, `.app-footer-button`, `.switch-source-btn`+aliases) vs 4px (`.btn-icon`, `.pane-header-close`, `.pane-header-action`, `.controls-section > summary`, `.theme-row-reset`, `.tree-row`)
- "Form input" radius: 4px (`.theme-color`, `.theme-number`, `.theme-select`, `.search-input`) vs 6px (`.modal-field input`)
- "Button" radius: 4px (`.btn-toggle`, `.segmented-option`) vs 5px (`.btn-accent-outline, .controls-button`) vs 6px (`.modal-tabs button`, `.modal-actions button`, `.modal-header .modal-close`)
- "Badge / pill": 3px (`.path-badge` 307, kbd 1015, info code 2059) vs 8px (`.app-header-branch-pill` 447) vs 10px (`.recent-row-badge` 2550) vs 100px (`.building-selected-indicator` 694)
- "Card": 5px (`.info-markdown pre` 2067) vs 6px (`.segmented-control` 1138, `.recent-row` 2513) vs 10px (`.modal-card`, `.loading-card`)

The file comment at line 2359–2361 states the modal radius convention: outer card 10px, interactive children 6px.

---

## 5. Padding (shorthand)

| Value | Lines | Selectors |
|---|---|---|
| `0` | 13, 874, 1427, 1434, 1607, 1699, 2078, 2594 | universal reset; `.activity-bar-icon`; `.theme-color`; `.theme-color::-webkit-color-swatch-wrapper`; `.theme-range-pair input[type='range']`; `.tree-item`; `.info-markdown pre code`; `.loading-steps` |
| `0 !important` | 2296 | `.code-editor-code` |
| `0 1px` | 387 | `.file-path-sep` |
| `0 2px` | 368 | `.app-header-ellipsis, .file-path-ellipsis` |
| `0 2px 0 8px` | 408 | `.project-btn` |
| `0 6px` | 445 | `.app-header-branch-pill` |
| `0 8px` | 204, 649 (media) | `#app-header`; `#app-footer` (≤580px) |
| `0 12px` | 504 | `#app-footer` |
| `1px 4px` | 333 | `.app-header-segment` |
| `1px 5px` | 1019, 2060 | `.controls-section-hint kbd, .shortcuts-list kbd, .shortcuts-list .shortcuts-mouse`; `.info-markdown code` |
| `1px 6px` | 306 | `.path-badge` |
| `2px` | 1139 | `.segmented-control` |
| `2px 0 2px 20px` | 2602 | `.loading-steps li` |
| `2px 4px` | 2658 | `.app-header-repo-link` |
| `2px 7px` | 2551 | `.recent-row-badge` |
| `3px 5px` | 1082, 1400 | `.controls-section-reset`; `.theme-row-reset` |
| `3px 6px` | 1499 | `.theme-number` |
| `3px 8px` | 1472 | `.theme-select-option` |
| `3px 16px` | 1043, 1313, 1712 | `.controls-section > summary.controls-section-summary`; `.theme-subgroup-collapsible > summary.theme-subgroup-label`; `.tree-row` |
| `4px` | 806, 821 | `.pane-header-close`; `.pane-header-action` |
| `4px 0` | 1365, 1895 | `.theme-row`; `.search-results` |
| `4px 8px` | 1472 — wait that's `3px 8px`. Real `4px 8px`: 2410, 2532 | `.modal-header button.modal-close`; `.recent-row .recent-remove` |
| `4px 9px` | 715 | `#hover-tooltip` |
| `4px 12px` | 1899, 2039 | `.search-result`; `.info-markdown blockquote` |
| `5px 8px` | 1839 | `.search-input` |
| `5px 10px` | 1178, 2096 | `.btn-toggle`; `.info-markdown th, td` |
| `6px 10px` | 1188 | `.segmented-option` |
| `6px 12px` | 2226 | `.code-editor-banner` |
| `6px 14px` | 2433 | `.modal-tabs button` |
| `6px 16px` | 695 | `.building-selected-indicator` |
| `8px 0` | 851, 974 | `.activity-bar`; `.tree-root` |
| `8px 4px` | 2512 | `.recent-row` |
| `8px 10px` | 1207, 2456, 2469 | `.btn-accent-outline, .controls-button`; `.modal-field input`; `.modal-error` |
| `8px 16px` | 2485 | `.modal-actions button` |
| `10px 8px 10px 10px` | 2263 | `.code-editor-gutter` |
| `10px 12px` | 1820, 2068, 2285 | `.search-input-wrap`; `.info-markdown pre`; `.code-editor-pre` |
| `10px 16px` | 1256 | `.controls-actions` |
| `12px 12px 12px 16px` | 937 | `.pane-header` |
| `14px 18px` | 2399 | `.modal-header` |
| `16px` | 982 | `.controls-body` |
| `16px 18px` | 2418 | `.modal-body` |
| `16px 18px 24px` | 1956 | `.info-markdown` |
| `24px 18px` | 1869 | `.search-state` |
| `24px 32px` | 2567 | `.loading-card` |
| `32px 20px` | 2171 | `.preview-state` |
| `0 0 0 8px` | 1688 | `.tree-list` |

### Padding-* (single-side)

| Property:Value | Line | Selector |
|---|---|---|
| `padding-top: 0` | 1289, 1349 | `.theme-subgroup:first-of-type`; `.theme-subgroup-collapsible > .theme-subgroup:first-of-type` |
| `padding-top: 4px` | 1284 | `.theme-subgroup` |
| `padding-top: 6px` | 990 | `.controls-section + .controls-section` |
| `padding-top: 10px` | 2499 | `.recents-list` |
| `padding-bottom: 4px` | 1986 | `.info-markdown h2` |
| `padding-bottom: 6px` | 1981 | `.info-markdown h1` |
| `padding-left: 0` | 1694 | `.tree-root.tree-list` |
| `padding-left: 10px` | 1345 | `.theme-subgroup-collapsible > .theme-subgroup` |
| `padding-left: 22px` | 2028 | `.info-markdown ul, .info-markdown ol` |

**Near-duplicates:**
- "Edge-to-edge row" padding: `3px 16px` (`.tree-row`, `.controls-section-summary`, `.theme-subgroup-collapsible summary`) — consistent, good
- "Compact button" padding: `3px 5px` (reset buttons) vs `3px 6px` (theme-number) vs `3px 8px` (theme-select-option) — all "inline mini-input" role
- "Modal container body" padding: `14px 18px` (modal-header), `16px 18px` (modal-body), `16px 18px 24px` (info-markdown), `24px 18px` (search-state), `24px 32px` (loading-card), `32px 20px` (preview-state) — varied "card body" paddings
- "Standard medium button": `5px 10px` (btn-toggle), `6px 10px` (segmented-option), `6px 14px` (modal-tabs button), `8px 10px` (btn-accent-outline, modal-field input, modal-error), `8px 16px` (modal-actions button)
- "Pane header": `12px 12px 12px 16px` (pane-header 937) vs `14px 18px` (modal-header 2399) — both "panel headers"

---

## 6. Margin

### Margin shorthand

| Value | Lines | Selectors |
|---|---|---|
| `0` | 12, 334, 953, 1119, 1401, 1487, 1606, 1684, 1698, 1879, 1885, 1894, 2034, 2187, 2193, 2284, 2593 | universal reset; `.app-header-segment`; `.pane-title`; `.shortcuts-list dd`; `.theme-row-reset`; `.theme-toggle`; `.theme-range-pair input[type='range']`; `.tree-list`; `.tree-item`; `.search-state-title`; `.search-state-sub`; `.search-results`; `.info-markdown li > p`; `.preview-state-title`; `.preview-state-sub`; `.code-editor-pre`; `.loading-steps` |
| `0 0 8px` | 2506 | `.recents-list h3` |
| `0 1px` | 1020 | `.controls-section-hint kbd, .shortcuts-list kbd, .shortcuts-list .shortcuts-mouse` |
| `0 6px 0 0` | 2105 | `.info-markdown input[type='checkbox']` |
| `3px 0` | 2031 | `.info-markdown li` |
| `4px 0` | 1131, 2045 | `.shortcuts-divider`; `.info-markdown blockquote > p` |
| `8px 0` | 2005, 2027 | `.info-markdown p`; `.info-markdown ul, ol` |
| `8px 0 0` | 1110 | `.shortcuts-list` |
| `10px 0` | 2038, 2069, 2090 | `.info-markdown blockquote`; `.info-markdown pre`; `.info-markdown table` |
| `16px 0` | 2051 | `.info-markdown hr` |
| `18px 0 8px` | 1971 | `.info-markdown h1–h6` |

### Margin-* (single-side)

| Property:Value | Line | Selector |
|---|---|---|
| `margin-top: 0` | 1977 | `.info-markdown h1:first-child, h2:first-child, h3:first-child` |
| `margin-top: 4px` | 1283, 2558 | `.theme-subgroup`; `.recent-row .recent-sub` (actually this is line 2558 in different context — verifying: line 2558 is `.modal-field-help` margin-top: 4px) |
| `margin-top: 6px` | 989, 1288, 2478 | `.controls-section + .controls-section`; `.theme-subgroup:first-of-type`; `.modal-actions` |
| `margin-top: 8px` | 1348 | `.theme-subgroup-collapsible > .theme-subgroup:first-of-type` |
| `margin-top: 14px` | 2497 | `.recents-list` |
| `margin-bottom: 2px` | 1876 | `.search-state .lucide-icon` |
| `margin-bottom: 4px` | 1046, 1316, 1316 — also `.preview-state .lucide-icon` 2184 | `.controls-section > summary.controls-section-summary`; `.theme-subgroup-collapsible > summary.theme-subgroup-label`; `.preview-state .lucide-icon` |
| `margin-bottom: 8px` | 1299 | `.theme-subgroup-label` |
| `margin-bottom: 12px` | 1006, 2446, 2471 | `.controls-section-hint`; `.modal-field`; `.modal-error` |
| `margin-bottom: 14px` | 2426 | `.modal-tabs` |
| `margin-left: -16px` | 1044, 1314 | `.controls-section > summary.controls-section-summary`; `.theme-subgroup-collapsible > summary.theme-subgroup-label` |
| `margin-left: 2px` | 1125 | `.shortcuts-list .shortcuts-or` |
| `margin-left: 3px` | 546 | `.app-footer-source` |
| `margin-left: 4px` | 2657 | `.app-header-refresh-btn` |
| `margin-left: 6px` | 446, 1455 | `.app-header-branch-pill`; `.theme-hue-preview` |
| `margin-right: 0` | 409, 2656 | `.project-btn`; `.switch-source-btn` |
| `margin-right: -16px` | 1045, 1315 | `.controls-section > summary.controls-section-summary`; `.theme-subgroup-collapsible > summary.theme-subgroup-label` |
| `margin-right: 4px` | 1766, 2658 | `.file-icon`; `.app-header-repo-link` |
| **`margin-left: auto`** | 1074, 2530, 2543 | `.controls-section-reset`; `.recent-row .recent-remove`; `.recent-row-badge` |

**Special:** `margin-left: auto` is used three times to push an element to the right end of a flex row. This is a consistent "push-to-end" idiom.

**Near-duplicates:**
- "Pulled-out negative margin to fill pane padding": `-16px` in 2 places (1044/1314) — paired with `padding: 3px 16px` to make edge-to-edge hover.
- "Small breathing-room bottom margin": `4px` vs `8px` vs `12px` vs `14px` — all "section gap" usage. The `controls-section-hint margin-bottom: 12px` and `modal-field margin-bottom: 12px` align; but `theme-subgroup-label margin-bottom: 8px` differs.

---

## 7. Gap

| Value | Lines | Selectors |
|---|---|---|
| `2px` | 323, 857, 965, 1708 | `.app-header-crumbs`; `.activity-bar-group`; `.pane-title`; `.tree-row` |
| `4px` | 202, 1038, 1312, 2425 | `#app-header`; `.controls-section > summary.controls-section-summary`; `.theme-subgroup-collapsible > summary.theme-subgroup-label`; `.modal-tabs` |
| `6px` | 403, 520, 585, 648 (media), 1108 (`6px 14px` — row+col), 1271, 1378, 1819, 1868 (`8px` — no), 2445, 2598 | `.project-btn`; `.app-footer-section`; `.app-footer-status`; `#app-footer` (≤580px); `.shortcuts-list` (row gap; col 14px); `.controls-actions .btn-accent-outline`; `.theme-row-label`; `.search-input-wrap`; `.modal-field`; `.loading-steps` |
| `6px 14px` | 1108 | `.shortcuts-list` (row × col) |
| `8px` | 219, 943, 1255, 1264, 1388, 1516, 1868, 2225 | `#app-title`; `.pane-header`; `.controls-actions`; `.controls-actions-left, .controls-actions-right`; `.theme-row-control`; `.theme-slider-wrap`; `.search-state`; `.code-editor-banner` |
| `10px` | 2170, 2511, 2566 | `.preview-state`; `.recent-row`; `.loading-card` |
| `12px` | 1364 | `.theme-row` |
| `14px` | 503 | `#app-footer` |

**Near-duplicates:**
- "Row-level gap": `2px` (tree-row, pane-title) vs `4px` (controls-section-summary, theme-subgroup-summary) — both are chevron-to-label gaps
- "Comfortable section gap": `6px`, `8px`, `10px` — used near-interchangeably across cards. e.g. modal cards use `6px` (.modal-field), `8px` (.search-state), `10px` (.recent-row), `14px` (.loading-card-internal items)

---

## 8. Transitions

| Value | Line | Selector |
|---|---|---|
| `opacity 0.2s` | 700 | `.building-selected-indicator` |
| `color 0.15s, background 0.15s, border-color 0.15s` | 870 (multi-line) | `.activity-bar-icon` |
| `background 0.1s` | 1048, 1318, 1715 | `.controls-section > summary.controls-section-summary`; `.theme-subgroup-collapsible > summary.theme-subgroup-label`; `.tree-row` |
| `transform 0.1s ease` | 1063, 1331 | `.controls-section-chevron`; `.theme-subgroup-chevron` |
| `color 0.15s, background 0.15s` | 1156 (multi-line) | `.btn-toggle, .segmented-option, .theme-select-option` |
| `color 0.15s, background 0.15s, border-color 0.15s` | 1209 (multi-line) | `.btn-accent-outline, .controls-button` |
| `color 0.2s` | 2605 | `.loading-steps li` |

**Duration patterns:** `0.1s` (3 instances on row/chevron interactions), `0.15s` (3 multi-property buttons), `0.2s` (2 fade/color transitions).

**Inconsistency:** Row hovers use `0.1s` (lines 1048, 1318, 1715) but button hovers use `0.15s` (1156, 1209). Both are "hover state change" — no obvious reason for the split.

---

## 9. Box-shadow

| Value | Line | Selector |
|---|---|---|
| `0 2px 10px rgba(0, 0, 0, 0.4)` | 721 | `#hover-tooltip` |
| `0 0 6px rgba(91, 157, 255, 0.35)` | 1590 | `.theme-range-pair-fill` (glow) |
| `0 1px 3px rgba(0, 0, 0, 0.4)` | 1642, 1652 | `.theme-range-pair input[type='range']::-webkit-slider-thumb`; `::-moz-range-thumb` |
| `0 10px 40px rgba(0, 0, 0, 0.6)` | 2390, 2571 | `.modal-card`; `.loading-card` |

Three discrete elevations: subtle thumb shadow, tooltip shadow, full modal shadow. Plus one accent glow.

---

## 10. Letter-spacing

| Value | Lines | Selectors |
|---|---|---|
| `0.02em` | 221, 957 | `#app-title`; `.pane-title` |
| `0.04em` | 310, 2546 | `.path-badge`; `.recent-row-badge` |
| `0.05em` | 2001 | `.info-markdown h5, h6` |
| `0.08em` | 1296, 2504 | `.theme-subgroup-label`; `.recents-list h3` |
| `0.1em` | 997 | `.controls-section-label` |

**Near-duplicates:** "Uppercase section label" tracking: `.controls-section-label` uses `0.1em` (line 997), `.theme-subgroup-label` uses `0.08em` (1296), `.recents-list h3` uses `0.08em` (2504), `.info-markdown h5, h6` uses `0.05em` (2001) — all are uppercase tracking labels, four different values.

---

## 11. Surface containers

Selectors with an explicit `background` that acts as a panel/surface (excluding hover overlays and accent-tint backgrounds).

| Selector | Lines | Background | Padding | Border | Border-radius |
|---|---|---|---|---|---|
| `html, body` | 145–167 | `var(--cc-bg-app)` | — | — | — |
| `canvas` | 238–245 | `var(--cc-bg-app)` | — | — | — |
| `#app-header` | 198–212 | `var(--cc-bg-chrome)` | `0 8px` | `border-bottom: 1px solid var(--cc-border-subtle)` | — |
| `#sidebar` | 249–265 | `var(--cc-bg-sidebar)` | — | `border-left: 1px solid var(--cc-border-subtle)` | — |
| `#app-footer` | 498–512 | `var(--cc-bg-chrome)` | `0 12px` | `border-top: 1px solid var(--cc-track)` | — |
| `#hover-tooltip` | 709–722 | `rgba(15, 17, 26, 0.94)` | `4px 9px` | `1px solid var(--cc-border-tooltip)` | `4px` |
| `#tree-sidebar` | 748–761 | `var(--cc-bg-sidebar)` | — | `border-right: 1px solid var(--cc-border-subtle)` | — |
| `.activity-bar` | 842–852 | `var(--cc-bg-chrome)` | `8px 0` | `border-right: 1px solid var(--cc-border-subtle)` | — |
| `.editor-body` | 475–482 | `var(--cc-bg-app)` | — | — | — |
| `.code-editor` | 2245–2257 | `var(--cc-bg-app)` | — | — | — |
| `.code-editor-banner` | 2221–2238 | `rgba(91, 157, 255, 0.06)` (accent-tint) | `6px 12px` | `border-bottom: 1px solid var(--cc-accent-mid)` | — |
| `.code-editor-gutter` | 2259–2275 | `var(--cc-bg-chrome)` | `10px 8px 10px 10px` | `border-right: 1px solid var(--cc-track)` | — |
| `.controls-actions` | 1250–1259 | `var(--cc-bg-sidebar)` | `10px 16px` | `border-top: 1px solid var(--cc-border-subtle)` | — |
| `.segmented-control` | 1134–1140 | `var(--cc-bg-chrome)` | `2px` | `1px solid var(--cc-border-input)` | `6px` |
| `.theme-select` | 1460–1466 | `var(--cc-bg-chrome)` | — | `1px solid var(--cc-border-input)` | `4px` |
| `.theme-number` | 1491–1501 | `var(--cc-bg-chrome)` | `3px 6px` | `1px solid var(--cc-border-input)` | `4px` |
| `.search-input` | 1830–1841 | `var(--cc-bg-chrome)` | `5px 8px` | `1px solid var(--cc-border-input)` | `4px` |
| `.info-markdown pre` | 2064–2074 | `var(--cc-bg-chrome)` | `10px 12px` | `1px solid var(--cc-track)` | `5px` |
| `.info-markdown th` | 2099–2102 | `var(--cc-bg-chrome)` | (from th/td 5px 10px) | (from th/td 1px solid var(--cc-border-subtle)) | — |
| `.modal-card` | 2381–2393 | `var(--cc-bg-modal)` | — | — | `10px` |
| `.loading-card` | 2562–2573 | `var(--cc-bg-modal)` | `24px 32px` | — | `10px` |
| `.modal-backdrop, .loading-backdrop` | 2363–2372 | `rgba(0, 0, 0, 0.55)` | — | — | — |
| `.preview-image` | 2113–2129 | checkerboard gradient using `var(--cc-bg-chrome)` | — | — | — |
| `.preview-media` | 2131–2137 | `#000` | — | — | — |

**Background-tokens summary:**
- `--cc-bg-app`: app + canvas + editor-body + code-editor (4 uses)
- `--cc-bg-chrome`: app-header, app-footer, activity-bar, code-editor-gutter, segmented-control, theme-select, theme-number, search-input, info-markdown pre, info-markdown th, code-editor-banner-bg (NO — banner uses accent tint) (10 uses)
- `--cc-bg-sidebar`: sidebar, tree-sidebar, controls-actions (3 uses)
- `--cc-bg-modal`: modal-card, loading-card (2 uses)
- `rgba(15, 17, 26, 0.94)`: hover-tooltip only — a one-off near-`--cc-bg-sidebar`
- `rgba(0, 0, 0, 0.55)`: backdrop only

---

## 12. Row-style components

Clickable horizontal rows with rest / hover / selected states.

### `.tree-row` (1702–1741)
- **Rest** (1702): `display: flex; align-items: center; gap: 2px; padding: 3px 16px; cursor: pointer; border-radius: 4px; transition: background 0.1s; user-select: none`
- **Hover** (1719): `background: rgba(255, 255, 255, 0.04)`
- **Hovered (city-driven mirror)** (1727): `.tree-item.tree-hovered > .tree-row { background: rgba(255, 255, 255, 0.04) }`
- **Selected** (1735): `.tree-item.tree-selected > .tree-row { background: var(--cc-accent-mid) }`
- **Selected + hover** (1738): `background: rgba(91, 157, 255, 0.24)`

### `.search-result` (1897–1927)
- **Rest** (1897): `display: block; padding: 4px 12px; cursor: pointer; border-left: 2px solid transparent; font-family: mono; font-size: 11.5px; color: var(--cc-text-row); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; outline: none`
- **Hover** (1910): `background: rgba(255, 255, 255, 0.04); color: var(--cc-text-primary)`
- **Focus-visible** (selected-by-keyboard) (1914): `background: rgba(91, 157, 255, 0.12); border-left-color: var(--cc-accent); color: var(--cc-text-primary)`
- **Mark inside row** (1919): `color: var(--cc-accent); font-weight: 700`; on hover/focus mark → `var(--cc-accent-mark)`

### `.recent-row` (2508–2541)
- **Rest** (2508): `display: flex; align-items: center; gap: 10px; padding: 8px 4px; border-radius: 6px; cursor: pointer`
- **Hover** (2516): `background: rgba(255, 255, 255, 0.06)`
- **Active** (`.recent-row--active`) (2535): `background: rgba(91, 157, 255, 0.08); cursor: default`
- **Active hover** (2539): `background: rgba(91, 157, 255, 0.12)`

### `.controls-section > summary.controls-section-summary` (1032–1054)
- **Rest** (1032): `cursor: pointer; list-style: none; user-select: none; display: flex; align-items: center; gap: 4px; padding: 3px 16px; margin-left: -16px; margin-right: -16px; margin-bottom: 4px; border-radius: 4px; transition: background 0.1s`
- **Hover** (1050): `background: rgba(255, 255, 255, 0.04)`
- No selected state.

### `.theme-subgroup-collapsible > summary.theme-subgroup-label` (1306–1325)
- **Rest** (1306): `cursor: pointer; list-style: none; user-select: none; display: flex; align-items: center; gap: 4px; padding: 3px 16px; margin-left: -16px; margin-right: -16px; margin-bottom: 4px; border-radius: 4px; transition: background 0.1s`
- **Hover** (1320): `background: rgba(255, 255, 255, 0.04)`
- No selected state. **Identical to `.controls-section-summary`.**

### `.theme-select-option` (1469–1479; shell shared with `.btn-toggle, .segmented-option` 1147–1172)
- **Rest** (shared 1147 + override 1469): `appearance: none; background: none; border: none; color: var(--cc-text-faint); font-family: inherit; cursor: pointer; transition: color 0.15s, background 0.15s; border-right: 1px solid var(--cc-track); font-size: 10px; padding: 3px 8px`
- **Hover** (shared 1161 + override 1477): `color: var(--cc-text-secondary); background: rgba(255, 255, 255, 0.04)`
- **Active** (1167): `background: var(--cc-accent-mid); color: var(--cc-text-primary)`

### `.activity-bar-icon` (860–886)
- **Rest** (860): `background: none; border: none; color: var(--cc-text-faintest); height: 40px; display: flex; align-items: center; justify-content: center; cursor: pointer; border-left: 2px solid transparent; transition: color 0.15s, background 0.15s, border-color 0.15s; padding: 0`
- **Hover** (877): `color: var(--cc-text-secondary); background: rgba(255, 255, 255, 0.03)`
- **Active** (882): `color: var(--cc-text-primary); border-left-color: var(--cc-accent); background: rgba(91, 157, 255, 0.06)`

### `.app-header-segment` (329–351)
- **Rest** (329): `background: none; border: none; padding: 1px 4px; margin: 0; font: inherit; color: var(--cc-text-muted); cursor: pointer; border-radius: 3px`
- **Hover** (341): `color: var(--cc-text-primary); background: rgba(255, 255, 255, 0.06)`
- **Leaf** (345): `color: var(--cc-text-primary); cursor: default`
- **Leaf hover** (349): `background: transparent`

### `.modal-tabs button` (2428–2440)
- **Rest** (2428): `appearance: none; background: transparent; border: 1px solid rgba(255, 255, 255, 0.12); color: inherit; padding: 6px 14px; border-radius: 6px; cursor: pointer; font: inherit`
- **Active** (2438): `background: rgba(255, 255, 255, 0.10)`
- No explicit hover.

### `.loading-steps li` (2600–2636)
- **Rest** (2600): `font-size: 12px; padding: 2px 0 2px 20px; position: relative; color: rgba(232, 232, 237, 0.5); transition: color 0.2s`
- **Pending** (2617): same color
- **Active** (2620): `color: var(--cc-accent)`; pseudo-element `'›'`
- **Done** (2629): `color: rgba(232, 232, 237, 0.55)`; pseudo-element `'✓'`

**Pattern summary:**
- Row hover bg: `rgba(255, 255, 255, 0.03)` (activity-bar-icon), `0.04` (tree-row, search-result, controls-summary, theme-subgroup-summary, theme-select-option), `0.06` (recent-row, app-header-segment)
- Selected bg: `var(--cc-accent-mid)` (tree-row, btn-toggle.is-active), `rgba(91, 157, 255, 0.12)` (search-result:focus, recent-row--active:hover), `rgba(91, 157, 255, 0.08)` (recent-row--active), `rgba(91, 157, 255, 0.06)` (activity-bar-icon.active)
- Three rows use the `padding: 3px 16px` + `margin-left: -16px; margin-right: -16px` "bleed to pane edge" pattern: tree-row (1702, no negative margin), controls-section-summary (1043 + negative), theme-subgroup-label (1313 + negative).

---

## 13. Label components (uppercase tracking labels)

| Selector | Lines | font-size | font-weight | letter-spacing | text-transform | color |
|---|---|---|---|---|---|---|
| `.controls-section-label` | 994–1000 | 10px | 700 | 0.1em | uppercase | `var(--cc-text-secondary)` |
| `.theme-subgroup-label` | 1293–1300 | 10px | 700 | 0.08em | uppercase | `var(--cc-text-muted)` |
| `.recents-list h3` | 2501–2507 | 12px | (inherits) | 0.08em | uppercase | `rgba(232, 232, 237, 0.55)` |
| `.info-markdown h5, h6` | 1996–2002 | 12px | 700 (inherits from h1–h6 rule 1970) | 0.05em | uppercase | `var(--cc-text-muted)` |
| `.recent-row-badge` | 2542–2553 | 10px | 600 | 0.04em | (no) | `var(--cc-accent)` |
| `.path-badge` | 303–316 | 9px | 700 | 0.04em | lowercase (note: not upper) | (HSL inline) |

**Inconsistency:** Four "uppercase section label" variants with three different sizes (10px, 12px) and four different tracking values (0.05em, 0.08em, 0.1em).

---

## 14. Input components

| Selector | Line range | Width/Size | Background | Border | Border-radius | Padding | Font | Color | Focus |
|---|---|---|---|---|---|---|---|---|---|
| `.search-input` | 1830–1852 | flex 1 1 auto | `var(--cc-bg-chrome)` | `1px solid var(--cc-border-input)` | 4px | `5px 8px` | inherit / 12px | `var(--cc-text-primary)` | `border-color: rgba(91, 157, 255, 0.5)` (1846) |
| `.modal-field input` | 2452–2463 | (full width) | `rgba(255, 255, 255, 0.05)` | `1px solid rgba(255, 255, 255, 0.12)` | 6px | `8px 10px` | inherit | `inherit` | `outline: 2px solid var(--cc-accent); outline-offset: 0` |
| `.theme-number` | 1491–1505 | `70px` | `var(--cc-bg-chrome)` | `1px solid var(--cc-border-input)` | 4px | `3px 6px` | mono / 11px | `var(--cc-text-primary)` | `border-color: rgba(91, 157, 255, 0.5)` (1504) |
| `.theme-color` | 1422–1443 | `32px × 22px` | `transparent` | `1px solid rgba(255, 255, 255, 0.18)` | 4px (swatch 3px) | `0` | — | — | — |
| `.theme-slider` | 1519–1546 | flex 1 1 auto, `height: 4px` | `var(--cc-track)` | — | 2px (track) / 50% (thumb) | — | — | — | — |
| `.theme-range-pair input[type='range']` | 1597–1660 | absolute fill | transparent track | thumb: `1px solid rgba(255, 255, 255, 0.35)` | 50% (thumb) | `0` | — | thumb bg `var(--cc-accent)` (lo: `var(--cc-accent-thumb-lo)`) | `outline: none` |
| `.theme-toggle` (checkbox) | 1482–1488 | `16px × 16px` | (native) | (native) | — | — | — | `accent-color: var(--cc-accent)` | — |

**Inconsistencies:**
- Two distinct input "border" tokens: `var(--cc-border-input)` (sidebar/theme inputs) vs `rgba(255, 255, 255, 0.12)` (modal inputs).
- Two distinct backgrounds: `var(--cc-bg-chrome)` vs `rgba(255, 255, 255, 0.05)`.
- Two focus paradigms: border-color shift (search/theme-number) vs `outline: 2px solid` (modal-field-input).
- Three radii on form fields: 2px (slider track), 4px (search-input, theme-number, theme-color), 6px (modal-field-input).

---

## 15. Card components

| Selector | Lines | Background | Border | Border-radius | Padding | Shadow |
|---|---|---|---|---|---|---|
| `.modal-card` | 2381–2393 | `var(--cc-bg-modal)` | — | 10px | — (children pad) | `0 10px 40px rgba(0, 0, 0, 0.6)` |
| `.loading-card` | 2562–2573 | `var(--cc-bg-modal)` | — | 10px | `24px 32px` | `0 10px 40px rgba(0, 0, 0, 0.6)` |
| `#hover-tooltip` | 709–722 | `rgba(15, 17, 26, 0.94)` | `1px solid var(--cc-border-tooltip)` | 4px | `4px 9px` | `0 2px 10px rgba(0, 0, 0, 0.4)` |
| `.building-selected-indicator` | 687–705 | `rgba(91, 157, 255, 0.15)` | `1px solid rgba(91, 157, 255, 0.35)` | 100px (pill) | `6px 16px` | — |
| `.info-markdown pre` | 2064–2074 | `var(--cc-bg-chrome)` | `1px solid var(--cc-track)` | 5px | `10px 12px` | — |
| `.info-markdown code` (inline) | 2054–2062 | `rgba(91, 157, 255, 0.08)` | `1px solid var(--cc-accent-mid)` | 3px | `1px 5px` | — |
| `.controls-section-hint kbd, .shortcuts-list kbd, .shortcuts-list .shortcuts-mouse` | 1009–1023 | `var(--cc-accent-dim)` | `1px solid rgba(91, 157, 255, 0.3)` | 3px | `1px 5px` | — |
| `.info-markdown blockquote` | 2037–2046 | `rgba(91, 157, 255, 0.04)` | `border-left: 3px solid var(--cc-border-tooltip)` | — | `4px 12px` | — |
| `.code-editor-banner` | 2221–2238 | `rgba(91, 157, 255, 0.06)` | `border-bottom: 1px solid var(--cc-accent-mid)` | — | `6px 12px` | — |
| `.modal-error` | 2465–2473 | `rgba(220, 50, 70, 0.18)` | `1px solid rgba(220, 50, 70, 0.45)` | 6px | `8px 10px` | — |

**No selector explicitly named `.info-card` exists in styles.css.** The "info"-area styles all hang off `.info-markdown ...` subselectors.

---

## 16. Badge / pill components

| Selector | Lines | Size cues | Background | Border | Border-radius | Padding | Font |
|---|---|---|---|---|---|---|---|
| `.path-badge` | 303–316 | inline-block | `hsl(var(--badge-hue), 60%, 35%)` | — | 3px | `1px 6px` | 9px / 700 / 0.04em / lowercase / mono |
| `.app-header-branch-pill` | 441–453 | height 16px | `rgba(91, 157, 255, 0.14)` | — | 8px | `0 6px` | 10.5px / mono / `var(--cc-accent-light)` |
| `.recent-row-badge` | 2542–2553 | inline | `rgba(91, 157, 255, 0.15)` | `1px solid rgba(91, 157, 255, 0.35)` | 10px | `2px 7px` | 10px / 600 / 0.04em / `var(--cc-accent)` |
| `.building-selected-indicator` | 687–705 | fixed-positioned pill | `rgba(91, 157, 255, 0.15)` | `1px solid rgba(91, 157, 255, 0.35)` | 100px | `6px 16px` | 12px / `var(--cc-accent-soft)` |

**No selector named `.theme-row-rebuild-badge` exists in this file.**

**Pattern:** All four are inline "label/pill" badges with slightly different padding, radius, and color tokens. The `.recent-row-badge` and `.building-selected-indicator` share an identical background+border treatment (`rgba(91, 157, 255, 0.15)` + `1px solid rgba(91, 157, 255, 0.35)`).

---

## 17. Status dot components

| Selector | Lines | Size | Border-radius | Color hook |
|---|---|---|---|---|
| `.app-footer-status-dot` | 587–592 | 6px × 6px | 50% | base shape |
| `.app-footer-status.is-ready .app-footer-status-dot` | 601–603 | (inherited) | (inherited) | bg `var(--cc-success)` |
| `.app-footer-status.is-rebuilding .app-footer-status-dot` | 604–606, 612–615 | (inherited) | (inherited) | bg `var(--cc-warning)`; pulse animation |
| `.app-footer-status.is-error .app-footer-status-dot` | 607–609 | (inherited) | (inherited) | bg `var(--cc-error)` |

Only one status-dot component in the file (single instance with state variants). No similar dot pattern appears elsewhere.

Animations driving the dot:
- `@keyframes app-footer-pulse` (623): 0.9s ease-in-out (rebuild state)
- `@keyframes app-footer-heartbeat` (632): 2.4s ease-in-out (ready+live)
- `@keyframes cc-spin` (2582): 0.8s linear (loading-spinner)

---

## 18. Divider patterns

### `border-top` (excluding inputs/cards)

| Line | Selector | Color | Style/Thickness |
|---|---|---|---|
| 507 | `#app-footer` | `var(--cc-track)` | 1px solid |
| 991 | `.controls-section + .controls-section` | `var(--cc-track)` | 1px solid |
| 1258 | `.controls-actions` | `var(--cc-border-subtle)` | 1px solid |
| 1285 | `.theme-subgroup` | `var(--cc-track)` | **1px dashed** |
| 1290 | `.theme-subgroup:first-of-type` | — | `none` (override) |
| 1350 | `.theme-subgroup-collapsible > .theme-subgroup:first-of-type` | — | `none` |
| 2050 | `.info-markdown hr` | `var(--cc-border-subtle)` | 1px solid (via shorthand `border: none` then `border-top`) |
| 2498 | `.recents-list` | `rgba(255, 255, 255, 0.08)` | 1px solid |

### `border-bottom`

| Line | Selector | Color | Style/Thickness |
|---|---|---|---|
| 206 | `#app-header` | `var(--cc-border-subtle)` | 1px solid |
| 938 | `.pane-header` | `var(--cc-border-subtle)` | 1px solid |
| 1821 | `.search-input-wrap` | `var(--cc-border-subtle)` | 1px solid |
| 1982 | `.info-markdown h1` | `var(--cc-border-subtle)` | 1px solid |
| 1987 | `.info-markdown h2` | `var(--cc-track)` | 1px solid |
| 2228 | `.code-editor-banner` | `var(--cc-accent-mid)` | 1px solid |
| 2400 | `.modal-header` | `rgba(255, 255, 255, 0.08)` | 1px solid |

### `border-left` (dividers/indicators only, not full borders)

| Line | Selector | Color | Style/Thickness |
|---|---|---|---|
| 258 | `#sidebar` | `var(--cc-border-subtle)` | 1px solid |
| 869 | `.activity-bar-icon` | `transparent` (active: `var(--cc-accent)`) | 2px solid (selection rail) |
| 1901 | `.search-result` | `transparent` (focus: `var(--cc-accent)`) | 2px solid (selection rail) |
| 2040 | `.info-markdown blockquote` | `var(--cc-border-tooltip)` | 3px solid (quote rail) |

### `border-right`

| Line | Selector | Color | Style/Thickness |
|---|---|---|---|
| 756 | `#tree-sidebar` | `var(--cc-border-subtle)` | 1px solid |
| 846 | `.activity-bar` | `var(--cc-border-subtle)` | 1px solid |
| 1470 | `.theme-select-option` | `var(--cc-track)` | 1px solid (between items) |
| 2265 | `.code-editor-gutter` | `var(--cc-track)` | 1px solid |

### Divider color summary
- `var(--cc-border-subtle)` (1px solid): used 11 times for "major surface boundary" (app-header bottom, sidebars, pane-header, modal-header-equivalent, search-input-wrap, controls-actions, hr, info-markdown h1)
- `var(--cc-track)` (1px solid): used 7 times for "secondary / sub-section" divider (app-footer top, controls-section + controls-section, theme-select-option separator, code-editor-gutter, info-markdown h2 bottom, info-markdown pre border)
- `var(--cc-track)` (1px **dashed**): single use on `.theme-subgroup` border-top
- `rgba(255, 255, 255, 0.08)` (1px solid): 2 uses (modal-header bottom, recents-list top) — inside modal context
- `rgba(255, 255, 255, 0.12)`: modal input borders only
- `var(--cc-accent-mid)`: code-editor-banner bottom; inline code border
- `var(--cc-border-tooltip)`: tooltip border, blockquote rail (3px)
- 2px-left rails: `.activity-bar-icon`, `.search-result` (both use accent on active)

**Inconsistency:** `border-subtle` vs `track` are used near-interchangeably for "1px section divider". Within the modal, all dividers/inputs jump to `rgba(255, 255, 255, 0.08–0.12)` rather than tokens.

---

## 19. Pane structure

### `.pane-header` (936–944)
```
padding: 12px 12px 12px 16px;
border-bottom: 1px solid var(--cc-border-subtle);
flex-shrink: 0;
display: flex;
align-items: center;
justify-content: space-between;
gap: 8px;
```

### `.pane-title` (950–966)
```
flex: 1 1 auto;
min-width: 0;
margin: 0;
font-size: 12px;
font-weight: 600;
color: var(--cc-text-secondary);
letter-spacing: 0.02em;
white-space: nowrap;
overflow: hidden;
text-overflow: ellipsis;
display: flex;
align-items: center;
gap: 2px;
```
- `.pane-title.is-mono` (967): swaps font-family to mono stack.

### Pane "body" variants

| Selector | Lines | Style |
|---|---|---|
| `.editor-body` | 475–482 | `flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; overflow: hidden; background: var(--cc-bg-app)` |
| `.controls-body` | 979–986 | `flex: 1; overflow-y: auto; padding: 16px; box-sizing: border-box` |
| `.search-body` | 1854–1860 | `flex: 1 1 auto; min-height: 0; overflow-y: auto; display: flex; flex-direction: column` |
| `.info-body` | 1940–1953 | `flex: 1 1 auto; min-height: 0; overflow-y: auto; display: flex; flex-direction: column` |
| `.left-pane` | 921–926 | `display: flex; flex-direction: column; flex: 1; overflow: hidden` |
| `.left-panel` | 914–919 | (parent of left-pane) `flex: 1; display: flex; flex-direction: column; overflow: hidden` |
| `.preview-shell` | 2149–2160 | `display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0` |
| `.code-editor-shell` | 2212–2219 | `flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; width: 100%; height: 100%` |
| `.file-preview-pane` | 465–471 | `flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; overflow: hidden` |

**What's consistent:**
- `.search-body`, `.info-body`, `.file-preview-pane` all share: `flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column` + `overflow-y: auto` (search/info) or `overflow: hidden` (file-preview).

**What diverges:**
- `.controls-body` (16px padding) is the only "body" with intrinsic padding — others are paddingless and rely on child padding (e.g. `.info-markdown` 16px 18px 24px, `.tree-root` 8px 0).
- `.editor-body` adds `background: var(--cc-bg-app)`; others don't set a background.
- `.controls-body` uses `flex: 1` (no min-height) — different from the `flex: 1 1 auto; min-height: 0` pattern others use.

### Pane header action buttons

- `.pane-header-close` (804–810): 4px padding, 4px radius, 14px font, line-height 1, color `var(--cc-text-faint)` — aliased to `.btn-icon` shell (96–113).
- `.pane-header-action` (815–836): same shell as above but separate ruleset; full hover/disabled states.

These two are visually equivalent buttons with two parallel rule sets.

---

## 20. Other repeated patterns

### Hover overlay backgrounds (used as inline rgba, not the `--cc-hover-overlay` tokens)
- `rgba(255, 255, 255, 0.03)` (1 use): `.activity-bar-icon:hover` (879)
- `rgba(255, 255, 255, 0.04)` (6 uses): `.controls-section-summary:hover` (1051), `.shortcuts-list .shortcuts-mouse:hover`? no — `.btn-secondary` rest bg (1237), `.theme-subgroup-collapsible summary:hover` (1321), `.theme-select-option:hover` (1478), `.tree-row:hover` + `.tree-hovered > .tree-row` (1720/1728), `.search-result:hover` (1911)
- `rgba(255, 255, 255, 0.05)` (1 use): `.modal-field input` rest bg (2453)
- `rgba(255, 255, 255, 0.06)` (5 uses): shared `:hover` on btn-icon family (127), `.app-header-segment:hover` (343), `.project-btn:hover` (423), `.pane-header-action:hover` (831), `.recent-row:hover` (2517)
- `rgba(255, 255, 255, 0.08)` (1 use): `.modal-header button.modal-close:hover` (2414); also border colors in modal (2400, 2498)
- `rgba(255, 255, 255, 0.10)` (1 use): `.modal-tabs button.active` (2439); `.btn-secondary:hover` (1242)
- `rgba(255, 255, 255, 0.12)` (2 uses): modal-tabs button border (2431), modal-field input border (2454), modal-error border isn't this (it's red)
- `rgba(255, 255, 255, 0.15)` (1 use): `.loading-spinner` border (2577)
- `rgba(255, 255, 255, 0.18)` (2 uses): `.theme-color` border (1429), `.theme-hue-preview` border (1453)
- `rgba(255, 255, 255, 0.20)` (1 use): `.theme-slider::*::-slider-thumb` border (1535, 1543)
- `rgba(255, 255, 255, 0.25)` (1 use): `.btn-secondary:hover` border (1243)
- `rgba(255, 255, 255, 0.35)` (1 use): `.theme-range-pair input thumb` border (1638, 1648)

The defined tokens `--cc-hover-overlay: rgba(255, 255, 255, 0.06)` and `--cc-hover-overlay-sm: rgba(255, 255, 255, 0.04)` (lines 86–87) are declared but **never used** — every callsite uses the inline rgba instead.

### Accent overlay backgrounds (inline rgba(91, 157, 255, X))
- `0.04`: `.info-markdown blockquote` (2042)
- `0.06`: `.activity-bar-icon.active` (885), `.code-editor-banner` (2227)
- `0.08`: `.info-markdown code` (2057), `.recent-row--active` (2536)
- `0.12`: `.search-result:focus-visible` (1915), `.recent-row--active:hover` (2540)
- `0.14`: `.app-header-branch-pill` (448)
- `0.15`: `.building-selected-indicator` (692), `.recent-row-badge` (2548)
- `0.24`: `.tree-item.tree-selected > .tree-row:hover` (1740)
- `0.3`: `.controls-section-hint kbd, ... kbd` border (1014), `.theme-row-reset:active` (1414)
- `0.35`: `.theme-range-pair-fill` shadow (1590), `.building-selected-indicator` border (693), `.recent-row-badge` border (2549)
- `0.4`: `.btn-accent-outline:hover` border (1218)
- `0.45`: `.theme-row-reset:hover` border (1411), `.controls-section-reset:hover` border (1091)
- `0.5`: `.search-input:focus` border (1846), `.theme-number:focus` border (1504)
- `0.55`: `.theme-range-pair-fill` gradient end (1587)
- `0.85`: `.theme-slider thumb` bg (1534, 1542), `.theme-range-pair-fill` gradient start (1587), `.controls-section-reset` color rest (1084), `.theme-row-reset` color rest (1403)
- `0.22`: `.controls-section-reset:disabled`, `.theme-row-reset:disabled` (1097, 1418)

Existing tokens `--cc-accent-dim: 0.10`, `--cc-accent-mid: 0.18`, `--cc-accent-strong: 0.25` cover 3 of the ~14 accent-alpha values used.

### Text-color rgba(232, 232, 237, X) — "on-modal text variants"
- `0.5`: `.loading-steps li`, `.loading-steps li[data-state="pending"]` (2604, 2618)
- `0.55`: `.recents-list h3` (2505), `.recent-row .recent-sub` (2524), `.loading-steps li[data-state="done"]` (2630)
- `0.6`: `.modal-field-help` (2557)
- `0.7`: `.modal-field label` (2450)

These four near-identical "muted text on modal" colors aren't tokenized (they're aliases of `--cc-text-on-modal` at varying alpha).

### Empty/state helpers (centered icon + headline + subtitle)
Three parallel implementations:

| Selector | Lines | Gap | Padding | Title (font-size/weight/color) | Sub (font-size/color) | Icon (font-size/opacity/mb) |
|---|---|---|---|---|---|---|
| `.search-state` | 1862–1890 | 8px | 24px 18px | 12px/500/`--cc-text-secondary` | 11px/`--cc-text-faint` | 22px/0.55/2px |
| `.preview-state` | 2164–2197 | 10px | 32px 20px | 13px/500/`--cc-text-secondary` | 11px/`--cc-text-faint` | 28px/0.55/4px |

(The `.editor-empty-hint` referenced in the comment at 2162 doesn't appear to have its own selector in this file.)

Same structure, slightly different paddings / icon sizes / title sizes — clearly the same component.

### "Reset" buttons (per-row and per-section)
Two near-identical rules:

| Property | `.controls-section-reset` (1073–1099) | `.theme-row-reset` (1394–1419) |
|---|---|---|
| `appearance` | none | (none declared) |
| `display` | inline-flex (1077) | inline-flex (1396) |
| `align-items` | center | center |
| `justify-content` | center | (none) |
| `background` | none | none |
| `border` | 1px solid transparent | 1px solid transparent |
| `padding` | 3px 5px | 3px 5px |
| `margin` | margin-left: auto | 0 |
| `color` | rgba(91, 157, 255, 0.85) | rgba(91, 157, 255, 0.85) |
| `border-radius` | 4px | 4px |
| `font-size` | 14px | 14px |
| `line-height` | (none) | 1 |
| `flex` | 0 0 auto | 0 0 auto |
| `cursor` | pointer | pointer |
| `:hover` color | `#fff` (literal — not a token) | `var(--cc-white)` (token) |
| `:hover` bg | `var(--cc-accent-mid)` | `var(--cc-accent-mid)` |
| `:hover` border | `rgba(91, 157, 255, 0.45)` | `rgba(91, 157, 255, 0.45)` |
| `:active` bg | `var(--cc-accent-strong)` | `rgba(91, 157, 255, 0.3)` |
| `:disabled` color | `rgba(91, 157, 255, 0.22)` | `rgba(91, 157, 255, 0.22)` |

**Inconsistency:** `:hover` color uses raw `#fff` in one rule vs `var(--cc-white)` token in the other. `:active` uses the `--cc-accent-strong` token in one vs raw `rgba(91, 157, 255, 0.3)` in the other (values: 0.25 vs 0.3 — not identical).

### Resize-handle pattern
Two parallel rules:
- `.sidebar-resize-handle-right` (275–288): position absolute; left -3px; width 6px; height 100%; cursor ew-resize; bg transparent; hover/dragging → `var(--cc-accent-strong)`
- `.sidebar-resize-handle` (771–784): position absolute; right -3px; width 6px; height 100%; cursor ew-resize; bg transparent; hover/dragging → `var(--cc-accent-strong)`

Identical apart from `left: -3px` vs `right: -3px`.

### Chevron rotation pattern
Two parallel rules:
- `.controls-section-chevron` (1056–1064) + `[open]` rotate (1065–1067)
- `.theme-subgroup-chevron` (1326–1332) + `[open]` rotate (1333–1335)

Same `width/height: 14px; flex-shrink: 0; transition: transform 0.1s ease`. Different color tokens (secondary vs muted). Both rotate to `90deg` when `[open]`.

### Scrollbar styling pattern
Two parallel rules:
- `#sidebar ::-webkit-scrollbar*` (658–680)
- `#tree-sidebar ::-webkit-scrollbar*` (1664–1680)

Identical: 4px width, transparent track, `--cc-border-input` thumb, 4px thumb radius, `--cc-track-hover` thumb:hover. Plus matching Firefox `scrollbar-width: thin; scrollbar-color: ...` blocks.

### `:focus` border-color treatments
Three identical: `border-color: rgba(91, 157, 255, 0.5)` (search-input 1846, theme-number 1504); single `outline: 2px solid var(--cc-accent)` (modal-field input 2461). All "input focus" should likely converge.

### Drag region attribute (`-webkit-app-region: no-drag`)
Used in 6 selectors for native-frame drag regions: `.app-header-icon` (232), `.path-badge` (315), `.app-header-segment` (339), `.app-header-ellipsis, .file-path-ellipsis` (not declared there — actually only on .path-badge etc.), `.project-btn` (419), `.app-header-branch-pill` (not declared), `.switch-source-btn, .app-header-refresh-btn, .app-header-repo-link` (2654). The repeated app-region toggling on every header child is a component-level concern.

### Truncation idiom (ellipsis)
The trio `white-space: nowrap; overflow: hidden; text-overflow: ellipsis;` appears on: `.app-header-crumbs` (324), `.app-footer-item` (542), `.app-footer-status-detail` (596), `.pane-title` (958), `.tree-label` (1797), `.search-result` (1905), `.search-state-sub` is not (just nowrap). Used 6+ times.

### Inline-flex icon-row shells (`display: inline-flex; align-items: center;`)
Appears on every header chip, every row chevron-icon-label, every reset button — 15+ uses. Most also set `flex: 0 0 auto`.

### Multi-line transition declarations
Three rules use the multi-property comma-separated `transition:` form on multiple lines (870–873, 1156–1158, 1209–1212). All three differ slightly: one tracks `border-color`, others don't.

### `.btn-icon` alias / shell pattern (96–143)
Eight selectors share the same `appearance/flex/display/align/justify/background/border/cursor` reset shell:
- `.btn-icon`, `.app-header-icon`, `.switch-source-btn`, `.app-header-refresh-btn`, `.app-header-repo-link`, `.app-footer-button`, `.pane-header-close`, `.modal-header button.modal-close`, `.recent-row .recent-remove`

And seven share the hover (`color: var(--cc-text-primary); background: rgba(255, 255, 255, 0.06)`). `.modal-header button.modal-close` is explicitly excluded from the shared hover (uses 0.08 overlay + inherited color instead). Each aliased class then sets size / radius / font-size / padding individually:

| Selector | Width | Height | Radius | Font-size | Padding |
|---|---|---|---|---|---|
| `.btn-icon` | 24px | 24px | 4px | 14px | — |
| `.app-header-icon` | 26px | 24px | 3px | 14px (via .lucide-icon) | — |
| `.switch-source-btn, .app-header-refresh-btn, .app-header-repo-link` | 24px | 24px | 3px | 14px (via .lucide-icon) | — / `.app-header-repo-link`: `2px 4px` |
| `.app-footer-button` | 22px | 22px | 3px | 13px (via .lucide-icon) | — |
| `.pane-header-close` | auto | auto | 4px | 14px | 4px |
| `.modal-header button.modal-close` | auto | auto | 6px | 18px | 4px 8px |
| `.recent-row .recent-remove` | auto | auto | (inherited) | (inherited) | 4px 8px |

Five distinct radii (3, 4, 6) and five distinct sizes (22, 24, 26, content+4px, content+4/8) for what's nominally the same icon-button shell.

### `.btn-toggle` alias / shell pattern (1147–1190)
Three selectors share a button shell:
- `.btn-toggle`, `.segmented-option`, `.theme-select-option`

Per-class overrides for padding/font-size/separator-border. Active-state class name differs: `.btn-toggle.is-active` vs `.segmented-option.active` vs `.theme-select-option.is-active`.

### `.btn-accent-outline` alias (1195–1244)
`.btn-accent-outline` and `.controls-button` share the same ruleset. `.btn-secondary` and `.controls-button-secondary` share another. The "secondary" variant is meant to compose with `.btn-accent-outline` for the muted look.
