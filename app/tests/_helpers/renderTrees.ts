// Test helper: a Trees renderer from commit fixtures, deriving the
// manifest.stats fields it reads exactly as the trees component does, so no
// test restates that derivation. Plus the chunk/face lookups tests need to
// drive the real commitForFace without a GPU.

import * as THREE from 'three';
import { createTreeRenderer, type Trees } from '@/city/components/trees/treeRenderer';
import type { TreePlacement } from '@/city/components/trees/treePlacement';
import type { CommitEntry, BusynessThresholds } from '@/types';
import { VERTS_PER_TRIANGLE } from '@/city/utils/bufferLayout';
import { commitStats } from './statsFixtures';

export function renderTrees(
  placements: TreePlacement[],
  commits: CommitEntry[] | null,
  busyness: BusynessThresholds,
  // The scan date every manifest carries, and every tree is aged against.
  // Defaults to the newest commit, which is what a fresh scan reads as.
  scannedAt: string | null = commits?.[commits.length - 1]?.date ?? null
): Trees {
  return createTreeRenderer(
    placements,
    commits,
    busyness,
    commits ? commitStats(commits) : null,
    scannedAt
  );
}

/** The chunk mesh rendering `placementIndex`, and its slot within it. */
export function treeSlot(trees: Trees, placementIndex: number): { mesh: THREE.Mesh; slot: number } {
  for (const child of trees.group.children) {
    if (child.userData?.meshKind !== 'trees') continue;
    const slot = (child.userData.placementOrder as number[]).indexOf(placementIndex);
    if (slot !== -1) return { mesh: child as THREE.Mesh, slot };
  }
  throw new Error(`no chunk renders placement ${placementIndex}`);
}

/** A raycast-shaped faceIndex landing on `placementIndex`, so tests can drive
 *  the real commitForFace without a GPU. */
export function treeFaceIndex(trees: Trees, placementIndex: number): number {
  const { mesh, slot } = treeSlot(trees, placementIndex);
  const perTree = (mesh.userData.canopyVerts as number) + (mesh.userData.trunkVerts as number);
  return (slot * perTree) / VERTS_PER_TRIANGLE;
}
