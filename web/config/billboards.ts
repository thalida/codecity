// config/billboards.ts — Procedural billboard geometry + colors. Billboards
// are the panel-on-post meshes used to render image/video files as 3D
// signs in place of the usual building cuboid. Changes require a full
// rebuild because the mesh geometry is baked at manifest-apply time
// (createBillboard snapshots the store once per mesh). Hot-reload routes
// via `rebuildStores` in web/config/hotReload.ts.
//
// Colors are stored as CSS hex strings (consistent with other color stores
// like SCENE_COLORS / SIDEWALK_COLORS) so they parse cleanly via
// `new THREE.Color('#hex')`. The default hex values match the previous
// 0xRRGGBB int literals exactly — POST_COLOR shares its hex with the
// city's sidewalk gray (SIDEWALK_COLORS.DEFAULT) by design.

import { map } from 'nanostores';

export interface BillboardGeometryConfig {
  PANEL_ASPECT: number;             // 0.3-1.5 — panel height as fraction of panel width
  PANEL_DEPTH_FRAC: number;         // 0-0.3 — body depth as fraction of panel width
  PANEL_INSET_FRAC: number;         // 0-0.2 — image inset (frame thickness) as fraction of panel height
  IMAGE_OFFSET: number;             // 0-0.2 — image plane offset in front of body
  POST_HEIGHT_FRAC: number;         // 0-3 — post height as fraction of panel height
  POST_WIDTH_FRAC: number;          // 0-0.3 — post width as fraction of panel width
  POST_INSET_FRAC: number;          // 0-0.5 — post x-offset from center as fraction of panel width
  POST_COLOR: string;               // CSS hex — billboard support post
  BODY_COLOR: string;               // CSS hex — panel frame / back
  PANEL_PLACEHOLDER_COLOR: string;  // CSS hex — fallback panel color while image loads or for non-image media
}

// Defaults preserve the prior hard-coded values exactly. Color hexes
// translated from the existing 0xRRGGBB literals:
//   0x2c2e36 = #2c2e36 (sidewalk gray — matches the city palette)
//   0x14161e = #14161e (dark frame / back)
//   0x1a1d28 = #1a1d28 (placeholder)
export const BILLBOARD_GEOMETRY = map<BillboardGeometryConfig>({
  PANEL_ASPECT: 0.7,
  PANEL_DEPTH_FRAC: 0.08,
  PANEL_INSET_FRAC: 0.04,
  IMAGE_OFFSET: 0.02,
  POST_HEIGHT_FRAC: 1.00,
  POST_WIDTH_FRAC: 0.05,
  POST_INSET_FRAC: 0.32,
  POST_COLOR: '#2c2e36',
  BODY_COLOR: '#14161e',
  PANEL_PLACEHOLDER_COLOR: '#1a1d28',
});
