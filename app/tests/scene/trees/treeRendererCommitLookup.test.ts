// treeRendererCommitLookup.test.ts — verifies the picker-facing lookups
// on the Trees handle: commitForInstance resolves a canopy or trunk
// instance back to its CommitEntry, and findTreeBySha resolves a SHA
// forward to a canopy instance + commit.

import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { createTreeRenderer } from '@/scene/components/trees/treeRenderer';
import type { TreePlacement } from '@/scene/components/trees/treePlacement';
import { TREES } from '@/state/settings/components/trees';
import { BUILDING_DIMENSIONS } from '@/state/settings/components/buildings';
import type { CommitEntry } from '@/types';

// Busyness thresholds only affect tree COLOR; these commit-lookup tests don't
// assert color, so a default is fine.
const BUSY = { avg: 1, busy: 1 };

function resetStores() {
  TREES.value = {
    TREES_ENABLED: true,
    EDGE_INSET_PERCENT: 8,
    TREE_DENSITY_FALLOFF: 0,
    TREE_MIN_HEIGHT: 48,
    TREE_MAX_HEIGHT: 144,
    TREE_MIN_WIDTH: 32,
    TREE_MAX_WIDTH: 128,
    TREE_FACETS_LOW: 5,
    TREE_FACETS_MID: 8,
    TREE_FACETS_HIGH: 12,
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
    TREE_WIDTH_AGE_FLOOR: 1.0,
  };
  BUILDING_DIMENSIONS.value = {
    MIN_FLOORS: 2,
    MAX_FLOORS: 96,
    FLOOR_HEIGHT: 16,
    MIN_WIDTH: 8,
    MAX_WIDTH: 8,
    DISTANCE_FROM_ROAD: 8,
  };
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
    authors: [`Author ${i}`],
    subject: `commit ${i}`,
  };
}

describe('Trees commit lookups', () => {
  beforeEach(resetStores);

  it('commitForInstance returns the placement commit for a canopy instance', () => {
    const commits = [commit(0), commit(1), commit(2)];
    const placements = [placement(0, 0), placement(1, 1), placement(2, 2)];
    const trees = createTreeRenderer(placements, commits, BUSY);

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
    const trees = createTreeRenderer(placements, commits, BUSY);

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
    const trees = createTreeRenderer(placements, commits, BUSY);

    const trunk = trees.group.children.find((c) => c.name === 'tree-trunk') as THREE.InstancedMesh;
    expect(trees.commitForInstance(trunk, 42)).toBeNull();
    expect(trees.commitForInstance(trunk, -1)).toBeNull();
  });

  it('commitForInstance returns null for a mesh that is not a tree mesh', () => {
    const commits = [commit(0)];
    const placements = [placement(0, 0)];
    const trees = createTreeRenderer(placements, commits, BUSY);

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
    const trees = createTreeRenderer(placements, commits, BUSY);

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
    const trees = createTreeRenderer(placements, commits, BUSY);
    expect(trees.findTreeBySha('f'.repeat(40))).toBeNull();
  });

  it('stamps meshKind userData on canopy and trunk', () => {
    const commits = [commit(0), commit(1)];
    const placements = [placement(0, 0), placement(1, 1)];
    const trees = createTreeRenderer(placements, commits, BUSY);

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
    const trees = createTreeRenderer(placements, null, BUSY);
    const trunk = trees.group.children.find((c) => c.name === 'tree-trunk') as THREE.InstancedMesh;
    expect(trees.commitForInstance(trunk, 0)).toBeNull();
  });

  it('findTreeBySha returns null when commits is null', () => {
    const trees = createTreeRenderer([placement(0, 0)], null, BUSY);
    expect(trees.findTreeBySha('a'.repeat(40))).toBeNull();
  });

  it('colorForSha returns the canopy instanceColor for a commit', () => {
    const commits = [commit(0), commit(1), commit(2)];
    const placements = [placement(0, 0), placement(1, 1), placement(2, 2)];
    const trees = createTreeRenderer(placements, commits, BUSY);

    const color = trees.colorForSha(commits[1].sha);
    // colorForSha must return a valid CSS hex color string.
    expect(color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('colorForSha returns null for an unknown sha', () => {
    const commits = [commit(0)];
    const placements = [placement(0, 0)];
    const trees = createTreeRenderer(placements, commits, BUSY);
    expect(trees.colorForSha('f'.repeat(40))).toBeNull();
  });

  it('colorForSha returns null when commits is null', () => {
    const trees = createTreeRenderer([placement(0, 0)], null, BUSY);
    expect(trees.colorForSha('a'.repeat(40))).toBeNull();
  });

  it('getInstanceTransform writes the canopy instance matrix into the out param', () => {
    const commits = [commit(0), commit(1)];
    const placements = [placement(0, 0), placement(3, 1)];
    const trees = createTreeRenderer(placements, commits, BUSY);

    const hit = trees.findTreeBySha(commits[1].sha)!;
    const expected = new THREE.Matrix4();
    hit.mesh.getMatrixAt(hit.instanceId, expected);

    const out = new THREE.Matrix4();
    const ok = trees.getInstanceTransform(commits[1].sha, out);
    expect(ok).toBe(true);
    for (let i = 0; i < 16; i++) {
      expect(out.elements[i]).toBeCloseTo(expected.elements[i], 5);
    }
  });

  it('getInstanceTransform returns false for unknown sha', () => {
    const commits = [commit(0)];
    const placements = [placement(0, 0)];
    const trees = createTreeRenderer(placements, commits, BUSY);
    const out = new THREE.Matrix4();
    expect(trees.getInstanceTransform('f'.repeat(40), out)).toBe(false);
  });

  it('TREE_WIDTH_AGE_FLOOR = 1.0 preserves file-driven canopy width unchanged', () => {
    // Two commits, same file count, different ages. With floor=1.0 the
    // attenuation is constant 1, so both trees should have the same
    // canopy XZ scale.
    TREES.value = { ...TREES.value, TREE_WIDTH_AGE_FLOOR: 1.0 };
    const commits = [commit(0), commit(1)];
    // Force same file count so file-driven radius matches.
    commits[0].files = 5;
    commits[1].files = 5;
    const placements = [placement(0, 0), placement(1, 1)];
    const trees = createTreeRenderer(placements, commits, BUSY);

    const hit0 = trees.findTreeBySha(commits[0].sha)!;
    const hit1 = trees.findTreeBySha(commits[1].sha)!;
    const m0 = new THREE.Matrix4();
    const m1 = new THREE.Matrix4();
    hit0.mesh.getMatrixAt(hit0.instanceId, m0);
    hit1.mesh.getMatrixAt(hit1.instanceId, m1);
    const s0 = new THREE.Vector3();
    const s1 = new THREE.Vector3();
    m0.decompose(new THREE.Vector3(), new THREE.Quaternion(), s0);
    m1.decompose(new THREE.Vector3(), new THREE.Quaternion(), s1);

    expect(s0.x).toBeCloseTo(s1.x, 3);
    expect(s0.z).toBeCloseTo(s1.z, 3);
  });

  it('TREE_WIDTH_AGE_FLOOR = 0.5 halves the shortest tree canopy width', () => {
    // Three commits, same file count. With ageT mapping oldest→0, newest→1,
    // the renderer assigns commits[2] (newest) min height (heightRatio=0)
    // → attenuation = 0.5; commits[0] (oldest) max height (heightRatio=1)
    // → attenuation = 1.
    TREES.value = { ...TREES.value, TREE_WIDTH_AGE_FLOOR: 0.5 };
    const commits = [commit(0), commit(1), commit(2)];
    for (const c of commits) c.files = 5;
    const placements = [placement(0, 0), placement(1, 1), placement(2, 2)];
    const trees = createTreeRenderer(placements, commits, BUSY);

    // Find the oldest (commits[0]) and newest (commits[2]) trees.
    const oldHit = trees.findTreeBySha(commits[0].sha)!;
    const newHit = trees.findTreeBySha(commits[2].sha)!;
    const mOld = new THREE.Matrix4();
    const mNew = new THREE.Matrix4();
    oldHit.mesh.getMatrixAt(oldHit.instanceId, mOld);
    newHit.mesh.getMatrixAt(newHit.instanceId, mNew);
    const sOld = new THREE.Vector3();
    const sNew = new THREE.Vector3();
    mOld.decompose(new THREE.Vector3(), new THREE.Quaternion(), sOld);
    mNew.decompose(new THREE.Vector3(), new THREE.Quaternion(), sNew);

    // Newest tree width should be ~50% of oldest tree width.
    expect(sNew.x).toBeCloseTo(sOld.x * 0.5, 2);
    expect(sNew.z).toBeCloseTo(sOld.z * 0.5, 2);
  });

  it('TREE_WIDTH_AGE_FLOOR = 0.0 produces near-zero width on shortest tree', () => {
    TREES.value = { ...TREES.value, TREE_WIDTH_AGE_FLOOR: 0.0 };
    const commits = [commit(0), commit(1), commit(2)];
    for (const c of commits) c.files = 5;
    const placements = [placement(0, 0), placement(1, 1), placement(2, 2)];
    const trees = createTreeRenderer(placements, commits, BUSY);

    const oldHit = trees.findTreeBySha(commits[0].sha)!;
    const newHit = trees.findTreeBySha(commits[2].sha)!;
    const mOld = new THREE.Matrix4();
    const mNew = new THREE.Matrix4();
    oldHit.mesh.getMatrixAt(oldHit.instanceId, mOld);
    newHit.mesh.getMatrixAt(newHit.instanceId, mNew);
    const sOld = new THREE.Vector3();
    const sNew = new THREE.Vector3();
    mOld.decompose(new THREE.Vector3(), new THREE.Quaternion(), sOld);
    mNew.decompose(new THREE.Vector3(), new THREE.Quaternion(), sNew);

    // Newest tree should be at least 10× narrower than oldest.
    expect(sNew.x * 10).toBeLessThan(sOld.x);
    expect(sNew.z * 10).toBeLessThan(sOld.z);
  });

  it('getTreeBoundsBySha returns position + dims for a known sha', () => {
    resetStores();
    const commits = [commit(0), commit(1), commit(2)];
    const placements = [placement(5, 0), placement(11, 1), placement(17, 2)];
    const trees = createTreeRenderer(placements, commits, BUSY);

    const bounds = trees.getTreeBoundsBySha(commits[1].sha);
    expect(bounds).not.toBeNull();
    // Placement seed=11 lands the tree at (110, 110) in XZ.
    expect(bounds!.x).toBeCloseTo(110, 3);
    expect(bounds!.z).toBeCloseTo(110, 3);
    expect(bounds!.y).toBe(0);
    expect(bounds!.height).toBeGreaterThan(0);
    expect(bounds!.radius).toBeGreaterThan(0);
  });

  it('getTreeBoundsBySha returns null for an unknown sha', () => {
    resetStores();
    const commits = [commit(0), commit(1)];
    const placements = [placement(3, 0), placement(7, 1)];
    const trees = createTreeRenderer(placements, commits, BUSY);
    expect(trees.getTreeBoundsBySha('f'.repeat(40))).toBeNull();
  });

  it('getTreeBoundsBySha returns null when commits is null', () => {
    resetStores();
    const placements = [placement(3, 0)];
    const trees = createTreeRenderer(placements, null, BUSY);
    expect(trees.getTreeBoundsBySha('a'.repeat(40))).toBeNull();
  });

  it('degenerate height range (min == max) does not produce NaN canopy matrices', () => {
    // When TREE_MIN_HEIGHT == TREE_MAX_HEIGHT, the heightRatio computation
    // would divide by zero without a clamp. Verify the renderer constructs
    // and all canopy instance matrix elements stay finite.
    TREES.value = { ...TREES.value, TREE_MIN_HEIGHT: 32 };
    TREES.value = { ...TREES.value, TREE_MAX_HEIGHT: 32 };
    TREES.value = { ...TREES.value, TREE_WIDTH_AGE_FLOOR: 0.5 };
    const commits = [commit(0), commit(1)];
    const placements = [placement(0, 0), placement(1, 1)];
    const trees = createTreeRenderer(placements, commits, BUSY);

    const canopies = trees.group.children.filter((c) =>
      c.name.startsWith('tree-canopy-')
    ) as THREE.InstancedMesh[];
    expect(canopies.length).toBeGreaterThan(0);

    const m = new THREE.Matrix4();
    for (const canopy of canopies) {
      for (let k = 0; k < canopy.count; k++) {
        canopy.getMatrixAt(k, m);
        for (let i = 0; i < 16; i++) {
          expect(Number.isFinite(m.elements[i])).toBe(true);
        }
      }
    }
  });
});

it('buildCanopyEdges returns non-empty EdgesGeometry for each detail level', async () => {
  const { buildCanopyEdges } = await import('@/scene/components/trees/treeRenderer.js');
  for (const detail of [0, 1, 2] as const) {
    const geom = buildCanopyEdges(detail);
    expect(geom).toBeInstanceOf(THREE.EdgesGeometry);
    const positions = geom.getAttribute('position');
    expect(positions).toBeDefined();
    expect(positions.count).toBeGreaterThan(0);
    geom.dispose();
  }
});
