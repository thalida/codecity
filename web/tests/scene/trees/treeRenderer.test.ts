// treeRenderer.test.ts — verifies createTreeRenderer() produces a
// tree-canopy + tree-trunk InstancedMesh pair, with per-instance
// heights driven by commit age (older = taller), widths driven by
// commit file count (more files = wider), and canopy colors that
// interpolate between TREE_COLOR_OLD and TREE_COLOR_NEW by age.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { createTreeRenderer, type Trees } from '@/scene/trees/treeRenderer.js';
import type { TreePlacement } from '@/scene/trees/treePlacement.js';
import { TREES } from '@/config/trees.js';
import { BUILDING_DIMENSIONS } from '@/config/building.js';
import { RENDER_ORDERS } from '@/constants';
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
    SCATTER_FOOTPRINT_FRAC_OF_MAX_WIDTH: 0.5,
    TREE_COLOR_OLD: '#0a2613',
    TREE_COLOR_NEW: '#a8d68a',
    TREE_SHADING_STRENGTH: 0.35,
    TREE_TRUNK_COLOR: '#4a3220',
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

function makeCommits(n: number, filesAt: (i: number) => number = (i) => i + 1): CommitEntry[] {
  const out: CommitEntry[] = [];
  for (let i = 0; i < n; i++) {
    const day = String(i + 1).padStart(2, '0');
    out.push({ date: `2026-01-${day}`, files: filesAt(i) });
  }
  return out;
}

function meshByName(group: THREE.Group, name: string): THREE.InstancedMesh {
  const m = group.children.find((c) => c.name === name);
  if (!m) throw new Error(`expected child '${name}' on trees group`);
  return m as THREE.InstancedMesh;
}

function instanceScale(mesh: THREE.InstancedMesh, i: number): THREE.Vector3 {
  const mat = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  mesh.getMatrixAt(i, mat);
  mat.decompose(pos, quat, scale);
  return scale;
}

function instancePosition(mesh: THREE.InstancedMesh, i: number): THREE.Vector3 {
  const mat = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  mesh.getMatrixAt(i, mat);
  mat.decompose(pos, quat, scale);
  return pos;
}

describe('createTreeRenderer()', () => {
  let trees: Trees;

  beforeEach(() => {
    resetStores();
  });

  afterEach(() => {
    trees?.dispose();
  });

  it('builds a tree-canopy and tree-trunk InstancedMesh', () => {
    trees = createTreeRenderer([placement(0, 0, 1, 0)], makeCommits(1));
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
    trees = createTreeRenderer(placements, makeCommits(3));
    expect(meshByName(trees.group, 'tree-canopy').count).toBe(3);
    expect(meshByName(trees.group, 'tree-trunk').count).toBe(3);
  });

  it('handles an empty placement list', () => {
    trees = createTreeRenderer([], makeCommits(0));
    for (const child of trees.group.children) {
      expect((child as THREE.InstancedMesh).count).toBe(0);
    }
  });

  it('puts foliage meshes at PARK_FOLIAGE render order', () => {
    trees = createTreeRenderer([placement(0, 0, 1, 0)], makeCommits(1));
    for (const name of ['tree-canopy', 'tree-trunk']) {
      expect(meshByName(trees.group, name).renderOrder).toBe(RENDER_ORDERS.PARK_FOLIAGE);
    }
  });

  it('honors TREES_ENABLED visibility toggle on build', () => {
    TREES.setKey('TREES_ENABLED', false);
    trees = createTreeRenderer([placement(0, 0, 1, 0)], makeCommits(1));
    expect(meshByName(trees.group, 'tree-canopy').visible).toBe(false);
    expect(meshByName(trees.group, 'tree-trunk').visible).toBe(false);
  });

  it('refresh() flips visibility on TREES_ENABLED change', () => {
    trees = createTreeRenderer([placement(0, 0, 1, 0)], makeCommits(1));
    TREES.setKey('TREES_ENABLED', false);
    trees.refresh();
    expect(meshByName(trees.group, 'tree-canopy').visible).toBe(false);
    expect(meshByName(trees.group, 'tree-trunk').visible).toBe(false);
    TREES.setKey('TREES_ENABLED', true);
    trees.refresh();
    expect(meshByName(trees.group, 'tree-canopy').visible).toBe(true);
    expect(meshByName(trees.group, 'tree-trunk').visible).toBe(true);
  });

  it('canopy height interpolates between MIN and MAX driven by commit age (older = taller)', () => {
    const commits: CommitEntry[] = [
      { date: '2026-01-01', files: 5 }, // oldest → max height
      { date: '2026-01-11', files: 5 }, // mid → mid height
      { date: '2026-01-21', files: 5 }, // newest → min height
    ];
    const placements = [
      placement(0, 0, 1, 0),
      placement(20, 0, 2, 1),
      placement(0, 20, 3, 2),
    ];
    trees = createTreeRenderer(placements, commits);

    const canopy = meshByName(trees.group, 'tree-canopy');
    const minHeight = 48;
    const maxHeight = 144;
    const midHeight = (minHeight + maxHeight) / 2;

    // commitIndex 0 = oldest → max; 1 = mid; 2 = newest → min.
    expect(instanceScale(canopy, 0).y).toBeCloseTo(maxHeight, 3);
    expect(instanceScale(canopy, 1).y).toBeCloseTo(midHeight, 3);
    expect(instanceScale(canopy, 2).y).toBeCloseTo(minHeight, 3);
  });

  it('canopy XZ radius interpolates between MIN and MAX driven by commit files', () => {
    const commits: CommitEntry[] = [
      { date: '2026-01-01', files: 1 }, // min files → min radius
      { date: '2026-01-11', files: 5 }, // mid → mid
      { date: '2026-01-21', files: 9 }, // max files → max radius
    ];
    const placements = [
      placement(0, 0, 1, 0),
      placement(20, 0, 2, 1),
      placement(0, 20, 3, 2),
    ];
    trees = createTreeRenderer(placements, commits);

    const canopy = meshByName(trees.group, 'tree-canopy');
    // Radii are DIAMETER / 2. TREE_MIN_WIDTH=32 → r=16; TREE_MAX_WIDTH=128 → r=64.
    const minRadius = 32 / 2;
    const maxRadius = 128 / 2;
    const midRadius = (minRadius + maxRadius) / 2;

    const scales = [instanceScale(canopy, 0), instanceScale(canopy, 1), instanceScale(canopy, 2)];
    expect(scales[0].x).toBeCloseTo(minRadius, 3);
    expect(scales[1].x).toBeCloseTo(midRadius, 3);
    expect(scales[2].x).toBeCloseTo(maxRadius, 3);
    // XZ symmetric: z scale equals x scale.
    for (const s of scales) {
      expect(s.z).toBeCloseTo(s.x, 5);
    }
  });

  it('trunk thickness scales with canopy radius via TRUNK_RADIUS_FRAC_OF_CANOPY', () => {
    const commits: CommitEntry[] = [
      { date: '2026-01-01', files: 9 }, // max files → max canopy radius
    ];
    trees = createTreeRenderer([placement(0, 0, 1, 0)], commits);

    const canopy = meshByName(trees.group, 'tree-canopy');
    const trunk = meshByName(trees.group, 'tree-trunk');
    const canopyR = instanceScale(canopy, 0).x;
    const trunkR = instanceScale(trunk, 0).x;
    expect(trunkR).toBeCloseTo(canopyR * 0.15, 4);
  });

  it('trunk height scales with canopy height via TRUNK_HEIGHT_FRAC', () => {
    const commits: CommitEntry[] = [
      { date: '2026-01-01', files: 5 }, // oldest → max canopy height
    ];
    trees = createTreeRenderer([placement(0, 0, 1, 0)], commits);

    const canopy = meshByName(trees.group, 'tree-canopy');
    const trunk = meshByName(trees.group, 'tree-trunk');
    const canopyH = instanceScale(canopy, 0).y;
    const trunkH = instanceScale(trunk, 0).y;
    expect(trunkH).toBeCloseTo(canopyH * 0.25, 4);
  });

  it('canopy sits on top of trunk (canopy base Y = trunk height)', () => {
    trees = createTreeRenderer([placement(0, 0, 1, 0)], makeCommits(1));
    const canopy = meshByName(trees.group, 'tree-canopy');
    const trunk = meshByName(trees.group, 'tree-trunk');
    const canopyBaseY = instancePosition(canopy, 0).y;
    const trunkHeight = instanceScale(trunk, 0).y;
    expect(canopyBaseY).toBeCloseTo(trunkHeight, 4);
  });

  it('per-instance color interpolates between OLD and NEW endpoints by commit age', () => {
    const commits: CommitEntry[] = [
      { date: '2026-01-01', files: 5 },
      { date: '2026-01-11', files: 5 },
      { date: '2026-01-21', files: 5 },
    ];
    const placements = [
      placement(0, 0, 1, 0),
      placement(20, 0, 2, 1),
      placement(0, 20, 3, 2),
    ];
    trees = createTreeRenderer(placements, commits);

    const canopy = meshByName(trees.group, 'tree-canopy');

    const oldColor = new THREE.Color();
    const newColor = new THREE.Color();
    oldColor.setStyle('#0a2613', THREE.LinearSRGBColorSpace);
    newColor.setStyle('#a8d68a', THREE.LinearSRGBColorSpace);
    const midColor = new THREE.Color().lerpColors(oldColor, newColor, 0.5);

    const got = new THREE.Color();
    canopy.getColorAt(0, got);
    expect(got.r).toBeCloseTo(oldColor.r, 3);
    expect(got.g).toBeCloseTo(oldColor.g, 3);
    canopy.getColorAt(1, got);
    expect(got.r).toBeCloseTo(midColor.r, 3);
    expect(got.g).toBeCloseTo(midColor.g, 3);
    canopy.getColorAt(2, got);
    expect(got.r).toBeCloseTo(newColor.r, 3);
    expect(got.g).toBeCloseTo(newColor.g, 3);
  });

  it('all trees render at midpoint values when commits is null', () => {
    const placements = [
      placement(0, 0, 1, 0),
      placement(20, 0, 2, 1),
    ];
    trees = createTreeRenderer(placements, null);

    const canopy = meshByName(trees.group, 'tree-canopy');
    const midHeight = (48 + 144) / 2;
    const midRadius = ((32 / 2) + (128 / 2)) / 2;
    for (let i = 0; i < placements.length; i++) {
      const s = instanceScale(canopy, i);
      expect(s.y).toBeCloseTo(midHeight, 3);
      expect(s.x).toBeCloseTo(midRadius, 3);
    }
  });

  it('canopy geometry carries a baked color attribute (vertex-color gradient)', () => {
    trees = createTreeRenderer([placement(0, 0, 1, 0)], makeCommits(1));
    const canopy = meshByName(trees.group, 'tree-canopy');
    const colorAttr = canopy.geometry.getAttribute('color');
    expect(colorAttr).toBeDefined();
    expect(colorAttr.itemSize).toBe(3);
    expect(colorAttr.count).toBeGreaterThan(0);
  });

  it('vertex-color gradient strength=0 yields uniform white vertex colors', () => {
    TREES.setKey('TREE_SHADING_STRENGTH', 0);
    trees = createTreeRenderer([placement(0, 0, 1, 0)], makeCommits(1));
    const colorAttr = meshByName(trees.group, 'tree-canopy').geometry.getAttribute('color');
    for (let i = 0; i < colorAttr.count; i++) {
      expect(colorAttr.getX(i)).toBeCloseTo(1, 5);
      expect(colorAttr.getY(i)).toBeCloseTo(1, 5);
      expect(colorAttr.getZ(i)).toBeCloseTo(1, 5);
    }
  });

  it('refresh() updates color endpoints without rebuilding meshes', () => {
    trees = createTreeRenderer([placement(0, 0, 1, 0)], makeCommits(1));
    const canopyBefore = meshByName(trees.group, 'tree-canopy');
    const trunkBefore = meshByName(trees.group, 'tree-trunk');
    const canopyGeom = canopyBefore.geometry;
    const trunkGeom = trunkBefore.geometry;

    TREES.setKey('TREE_COLOR_OLD', '#000000');
    TREES.setKey('TREE_COLOR_NEW', '#ffffff');
    TREES.setKey('TREE_TRUNK_COLOR', '#ff0000');
    trees.refresh();

    expect(meshByName(trees.group, 'tree-canopy')).toBe(canopyBefore);
    expect(meshByName(trees.group, 'tree-trunk')).toBe(trunkBefore);
    expect(canopyBefore.geometry).toBe(canopyGeom);
    expect(trunkBefore.geometry).toBe(trunkGeom);
  });

  it('dispose() releases geometry and materials', () => {
    trees = createTreeRenderer([placement(0, 0, 1, 0)], makeCommits(1));
    const tracked: Array<{ name: string; disposed: boolean }> = [];
    for (const child of trees.group.children) {
      const mesh = child as THREE.InstancedMesh;
      const entry = { name: mesh.name, disposed: false };
      tracked.push(entry);
      const origDispose = mesh.geometry.dispose.bind(mesh.geometry);
      mesh.geometry.dispose = () => { entry.disposed = true; origDispose(); };
    }
    trees.dispose();
    for (const t of tracked) expect(t.disposed).toBe(true);
  });
});
