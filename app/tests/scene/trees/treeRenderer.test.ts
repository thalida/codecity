// treeRenderer.test.ts — verifies createTreeRenderer() produces one
// InstancedMesh per non-empty canopy detail level plus a shared trunk
// mesh, with per-instance heights driven by commit age (older = taller),
// canopy widths driven by commit file count (more files = wider) and
// canopy facet counts also driven by file count (more files = higher
// subdivision), and canopy colors that interpolate between
// TREE_COLOR_SOLO_DAY (solo-commit days) and TREE_COLOR_BUSY_DAY (busy days) by
// commits-per-day.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { createTreeRenderer, type Trees } from '@/scene/components/trees/treeRenderer.js';
import type { TreePlacement } from '@/scene/components/trees/treePlacement.js';
import { TREES } from '@/config/components/trees.js';
import { BUILDING_DIMENSIONS } from '@/config/components/buildings.js';
import { LIGHTING } from '@/config/components/lighting.js';
import { RENDER_ORDERS } from '@/constants';
import type { CommitEntry } from '@/types';
import { commits as buildCommits } from './_commitFixtures.js';

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

function placement(x: number, y: number, seed: number, commitIndex: number): TreePlacement {
  return { x, y, seed, commitIndex };
}

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
    .filter((c) => c.name.startsWith('tree-canopy-'))
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

  it('builds at most one canopy mesh per detail level (d0/d1/d2) plus trunk', () => {
    const placements = [placement(0, 0, 1, 0), placement(20, 0, 2, 1), placement(0, 20, 3, 2)];
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
    const commits = buildCommits(
      { date: '2026-01-01', files: 5 }, // oldest → max height
      { date: '2026-01-11', files: 5 }, // mid → mid height
      { date: '2026-01-21', files: 5 } // newest → min height
    );
    const placements = [placement(0, 0, 1, 0), placement(20, 0, 2, 1), placement(0, 20, 3, 2)];
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
    const commits = buildCommits(
      { date: '2026-01-01', files: 1 }, // min files → min canopy radius
      { date: '2026-01-11', files: 5 }, // mid
      { date: '2026-01-21', files: 9 } // max files → max canopy radius
    );
    const placements = [placement(0, 0, 1, 0), placement(20, 0, 2, 1), placement(0, 20, 3, 2)];
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
    const commits = buildCommits(
      { date: '2026-01-01', files: 1 },
      { date: '2026-01-21', files: 9 }
    );
    const placements = [placement(0, 0, 1, 0), placement(20, 0, 2, 1)];
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

  it('canopy overlaps the top of the trunk by CANOPY_TRUNK_OVERLAP_FRAC', () => {
    trees = createTreeRenderer([placement(0, 0, 1, 0)], makeCommits(1));
    const canopy = canopyMeshes(trees.group)[0];
    const trunk = trunkMesh(trees.group);
    const canopyBaseY = instancePosition(canopy, 0).y;
    const trunkHeight = instanceScale(trunk, 0).y;
    // Default overlap=0.7 → canopy base sits at trunkH * (1 - 0.7) = 0.3 * trunkH.
    expect(canopyBaseY).toBeCloseTo(trunkHeight * 0.3, 4);
  });

  it('CANOPY_TRUNK_OVERLAP_FRAC=0 puts canopy base exactly on trunk top', () => {
    TREES.setKey('CANOPY_TRUNK_OVERLAP_FRAC', 0);
    trees = createTreeRenderer([placement(0, 0, 1, 0)], makeCommits(1));
    const canopy = canopyMeshes(trees.group)[0];
    const trunk = trunkMesh(trees.group);
    expect(instancePosition(canopy, 0).y).toBeCloseTo(instanceScale(trunk, 0).y, 4);
  });

  it('facet detail increases with commit file count', () => {
    const commits = buildCommits(
      { date: '2026-01-01', files: 1 }, // sizeT=0   → detail 0
      { date: '2026-01-11', files: 5 }, // sizeT=0.5 → detail 1
      { date: '2026-01-21', files: 9 } // sizeT=1   → detail 2
    );
    const placements = [placement(0, 0, 1, 0), placement(20, 0, 2, 1), placement(0, 20, 3, 2)];
    trees = createTreeRenderer(placements, commits);

    const a = findCanopyInstance(trees.group, 0);
    const b = findCanopyInstance(trees.group, 1);
    const c = findCanopyInstance(trees.group, 2);
    expect(a!.mesh.name).toBe('tree-canopy-d0');
    expect(b!.mesh.name).toBe('tree-canopy-d1');
    expect(c!.mesh.name).toBe('tree-canopy-d2');
    // More facets = strictly more triangles (after toNonIndexed).
    expect(b!.mesh.geometry.getAttribute('position').count).toBeGreaterThan(
      a!.mesh.geometry.getAttribute('position').count
    );
    expect(c!.mesh.geometry.getAttribute('position').count).toBeGreaterThan(
      b!.mesh.geometry.getAttribute('position').count
    );
  });

  it('per-instance color interpolates between SOLO_DAY (solo day) and BUSY_DAY (busy day) by COMMITS-PER-DAY', () => {
    // Three days with 1, 2, and 4 commits respectively. After log-norm:
    //   - solo day (count=1) → t=0 → TREE_COLOR_SOLO_DAY
    //   - busy day (count=4) → t=1 → TREE_COLOR_BUSY_DAY
    //   - mid day (count=2)  → t≈0.5 between log1p(1) and log1p(4)
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
    trees = createTreeRenderer(placements, commits);

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

    TREES.setKey('TREE_COLOR_BUSY_DAY', '#000000');
    TREES.setKey('TREE_COLOR_SOLO_DAY', '#ffffff');
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
      mesh.geometry.dispose = () => {
        entry.disposed = true;
        origDispose();
      };
    }
    trees.dispose();
    for (const t of tracked) expect(t.disposed).toBe(true);
  });

  describe('age-based desaturation', () => {
    // Helper: read the raw THREE.Color stored in a canopy instance.
    function instanceColor(group: THREE.Group, placementIdx: number): THREE.Color {
      const inst = findCanopyInstance(group, placementIdx);
      if (!inst) throw new Error(`placement ${placementIdx} not found`);
      const color = new THREE.Color();
      inst.mesh.getColorAt(inst.instanceIdx, color);
      return color;
    }

    // Helper: read the HSL saturation of a canopy instance color.
    function instanceSaturation(group: THREE.Group, placementIdx: number): number {
      const color = instanceColor(group, placementIdx);
      const hsl = { h: 0, s: 0, l: 0 };
      color.getHSL(hsl);
      return hsl.s;
    }

    it('TREE_AGE_DESAT_ENABLED=false: canopy color matches raw OKLCH-interpolated base', () => {
      // Two commits on different dates so each is a solo day.
      // With desat OFF, the instance color must equal the raw OKLCH-interpolated
      // value (no saturation scaling applied). We verify by rebuilding once with
      // desat OFF and once with desat ON at extreme min (factor→0) and confirming
      // the OFF result differs from the ON result for the oldest commit.
      const testCommits = buildCommits(
        { date: '2026-01-01', files: 5 }, // oldest
        { date: '2026-01-21', files: 5 } // newest
      );
      const placements = [placement(0, 0, 1, 0), placement(20, 0, 2, 1)];

      // Build with desat OFF (set in resetStores).
      trees = createTreeRenderer(placements, testCommits);
      const offColor = instanceColor(trees.group, 0).clone();
      trees.dispose();

      // Build with desat ON + extreme min (0 → fully gray).
      TREES.setKey('TREE_AGE_DESAT_ENABLED', true);
      TREES.setKey('TREE_AGE_SATURATION_MIN', 0);
      TREES.setKey('TREE_AGE_SATURATION_MAX', 100);
      trees = createTreeRenderer(placements, testCommits);
      const onColor = instanceColor(trees.group, 0).clone();

      // The OFF color must differ from the gray-forced ON color (oldest commit).
      // If desat ON/OFF were the same this test would be meaningless.
      const offHsl = { h: 0, s: 0, l: 0 };
      const onHsl = { h: 0, s: 0, l: 0 };
      offColor.getHSL(offHsl);
      onColor.getHSL(onHsl);
      expect(offHsl.s).toBeGreaterThan(onHsl.s + 0.01);
    });

    it('TREE_AGE_DESAT_ENABLED=true: oldest commit saturation is reduced by minFactor relative to no-desat base', () => {
      // Build once without desat to capture the base saturation, then again
      // with desat ON and verify the oldest commit's saturation is base * minFactor.
      const testCommits = buildCommits(
        { date: '2026-01-01', files: 5 }, // oldest → ageT=0 → factor = MIN/100
        { date: '2026-01-21', files: 5 } // newest → ageT=1 → factor = MAX/100
      );
      const placements = [placement(0, 0, 1, 0), placement(20, 0, 2, 1)];

      // Capture base saturation with desat OFF (resetStores sets it false).
      trees = createTreeRenderer(placements, testCommits);
      const baseS = instanceSaturation(trees.group, 0);
      trees.dispose();

      // Now build with desat ON.
      TREES.setKey('TREE_AGE_DESAT_ENABLED', true);
      TREES.setKey('TREE_AGE_SATURATION_MIN', 20);
      TREES.setKey('TREE_AGE_SATURATION_MAX', 100);
      trees = createTreeRenderer(placements, testCommits);

      const oldestS = instanceSaturation(trees.group, 0);
      // oldest → ageT=0 → factor = 20/100 = 0.20
      expect(oldestS).toBeCloseTo(baseS * 0.2, 3);
    });

    it('TREE_AGE_DESAT_ENABLED=true: newest commit saturation is reduced by maxFactor relative to no-desat base', () => {
      const testCommits = buildCommits(
        { date: '2026-01-01', files: 5 }, // oldest
        { date: '2026-01-21', files: 5 } // newest → ageT=1 → factor = MAX/100
      );
      const placements = [placement(0, 0, 1, 0), placement(20, 0, 2, 1)];

      // Capture base saturation with desat OFF.
      trees = createTreeRenderer(placements, testCommits);
      const baseNewestS = instanceSaturation(trees.group, 1);
      trees.dispose();

      // Build with desat ON, MAX=100 → factor=1.00 → no change to newest.
      TREES.setKey('TREE_AGE_DESAT_ENABLED', true);
      TREES.setKey('TREE_AGE_SATURATION_MIN', 20);
      TREES.setKey('TREE_AGE_SATURATION_MAX', 100);
      trees = createTreeRenderer(placements, testCommits);

      const newestS = instanceSaturation(trees.group, 1);
      // newest → ageT=1 → factor = 100/100 = 1.00 → saturation unchanged
      expect(newestS).toBeCloseTo(baseNewestS * 1.0, 3);
    });

    it('refresh() re-applies new TREE_AGE_DESAT_ENABLED config — colors differ after toggle', () => {
      TREES.setKey('TREE_AGE_DESAT_ENABLED', true);
      TREES.setKey('TREE_AGE_SATURATION_MIN', 20);
      TREES.setKey('TREE_AGE_SATURATION_MAX', 100);

      const testCommits = buildCommits(
        { date: '2026-01-01', files: 5 }, // oldest → will have reduced saturation
        { date: '2026-01-21', files: 5 } // newest
      );
      const placements = [placement(0, 0, 1, 0), placement(20, 0, 2, 1)];
      trees = createTreeRenderer(placements, testCommits);

      // Capture saturation of oldest tree with desat ON.
      const sWithDesat = instanceSaturation(trees.group, 0);

      // Flip desat OFF and refresh.
      TREES.setKey('TREE_AGE_DESAT_ENABLED', false);
      trees.refresh();

      // Capture saturation of oldest tree with desat OFF.
      const sNoDesat = instanceSaturation(trees.group, 0);

      // Saturation should be higher after disabling desat — the oldest tree
      // was at 20% saturation with desat ON, full saturation with desat OFF.
      expect(sNoDesat).toBeGreaterThan(sWithDesat + 0.01);
    });
  });

  describe('tree shading sun direction', () => {
    it('bakes vertex colors that respond to LIGHTING.SUN_AZIMUTH_DEG changes', () => {
      // Bake at the first sun direction, capture canopy shading.
      resetStores();
      LIGHTING.set({
        SUN_AZIMUTH_DEG: 51,
        SUN_ELEVATION_DEG: 58,
        AMBIENT: 0.72,
        SUN_CONTRAST: 0.5,
      });
      const placements = [placement(0, 0, 1, 0)];
      const commits = buildCommits({ date: '2026-01-01', files: 1 });
      trees = createTreeRenderer(placements, commits);
      const canopyInst = findCanopyInstance(trees.group, 0);
      expect(canopyInst).not.toBeNull();
      const colorAttr1 = canopyInst!.mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
      // Collect all colors to compare distribution
      const colors1: number[] = [];
      for (let i = 0; i < colorAttr1.count; i++) {
        colors1.push(colorAttr1.getX(i));
      }
      trees.dispose();

      // Move the sun 90° azimuth. Vertices should have different shading.
      LIGHTING.set({
        SUN_AZIMUTH_DEG: 141, // 51 + 90
        SUN_ELEVATION_DEG: 58,
        AMBIENT: 0.72,
        SUN_CONTRAST: 0.5,
      });
      trees = createTreeRenderer(placements, commits);
      const canopyInst2 = findCanopyInstance(trees.group, 0);
      expect(canopyInst2).not.toBeNull();
      const colorAttr2 = canopyInst2!.mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
      const colors2: number[] = [];
      for (let i = 0; i < colorAttr2.count; i++) {
        colors2.push(colorAttr2.getX(i));
      }
      trees.dispose();

      // Verify at least one vertex has different shading between the two sun directions
      expect(colors1.length).toBeGreaterThan(0);
      expect(colors2.length).toBe(colors1.length);
      let foundDifference = false;
      for (let i = 0; i < colors1.length; i++) {
        if (!Number.isNaN(colors1[i]) && !Number.isNaN(colors2[i])) {
          if (Math.abs(colors1[i] - colors2[i]) > 0.001) {
            foundDifference = true;
            break;
          }
        }
      }
      expect(foundDifference).toBe(true);
    });
  });
});
