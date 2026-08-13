import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { buildCanopyEdges, type Trees } from '@/city/components/trees/treeRenderer';
import type { TreePlacement } from '@/city/components/trees/treePlacement';
import { TREES } from '@/state/stores/settings/trees';
import { BUILDING_DIMENSIONS } from '@/state/stores/settings/buildings';
import { RENDER_ORDERS } from '@/city/types/renderOrders';
import { VERTS_PER_TRIANGLE } from '@/city/utils/bufferLayout';
import { commits as buildCommits, commitSeries } from '../../../_helpers/commits';
import { renderTrees } from '../../../_helpers/renderTrees';

function resetStores() {
  TREES.value = {
    ENABLED: true,
    CITY_CLEARANCE: 32,
    DENSITY_FALLOFF: 0,
    EDGE_INSET_PERCENT: 1,
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
    HALF_LIFE_DAYS: 180,
    OUTLINE_WIDTH: 1,
    OUTLINE_HOVER_COLOR: '#ffffff',
    OUTLINE_HOVER_OPACITY: 0.5,
    OUTLINE_SELECTED_OPACITY: 0.75,
  };
  BUILDING_DIMENSIONS.value = {
    MIN_FLOORS: 2,
    MAX_FLOORS: 96,
    FLOOR_HEIGHT: 16,
    FULL_HEIGHT_LINES: 2000,
    EMPTY_SLAB_FLOORS: 0.05,
    MIN_WIDTH: 8,
    MAX_WIDTH: 8,
    FULL_WIDTH_KB: 64,
    DISTANCE_FROM_ROAD: 8,
    DATA_HEIGHT_RATIO: 0.7,
  };
}

function placement(x: number, y: number, seed: number, commitIndex: number): TreePlacement {
  return { x, y, seed, commitIndex };
}

// Default busyness thresholds for color-ramp anchoring (now passed in from
// the manifest; the renderer no longer derives them).
const BUSY = { avg: 1, busy: 1 };

function chunkMeshes(group: THREE.Group): THREE.Mesh[] {
  return group.children.filter((c) => c.name === 'trees-chunk').map((c) => c as THREE.Mesh);
}

/** Locate the chunk mesh + slot rendering a given placement index. */
function findTreeSlot(
  group: THREE.Group,
  placementIdx: number
): { mesh: THREE.Mesh; slot: number } {
  for (const m of chunkMeshes(group)) {
    const order = m.userData.placementOrder as number[];
    const slot = order.indexOf(placementIdx);
    if (slot !== -1) return { mesh: m, slot };
  }
  throw new Error(`placement ${placementIdx} not found in any chunk`);
}

/** First face index of a tree's vertex range — for commitForFace round-trips. */
function firstFaceOf(mesh: THREE.Mesh, slot: number): number {
  const perTree = (mesh.userData.canopyVerts as number) + (mesh.userData.trunkVerts as number);
  return (slot * perTree) / VERTS_PER_TRIANGLE;
}

/** Min/max of one merged tree's vertex positions on an axis, split by part. */
function treeExtent(
  mesh: THREE.Mesh,
  slot: number,
  part: 'canopy' | 'trunk',
  axis: 0 | 1 | 2
): { min: number; max: number } {
  const canopyVerts = mesh.userData.canopyVerts as number;
  const trunkVerts = mesh.userData.trunkVerts as number;
  const perTree = canopyVerts + trunkVerts;
  const start = slot * perTree + (part === 'trunk' ? canopyVerts : 0);
  const count = part === 'trunk' ? trunkVerts : canopyVerts;
  const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
  let min = Infinity;
  let max = -Infinity;
  for (let v = start; v < start + count; v++) {
    const value = axis === 0 ? pos.getX(v) : axis === 1 ? pos.getY(v) : pos.getZ(v);
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return { min, max };
}

describe('createTreeRenderer()', () => {
  let trees: Trees;

  beforeEach(() => {
    resetStores();
  });

  afterEach(() => {
    trees?.dispose();
  });

  it('builds one merged chunk mesh holding every tree', () => {
    const placements = [placement(0, 0, 1, 0), placement(20, 0, 2, 1), placement(0, 20, 3, 2)];
    trees = renderTrees(placements, commitSeries(3), BUSY);
    const chunks = chunkMeshes(trees.group);
    expect(chunks.length).toBe(1);
    expect(trees.group.children.length).toBe(1);
    const perTree =
      (chunks[0].userData.canopyVerts as number) + (chunks[0].userData.trunkVerts as number);
    expect(chunks[0].geometry.getAttribute('position').count).toBe(placements.length * perTree);
  });

  it('handles an empty placement list (no chunk meshes)', () => {
    trees = renderTrees([], commitSeries(0), BUSY);
    expect(trees.group.children.length).toBe(0);
  });

  it('splits big forests into chunks and resolves lookups across the boundary', () => {
    const many = Array.from({ length: 600 }, (_, i) => placement(i, 0, i + 1, i));
    const commits = commitSeries(600);
    trees = renderTrees(many, commits, BUSY);
    // 600 trees at 512 per chunk → two chunk meshes.
    const chunks = chunkMeshes(trees.group);
    expect(chunks.length).toBe(2);
    const trees0 = (chunks[0].userData.placementOrder as number[]).length;
    const trees1 = (chunks[1].userData.placementOrder as number[]).length;
    expect(trees0 + trees1).toBe(600);
    // A tree past the boundary resolves by sha and round-trips via its face.
    const hit = trees.findTreeBySha(commits[599].sha);
    expect(hit).not.toBeNull();
    const { mesh, slot } = findTreeSlot(trees.group, hit!.instanceId);
    const back = trees.commitForFace(mesh, firstFaceOf(mesh, slot));
    expect(back?.commit.sha).toBe(commits[599].sha);
    expect(back?.placementIndex).toBe(hit!.instanceId);
  });

  it('puts chunk meshes at PARK_FOLIAGE render order with the trees meshKind', () => {
    trees = renderTrees([placement(0, 0, 1, 0)], commitSeries(1), BUSY);
    for (const m of chunkMeshes(trees.group)) {
      expect(m.renderOrder).toBe(RENDER_ORDERS.PARK_FOLIAGE);
      expect(m.userData.meshKind).toBe('trees');
    }
  });

  it('honors ENABLED visibility toggle on build', () => {
    TREES.value = { ...TREES.value, ENABLED: false };
    trees = renderTrees([placement(0, 0, 1, 0)], commitSeries(1), BUSY);
    for (const m of chunkMeshes(trees.group)) expect(m.visible).toBe(false);
  });

  it('refresh() flips visibility on ENABLED change', () => {
    trees = renderTrees([placement(0, 0, 1, 0)], commitSeries(1), BUSY);
    TREES.value = { ...TREES.value, ENABLED: false };
    trees.refresh();
    for (const m of chunkMeshes(trees.group)) expect(m.visible).toBe(false);
    TREES.value = { ...TREES.value, ENABLED: true };
    trees.refresh();
    for (const m of chunkMeshes(trees.group)) expect(m.visible).toBe(true);
  });

  // treeEncoding owns the curves; these pin that the renderer bakes them
  // into vertices at all, so the expectations are literal.
  it('writes commit-age-driven height into the trunk vertices (older = taller)', () => {
    const commits = buildCommits(
      { date: '2026-01-01', files: 5 },
      { date: '2026-01-11', files: 5 },
      { date: '2026-01-21', files: 5 }
    );
    const placements = [placement(0, 0, 1, 0), placement(20, 0, 2, 1), placement(0, 20, 3, 2)];
    trees = renderTrees(placements, commits, BUSY);

    const trunkTop = (i: number) => {
      const { mesh, slot } = findTreeSlot(trees.group, i);
      return treeExtent(mesh, slot, 'trunk', 1).max;
    };
    // Older is taller; TRUNK_HEIGHT_FRAC 0.25 of each. treeEncoding owns the
    // curve, so what is pinned here is the ordering and the fraction.
    expect(trunkTop(0)).toBeCloseTo(14.4, 3);
    expect(trunkTop(1)).toBeGreaterThan(trunkTop(2));
    expect(trunkTop(2)).toBeCloseTo(12, 3);
  });

  it('scales the trunk footprint off the canopy radius', () => {
    const commits = buildCommits(
      { date: '2026-01-01', files: 1 },
      { date: '2026-01-11', files: 5 },
      { date: '2026-01-21', files: 9 }
    );
    const placements = [placement(0, 0, 1, 0), placement(20, 0, 2, 1), placement(0, 20, 3, 2)];
    trees = renderTrees(placements, commits, BUSY);

    const trunkRadius = (i: number) => {
      const { mesh, slot } = findTreeSlot(trees.group, i);
      const ext = treeExtent(mesh, slot, 'trunk', 0);
      return (ext.max - ext.min) / 2;
    };
    // Radii 16 / 40 / 64 at TRUNK_RADIUS_FRAC 0.15.
    expect(trunkRadius(0)).toBeCloseTo(2.4, 3);
    expect(trunkRadius(1)).toBeCloseTo(6, 3);
    expect(trunkRadius(2)).toBeCloseTo(9.6, 3);
  });

  it('writes file-count-driven radius into the canopy vertices', () => {
    const commits = buildCommits(
      { date: '2026-01-01', files: 1 },
      { date: '2026-01-21', files: 9 }
    );
    const placements = [placement(0, 0, 1, 0), placement(20, 0, 2, 1)];
    trees = renderTrees(placements, commits, BUSY);

    // Measured on Z: the 6-segment lathe places vertices at sin(phi) on X
    // (no vertex at ±1) but cos(phi) on Z spans the full diameter.
    const canopyRadius = (i: number) => {
      const { mesh, slot } = findTreeSlot(trees.group, i);
      const ext = treeExtent(mesh, slot, 'canopy', 2);
      return (ext.max - ext.min) / 2;
    };
    expect(canopyRadius(0)).toBeCloseTo(16, 3);
    expect(canopyRadius(1)).toBeCloseTo(64, 3);
  });

  it('canopy overlaps the top of the trunk by CANOPY_TRUNK_OVERLAP_FRAC', () => {
    trees = renderTrees([placement(0, 0, 1, 0)], commitSeries(1), BUSY);
    const { mesh, slot } = findTreeSlot(trees.group, 0);
    const canopyBaseY = treeExtent(mesh, slot, 'canopy', 1).min;
    const trunkHeight = treeExtent(mesh, slot, 'trunk', 1).max;
    // Default overlap=0.7 → canopy base sits at trunkH * (1 - 0.7) = 0.3 * trunkH.
    expect(canopyBaseY).toBeCloseTo(trunkHeight * 0.3, 4);
  });

  it('CANOPY_TRUNK_OVERLAP_FRAC=0 puts canopy base exactly on trunk top', () => {
    TREES.value = { ...TREES.value, CANOPY_TRUNK_OVERLAP_FRAC: 0 };
    trees = renderTrees([placement(0, 0, 1, 0)], commitSeries(1), BUSY);
    const { mesh, slot } = findTreeSlot(trees.group, 0);
    expect(treeExtent(mesh, slot, 'canopy', 1).min).toBeCloseTo(
      treeExtent(mesh, slot, 'trunk', 1).max,
      4
    );
  });

  it('bakes commit-day color into canopy vertices: SOLO vs BUSY endpoints, same day = same color', () => {
    // Shading off so canopy vertex colors ARE the tree color (byte-quantized).
    TREES.value = { ...TREES.value, SHADING_STRENGTH: 0 };
    // Three days with 1, 2, and 4 commits. With thresholds {avg:2, busy:4}
    // the gradient anchors: solo day → COLOR_SOLO_DAY, busy day → COLOR_BUSY_DAY.
    const commits = buildCommits(
      { date: '2026-01-01', files: 5 }, // solo day
      { date: '2026-01-10', files: 5 }, // mid day, commit A
      { date: '2026-01-10', files: 5 }, // mid day, commit B
      { date: '2026-01-20', files: 5 }, // busy day, commit A
      { date: '2026-01-20', files: 5 }, // busy day, commit B
      { date: '2026-01-20', files: 5 }, // busy day, commit C
      { date: '2026-01-20', files: 5 } // busy day, commit D
    );
    const placements = commits.map((_, i) => placement(i * 20, 0, i + 1, i));
    trees = renderTrees(placements, commits, { avg: 2, busy: 4 });

    const vertexColor = (i: number): THREE.Color => {
      const { mesh, slot } = findTreeSlot(trees.group, i);
      const perTree = (mesh.userData.canopyVerts as number) + (mesh.userData.trunkVerts as number);
      const color = mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
      const v = slot * perTree; // first canopy vertex
      return new THREE.Color(color.getX(v), color.getY(v), color.getZ(v));
    };

    const soloColor = new THREE.Color();
    const busyColor = new THREE.Color();
    soloColor.setStyle('#a8d68a', THREE.LinearSRGBColorSpace);
    busyColor.setStyle('#0a2613', THREE.LinearSRGBColorSpace);

    // Solo day commit → COLOR_SOLO_DAY; busy day → COLOR_BUSY_DAY (bytes → 2dp).
    expect(vertexColor(0).r).toBeCloseTo(soloColor.r, 2);
    expect(vertexColor(0).g).toBeCloseTo(soloColor.g, 2);
    expect(vertexColor(0).b).toBeCloseTo(soloColor.b, 2);
    expect(vertexColor(3).r).toBeCloseTo(busyColor.r, 2);
    expect(vertexColor(3).g).toBeCloseTo(busyColor.g, 2);
    expect(vertexColor(3).b).toBeCloseTo(busyColor.b, 2);

    // All commits on the same date render the same color.
    expect(vertexColor(4).getHexString()).toBe(vertexColor(3).getHexString());
  });

  it('all trees render at midpoint values when commits is null', () => {
    const placements = [placement(0, 0, 1, 0), placement(20, 0, 2, 1)];
    trees = renderTrees(placements, null, BUSY);
    const midH = (48 + 144) / 2;
    for (let i = 0; i < placements.length; i++) {
      const { mesh, slot } = findTreeSlot(trees.group, i);
      expect(treeExtent(mesh, slot, 'trunk', 1).max).toBeCloseTo(midH * 0.25, 3);
    }
  });

  it('vertex shading strength=0 yields uniform canopy color per tree', () => {
    TREES.value = { ...TREES.value, SHADING_STRENGTH: 0 };
    trees = renderTrees([placement(0, 0, 1, 0)], commitSeries(1), BUSY);
    const { mesh, slot } = findTreeSlot(trees.group, 0);
    const canopyVerts = mesh.userData.canopyVerts as number;
    const perTree = canopyVerts + (mesh.userData.trunkVerts as number);
    const color = mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
    const base = slot * perTree;
    for (let v = base + 1; v < base + canopyVerts; v++) {
      expect(color.getX(v)).toBeCloseTo(color.getX(base), 5);
      expect(color.getY(v)).toBeCloseTo(color.getY(base), 5);
      expect(color.getZ(v)).toBeCloseTo(color.getZ(base), 5);
    }
  });

  it('default shading strength bakes a real brightness spread across facets', () => {
    trees = renderTrees([placement(0, 0, 1, 0)], commitSeries(1), BUSY);
    const { mesh, slot } = findTreeSlot(trees.group, 0);
    const canopyVerts = mesh.userData.canopyVerts as number;
    const perTree = canopyVerts + (mesh.userData.trunkVerts as number);
    const color = mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
    const base = slot * perTree;
    let min = Infinity;
    let max = -Infinity;
    for (let v = base; v < base + canopyVerts; v++) {
      min = Math.min(min, color.getX(v));
      max = Math.max(max, color.getX(v));
    }
    expect(max - min).toBeGreaterThan(0.001);
  });

  it('refresh() updates colors in place without rebuilding meshes', () => {
    trees = renderTrees([placement(0, 0, 1, 0)], commitSeries(1), BUSY);
    const meshesBefore = chunkMeshes(trees.group);
    const geomsBefore = meshesBefore.map((m) => m.geometry);
    const colorBefore = trees.colorForSha(commitSeries(1)[0].sha);

    TREES.value = { ...TREES.value, COLOR_BUSY_DAY: '#000000', COLOR_SOLO_DAY: '#ffffff' };
    trees.refresh();

    const meshesAfter = chunkMeshes(trees.group);
    for (let i = 0; i < meshesAfter.length; i++) {
      expect(meshesAfter[i]).toBe(meshesBefore[i]);
      expect(meshesAfter[i].geometry).toBe(geomsBefore[i]);
    }
    expect(trees.colorForSha(commitSeries(1)[0].sha)).not.toBe(colorBefore);
  });

  it('dispose() releases every chunk geometry', () => {
    trees = renderTrees([placement(0, 0, 1, 0)], commitSeries(1), BUSY);
    const tracked: Array<{ disposed: boolean }> = [];
    for (const mesh of chunkMeshes(trees.group)) {
      const entry = { disposed: false };
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

  describe('setScrubCommit()', () => {
    it('gates rendering via the shader uniform and picking via isScrubHidden', () => {
      const commits = commitSeries(4);
      const placements = [
        placement(0, 0, 1, 0),
        placement(20, 0, 2, 1),
        placement(0, 20, 3, 2),
        placement(20, 20, 4, 3),
      ];
      trees = renderTrees(placements, commits, BUSY);
      const material = chunkMeshes(trees.group)[0].material as THREE.ShaderMaterial;

      expect(material.uniforms.uScrubCommit.value).toBe(-1);
      for (let i = 0; i < 4; i++) expect(trees.isScrubHidden(i)).toBe(false);

      trees.setScrubCommit(1);
      expect(material.uniforms.uScrubCommit.value).toBe(1);
      expect(trees.isScrubHidden(0)).toBe(false);
      expect(trees.isScrubHidden(1)).toBe(false);
      expect(trees.isScrubHidden(2)).toBe(true);
      expect(trees.isScrubHidden(3)).toBe(true);
    });

    it('a scrub-hidden tree stops resolving through commitForFace', () => {
      const commits = commitSeries(2);
      trees = renderTrees([placement(0, 0, 1, 0), placement(20, 0, 2, 1)], commits, BUSY);
      const { mesh, slot } = findTreeSlot(trees.group, 1);
      expect(trees.commitForFace(mesh, firstFaceOf(mesh, slot))?.commit).toEqual(commits[1]);
      trees.setScrubCommit(0);
      expect(trees.commitForFace(mesh, firstFaceOf(mesh, slot))).toBeNull();
    });

    it('setScrubCommit(null) restores every tree', () => {
      const commits = commitSeries(3);
      trees = renderTrees(
        [placement(0, 0, 1, 0), placement(20, 0, 2, 1), placement(0, 20, 3, 2)],
        commits,
        BUSY
      );
      trees.setScrubCommit(0);
      expect(trees.isScrubHidden(2)).toBe(true);
      trees.setScrubCommit(null);
      for (let i = 0; i < 3; i++) expect(trees.isScrubHidden(i)).toBe(false);
      const material = chunkMeshes(trees.group)[0].material as THREE.ShaderMaterial;
      expect(material.uniforms.uScrubCommit.value).toBe(-1);
    });
  });

  // The picker's half of the handle: face → commit, and sha → tree.
  describe('commit lookups', () => {
    const seeded = (seed: number, commitIndex: number) =>
      placement(seed * 10, seed * 10, seed, commitIndex);

    it('commitForFace resolves every tree through its vertex range', () => {
      const commits = commitSeries(3);
      const placements = [seeded(0, 0), seeded(1, 1), seeded(2, 2)];
      trees = renderTrees(placements, commits, BUSY);
      for (let i = 0; i < placements.length; i++) {
        const { mesh, slot } = findTreeSlot(trees.group, i);
        const hit = trees.commitForFace(mesh, firstFaceOf(mesh, slot));
        expect(hit?.commit).toEqual(commits[placements[i].commitIndex]);
        expect(hit?.placementIndex).toBe(i);
      }
    });

    it('commitForFace returns null off the end, for null faces, and for a foreign mesh', () => {
      trees = renderTrees([seeded(0, 0)], commitSeries(1), BUSY);
      const mesh = chunkMeshes(trees.group)[0];
      const perTree = (mesh.userData.canopyVerts as number) + (mesh.userData.trunkVerts as number);
      const stranger = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
      expect(trees.commitForFace(mesh, perTree)).toBeNull(); // past the last tree
      expect(trees.commitForFace(mesh, null)).toBeNull();
      expect(trees.commitForFace(stranger, 0)).toBeNull();
    });

    it('findTreeBySha round-trips back through commitForFace', () => {
      const commits = commitSeries(3);
      trees = renderTrees([seeded(0, 0), seeded(1, 1), seeded(2, 2)], commits, BUSY);

      const got = trees.findTreeBySha(commits[1].sha);
      expect(got).not.toBeNull();
      expect(got!.commit).toEqual(commits[1]);
      expect(got!.mesh.name).toBe('trees-chunk');
      const { mesh, slot } = findTreeSlot(trees.group, got!.instanceId);
      expect(trees.commitForFace(mesh, firstFaceOf(mesh, slot))?.commit).toEqual(commits[1]);
    });

    it('colorForSha returns the tree base colour as hex', () => {
      const commits = commitSeries(3);
      trees = renderTrees([seeded(0, 0), seeded(1, 1), seeded(2, 2)], commits, BUSY);
      expect(trees.colorForSha(commits[1].sha)).toMatch(/^#[0-9a-f]{6}$/);
    });

    it('getInstanceTransform composes the canopy transform from placement data', () => {
      const commits = commitSeries(2);
      trees = renderTrees([seeded(0, 0), seeded(3, 1)], commits, BUSY);

      const out = new THREE.Matrix4();
      expect(trees.getInstanceTransform(commits[1].sha, out)).toBe(true);
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      out.decompose(pos, quat, scale);
      const bounds = trees.getTreeBoundsBySha(commits[1].sha)!;
      expect(pos.x).toBeCloseTo(bounds.x, 4);
      expect(pos.z).toBeCloseTo(bounds.z, 4);
      expect(scale.x).toBeCloseTo(bounds.radius, 4);
      expect(scale.y).toBeCloseTo(bounds.height, 4);
      // Canopy base = trunkH × (1 − overlap) with TRUNK_HEIGHT_FRAC 0.25,
      // overlap 0.7.
      expect(pos.y).toBeCloseTo(bounds.height * 0.25 * 0.3, 4);
    });

    it('getTreeBoundsBySha reports the placement position and non-zero dims', () => {
      const commits = commitSeries(3);
      trees = renderTrees([seeded(5, 0), seeded(11, 1), seeded(17, 2)], commits, BUSY);

      const bounds = trees.getTreeBoundsBySha(commits[1].sha);
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeCloseTo(110, 3);
      expect(bounds!.z).toBeCloseTo(110, 3);
      expect(bounds!.y).toBe(0);
      expect(bounds!.height).toBeGreaterThan(0);
      expect(bounds!.radius).toBeGreaterThan(0);
    });

    it.each([
      ['an unknown sha', 3, 'f'.repeat(40)],
      ['a null commit list', 0, '0'.repeat(40)],
    ])('every sha lookup returns empty for %s', (_label, n, sha) => {
      const commits = n > 0 ? commitSeries(n) : null;
      trees = renderTrees([seeded(0, 0)], commits, BUSY);
      expect(trees.findTreeBySha(sha)).toBeNull();
      expect(trees.colorForSha(sha)).toBeNull();
      expect(trees.getTreeBoundsBySha(sha)).toBeNull();
      expect(trees.getInstanceTransform(sha, new THREE.Matrix4())).toBe(false);
    });

    it('a degenerate height range leaves no NaN in the baked vertices', () => {
      TREES.value = { ...TREES.value, MIN_HEIGHT: 32, MAX_HEIGHT: 32, WIDTH_AGE_FLOOR: 0.5 };
      trees = renderTrees([seeded(0, 0), seeded(1, 1)], commitSeries(2), BUSY);
      for (const mesh of chunkMeshes(trees.group)) {
        const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
        for (let v = 0; v < pos.count; v++) {
          expect(Number.isFinite(pos.getX(v))).toBe(true);
          expect(Number.isFinite(pos.getY(v))).toBe(true);
          expect(Number.isFinite(pos.getZ(v))).toBe(true);
        }
      }
    });
  });
});

it('buildCanopyEdges returns a non-empty EdgesGeometry', () => {
  const geom = buildCanopyEdges();
  expect(geom).toBeInstanceOf(THREE.EdgesGeometry);
  expect(geom.getAttribute('position').count).toBeGreaterThan(0);
  geom.dispose();
});
