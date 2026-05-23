// scene/trees/trees.ts — Trees subsystem orchestrator. Thin
// pass-through from a precomputed TreePlacement[] (produced by the
// treePlacementClient) to a Trees lifecycle handle.
//
// Lifecycle:
//
//   const placements = await placementClient.compute(layout, bbox, commitCount, cityHeight);
//   const trees = createTrees(placements);
//   scene.add(trees.group);
//   trees.refresh();   // on applyTheme() hot-reload
//   trees.dispose();   // on rebuild / scene teardown

import { createTreeRenderer, type Trees } from './treeRenderer.js';
import type { TreePlacement } from './treePlacement.js';

export function createTrees(placements: TreePlacement[]): Trees {
  return createTreeRenderer(placements);
}

export type { Trees };
