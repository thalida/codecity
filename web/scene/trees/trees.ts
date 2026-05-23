// scene/trees/trees.ts — Trees subsystem orchestrator. Thin
// pass-through from a precomputed TreePlacement[] + the manifest's
// commit list to a Trees lifecycle handle.
//
// Lifecycle:
//
//   const placements = await placementClient.compute(layout, bbox, commitCount, cityHeight);
//   const trees = createTrees(placements, manifest.commits);
//   scene.add(trees.group);
//   trees.refresh();   // on applyTheme() hot-reload
//   trees.dispose();   // on rebuild / scene teardown

import { createTreeRenderer, type Trees } from './treeRenderer.js';
import type { TreePlacement } from './treePlacement.js';
import type { CommitEntry } from '@/types';

export function createTrees(
  placements: TreePlacement[],
  commits: CommitEntry[] | null,
): Trees {
  return createTreeRenderer(placements, commits);
}

export type { Trees };
