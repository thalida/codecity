// scene/components/trees/trees.ts — Trees subsystem orchestrator. Thin
// pass-through from a precomputed TreePlacement[] + the manifest's
// commit list to a Trees lifecycle handle.
//
// Lifecycle:
//
//   const placements = await placementClient.compute(layout, bbox, commitCount, cityHeight);
//   const trees = createTrees(placements, manifest.commits);
//   scene.add(trees.group);
//   trees.refresh();   // on applyTheme() — called on Save
//   trees.dispose();   // on rebuild / scene teardown

import { createTreeRenderer, type Trees } from './treeRenderer';
import type { TreePlacement } from './treePlacement';
import type { CommitEntry, BusynessThresholds } from '@/types';

export function createTrees(
  placements: TreePlacement[],
  commits: CommitEntry[] | null,
  busyness: BusynessThresholds
): Trees {
  return createTreeRenderer(placements, commits, busyness);
}

export type { Trees };
