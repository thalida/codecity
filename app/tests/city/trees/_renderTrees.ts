// Test helper: build a Trees renderer from commits, deriving the
// manifest.stats fields it reads for the age/size ranges (commitDates,
// sparsest/grandest commit) — exactly as the trees component derives them
// from manifest.stats. Renderer tests build terse commit fixtures and go
// through this so they don't restate the stats derivation at each call site.

import { createTreeRenderer, type Trees } from '@/city/components/trees/treeRenderer';
import type { TreePlacement } from '@/city/components/trees/treePlacement';
import type { CommitEntry, BusynessThresholds } from '@/types';
import { commitStats } from '../../_helpers/statsFixtures';

export function renderTrees(
  placements: TreePlacement[],
  commits: CommitEntry[] | null,
  busyness: BusynessThresholds
): Trees {
  return createTreeRenderer(placements, commits, busyness, commits ? commitStats(commits) : null);
}
