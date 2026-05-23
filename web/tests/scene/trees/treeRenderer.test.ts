// treeRenderer.test.ts — verifies createTreeRenderer() produces one
// InstancedMesh per non-empty canopy detail level plus a shared trunk
// mesh, with per-instance heights driven by commit age (older = taller),
// canopy widths driven by commit file count (more files = wider) and
// canopy facet counts also driven by file count (more files = higher
// subdivision), and canopy colors that interpolate between
// TREE_COLOR_OLD and TREE_COLOR_NEW by commit age.

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
    TREE_SHADING_STRENGTH: 0.55,
    TREE_TRUNK_COLOR: '#120c08',
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

/** Locate the canopy mesh + instance index that renders a given
 *  placement. Returns null if not found (e.g. all shapes disabled). */
function findCanopyInstance(
  group: THREE.Group,
  placementIdx: number,
): { mesh: THREE.InstancedMesh; instanceIdx: number } | null {
  for (const m of canopyMeshes(group)) {
    const order = m.userData.placementOrder as number[] | undefined;
    if (!order) continue;
    const k = order.indexOf(placementIdx);
    if (k !== -1) return { mesh: m, instanceIdx: k };
  }
  return null;
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

  it('builds at most one canopy mesh per detail level (d0/d1/d2) plus trunk', () => {
    const placements = [
      placement(0, 0, 1, 0),
      placement(20, 0, 2, 1),
      placement(0, 20, 3, 2),
    ];
    trees = createTreeRenderer(placements, makeCommits(3));
    const names = trees.group.children.map((c) => c.name).sort();
    expect(names).toContain('tree-trunk');
    const canopyNames = names.filter((n) => n.startsWith('tree-canopy-'));
    expect(canopyNames.length).toBeGreaterThan(0);
    expect(canopyNames.length).toBeLessThanOrEqual(3);
    for (const n of canopyNames) {
      expect(['tree-canopy-d0', 'tree-canopy-d1', 'tree-canopy-d2']).toContain(n);
    }
  });

  it('canopy instance counts sum to placements.length', () => {
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

  it('puts foliage meshes at PARK_FOLIAGE render order', () => {
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

  it('trunk height interpolates between MIN and MAX driven by commit age (older = taller)', () => {
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

    const trunk = trunkMesh(trees.group);
    const minH = 48;
    const maxH = 144;
    const midH = (minH + maxH) / 2;

    expect(instanceScale(trunk, 0).y).toBeCloseTo(maxH * 0.25, 3);
    expect(instanceScale(trunk, 1).y).toBeCloseTo(midH * 0.25, 3);
    expect(instanceScale(trunk, 2).y).toBeCloseTo(minH * 0.25, 3);
  });

  it('trunk XZ scale tracks per-tree canopy radius via TRUNK_RADIUS_FRAC_OF_CANOPY', () => {
    const commits: CommitEntry[] = [
      { date: '2026-01-01', files: 1 }, // min files → min canopy radius
      { date: '2026-01-11', files: 5 }, // mid
      { date: '2026-01-21', files: 9 }, // max files → max canopy radius
    ];
    const placements = [
      placement(0, 0, 1, 0),
      placement(20, 0, 2, 1),
      placement(0, 20, 3, 2),
    ];
    trees = createTreeRenderer(placements, commits);

    const trunk = trunkMesh(trees.group);
    const minR = 32 / 2;
    const maxR = 128 / 2;
    const midR = (minR + maxR) / 2;
    const trunkFrac = 0.15;

    expect(instanceScale(trunk, 0).x).toBeCloseTo(minR * trunkFrac, 3);
    expect(instanceScale(trunk, 1).x).toBeCloseTo(midR * trunkFrac, 3);
    expect(instanceScale(trunk, 2).x).toBeCloseTo(maxR * trunkFrac, 3);
  });

  it('canopy XZ scale matches per-tree radius (looked up via placementOrder)', () => {
    const commits: CommitEntry[] = [
      { date: '2026-01-01', files: 1 },
      { date: '2026-01-21', files: 9 },
    ];
    const placements = [
      placement(0, 0, 1, 0),
      placement(20, 0, 2, 1),
    ];
    trees = createTreeRenderer(placements, commits);
    const minR = 32 / 2;
    const maxR = 128 / 2;

    const a = findCanopyInstance(trees.group, 0);
    const b = findCanopyInstance(trees.group, 1);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(instanceScale(a!.mesh, a!.instanceIdx).x).toBeCloseTo(minR, 3);
    expect(instanceScale(b!.mesh, b!.instanceIdx).x).toBeCloseTo(maxR, 3);
  });

  it('canopy sits on top of trunk (canopy base Y = trunk height)', () => {
    trees = createTreeRenderer([placement(0, 0, 1, 0)], makeCommits(1));
    const canopy = canopyMeshes(trees.group)[0];
    const trunk = trunkMesh(trees.group);
    const canopyBaseY = instancePosition(canopy, 0).y;
    const trunkHeight = instanceScale(trunk, 0).y;
    expect(canopyBaseY).toBeCloseTo(trunkHeight, 4);
  });

  it('facet detail increases with commit file count', () => {
    const commits: CommitEntry[] = [
      { date: '2026-01-01', files: 1 }, // sizeT=0   → detail 0
      { date: '2026-01-11', files: 5 }, // sizeT=0.5 → detail 1
      { date: '2026-01-21', files: 9 }, // sizeT=1   → detail 2
    ];
    const placements = [
      placement(0, 0, 1, 0),
      placement(20, 0, 2, 1),
      placement(0, 20, 3, 2),
    ];
    trees = createTreeRenderer(placements, commits);

    const a = findCanopyInstance(trees.group, 0);
    const b = findCanopyInstance(trees.group, 1);
    const c = findCanopyInstance(trees.group, 2);
    expect(a!.mesh.name).toBe('tree-canopy-d0');
    expect(b!.mesh.name).toBe('tree-canopy-d1');
    expect(c!.mesh.name).toBe('tree-canopy-d2');
    // More facets = strictly more triangles (after toNonIndexed).
    expect(b!.mesh.geometry.getAttribute('position').count)
      .toBeGreaterThan(a!.mesh.geometry.getAttribute('position').count);
    expect(c!.mesh.geometry.getAttribute('position').count)
      .toBeGreaterThan(b!.mesh.geometry.getAttribute('position').count);
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

    const oldColor = new THREE.Color();
    const newColor = new THREE.Color();
    oldColor.setStyle('#0a2613', THREE.LinearSRGBColorSpace);
    newColor.setStyle('#a8d68a', THREE.LinearSRGBColorSpace);
    const midColor = new THREE.Color().lerpColors(oldColor, newColor, 0.5);

    const got = new THREE.Color();
    const a = findCanopyInstance(trees.group, 0)!; // oldest → OLD
    const b = findCanopyInstance(trees.group, 1)!; // mid
    const c = findCanopyInstance(trees.group, 2)!; // newest → NEW
    a.mesh.getColorAt(a.instanceIdx, got);
    expect(got.r).toBeCloseTo(oldColor.r, 3);
    expect(got.g).toBeCloseTo(oldColor.g, 3);
    b.mesh.getColorAt(b.instanceIdx, got);
    expect(got.r).toBeCloseTo(midColor.r, 3);
    expect(got.g).toBeCloseTo(midColor.g, 3);
    c.mesh.getColorAt(c.instanceIdx, got);
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
    const midH = (48 + 144) / 2;
    for (let i = 0; i < placements.length; i++) {
      expect(instanceScale(trunk, i).y).toBeCloseTo(midH * 0.25, 3);
    }
    // Null commits → degenerate sizeT=0.5 → detail 1 for every tree.
    const canopies = canopyMeshes(trees.group);
    expect(canopies.length).toBe(1);
    expect(canopies[0].name).toBe('tree-canopy-d1');
  });

  it('canopy geometry carries a baked color attribute (vertex shading)', () => {
    trees = createTreeRenderer([placement(0, 0, 1, 0)], makeCommits(1));
    for (const m of canopyMeshes(trees.group)) {
      const colorAttr = m.geometry.getAttribute('color');
      expect(colorAttr).toBeDefined();
      expect(colorAttr.itemSize).toBe(3);
      expect(colorAttr.count).toBeGreaterThan(0);
    }
  });

  it('vertex shading strength=0 yields uniform white vertex colors', () => {
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
    const geomsBefore = meshesBefore.map((m) => m.geometry);

    TREES.setKey('TREE_COLOR_OLD', '#000000');
    TREES.setKey('TREE_COLOR_NEW', '#ffffff');
    TREES.setKey('TREE_TRUNK_COLOR', '#ff0000');
    trees.refresh();

    const meshesAfter = [...canopyMeshes(trees.group), trunkMesh(trees.group)];
    for (let i = 0; i < meshesAfter.length; i++) {
      expect(meshesAfter[i]).toBe(meshesBefore[i]);
      expect(meshesAfter[i].geometry).toBe(geomsBefore[i]);
    }
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
