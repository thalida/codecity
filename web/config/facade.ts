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
