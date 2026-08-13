// city/components/island/index.ts — the floating island under the city: a
// settings effect and a bounds effect, added once at world boot. No tick: its
// lighting is static, so there is no per-frame work to do.

import * as THREE from 'three';
import { effect } from '@preact/signals';

import { ISLAND } from '@/state/stores/settings/island';
import { getWorldBounds, type WorldBounds } from '@/city/utils/floorBounds';
import { buildIslandGeometry, type IslandBuildParams } from './islandGeometry';
import { createIslandMaterial } from './islandShader';
import { RENDER_ORDERS } from '@/city/types/renderOrders';
import type { SceneComponent, SceneContext } from '../../types';
import { onSettings } from '../../utils/onSettings';

// Coplanar with the city, because it is the ground the city stands on. Dropping
// it to dodge a z-fight suspended every building and tree above the grass.
export const ISLAND_TOP_Y = 0;

export interface Island extends SceneComponent {
  /** Rebuild geometry and reposition group to fit the given bounds. */
  setBounds(bounds: WorldBounds): void;
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

// Seeded from the bounds, so a repo keeps its silhouette, and exported so the
// placement worker can rebuild the identical polygon.
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

// Reads only ctx.cityState (to size itself reactively off latestWorldBounds —
// see the bounds effect below); no picker/camera/renderer needed at construction.
export function createIsland(ctx: SceneContext): Island {
  const { cityState } = ctx;
  let currentBounds = getWorldBounds(null);
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

  // The bounds reference is stable across a reuse apply, so this fires on real
  // changes only, with no gate of its own.
  const stopBounds = effect(() => {
    const bounds = cityState.latestWorldBounds.value;
    if (bounds) setBounds(bounds);
  });

  // Also runs once at construction, re-applying what the constructor baked.
  const stopEffect = onSettings(ISLAND, () => {
    // Geometry colors changed → rebuild (vertex colors are baked into the
    // geometry, not pushed through uniforms). This is cheap for ~1-2k verts.
    setBounds(currentBounds);
    group.visible = ISLAND.value.ENABLED;
    const m = ISLAND.value;
    (material.uniforms.uHemiSkyColor!.value as THREE.Color).set(m.HEMI_SKY_COLOR);
    (material.uniforms.uHemiGroundColor!.value as THREE.Color).set(m.HEMI_GROUND_COLOR);
    material.uniforms.uGrassTexture!.value = m.GRASS_TEXTURE;
    material.uniforms.uGrassPatchSize!.value = m.GRASS_PATCH_SIZE;
    material.uniforms.uRockTexture!.value = m.ROCK_TEXTURE;
    material.uniforms.uRockPatchSize!.value = m.ROCK_PATCH_SIZE;
  });

  function dispose(): void {
    if (group.parent) group.parent.remove(group);
    geometry.dispose();
    material.dispose();
    stopBounds();
    stopEffect();
  }

  return { group, setBounds, dispose };
}
