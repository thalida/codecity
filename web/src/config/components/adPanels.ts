// config/adPanel.ts — Procedural ad-panel geometry + colors. Ad panels
// are the textured planes mounted on the front face of media-file
// buildings (image / video). Changes require a full rebuild because
// the mesh geometry is baked at manifest-apply time (createAdPanel
// snapshots the store once per mesh). Hot-reload routes via
// `rebuildStores` in web/config/hotReload.ts.

import { map } from 'nanostores';

export interface AdPanelConfig {
  AD_SIDE_MARGIN_FRAC: number;     // 0-0.4 — horizontal margin on each side of the building's width
  AD_BOTTOM_OFFSET_FLOORS: number; // 0-3   — ad bottom = N × FLOOR_HEIGHT above ground (clears the 0.75-floor door)
  AD_OFFSET: number;               // 0-4 — world-unit z-offset from the front face. The panel material runs with depthWrite: false, so this is the ONLY thing keeping the panel quad from co-planar z-fighting with the building face; polygonOffset has no effect without depthWrite. 0.5 wasn't enough at oblique camera angles for typical 8-96 unit-wide buildings.
  AD_PLACEHOLDER_COLOR: string;    // CSS hex — shown while the image is queued / fetching / decoding (transient)
  AD_ERROR_COLOR: string;          // CSS hex — shown after a permanent load/decode/upload failure (sticky)
}

export const AD_PANEL = map<AdPanelConfig>({
  AD_SIDE_MARGIN_FRAC: 0.10,
  AD_BOTTOM_OFFSET_FLOORS: 1.0,
  AD_OFFSET: 1.5,
  AD_PLACEHOLDER_COLOR: '#1a1d28',
  AD_ERROR_COLOR: '#3a1d1d',
});
