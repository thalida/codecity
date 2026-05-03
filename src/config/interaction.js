// config/interaction.js — Hover, click, tooltip, pivot ping, neon path line,
// and sidebar badge feel. Most values here are read per-event or per-frame,
// so the Settings UI mutates them in place and changes apply immediately.

import { map } from 'nanostores';

// ─── Pointer input timing ─────────────────────────────────────────────────
// Click vs drag detection + hover stickiness, grouped because they all
// describe how the pointer feel works.
export const INPUT_TIMING = map({
  CLICK_MOVE_THRESHOLD_PX: 5,    // pointer must move < this px to count as a click
  CLICK_TIME_THRESHOLD_MS: 400,  // …and release within this window
  HOVER_COMMIT_MS:         35    // ms cursor must stay on a target before
                                 // the heavy fade cascade commits
});

// ─── Tooltip placement ────────────────────────────────────────────────────
export const TOOLTIP = map({
  OFFSET_PX:          14,      // distance from cursor
  VIEWPORT_MARGIN_PX: 4        // safety margin from viewport edges
});

// ─── Pivot ping (the ring that flashes at the new orbit pivot) ────────────
export const PIVOT_PING = map({
  COLOR:         '#8ea4ff',
  INNER_RADIUS:  0.6,
  OUTER_RADIUS:  1.0,
  SEGMENTS:      48,
  HEIGHT:        0.6,          // Y position above ground
  DURATION_MS:   700,
  START_SCALE:   0.7,
  END_SCALE:     4.0,
  START_OPACITY: 0.85
});

// ─── Neon path line (gem → selection) ──────────────────────────────────────
// Rainbow color cycle is shared with the selected building outline — see
// RAINBOW in config/animation.js.
export const PATH_LINE = map({
  LINEWIDTH: 5,
  ELEVATION: 0.3,    // Y position above ground
  OPACITY:   0.95
});

