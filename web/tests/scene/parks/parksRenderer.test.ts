// parksRenderer.test.ts — verifies createParksRenderer() produces the
// four foliage InstancedMeshes (tree canopies + trunks + bushes +
// flowers — no ground mesh, by design) with the right instance counts
// derived from the input ParkPlacement[], that refresh() pushes fresh
// palette + emission values into the shared materials without
// rebuilding the meshes, and that dispose() releases all GPU resources.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { createParksRenderer, type Parks } from '@/scene/parks/parksRenderer.js';
import type { ParkPlacement } from '@/scene/parks/parksPlacement.js';
import { PARKS, PARKS_PALETTE } from '@/config/parks.js';
import { BUILDING_DIMENSIONS } from '@/config/building.js';
import { RENDER_ORDERS } from '@/constants';

function resetStores() {
  PARKS.set({
    ENABLED: true,
    DENSITY_PERCENT: 100,
    CITY_DENSITY_PERCENT: 100,
    GRADIENT_REACH_PERCENT: 40,
    MIX_TREE_FRAC: 0.65,
    MIX_BUSH_FRAC: 0.25,
    MIX_FLOWER_FRAC: 0.10,
    SCATTER_FOOTPRINT_FRAC_OF_MAX_WIDTH: 0.5,
    TREE_HEIGHT_FLOORS: 6,
    TREE_RADIUS_FRAC_OF_HEIGHT: 0.3,
    BUSH_RADIUS_FRAC_OF_TREE: 0.4,
    FLOWER_SIZE_FRAC_OF_TREE: 0.08,
    FLOWERS_PER_BUSH: 4,
    FLOWERS_PER_CLUSTER: 8,
  });
  PARKS_PALETTE.set({
    GROUND_ENABLED: true,
    GROUND_COLOR: '#0c1814',
    TREES_ENABLED: true,
    BUSHES_ENABLED: true,
    FLOWERS_ENABLED: true,
    TREE_GREENS: ['#2a6a4a', '#3a7a3a', '#4a8a4a', '#1f5a2f'],
    TREE_TRUNK_COLOR: '#4a3220',
    BUSH_NEON_COLORS: ['#00ff88', '#ff2bd6', '#b400ff', '#00d9ff', '#ffd400'],
    BUSH_EMISSION_BOOST: 1.5,
    FLOWER_COLORS: ['#ff2bd6', '#ffd400', '#00d9ff', '#00ff88', '#b400ff'],
    FLOWER_EMISSION_BOOST: 1.8,
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

function plot(
  x: number, y: number, seed: number,
  treeCount: number, bushCount: number, flowerCount: number,
  kind: 'tree' | 'bush' | 'flower-cluster' = 'tree',
): ParkPlacement {
  return { x, y, seed, kind, treeCount, bushCount, flowerCount };
}

function findMesh(group: THREE.Group, name: string): THREE.InstancedMesh {
  const m = group.children.find((c) => c.name === name);
  if (!m) throw new Error(`expected child '${name}' on parks group`);
  return m as THREE.InstancedMesh;
}

describe('createParksRenderer()', () => {
  let parks: Parks;

  beforeEach(() => {
    resetStores();
  });

  afterEach(() => {
    parks?.dispose();
  });

  it('builds a group of four named foliage InstancedMeshes (no ground mesh)', () => {
    parks = createParksRenderer([plot(0, 0, 1, 1, 0, 0)]);
    const names = parks.group.children.map((c) => c.name).sort();
    expect(names).toEqual([
      'parks-bushes',
      'parks-flowers',
      'parks-tree-canopy',
      'parks-tree-trunk',
    ]);
    for (const child of parks.group.children) {
      expect((child as THREE.InstancedMesh).isInstancedMesh).toBe(true);
    }
  });

  it('instance counts match the placement-summed totals', () => {
    const placements = [
      plot(0, 0, 1, 1, 0, 0, 'tree'),
      plot(20, 0, 2, 1, 0, 0, 'tree'),
      plot(0, 20, 3, 0, 1, 4, 'bush'),
      plot(40, 0, 4, 0, 0, 8, 'flower-cluster'),
    ];
    parks = createParksRenderer(placements);
    // trees: 1+1 = 2 canopies AND 2 trunks.
    expect(findMesh(parks.group, 'parks-tree-canopy').count).toBe(2);
    expect(findMesh(parks.group, 'parks-tree-trunk').count).toBe(2);
    // bushes: 0+0+1+0 = 1.
    expect(findMesh(parks.group, 'parks-bushes').count).toBe(1);
    // flowers: 0+0+4+8 = 12.
    expect(findMesh(parks.group, 'parks-flowers').count).toBe(12);
  });

  it('handles an empty placement list', () => {
    parks = createParksRenderer([]);
    for (const child of parks.group.children) {
      expect((child as THREE.InstancedMesh).count).toBe(0);
    }
  });

  it('puts foliage meshes at PARK_FOLIAGE render order', () => {
    parks = createParksRenderer([plot(0, 0, 1, 1, 1, 4, 'bush')]);
    for (const name of ['parks-tree-canopy', 'parks-tree-trunk', 'parks-bushes', 'parks-flowers']) {
      expect(findMesh(parks.group, name).renderOrder).toBe(RENDER_ORDERS.PARK_FOLIAGE);
    }
  });

  it('refresh() updates the bush emission uniform on PARKS_PALETTE change', () => {
    parks = createParksRenderer([plot(0, 0, 1, 0, 1, 0, 'bush')]);
    const bushes = findMesh(parks.group, 'parks-bushes');
    const mat = bushes.material as THREE.ShaderMaterial;
    PARKS_PALETTE.setKey('BUSH_EMISSION_BOOST', 4.2);
    parks.refresh();
    expect(mat.uniforms.uEmissionBoost.value).toBeCloseTo(4.2);
  });

  it('honors per-mesh visibility toggles in PARKS_PALETTE on build', () => {
    PARKS_PALETTE.setKey('TREES_ENABLED', false);
    PARKS_PALETTE.setKey('FLOWERS_ENABLED', false);
    parks = createParksRenderer([plot(0, 0, 1, 1, 1, 4, 'bush')]);
    expect(findMesh(parks.group, 'parks-tree-canopy').visible).toBe(false);
    expect(findMesh(parks.group, 'parks-tree-trunk').visible).toBe(false);
    expect(findMesh(parks.group, 'parks-flowers').visible).toBe(false);
    expect(findMesh(parks.group, 'parks-bushes').visible).toBe(true);
  });

  it('refresh() flips per-mesh visibility on PARKS_PALETTE toggles', () => {
    parks = createParksRenderer([plot(0, 0, 1, 1, 1, 0, 'bush')]);
    PARKS_PALETTE.setKey('BUSHES_ENABLED', false);
    parks.refresh();
    expect(findMesh(parks.group, 'parks-bushes').visible).toBe(false);
    expect(findMesh(parks.group, 'parks-tree-canopy').visible).toBe(true);
    PARKS_PALETTE.setKey('BUSHES_ENABLED', true);
    parks.refresh();
    expect(findMesh(parks.group, 'parks-bushes').visible).toBe(true);
  });

  it('refresh() hides the group when PARKS.ENABLED is false', () => {
    parks = createParksRenderer([plot(0, 0, 1, 1, 1, 0, 'bush')]);
    expect(parks.group.visible).toBe(true);
    PARKS.setKey('ENABLED', false);
    parks.refresh();
    expect(parks.group.visible).toBe(false);
    PARKS.setKey('ENABLED', true);
    parks.refresh();
    expect(parks.group.visible).toBe(true);
  });

  it('dispose() releases geometry and materials on every child', () => {
    parks = createParksRenderer([plot(0, 0, 1, 1, 1, 0, 'bush')]);
    const sentinels: Array<{ geom: boolean; mat: boolean }> = [];
    for (const child of parks.group.children) {
      const mesh = child as THREE.InstancedMesh;
      const s = { geom: false, mat: false };
      sentinels.push(s);
      const origGeomDispose = mesh.geometry.dispose.bind(mesh.geometry);
      mesh.geometry.dispose = () => { s.geom = true; origGeomDispose(); };
      const mat = mesh.material as THREE.Material;
      const origMatDispose = mat.dispose.bind(mat);
      mat.dispose = () => { s.mat = true; origMatDispose(); };
    }
    parks.dispose();
    for (const s of sentinels) {
      expect(s.geom).toBe(true);
      expect(s.mat).toBe(true);
    }
  });
});
