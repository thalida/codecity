// config/interaction.js — Hover, click, tooltip, pivot ping, neon path line,
// and sidebar badge feel. Most values here are read per-event or per-frame,
// so the Settings UI mutates them in place and changes apply immediately.

import { map } from 'nanostores';

// ─── Click vs drag detection ───────────────────────────────────────────────
export const CLICK = map({
  MOVE_THRESHOLD_PX: 5,        // pointer must move less than this to count as a click
  TIME_THRESHOLD_MS: 400       // …and release within this window
});

// ─── Hover stickiness ──────────────────────────────────────────────────────
// Throttles the heavy fade cascade when sweeping the cursor across the scene.
export const HOVER = map({
  COMMIT_MS: 35                // ms cursor must stay on a target before committing
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
export const PATH_LINE = map({
  LINEWIDTH:          5,
  ELEVATION:          0.3,     // Y position above ground
  OPACITY:            0.95,
  RAINBOW_SATURATION: 1.0,
  RAINBOW_LIGHTNESS:  0.65,
  RAINBOW_SPEED:      0.0006   // hue chase speed
});

// ─── Misc thresholds ──────────────────────────────────────────────────────
export const LABEL_FLIP_HYSTERESIS = map({
  THRESHOLD: 0.15              // axis-crossing sensitivity for label flip
});
