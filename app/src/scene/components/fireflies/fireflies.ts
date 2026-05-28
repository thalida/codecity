// scene/fireflies/fireflies.ts — Fireflies subsystem orchestrator.
// Thin pass-through from TreePlacement[] + commits to a renderer
// lifecycle handle. Mirrors trees/trees.ts.

import { placeFireflies, type FireflyPlacement } from './firefliesPlacement.js';
import { createFireflyRenderer, type FireflyRenderer } from './firefliesRenderer.js';
import type { TreePlacement } from '@/scene/components/trees/treePlacement.js';
import type { CommitEntry } from '@/types';
import { FIREFLIES } from '@/config/components/fireflies.js';

export type Fireflies = FireflyRenderer;

export function createFireflies(
  placements: TreePlacement[],
  commits: CommitEntry[] | null,
): Fireflies {
  // Master config gate. When disabled, return an empty renderer so the
  // caller's group is still safe to add/dispose.
  if (!FIREFLIES.get().FIREFLIES_ENABLED) {
    return createFireflyRenderer([]);
  }
  const orbs: FireflyPlacement[] = placeFireflies(placements, commits);
  return createFireflyRenderer(orbs);
}
