// scene/committerSoil/committerSoil.ts — orchestrator. Mirrors
// scene/components/fireflies/fireflies.ts.
//
// Hidden when TREES_ENABLED is false because the soil ring is
// visually anchored to a tree; without the tree it floats orphaned.

import { placeSoil } from './soilPlacement.js';
import { createSoilRenderer, type SoilRenderer } from './soilRenderer.js';
import type { TreePlacement } from '@/scene/components/trees/treePlacement.js';
import type { CommitEntry } from '@/types';
import { COMMITTER_SOIL } from '@/config/components/committerSoil.js';
import { TREES } from '@/config/components/trees.js';

export type CommitterSoil = SoilRenderer;

export function createCommitterSoil(
  placements: TreePlacement[],
  commits: CommitEntry[] | null,
): CommitterSoil {
  if (
    !COMMITTER_SOIL.get().COMMITTER_SOIL_ENABLED ||
    !TREES.get().TREES_ENABLED
  ) {
    return createSoilRenderer([]);
  }
  return createSoilRenderer(placeSoil(placements, commits));
}
