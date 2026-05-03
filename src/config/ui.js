// config/ui.js — Sidebar / tree / controls UI text + glyphs + remote assets.
// These are user-facing strings and small UI primitives that aren't
// strictly visual (colors/sizes) but ARE designer-tunable text.

import { map, atom } from 'nanostores';

// ─── Activity bar tabs (left sidebar) ──────────────────────────────────────
// Each entry: { id, icon, title }. ICON is a filename relative to
// LUCIDE_ICON_BASE_URL.
export const ACTIVITY_BAR_TABS = atom([
  { id: 'tree',     icon: 'folder-tree.svg',        title: 'Tree'     },
  { id: 'controls', icon: 'sliders-horizontal.svg', title: 'Controls' }
]);

export const LUCIDE_ICON_BASE_URL = atom(
  'https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/'
);

// ─── Glyphs used in tree + sidebar UIs ─────────────────────────────────────
export const GLYPHS = map({
  TREE_COLLAPSED:    '▶',   // ▶
  TREE_EXPANDED:     '▼',   // ▼
  TREE_FILE:         '○',   // ○
  CLOSE_BUTTON:      '×',   // ×
  MISSING_VALUE:     '—'    // — (em dash for "no value")
});

// ─── UI text strings + microcopy ──────────────────────────────────────────
export const UI_TEXT = map({
  DEFAULT_PROJECT_NAME:  'Project',
  CONTROLS_TITLE:        'Controls'
});

// ─── UI timing ─────────────────────────────────────────────────────────────
export const UI_TIMING = map({
  COPY_FEEDBACK_DURATION_MS: 1500
});
