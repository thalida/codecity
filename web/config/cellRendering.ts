// config/cellRendering.ts — Feature flag for the spatial-grid +
// LOD rendering rewrite. When OFF, the legacy SceneBlock path
// runs. When ON, CellTile + LOD evaluator + instanced ad panels +
// progressive build replace it. Flag exists for the duration of
// the migration; removed in the final cleanup task.

import { map } from 'nanostores';

export interface CellRenderingConfig {
  enabled: boolean;
}

export const CELL_RENDERING = map<CellRenderingConfig>({
  enabled: false,
});
