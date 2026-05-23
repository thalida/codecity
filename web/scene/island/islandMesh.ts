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
import {
  ISLAND_GEOMETRY,
  ISLAND_MATERIALS,
  ISLAND_UNDERGLOW,
  ISLAND_ATMOSPHERE,
} from '@/config/island.js';
import { getWorldBounds, type WorldBounds } from '@/scene/worldBounds.js';
import {
  buildIslandGeometry,
  bottomCapRadius,
  bottomCapDepth,
  type IslandBuildParams,
} from './islandGeometry.js';
import { createIslandMaterial } from './islandShader.js';
import { createUnderglowCore, type UnderglowCore } from './underglowCore.js';
import { createShadowDisc, type ShadowDisc } from './shadowDisc.js';
import { RENDER_ORDERS } from '@/constants';

const ISLAND_TOP_Y = -2.0; // Increased from -0.5 for z-fighting prevention (4x separation from city y=0)

export interface Island {
  group: THREE.Group;
  /** Rebuild geometry and reposition group to fit the given bounds. */
  setBounds(bounds: WorldBounds): void;
  /** Pull fresh values from config stores; called on hot-reload. */
  refresh(): void;
  /** Per-frame tick: no-op for the island (hemispheric lighting is static). */
  tick(): void;
  dispose(): void;
}

function buildParams(bounds: WorldBounds, seedFromBounds: number): IslandBuildParams {
  const g = ISLAND_GEOMETRY.get();
  return {
    sides: g.SIDES,
    irregularity: g.IRREGULARITY,
    tiers: g.TIERS,
    depth: g.DEPTH,
    halfWidth: bounds.halfWidth,
    halfDepth: bounds.halfDepth,
    seed: seedFromBounds,
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
  group.visible = ISLAND_GEOMETRY.get().ENABLED;

  // Island mesh.
  let params = buildParams(currentBounds, islandSeedFromBounds(currentBounds));
  const mats = ISLAND_MATERIALS.get();
  let geometry = buildIslandGeometry(params, {
    GRASS: mats.GRASS_COLOR,
    SOIL: mats.SOIL_COLOR,
    ROCK: mats.ROCK_COLOR,
  });
  const material = createIslandMaterial();
  const islandMesh = new THREE.Mesh(geometry, material);
  islandMesh.renderOrder = RENDER_ORDERS.VALLEY_FLOOR;
  islandMesh.frustumCulled = false;
  islandMesh.userData.island = 'islandMesh';
  group.add(islandMesh);

  // Underglow core (positioned relative to local island coordinates).
  // bottomCapRadius/Depth come from islandGeometry so they always match
  // the actual bottom cap, even if tier shrink constants change later.
  let bottomY = -bottomCapDepth(params);
  let bottomRadius = bottomCapRadius(params);
  let underglow: UnderglowCore = createUnderglowCore({ bottomY, bottomRadius });
  group.add(underglow.mesh);

  // Shadow disc — fake shadow below the island to ground it visually.
  // islandRadius matches the inscribed-polygon baseR used by islandGeometry.
  let islandRadius = Math.min(currentBounds.halfWidth, currentBounds.halfDepth);
  let shadowDisc: ShadowDisc = createShadowDisc({ islandRadius, bottomY });
  group.add(shadowDisc.mesh);

  function setBounds(newBounds: WorldBounds): void {
    currentBounds = newBounds;
    geometry.dispose();
    params = buildParams(currentBounds, islandSeedFromBounds(currentBounds));
    const m = ISLAND_MATERIALS.get();
    geometry = buildIslandGeometry(params, {
      GRASS: m.GRASS_COLOR,
      SOIL: m.SOIL_COLOR,
      ROCK: m.ROCK_COLOR,
    });
    islandMesh.geometry = geometry;
    group.position.set(currentBounds.cx, ISLAND_TOP_Y, currentBounds.cz);

    // Rebuild underglow core in case bounds-derived size changed.
    underglow.dispose();
    bottomY = -bottomCapDepth(params);
    bottomRadius = bottomCapRadius(params);
    underglow = createUnderglowCore({ bottomY, bottomRadius });
    group.add(underglow.mesh);

    // Rebuild shadow disc to match new bounds.
    shadowDisc.dispose();
    islandRadius = Math.min(currentBounds.halfWidth, currentBounds.halfDepth);
    shadowDisc = createShadowDisc({ islandRadius, bottomY });
    group.add(shadowDisc.mesh);
  }

  function refresh(): void {
    // Geometry colors changed → rebuild (vertex colors are baked into the
    // geometry, not pushed through uniforms). This is cheap for ~1-2k verts.
    setBounds(currentBounds);
    group.visible = ISLAND_GEOMETRY.get().ENABLED;
    const mats = ISLAND_MATERIALS.get();
    (material.uniforms.uHemiSkyColor!.value as THREE.Color).set(mats.HEMI_SKY_COLOR);
    (material.uniforms.uHemiGroundColor!.value as THREE.Color).set(mats.HEMI_GROUND_COLOR);
    const ug = ISLAND_UNDERGLOW.get();
    (material.uniforms.uUnderglowColor!.value as THREE.Color).set(
      ug.ENABLED ? ug.COLOR : '#000000',
    );
    material.uniforms.uUnderglowStrength!.value = ug.ENABLED ? ug.STRENGTH : 0;
    const atm = ISLAND_ATMOSPHERE.get();
    material.uniforms.uDistanceFogEnabled!.value = atm.DISTANCE_FOG_ENABLED;
    (material.uniforms.uDistanceFogColor!.value as THREE.Color).set(atm.DISTANCE_FOG_COLOR);
    material.uniforms.uDistanceFogNear!.value = atm.DISTANCE_FOG_NEAR;
    material.uniforms.uDistanceFogFar!.value = atm.DISTANCE_FOG_FAR;
    underglow.refresh();
    shadowDisc.refresh();
  }

  function tick(): void {
    // Island uses hemispheric lighting — no sun direction to update.
  }

  function dispose(): void {
    if (group.parent) group.parent.remove(group);
    geometry.dispose();
    material.dispose();
    underglow.dispose();
    shadowDisc.dispose();
  }

  return { group, setBounds, refresh, tick, dispose };
}
