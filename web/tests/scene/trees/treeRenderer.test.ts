// treeRenderer.test.ts — verifies createTreeRenderer() produces the
// two foliage InstancedMeshes (tree canopies + trunks) with the right
// instance counts, that refresh() updates colors without rebuilding,
// and that dispose() releases all GPU resources.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { createTreeRenderer, type Trees } from '@/scene/trees/treeRenderer.js';
import type { TreePlacement } from '@/scene/trees/treePlacement.js';
import { TREES } from '@/config/trees.js';
import { BUILDING_DIMENSIONS } from '@/config/building.js';
import { RENDER_ORDERS } from '@/constants';

function resetStores() {
  TREES.set({
    TREES_ENABLED: true,
    EDGE_INSET_PERCENT: 8,
    TREE_MIN_HEIGHT_FLOORS: 3,
    TREE_MAX_HEIGHT_FLOORS: 9,
    TREE_RADIUS_FRAC_OF_HEIGHT: 0.3,
    SCATTER_FOOTPRINT_FRAC_OF_MAX_WIDTH: 0.5,
    TREE_COLOR_OLD: '#1f5a2f',
    TREE_COLOR_NEW: '#a8d68a',
    TREE_SHADING_STRENGTH: 0.35,
    TREE_TRUNK_COLOR: '#4a3220',
    SHAPE_POINTY_ENABLED: true,
    SHAPE_ROUNDED_ENABLED: true,
    SHAPE_FIR_ENABLED: true,
    SHAPE_NARROW_ENABLED: true,
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

function placement(x: number, y: number, seed: number, commitIndex: number): TreePlacement {
  return { x, y, seed, commitIndex };
}

function findMesh(group: THREE.Group, name: string): THREE.InstancedMesh {
  const m = group.children.find((c) => c.name === name);
  if (!m) throw new Error(`expected child '${name}' on trees group`);
  return m as THREE.InstancedMesh;
}

describe('createTreeRenderer()', () => {
  let trees: Trees;

  beforeEach(() => {
    resetStores();
  });

  afterEach(() => {
    trees?.dispose();
  });

  it('builds a group of two named foliage InstancedMeshes', () => {
    trees = createTreeRenderer([placement(0, 0, 1, 0)]);
    const names = trees.group.children.map((c) => c.name).sort();
    expect(names).toEqual(['tree-canopy', 'tree-trunk']);
    for (const child of trees.group.children) {
      expect((child as THREE.InstancedMesh).isInstancedMesh).toBe(true);
    }
  });

  it('instance counts match placement array length', () => {
    const placements = [
      placement(0, 0, 1, 0),
      placement(20, 0, 2, 1),
      placement(0, 20, 3, 2),
    ];
    trees = createTreeRenderer(placements);
    expect(findMesh(trees.group, 'tree-canopy').count).toBe(3);
    expect(findMesh(trees.group, 'tree-trunk').count).toBe(3);
  });

  it('handles an empty placement list', () => {
    trees = createTreeRenderer([]);
    for (const child of trees.group.children) {
      expect((child as THREE.InstancedMesh).count).toBe(0);
    }
  });

  it('puts foliage meshes at PARK_FOLIAGE render order', () => {
    trees = createTreeRenderer([placement(0, 0, 1, 0)]);
    for (const name of ['tree-canopy', 'tree-trunk']) {
      expect(findMesh(trees.group, name).renderOrder).toBe(RENDER_ORDERS.PARK_FOLIAGE);
    }
  });

  it('honors TREES_ENABLED visibility toggle on build', () => {
    TREES.setKey('TREES_ENABLED', false);
    trees = createTreeRenderer([placement(0, 0, 1, 0)]);
    expect(findMesh(trees.group, 'tree-canopy').visible).toBe(false);
    expect(findMesh(trees.group, 'tree-trunk').visible).toBe(false);
  });

  it('refresh() flips visibility on TREES_ENABLED change', () => {
    trees = createTreeRenderer([placement(0, 0, 1, 0)]);
    TREES.setKey('TREES_ENABLED', false);
    trees.refresh();
    expect(findMesh(trees.group, 'tree-canopy').visible).toBe(false);
    TREES.setKey('TREES_ENABLED', true);
    trees.refresh();
    expect(findMesh(trees.group, 'tree-canopy').visible).toBe(true);
  });

  it('dispose() releases geometry and materials on every child', () => {
    trees = createTreeRenderer([placement(0, 0, 1, 0)]);
    const sentinels: Array<{ geom: boolean; mat: boolean }> = [];
    for (const child of trees.group.children) {
      const mesh = child as THREE.InstancedMesh;
      const s = { geom: false, mat: false };
      sentinels.push(s);
      const origGeomDispose = mesh.geometry.dispose.bind(mesh.geometry);
      mesh.geometry.dispose = () => { s.geom = true; origGeomDispose(); };
      const mat = mesh.material as THREE.Material;
      const origMatDispose = mat.dispose.bind(mat);
      mat.dispose = () => { s.mat = true; origMatDispose(); };
    }
    trees.dispose();
    for (const s of sentinels) {
      expect(s.geom).toBe(true);
      expect(s.mat).toBe(true);
    }
  });
});
