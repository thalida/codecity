// config/cellRendering.ts — Feature flag for the spatial-grid +
// LOD rendering rewrite. When ON (default), CellTile + LOD evaluator
// + instanced ad panels replace the legacy SceneBlock path. When OFF,
// the legacy per-directory rendering runs. Flag exists for the
// duration of the migration; removed in the final cleanup task once
// legacy is fully retired.

import { map } from 'nanostores';

export interface CellRenderingConfig {
  enabled: boolean;
}

export const CELL_RENDERING = map<CellRenderingConfig>({
  enabled: true,
});
