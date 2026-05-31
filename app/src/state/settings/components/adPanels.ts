// state/settings/adPanel.ts — Procedural ad-panel geometry + colors. Ad panels
// are the textured planes mounted on the front face of media-file
// buildings (image / video). Changes require a full rebuild because
// the mesh geometry is baked at manifest-apply time (createAdPanel
// snapshots the store once per mesh). Hot-reload routes via
// `rebuildStores` in app/config/hotReload.ts.

import { persistedSignal } from '@/state/persist';

export interface AdPanelConfig {
  AD_SIDE_MARGIN_FRAC: number; // 0-0.4 — horizontal margin on each side of the building's width
  AD_BOTTOM_OFFSET_FLOORS: number; // 0-3   — ad bottom = N × FLOOR_HEIGHT above ground (clears the 0.75-floor door)
  AD_PLACEHOLDER_COLOR: string; // CSS hex — shown while the image is queued / fetching / decoding (transient)
  AD_ERROR_COLOR: string; // CSS hex — shown after a permanent load/decode/upload failure (sticky)
}

export const AD_PANEL = persistedSignal<AdPanelConfig>('AD_PANEL', {
  AD_SIDE_MARGIN_FRAC: 0.1,
  AD_BOTTOM_OFFSET_FLOORS: 1.0,
  AD_PLACEHOLDER_COLOR: '#29293d',
  AD_ERROR_COLOR: '#3a1d1d',
});
