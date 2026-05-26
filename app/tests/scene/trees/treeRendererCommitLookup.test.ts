// treeRendererCommitLookup.test.ts — verifies the picker-facing lookups
// on the Trees handle: commitForInstance resolves a canopy or trunk
// instance back to its CommitEntry, and findTreeBySha resolves a SHA
// forward to a canopy instance + commit.

import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { createTreeRenderer } from '@/scene/components/trees/treeRenderer.js';
import type { TreePlacement } from '@/scene/components/trees/treePlacement.js';
import { TREES } from '@/config/components/trees.js';
import { BUILDING_DIMENSIONS } from '@/config/components/buildings.js';
import type { CommitEntry } from '@/types';

function resetStores() {
  TREES.set({
    TREES_ENABLED: true,
    EDGE_INSET_PERCENT: 8,
    TREE_DENSITY_FALLOFF: 0,
    TREE_MIN_HEIGHT: 48,
    TREE_MAX_HEIGHT: 144,
    TREE_MIN_WIDTH: 32,
    TREE_MAX_WIDTH: 128,
    TRUNK_HEIGHT_FRAC: 0.25,
    TRUNK_RADIUS_FRAC_OF_CANOPY: 0.15,
    CANOPY_TRUNK_OVERLAP_FRAC: 0.7,
    SCATTER_FOOTPRINT_FRAC_OF_MAX_WIDTH: 0.5,
    TREE_COLOR_BUSY_DAY: '#0a2613',
    TREE_COLOR_SOLO_DAY: '#a8d68a',
    TREE_SHADING_STRENGTH: 0.65,
    TREE_TRUNK_COLOR: '#120c08',
    TREE_AGE_DESAT_ENABLED: false,
    TREE_AGE_SATURATION_MIN: 20,
    TREE_AGE_SATURATION_MAX: 100,
  });
  BUILDING_DIMENSIONS.set({
    MIN_FLOORS: 2,
    MAX_FLOORS: 96,
    FLOOR_HEIGHT: 16,
    MIN_WIDTH: 8,
    MAX_WIDTH: 8,
    PATH_LENGTH: 8,
    PATH_WIDTH_FRAC: 0.5,
  });
}

function placement(seed: number, commitIndex: number): TreePlacement {
  return { x: seed * 10, y: seed * 10, seed, commitIndex };
}

function commit(i: number): CommitEntry {
  const day = String(i + 1).padStart(2, '0');
  return {
    date: `2026-03-${day}`,
    files: (i % 5) + 1,
    sha: `${i.toString(16).padStart(8, '0')}${'0'.repeat(32)}`,
  };
}

describe('Trees commit lookups', () => {
  beforeEach(resetStores);

  it('commitForInstance returns the placement commit for a canopy instance', () => {
    const commits = [commit(0), commit(1), commit(2)];
    const placements = [placement(0, 0), placement(1, 1), placement(2, 2)];
    const trees = createTreeRenderer(placements, commits);

    // Find any canopy mesh on the trees group.
    const canopy = trees.group.children.find((c) => c.name.startsWith('tree-canopy-')) as
      | THREE.InstancedMesh
      | undefined;
    expect(canopy).toBeDefined();

    // For each instance on that mesh, the lookup should return the
    // commit of the placement that owns the instance.
    const order = canopy!.userData.placementOrder as number[];
    for (let k = 0; k < order.length; k++) {
      const got = trees.commitForInstance(canopy!, k);
      expect(got).toEqual(commits[placements[order[k]].commitIndex]);
    }
  });

  it('commitForInstance returns the placement commit for a trunk instance', () => {
    const commits = [commit(0), commit(1)];
    const placements = [placement(0, 0), placement(1, 1)];
    const trees = createTreeRenderer(placements, commits);

    const trunk = trees.group.children.find((c) => c.name === 'tree-trunk') as
      | THREE.InstancedMesh
      | undefined;
    expect(trunk).toBeDefined();

    // Trunk instances are in placement order (one instance per placement).
    expect(trees.commitForInstance(trunk!, 0)).toEqual(commits[0]);
    expect(trees.commitForInstance(trunk!, 1)).toEqual(commits[1]);
  });

  it('commitForInstance returns null for out-of-range instanceId', () => {
    const commits = [commit(0)];
    const placements = [placement(0, 0)];
    const trees = createTreeRenderer(placements, commits);

    const trunk = trees.group.children.find((c) => c.name === 'tree-trunk') as THREE.InstancedMesh;
    expect(trees.commitForInstance(trunk, 42)).toBeNull();
    expect(trees.commitForInstance(trunk, -1)).toBeNull();
  });

  it('commitForInstance returns null for a mesh that is not a tree mesh', () => {
    const commits = [commit(0)];
    const placements = [placement(0, 0)];
    const trees = createTreeRenderer(placements, commits);

    const stranger = new THREE.InstancedMesh(
      new THREE.BoxGeometry(),
      new THREE.MeshBasicMaterial(),
      1
    );
    expect(trees.commitForInstance(stranger, 0)).toBeNull();
  });

  it('findTreeBySha returns the first canopy instance for the matching commit', () => {
    const commits = [commit(0), commit(1), commit(2)];
    const placements = [placement(0, 0), placement(1, 1), placement(2, 2)];
    const trees = createTreeRenderer(placements, commits);

    const got = trees.findTreeBySha(commits[1].sha);
    expect(got).not.toBeNull();
    expect(got!.commit).toEqual(commits[1]);
    expect(got!.mesh.name).toMatch(/^tree-canopy-/);
    // The resolved (mesh, instanceId) must round-trip through commitForInstance.
    expect(trees.commitForInstance(got!.mesh, got!.instanceId)).toEqual(commits[1]);
  });

  it('findTreeBySha returns null when no commit has the given sha', () => {
    const commits = [commit(0)];
    const placements = [placement(0, 0)];
    const trees = createTreeRenderer(placements, commits);
    expect(trees.findTreeBySha('f'.repeat(40))).toBeNull();
  });

  it('stamps meshKind userData on canopy and trunk', () => {
    const commits = [commit(0), commit(1)];
    const placements = [placement(0, 0), placement(1, 1)];
    const trees = createTreeRenderer(placements, commits);

    const canopies = trees.group.children.filter((c) => c.name.startsWith('tree-canopy-'));
    for (const c of canopies) {
      expect(c.userData.meshKind).toBe('tree-canopy');
    }
    const trunk = trees.group.children.find((c) => c.name === 'tree-trunk');
    expect(trunk).toBeDefined();
    expect(trunk!.userData.meshKind).toBe('tree-trunk');
  });

  it('commitForInstance returns null when commits is null', () => {
    const placements = [placement(0, 0)];
    const trees = createTreeRenderer(placements, null);
    const trunk = trees.group.children.find((c) => c.name === 'tree-trunk') as THREE.InstancedMesh;
    expect(trees.commitForInstance(trunk, 0)).toBeNull();
  });

  it('findTreeBySha returns null when commits is null', () => {
    const trees = createTreeRenderer([placement(0, 0)], null);
    expect(trees.findTreeBySha('a'.repeat(40))).toBeNull();
  });

  it('colorForSha returns the canopy instanceColor for a commit', () => {
    const commits = [commit(0), commit(1), commit(2)];
    const placements = [placement(0, 0), placement(1, 1), placement(2, 2)];
    const trees = createTreeRenderer(placements, commits);

    const color = trees.colorForSha(commits[1].sha);
    // colorForSha must return a valid CSS hex color string.
    expect(color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('colorForSha returns the base color even when the tree is hovered', () => {
    const commits = [commit(0), commit(1)];
    const placements = [placement(0, 0), placement(1, 1)];
    const trees = createTreeRenderer(placements, commits);

    const base = trees.colorForSha(commits[1].sha);
    expect(base).toMatch(/^#[0-9a-f]{6}$/);

    trees.setHoverSha(commits[1].sha);
    const duringHover = trees.colorForSha(commits[1].sha);
    expect(duringHover).toBe(base);

    trees.setSelectionSha(commits[1].sha);
    const duringSelect = trees.colorForSha(commits[1].sha);
    expect(duringSelect).toBe(base);

    trees.setHoverSha(null);
    trees.setSelectionSha(null);
    expect(trees.colorForSha(commits[1].sha)).toBe(base);
  });

  it('colorForSha returns null for an unknown sha', () => {
    const commits = [commit(0)];
    const placements = [placement(0, 0)];
    const trees = createTreeRenderer(placements, commits);
    expect(trees.colorForSha('f'.repeat(40))).toBeNull();
  });

  it('colorForSha returns null when commits is null', () => {
    const trees = createTreeRenderer([placement(0, 0)], null);
    expect(trees.colorForSha('a'.repeat(40))).toBeNull();
  });

  it('setHoverSha tints the canopy instance brighter than baseline', () => {
    const commits = [commit(0), commit(1)];
    const placements = [placement(0, 0), placement(1, 1)];
    const trees = createTreeRenderer(placements, commits);

    const tmp = new THREE.Color();
    const hit = trees.findTreeBySha(commits[1].sha)!;
    hit.mesh.getColorAt(hit.instanceId, tmp);
    const baseR = tmp.r;

    trees.setHoverSha(commits[1].sha);
    hit.mesh.getColorAt(hit.instanceId, tmp);
    expect(tmp.r).toBeGreaterThan(baseR);
  });

  it('setHoverSha(null) restores the baseline color', () => {
    const commits = [commit(0), commit(1)];
    const placements = [placement(0, 0), placement(1, 1)];
    const trees = createTreeRenderer(placements, commits);

    const tmp = new THREE.Color();
    const hit = trees.findTreeBySha(commits[1].sha)!;
    hit.mesh.getColorAt(hit.instanceId, tmp);
    const baseR = tmp.r;

    trees.setHoverSha(commits[1].sha);
    trees.setHoverSha(null);
    hit.mesh.getColorAt(hit.instanceId, tmp);
    expect(Math.abs(tmp.r - baseR)).toBeLessThan(0.001);
  });

  it('setSelectionSha tints more strongly than setHoverSha', () => {
    const commits = [commit(0), commit(1)];
    const placements = [placement(0, 0), placement(1, 1)];
    const trees = createTreeRenderer(placements, commits);

    const tmp = new THREE.Color();
    const hit = trees.findTreeBySha(commits[1].sha)!;

    trees.setHoverSha(commits[1].sha);
    hit.mesh.getColorAt(hit.instanceId, tmp);
    const hoverR = tmp.r;

    trees.setHoverSha(null);
    trees.setSelectionSha(commits[1].sha);
    hit.mesh.getColorAt(hit.instanceId, tmp);
    expect(tmp.r).toBeGreaterThan(hoverR);
  });

  it('selection wins over hover when both apply to the same tree', () => {
    const commits = [commit(0), commit(1)];
    const placements = [placement(0, 0), placement(1, 1)];
    const trees = createTreeRenderer(placements, commits);

    const tmp = new THREE.Color();
    const hit = trees.findTreeBySha(commits[1].sha)!;

    trees.setSelectionSha(commits[1].sha);
    hit.mesh.getColorAt(hit.instanceId, tmp);
    const selectedR = tmp.r;

    trees.setHoverSha(commits[1].sha); // hover same tree
    hit.mesh.getColorAt(hit.instanceId, tmp);
    expect(Math.abs(tmp.r - selectedR)).toBeLessThan(0.001);
  });

  it('moving hover from selected tree to another reverts the previous to selected', () => {
    const commits = [commit(0), commit(1), commit(2)];
    const placements = [placement(0, 0), placement(1, 1), placement(2, 2)];
    const trees = createTreeRenderer(placements, commits);

    const tmp = new THREE.Color();
    const hit1 = trees.findTreeBySha(commits[1].sha)!;

    trees.setSelectionSha(commits[1].sha);
    hit1.mesh.getColorAt(hit1.instanceId, tmp);
    const selectedR = tmp.r;

    trees.setHoverSha(commits[1].sha); // hover === selected, no change
    trees.setHoverSha(commits[2].sha); // hover moves to a different tree
    hit1.mesh.getColorAt(hit1.instanceId, tmp);
    expect(Math.abs(tmp.r - selectedR)).toBeLessThan(0.001); // still selected-tinted
  });
});
