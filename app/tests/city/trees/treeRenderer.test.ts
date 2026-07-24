// treeRenderer.test.ts — verifies createTreeRenderer() produces one shared
// canopy InstancedMesh plus a shared trunk mesh, with per-instance heights
// driven by commit age (older = taller), canopy widths driven by commit file
// count (more files = wider), and canopy colors that interpolate between
// COLOR_SOLO_DAY (solo-commit days) and COLOR_BUSY_DAY (busy days) by
// commits-per-day.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { type Trees } from '@/city/components/trees/treeRenderer';
import type { TreePlacement } from '@/city/components/trees/treePlacement';
import { TREES } from '@/state/stores/settings/trees';
import { BUILDING_DIMENSIONS } from '@/state/stores/settings/buildings';
import { RENDER_ORDERS } from '@/city/types/renderOrders';
import type { CommitEntry } from '@/types';
import { commits as buildCommits } from './_commitFixtures';
import { renderTrees } from './_renderTrees';

function resetStores() {
  TREES.value = {
    ENABLED: true,
    MIN_HEIGHT: 48,
    MAX_HEIGHT: 144,
    MIN_WIDTH: 32,
    MAX_WIDTH: 128,
    TRUNK_HEIGHT_FRAC: 0.25,
    TRUNK_RADIUS_FRAC: 0.15,
    CANOPY_TRUNK_OVERLAP_FRAC: 0.7,
    COLOR_BUSY_DAY: '#0a2613',
    COLOR_SOLO_DAY: '#a8d68a',
    SHADING_STRENGTH: 0.65,
    TRUNK_COLOR: '#120c08',
    WIDTH_AGE_FLOOR: 1.0,
    STALE_HORIZON_DAYS: 730,
    STALENESS_CAP: 0.85,
    OUTLINE_WIDTH: 1,
    OUTLINE_HOVER_COLOR: '#ffffff',
    OUTLINE_HOVER_OPACITY: 0.5,
    OUTLINE_SELECTED_OPACITY: 0.75,
  };
  BUILDING_DIMENSIONS.value = {
    MIN_FLOORS: 2,
    MAX_FLOORS: 96,
    FULL_HEIGHT_LINES: 2000,
    FLOOR_HEIGHT: 16,
    MIN_WIDTH: 8,
    MAX_WIDTH: 8,
    FULL_WIDTH_KB: 64,
    DISTANCE_FROM_ROAD: 8,
  };
}

function placement(x: number, y: number, seed: number, commitIndex: number): TreePlacement {
  return { x, y, seed, commitIndex };
}

// Default busyness thresholds for color-ramp anchoring (now passed in from
// the manifest; the renderer no longer derives them).
const BUSY = { avg: 1, busy: 1 };

function makeCommits(n: number, filesAt: (i: number) => number = (i) => i + 1): CommitEntry[] {
  const entries: { date: string; files: number }[] = [];
  for (let i = 0; i < n; i++) {
    const day = String(i + 1).padStart(2, '0');
    entries.push({ date: `2026-01-${day}`, files: filesAt(i) });
  }
  return buildCommits(...entries);
}

function trunkMesh(group: THREE.Group): THREE.InstancedMesh {
  const m = group.children.find((c) => c.name === 'tree-trunk');
  if (!m) throw new Error("expected 'tree-trunk' on trees group");
  return m as THREE.InstancedMesh;
}

function canopyMeshes(group: THREE.Group): THREE.InstancedMesh[] {
  return group.children
    .filter((c) => c.name.startsWith('tree-canopy'))
    .map((c) => c as THREE.InstancedMesh);
}

/** Locate the canopy mesh + instance index that renders a given
 *  placement. Returns null if not found (e.g. all shapes disabled). */
function findCanopyInstance(
  group: THREE.Group,
  placementIdx: number
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

  it('builds one shared canopy mesh plus a trunk mesh', () => {
    const placements = [placement(0, 0, 1, 0), placement(20, 0, 2, 1), placement(0, 20, 3, 2)];
    trees = renderTrees(placements, makeCommits(3), BUSY);
    const names = trees.group.children.map((c) => c.name).sort();
    expect(names).toContain('tree-trunk');
    expect(names.filter((n) => n.startsWith('tree-canopy'))).toEqual(['tree-canopy']);
  });

  it('canopy instance counts sum to placements.length', () => {
    const placements = [
      placement(0, 0, 1, 0),
      placement(20, 0, 2, 1),
      placement(0, 20, 3, 2),
      placement(20, 20, 4, 0),
    ];
    trees = renderTrees(placements, makeCommits(3), BUSY);
    const totalCanopy = canopyMeshes(trees.group).reduce((acc, m) => acc + m.count, 0);
    expect(totalCanopy).toBe(placements.length);
    expect(trunkMesh(trees.group).count).toBe(placements.length);
  });

  it('handles an empty placement list', () => {
    trees = renderTrees([], makeCommits(0), BUSY);
    const canopies = canopyMeshes(trees.group);
    expect(canopies.length).toBe(1);
    expect(canopies[0].count).toBe(0);
    expect(trunkMesh(trees.group).count).toBe(0);
  });

  it('puts foliage meshes at PARK_FOLIAGE render order', () => {
    trees = renderTrees([placement(0, 0, 1, 0)], makeCommits(1), BUSY);
    for (const m of [...canopyMeshes(trees.group), trunkMesh(trees.group)]) {
      expect(m.renderOrder).toBe(RENDER_ORDERS.PARK_FOLIAGE);
    }
  });

  it('honors ENABLED visibility toggle on build', () => {
    TREES.value = { ...TREES.value, ENABLED: false };
    trees = renderTrees([placement(0, 0, 1, 0)], makeCommits(1), BUSY);
    for (const m of [...canopyMeshes(trees.group), trunkMesh(trees.group)]) {
      expect(m.visible).toBe(false);
    }
  });

  it('refresh() flips visibility on ENABLED change', () => {
    trees = renderTrees([placement(0, 0, 1, 0)], makeCommits(1), BUSY);
    TREES.value = { ...TREES.value, ENABLED: false };
    trees.refresh();
    for (const m of [...canopyMeshes(trees.group), trunkMesh(trees.group)]) {
      expect(m.visible).toBe(false);
    }
    TREES.value = { ...TREES.value, ENABLED: true };
    trees.refresh();
    for (const m of [...canopyMeshes(trees.group), trunkMesh(trees.group)]) {
      expect(m.visible).toBe(true);
    }
  });

  it('trunk height interpolates between MIN and MAX driven by commit age (older = taller)', () => {
    const commits = buildCommits(
      { date: '2026-01-01', files: 5 }, // oldest → max height
      { date: '2026-01-11', files: 5 }, // mid → mid height
      { date: '2026-01-21', files: 5 } // newest → min height
    );
    const placements = [placement(0, 0, 1, 0), placement(20, 0, 2, 1), placement(0, 20, 3, 2)];
    trees = renderTrees(placements, commits, BUSY);

    const trunk = trunkMesh(trees.group);
    const minH = 48;
    const maxH = 144;
    const midH = (minH + maxH) / 2;

    expect(instanceScale(trunk, 0).y).toBeCloseTo(maxH * 0.25, 3);
    expect(instanceScale(trunk, 1).y).toBeCloseTo(midH * 0.25, 3);
    expect(instanceScale(trunk, 2).y).toBeCloseTo(minH * 0.25, 3);
  });

  it('trunk XZ scale tracks per-tree canopy radius via TRUNK_RADIUS_FRAC', () => {
    const commits = buildCommits(
      { date: '2026-01-01', files: 1 }, // min files → min canopy radius
      { date: '2026-01-11', files: 5 }, // mid
      { date: '2026-01-21', files: 9 } // max files → max canopy radius
    );
    const placements = [placement(0, 0, 1, 0), placement(20, 0, 2, 1), placement(0, 20, 3, 2)];
    trees = renderTrees(placements, commits, BUSY);

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
    const commits = buildCommits(
      { date: '2026-01-01', files: 1 },
      { date: '2026-01-21', files: 9 }
    );
    const placements = [placement(0, 0, 1, 0), placement(20, 0, 2, 1)];
    trees = renderTrees(placements, commits, BUSY);
    const minR = 32 / 2;
    const maxR = 128 / 2;

    const a = findCanopyInstance(trees.group, 0);
    const b = findCanopyInstance(trees.group, 1);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(instanceScale(a!.mesh, a!.instanceIdx).x).toBeCloseTo(minR, 3);
    expect(instanceScale(b!.mesh, b!.instanceIdx).x).toBeCloseTo(maxR, 3);
  });

  it('canopy overlaps the top of the trunk by CANOPY_TRUNK_OVERLAP_FRAC', () => {
    trees = renderTrees([placement(0, 0, 1, 0)], makeCommits(1), BUSY);
    const canopy = canopyMeshes(trees.group)[0];
    const trunk = trunkMesh(trees.group);
    const canopyBaseY = instancePosition(canopy, 0).y;
    const trunkHeight = instanceScale(trunk, 0).y;
    // Default overlap=0.7 → canopy base sits at trunkH * (1 - 0.7) = 0.3 * trunkH.
    expect(canopyBaseY).toBeCloseTo(trunkHeight * 0.3, 4);
  });

  it('CANOPY_TRUNK_OVERLAP_FRAC=0 puts canopy base exactly on trunk top', () => {
    TREES.value = { ...TREES.value, CANOPY_TRUNK_OVERLAP_FRAC: 0 };
    trees = renderTrees([placement(0, 0, 1, 0)], makeCommits(1), BUSY);
    const canopy = canopyMeshes(trees.group)[0];
    const trunk = trunkMesh(trees.group);
    expect(instancePosition(canopy, 0).y).toBeCloseTo(instanceScale(trunk, 0).y, 4);
  });

  it('per-instance color interpolates between SOLO_DAY (solo day) and BUSY_DAY (busy day) by COMMITS-PER-DAY', () => {
    // Three days with 1, 2, and 4 commits. With thresholds {avg:2, busy:4}
    // the gradient anchors:
    //   - solo day (count=1)      → t=0   → COLOR_SOLO_DAY
    //   - mid day  (count=2 = avg) → t=0.5
    //   - busy day (count=4 = busy)→ t=1   → COLOR_BUSY_DAY
    const commits = buildCommits(
      { date: '2026-01-01', files: 5 }, // solo day
      { date: '2026-01-10', files: 5 }, // mid day, commit A
      { date: '2026-01-10', files: 5 }, // mid day, commit B
      { date: '2026-01-20', files: 5 }, // busy day, commit A
      { date: '2026-01-20', files: 5 }, // busy day, commit B
      { date: '2026-01-20', files: 5 }, // busy day, commit C
      { date: '2026-01-20', files: 5 } // busy day, commit D
    );
    const placements = [
      placement(0, 0, 1, 0),
      placement(20, 0, 2, 1),
      placement(40, 0, 3, 2),
      placement(0, 20, 4, 3),
      placement(20, 20, 5, 4),
      placement(40, 20, 6, 5),
      placement(60, 20, 7, 6),
    ];
    trees = renderTrees(placements, commits, { avg: 2, busy: 4 });

    const oldColor = new THREE.Color();
    const newColor = new THREE.Color();
    oldColor.setStyle('#0a2613', THREE.LinearSRGBColorSpace);
    newColor.setStyle('#a8d68a', THREE.LinearSRGBColorSpace);

    const got = new THREE.Color();
    // Solo day commit → t=0 → NEW (light).
    const solo = findCanopyInstance(trees.group, 0)!;
    solo.mesh.getColorAt(solo.instanceIdx, got);
    expect(got.r).toBeCloseTo(newColor.r, 3);
    expect(got.g).toBeCloseTo(newColor.g, 3);
    expect(got.b).toBeCloseTo(newColor.b, 3);

    // Busy day commit → t=1 → OLD (dark).
    const busy = findCanopyInstance(trees.group, 3)!;
    busy.mesh.getColorAt(busy.instanceIdx, got);
    expect(got.r).toBeCloseTo(oldColor.r, 3);
    expect(got.g).toBeCloseTo(oldColor.g, 3);
    expect(got.b).toBeCloseTo(oldColor.b, 3);

    // All commits on the same date render the same color.
    const busyA = findCanopyInstance(trees.group, 3)!;
    const busyB = findCanopyInstance(trees.group, 4)!;
    const colorA = new THREE.Color();
    const colorB = new THREE.Color();
    busyA.mesh.getColorAt(busyA.instanceIdx, colorA);
    busyB.mesh.getColorAt(busyB.instanceIdx, colorB);
    expect(colorA.r).toBeCloseTo(colorB.r, 5);
    expect(colorA.g).toBeCloseTo(colorB.g, 5);
    expect(colorA.b).toBeCloseTo(colorB.b, 5);
  });

  it('all trees render at midpoint values when commits is null', () => {
    const placements = [placement(0, 0, 1, 0), placement(20, 0, 2, 1)];
    trees = renderTrees(placements, null, BUSY);

    const trunk = trunkMesh(trees.group);
    const midH = (48 + 144) / 2;
    for (let i = 0; i < placements.length; i++) {
      expect(instanceScale(trunk, i).y).toBeCloseTo(midH * 0.25, 3);
    }
    // One shared canopy mesh holds every tree.
    const canopies = canopyMeshes(trees.group);
    expect(canopies.length).toBe(1);
    expect(canopies[0].name).toBe('tree-canopy');
  });

  it('canopy geometry carries a baked color attribute (vertex shading)', () => {
    trees = renderTrees([placement(0, 0, 1, 0)], makeCommits(1), BUSY);
    for (const m of canopyMeshes(trees.group)) {
      const colorAttr = m.geometry.getAttribute('color');
      expect(colorAttr).toBeDefined();
      expect(colorAttr.itemSize).toBe(3);
      expect(colorAttr.count).toBeGreaterThan(0);
    }
  });

  it('vertex shading strength=0 yields uniform white vertex colors', () => {
    TREES.value = { ...TREES.value, SHADING_STRENGTH: 0 };
    trees = renderTrees([placement(0, 0, 1, 0)], makeCommits(1), BUSY);
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
    trees = renderTrees([placement(0, 0, 1, 0)], makeCommits(1), BUSY);
    const meshesBefore = [...canopyMeshes(trees.group), trunkMesh(trees.group)];
    const geomsBefore = meshesBefore.map((m) => m.geometry);

    TREES.value = { ...TREES.value, COLOR_BUSY_DAY: '#000000' };
    TREES.value = { ...TREES.value, COLOR_SOLO_DAY: '#ffffff' };
    TREES.value = { ...TREES.value, TRUNK_COLOR: '#ff0000' };
    trees.refresh();

    const meshesAfter = [...canopyMeshes(trees.group), trunkMesh(trees.group)];
    for (let i = 0; i < meshesAfter.length; i++) {
      expect(meshesAfter[i]).toBe(meshesBefore[i]);
      expect(meshesAfter[i].geometry).toBe(geomsBefore[i]);
    }
  });

  it('dispose() releases geometry and materials', () => {
    trees = renderTrees([placement(0, 0, 1, 0)], makeCommits(1), BUSY);
    const tracked: Array<{ name: string; disposed: boolean }> = [];
    for (const child of trees.group.children) {
      const mesh = child as THREE.InstancedMesh;
      const entry = { name: mesh.name, disposed: false };
      tracked.push(entry);
      const origDispose = mesh.geometry.dispose.bind(mesh.geometry);
      mesh.geometry.dispose = () => {
        entry.disposed = true;
        origDispose();
      };
    }
    trees.dispose();
    for (const t of tracked) expect(t.disposed).toBe(true);
  });

  // Trees never rotate, so the diagonal elements ARE the scale directly.
  // decompose() can't be used here: three.js special-cases a zero-determinant
  // (fully zero-scaled) matrix by returning scale (1,1,1), which would mask
  // exactly the zero-scale state these tests assert on.
  function rawScaleX(mesh: THREE.InstancedMesh, i: number): number {
    const m = new THREE.Matrix4();
    mesh.getMatrixAt(i, m);
    return m.elements[0];
  }
  function rawScaleY(mesh: THREE.InstancedMesh, i: number): number {
    const m = new THREE.Matrix4();
    mesh.getMatrixAt(i, m);
    return m.elements[5];
  }

  describe('setScrubCommit()', () => {
    it('zero-scales trees past the threshold on both canopy and trunk, keeps <= threshold full', () => {
      const commits = makeCommits(4);
      const placements = [
        placement(0, 0, 1, 0),
        placement(20, 0, 2, 1),
        placement(0, 20, 3, 2),
        placement(20, 20, 4, 3),
      ];
      trees = renderTrees(placements, commits, BUSY);
      const trunk = trunkMesh(trees.group);

      const fullTrunkScale = [0, 1, 2, 3].map((i) => rawScaleY(trunk, i));
      const fullCanopyScale = [0, 1, 2, 3].map((i) => {
        const hit = findCanopyInstance(trees.group, i)!;
        return rawScaleX(hit.mesh, hit.instanceIdx);
      });
      expect(fullTrunkScale.every((s) => s > 0)).toBe(true);
      expect(fullCanopyScale.every((s) => s > 0)).toBe(true);

      trees.setScrubCommit(1);

      // commitIndex 0, 1 stay full; 2, 3 collapse to scale 0.
      expect(rawScaleY(trunk, 0)).toBeCloseTo(fullTrunkScale[0], 5);
      expect(rawScaleY(trunk, 1)).toBeCloseTo(fullTrunkScale[1], 5);
      expect(rawScaleY(trunk, 2)).toBe(0);
      expect(rawScaleY(trunk, 3)).toBe(0);

      const c0 = findCanopyInstance(trees.group, 0)!;
      const c1 = findCanopyInstance(trees.group, 1)!;
      const c2 = findCanopyInstance(trees.group, 2)!;
      const c3 = findCanopyInstance(trees.group, 3)!;
      expect(rawScaleX(c0.mesh, c0.instanceIdx)).toBeCloseTo(fullCanopyScale[0], 5);
      expect(rawScaleX(c1.mesh, c1.instanceIdx)).toBeCloseTo(fullCanopyScale[1], 5);
      expect(rawScaleX(c2.mesh, c2.instanceIdx)).toBe(0);
      expect(rawScaleX(c3.mesh, c3.instanceIdx)).toBe(0);
    });

    it('setScrubCommit(null) restores every tree to its full matrix', () => {
      const commits = makeCommits(3);
      const placements = [placement(0, 0, 1, 0), placement(20, 0, 2, 1), placement(0, 20, 3, 2)];
      trees = renderTrees(placements, commits, BUSY);
      const trunk = trunkMesh(trees.group);
      const fullScale = [0, 1, 2].map((i) => rawScaleY(trunk, i));

      trees.setScrubCommit(0);
      expect(rawScaleY(trunk, 1)).toBe(0);
      expect(rawScaleY(trunk, 2)).toBe(0);

      trees.setScrubCommit(null);
      for (let i = 0; i < 3; i++) {
        expect(rawScaleY(trunk, i)).toBeCloseTo(fullScale[i], 5);
      }
    });

    it('only rewrites instances whose visibility actually flips between calls', () => {
      const commits = makeCommits(3);
      const placements = [placement(0, 0, 1, 0), placement(20, 0, 2, 1), placement(0, 20, 3, 2)];
      trees = renderTrees(placements, commits, BUSY);
      const trunk = trunkMesh(trees.group);

      let updates = 0;
      const origSetMatrixAt = trunk.setMatrixAt.bind(trunk);
      trunk.setMatrixAt = (slot: number, m: THREE.Matrix4) => {
        updates++;
        return origSetMatrixAt(slot, m);
      };

      // Threshold 2 hides nothing (max commitIndex is 2); dropping to 1 flips only placement 2.
      trees.setScrubCommit(2);
      updates = 0;
      trees.setScrubCommit(1);
      expect(updates).toBe(1);

      // Same threshold again: nothing should flip.
      updates = 0;
      trees.setScrubCommit(1);
      expect(updates).toBe(0);
    });
  });

  describe('tree shading sun direction', () => {
    it('bakes directional facet shading (canopy vertex colors are non-uniform)', () => {
      // The sun position is now a fixed constant (constants/lighting), so we
      // verify the bake actually applies directional shading: facets pointing
      // toward vs away from the sun get different brightness. (The sun-angle →
      // direction math itself is covered by sunDir.test.)
      resetStores();
      const placements = [placement(0, 0, 1, 0)];
      const commits = buildCommits({ date: '2026-01-01', files: 1 });
      trees = renderTrees(placements, commits, BUSY);
      const canopyInst = findCanopyInstance(trees.group, 0);
      expect(canopyInst).not.toBeNull();
      const colorAttr = canopyInst!.mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
      const xs: number[] = [];
      for (let i = 0; i < colorAttr.count; i++) {
        const x = colorAttr.getX(i);
        if (!Number.isNaN(x)) xs.push(x);
      }
      trees.dispose();

      expect(xs.length).toBeGreaterThan(0);
      // Directional sun shading + vertical gradient → a real brightness spread.
      expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.001);
    });
  });
});
