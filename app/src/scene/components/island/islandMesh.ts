// scene/island/islandMesh.ts — Public API for the floating-island
// world-plane module. Replaces createWorldFloor() (worldFloor.ts).
//
// Lifecycle:
//   const island = createIsland(null);
//   scene.add(island.group);
//   island.setBounds(getWorldBounds(bbox)); // when layout (re)computes
//   island.refresh();                       // on every applyTheme()
//   island.dispose();

import * as THREE from 'three';
import { ISLAND } from '@/state/settings/island';
import { getWorldBounds, type WorldBounds } from '@/scene/layout/worldBounds';
import { buildIslandGeometry, type IslandBuildParams } from './islandGeometry';
import { createIslandMaterial } from './islandShader';
import { RENDER_ORDERS } from '@/scene/renderOrders';

const ISLAND_TOP_Y = -2.0; // Increased from -0.5 for z-fighting prevention (4x separation from city y=0)

export interface Island {
  group: THREE.Group;
  /** Rebuild geometry and reposition group to fit the given bounds. */
  setBounds(bounds: WorldBounds): void;
  /** Pull fresh values from config stores; called on Save via applyTheme(). */
  refresh(): void;
  /** Per-frame tick: no-op for the island (hemispheric lighting is static). */
  tick(): void;
  dispose(): void;
}

function buildParams(bounds: WorldBounds, seedFromBounds: number): IslandBuildParams {
  const g = ISLAND.value;
  return {
    sides: g.SIDES,
    irregularity: g.IRREGULARITY,
    tiers: g.TIERS,
    depth: g.DEPTH,
    halfWidth: bounds.halfWidth,
    halfDepth: bounds.halfDepth,
    seed: seedFromBounds,
    roundness: g.ROUNDNESS,
    grassThickness: g.GRASS_THICKNESS,
  };
}

// Stable seed from bounds so the same repo always gets the same silhouette.
// Exported so tree placement (running in a worker) can rebuild the identical
// polygon without reaching into islandMesh's private state.
export function islandSeedFromBounds(b: WorldBounds): number {
  const x = Math.round(b.cx * 1000) | 0;
  const z = Math.round(b.cz * 1000) | 0;
  const w = Math.round(b.halfWidth * 1000) | 0;
  const d = Math.round(b.halfDepth * 1000) | 0;
  // Mix with multiply-then-shift hash.
  let h = x * 73856093;
  h = (h ^ (z * 19349663)) | 0;
  h = (h ^ (w * 83492791)) | 0;
  h = (h ^ (d * 9176)) | 0;
  return h >>> 0;
}

export function createIsland(initialBounds: WorldBounds | null): Island {
  let currentBounds = initialBounds ?? getWorldBounds(null);
  const group = new THREE.Group();
  group.position.set(currentBounds.cx, ISLAND_TOP_Y, currentBounds.cz);
  group.visible = ISLAND.value.ENABLED;

  // Island mesh.
  let params = buildParams(currentBounds, islandSeedFromBounds(currentBounds));
  const mats = ISLAND.value;
  let geometry = buildIslandGeometry(params, {
    GRASS: mats.GRASS_COLOR,
    GRASS_SIDE: mats.GRASS_SIDE_COLOR,
    ROCK: mats.ROCK_COLOR,
  });
  const material = createIslandMaterial();
  const islandMesh = new THREE.Mesh(geometry, material);
  islandMesh.renderOrder = RENDER_ORDERS.VALLEY_FLOOR;
  islandMesh.frustumCulled = false;
  islandMesh.userData.island = 'islandMesh';
  group.add(islandMesh);

  function setBounds(newBounds: WorldBounds): void {
    currentBounds = newBounds;
    geometry.dispose();
    params = buildParams(currentBounds, islandSeedFromBounds(currentBounds));
    const m = ISLAND.value;
    geometry = buildIslandGeometry(params, {
      GRASS: m.GRASS_COLOR,
      GRASS_SIDE: m.GRASS_SIDE_COLOR,
      ROCK: m.ROCK_COLOR,
    });
    islandMesh.geometry = geometry;
    group.position.set(currentBounds.cx, ISLAND_TOP_Y, currentBounds.cz);
  }

  function refresh(): void {
    // Geometry colors changed → rebuild (vertex colors are baked into the
    // geometry, not pushed through uniforms). This is cheap for ~1-2k verts.
    setBounds(currentBounds);
    group.visible = ISLAND.value.ENABLED;
    const mats = ISLAND.value;
    (material.uniforms.uHemiSkyColor!.value as THREE.Color).set(mats.HEMI_SKY_COLOR);
    (material.uniforms.uHemiGroundColor!.value as THREE.Color).set(mats.HEMI_GROUND_COLOR);
  }

  function tick(): void {
    // Island uses hemispheric lighting — no sun direction to update.
  }

  function dispose(): void {
    if (group.parent) group.parent.remove(group);
    geometry.dispose();
    material.dispose();
  }

  return { group, setBounds, refresh, tick, dispose };
}
