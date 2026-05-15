// config/facade.ts — Procedural facade geometry knobs. Exposes the shader
// constants that govern how each building's wall is divided into floors,
// windows, doors, and roof border. Plus the per-building window column
// count + door sizing pulled from buildings.ts.
//
// Shader-side keys (SLAB/WINDOW/DOOR/ROOF_*_FRAC) route through
// refreshBuildingMaterial() on hot-reload — cheap, no rebuild needed.
//
// JS-side keys (WINDOW_COLS_MAX, WIDTH_PER_WINDOW_COL, DOOR_WIDTH_FRAC_OF_PATH)
// feed into per-instance attributes that are baked at manifest-apply time,
// so they need scheduleRebuild() rather than uniform refresh. The hotReload
// wiring handles this — see web/config/hotReload.ts.
//
// Consumers do NOT clamp values from this store — the UI is the gate for
// ranges. Degenerate inputs (e.g. WINDOW_COLS_MAX=0, SLAB_HEIGHT_FRAC=1.0)
// render visually weird but do not crash.

import { map } from 'nanostores';

export interface FacadeGeometryConfig {
  // SHADER-DRIVEN (refresh uniforms, no rebuild required)
  SLAB_HEIGHT_FRAC: number;           // 0-0.4 typical — floor slab strip height as fraction of one floor
  WINDOW_WIDTH_FRAC: number;          // 0-1 — window width as fraction of one cell
  WINDOW_HEIGHT_FRAC: number;         // 0-1 — window height as fraction of one floor
  WINDOW_MARGIN_FRAC: number;         // 0-0.25 — horizontal margin per edge as fraction of face width
  DOOR_HEIGHT_FRAC: number;           // 0-1 — door height as fraction of one floor
  ROOF_BORDER_FRAC: number;           // 0-0.1 — roof border strip width as fraction of face

  // JS-DRIVEN (per-instance attributes baked at build time → rebuild)
  WINDOW_COLS_MAX: number;            // 1-10 integer — max window columns per face
  WIDTH_PER_WINDOW_COL: number;       // 1-32 — world-unit width allotted per window column (cols = floor(width / this))
  DOOR_WIDTH_FRAC_OF_PATH: number;    // 0-1 — door width as fraction of path width
}

export const FACADE_GEOMETRY = map<FacadeGeometryConfig>({
  SLAB_HEIGHT_FRAC: 0.12,
  WINDOW_WIDTH_FRAC: 0.45,
  WINDOW_HEIGHT_FRAC: 0.45,
  WINDOW_MARGIN_FRAC: 0.08,
  DOOR_HEIGHT_FRAC: 0.7,
  ROOF_BORDER_FRAC: 0.03125,
  WINDOW_COLS_MAX: 5,
  WIDTH_PER_WINDOW_COL: 8,
  DOOR_WIDTH_FRAC_OF_PATH: 0.8,
});

// HSL lightness deltas applied via shadeColor() / shadeAndShiftHue() in the
// fragment shader. Values are percentage-points relative to a hue's natural
// lightness in HSL space; negative darkens, positive brightens.
//
// Consumers do NOT clamp; degenerate values (e.g. -200) just clip to
// HSL [0,100] in the shader's shadeColor helper. The UI gates ranges.
export interface FacadeDetailConfig {
  SLAB_LIGHTNESS_DELTA: number;        // -100..100 (default -12)
  DOOR_LIGHTNESS_DELTA: number;        // -100..100 (default -55)
  ROOF_BORDER_LIGHTNESS_DELTA: number; // -100..100 (default -15)
}

export const FACADE_DETAIL = map<FacadeDetailConfig>({
  SLAB_LIGHTNESS_DELTA: -12,
  DOOR_LIGHTNESS_DELTA: -55,
  ROOF_BORDER_LIGHTNESS_DELTA: -15,
});

// Window-pane lighting: how panes glow when lit, fade when unlit, and gap
// out as buildings age. Driven from the shader (renderWallFace's lit/unlit
// per-cell branch). DIM_GLOW_COLOR is the warm-amber tint that old/dim
// buildings drift toward — newest buildings keep their saturated hue.
export interface WindowLightingConfig {
  UNLIT_LIGHTNESS_DELTA: number;  // -20..20 (default 4) — HSL lightness for unlit panes
  GAP_BASE_THRESHOLD: number;     // 0..1 (default 0.18) — base fraction of empty cells
  GAP_AGE_BONUS: number;          // 0..1 (default 0.32) — extra empty fraction for oldest
  DIM_GLOW_COLOR: string;         // CSS color (default '#806626') — old-building lit pane tint
}

export const WINDOW_LIGHTING = map<WindowLightingConfig>({
  UNLIT_LIGHTNESS_DELTA: 4,
  GAP_BASE_THRESHOLD: 0.18,
  GAP_AGE_BONUS: 0.32,
  DIM_GLOW_COLOR: '#806626', // approx rgb(128, 102, 38) approx (0.5, 0.4, 0.15) * 255
});
