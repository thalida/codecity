// treeRenderer.test.ts — verifies createTreeRenderer() produces one
// InstancedMesh per enabled canopy shape plus a shared trunk mesh,
// with per-instance heights and colors driven by commit metadata,
// and that refresh() updates colors without rebuilding.

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

function makeCommits(n: number, filesAt: (i: number) => number = (i) => i + 1): CommitEntry[] {
  const out: CommitEntry[] = [];
  for (let i = 0; i < n; i++) {
    const day = String(i + 1).padStart(2, '0');
    out.push({ date: `2026-01-${day}`, files: filesAt(i) });
  }
  return out;
}

function trunkMesh(group: THREE.Group): THREE.InstancedMesh {
  const m = group.children.find((c) => c.name === 'tree-trunk');
  if (!m) throw new Error("expected 'tree-trunk' on trees group");
  return m as THREE.InstancedMesh;
}

function canopyMeshes(group: THREE.Group): THREE.InstancedMesh[] {
  return group.children
    .filter((c) => c.name.startsWith('tree-canopy-'))
    .map((c) => c as THREE.InstancedMesh);
}

describe('createTreeRenderer()', () => {
  let trees: Trees;

  beforeEach(() => {
    resetStores();
  });

  afterEach(() => {
    trees?.dispose();
  });

  it('builds at most one canopy mesh per enabled shape, plus one trunk mesh', () => {
    const placements = [
      placement(0, 0, 1, 0),
      placement(20, 0, 2, 1),
      placement(0, 20, 3, 2),
      placement(20, 20, 4, 0),
    ];
    trees = createTreeRenderer(placements, makeCommits(3));
    const names = trees.group.children.map((c) => c.name).sort();
    expect(names).toContain('tree-trunk');
    const canopyNames = names.filter((n) => n.startsWith('tree-canopy-'));
    expect(canopyNames.length).toBeGreaterThan(0);
    expect(canopyNames.length).toBeLessThanOrEqual(4);
    for (const n of canopyNames) {
      expect(['tree-canopy-pointy', 'tree-canopy-rounded', 'tree-canopy-fir', 'tree-canopy-narrow'])
        .toContain(n);
    }
  });

  it('sum of canopy instance counts equals placements.length', () => {
    const placements = [
      placement(0, 0, 1, 0),
      placement(20, 0, 2, 1),
      placement(0, 20, 3, 2),
      placement(20, 20, 4, 0),
    ];
    trees = createTreeRenderer(placements, makeCommits(3));
    const totalCanopy = canopyMeshes(trees.group).reduce((acc, m) => acc + m.count, 0);
    expect(totalCanopy).toBe(placements.length);
    expect(trunkMesh(trees.group).count).toBe(placements.length);
  });

  it('handles an empty placement list', () => {
    trees = createTreeRenderer([], makeCommits(0));
    expect(canopyMeshes(trees.group).length).toBe(0);
    expect(trunkMesh(trees.group).count).toBe(0);
  });

  it('puts every foliage mesh at PARK_FOLIAGE render order', () => {
    trees = createTreeRenderer([placement(0, 0, 1, 0)], makeCommits(1));
    for (const m of [...canopyMeshes(trees.group), trunkMesh(trees.group)]) {
      expect(m.renderOrder).toBe(RENDER_ORDERS.PARK_FOLIAGE);
    }
  });

  it('honors TREES_ENABLED visibility toggle on build', () => {
    TREES.setKey('TREES_ENABLED', false);
    trees = createTreeRenderer([placement(0, 0, 1, 0)], makeCommits(1));
    for (const m of [...canopyMeshes(trees.group), trunkMesh(trees.group)]) {
      expect(m.visible).toBe(false);
    }
  });

  it('refresh() flips visibility on TREES_ENABLED change', () => {
    trees = createTreeRenderer([placement(0, 0, 1, 0)], makeCommits(1));
    TREES.setKey('TREES_ENABLED', false);
    trees.refresh();
    for (const m of [...canopyMeshes(trees.group), trunkMesh(trees.group)]) {
      expect(m.visible).toBe(false);
    }
    TREES.setKey('TREES_ENABLED', true);
    trees.refresh();
    for (const m of [...canopyMeshes(trees.group), trunkMesh(trees.group)]) {
      expect(m.visible).toBe(true);
    }
  });

  it('renders no canopy meshes when all shapes are disabled', () => {
    TREES.setKey('SHAPE_POINTY_ENABLED', false);
    TREES.setKey('SHAPE_ROUNDED_ENABLED', false);
    TREES.setKey('SHAPE_FIR_ENABLED', false);
    TREES.setKey('SHAPE_NARROW_ENABLED', false);
    trees = createTreeRenderer([placement(0, 0, 1, 0)], makeCommits(1));
    expect(canopyMeshes(trees.group).length).toBe(0);
    expect(trunkMesh(trees.group).count).toBe(1);
  });

  it('per-instance height interpolates between min/max by commit file count', () => {
    const placements = [
      placement(0, 0, 1, 0),
      placement(20, 0, 2, 1),
      placement(0, 20, 3, 2),
    ];
    const commits: CommitEntry[] = [
      { date: '2026-01-01', files: 1 },
      { date: '2026-01-11', files: 5 },
      { date: '2026-01-21', files: 9 },
    ];
    trees = createTreeRenderer(placements, commits);

    const trunk = trunkMesh(trees.group);
    const minHeight = 3 * 16;
    const maxHeight = 9 * 16;
    const midHeight = (minHeight + maxHeight) / 2;

    const heights = [0, 0, 0];
    const mat = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    for (let i = 0; i < 3; i++) {
      trunk.getMatrixAt(i, mat);
      mat.decompose(pos, quat, scale);
      heights[i] = scale.y;
    }
    expect(heights[0]).toBeCloseTo(minHeight, 3);
    expect(heights[1]).toBeCloseTo(midHeight, 3);
    expect(heights[2]).toBeCloseTo(maxHeight, 3);
  });

  it('per-instance color interpolates between OLD and NEW endpoints by commit age', () => {
    const commits: CommitEntry[] = [
      { date: '2026-01-01', files: 5 },
      { date: '2026-01-11', files: 5 },
      { date: '2026-01-21', files: 5 },
    ];
    TREES.setKey('SHAPE_ROUNDED_ENABLED', false);
    TREES.setKey('SHAPE_FIR_ENABLED', false);
    TREES.setKey('SHAPE_NARROW_ENABLED', false);
    const placements = [
      placement(0, 0, 1, 0),
      placement(20, 0, 2, 1),
      placement(0, 20, 3, 2),
    ];
    trees = createTreeRenderer(placements, commits);

    const canopy = canopyMeshes(trees.group)[0];
    expect(canopy.name).toBe('tree-canopy-pointy');
    expect(canopy.count).toBe(3);

    const oldColor = new THREE.Color();
    const newColor = new THREE.Color();
    oldColor.setStyle('#1f5a2f', THREE.LinearSRGBColorSpace);
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

    const trunk = trunkMesh(trees.group);
    const midHeight = ((3 + 9) / 2) * 16;
    const mat = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    for (let i = 0; i < placements.length; i++) {
      trunk.getMatrixAt(i, mat);
      mat.decompose(pos, quat, scale);
      expect(scale.y).toBeCloseTo(midHeight, 3);
    }
  });

  it('canopy geometry carries a baked color attribute (vertex-color gradient)', () => {
    trees = createTreeRenderer([placement(0, 0, 1, 0)], makeCommits(1));
    for (const m of canopyMeshes(trees.group)) {
      const colorAttr = m.geometry.getAttribute('color');
      expect(colorAttr).toBeDefined();
      expect(colorAttr.itemSize).toBe(3);
      expect(colorAttr.count).toBeGreaterThan(0);
    }
  });

  it('vertex-color gradient strength=0 yields uniform white vertex colors', () => {
    TREES.setKey('TREE_SHADING_STRENGTH', 0);
    trees = createTreeRenderer([placement(0, 0, 1, 0)], makeCommits(1));
    for (const m of canopyMeshes(trees.group)) {
      const colorAttr = m.geometry.getAttribute('color');
      for (let i = 0; i < colorAttr.count; i++) {
        expect(colorAttr.getX(i)).toBeCloseTo(1, 5);
        expect(colorAttr.getY(i)).toBeCloseTo(1, 5);
        expect(colorAttr.getZ(i)).toBeCloseTo(1, 5);
      }
    }
  });

  it('refresh() updates color endpoints without rebuilding meshes', () => {
    trees = createTreeRenderer([placement(0, 0, 1, 0)], makeCommits(1));
    const meshesBefore = [...canopyMeshes(trees.group), trunkMesh(trees.group)];
    const geomBefore = meshesBefore.map((m) => m.geometry);

    TREES.setKey('TREE_COLOR_OLD', '#000000');
    TREES.setKey('TREE_COLOR_NEW', '#ffffff');
    TREES.setKey('TREE_TRUNK_COLOR', '#ff0000');
    trees.refresh();

    const meshesAfter = [...canopyMeshes(trees.group), trunkMesh(trees.group)];
    for (let i = 0; i < meshesAfter.length; i++) {
      expect(meshesAfter[i]).toBe(meshesBefore[i]);
      expect(meshesAfter[i].geometry).toBe(geomBefore[i]);
    }
  });

  it('dispose() releases geometry and materials', () => {
    trees = createTreeRenderer([placement(0, 0, 1, 0)], makeCommits(1));
    const tracked: Array<{ name: string; disposed: boolean }> = [];
    for (const m of [...canopyMeshes(trees.group), trunkMesh(trees.group)]) {
      const entry = { name: m.name, disposed: false };
      tracked.push(entry);
      const origDispose = m.geometry.dispose.bind(m.geometry);
      m.geometry.dispose = () => { entry.disposed = true; origDispose(); };
    }
    trees.dispose();
    for (const t of tracked) expect(t.disposed).toBe(true);
  });
});
