// city/components/island/index.ts — Cyberpunk Valley floating-island COMPONENT
// (public door).
//
// Self-contained scene component: builds a shaped polygonal slab that replaces
// the old flat world-floor plane. The component owns its settings-reactivity
// (an effect reading ISLAND) and frees its own GPU resources + stops its
// effect in dispose(). Persistent — the island group is added once at world
// boot and sized via setBounds() when layout (re)computes.
//
// Lifecycle (matches the other createX(ctx) components under app/city/):
//
//   const island = createIsland(ctx);
//   scene.add(island.group);              // once, at world boot
//   island.setBounds(getWorldBounds(…)); // when layout (re)computes
//   island.dispose();                    // on world teardown
//
// The settings effect replaces the old refresh() / applyTheme() path:
// it reads ISLAND (ENABLED, colors, geometry params) and rebuilds geometry
// + material uniforms on every ISLAND Save. It runs once at construction
// (idempotently re-applying the same values the constructor baked — a
// redundant geometry rebuild with default bounds is acceptable since
// world.setBounds(realBounds) immediately follows, producing identical output).
//
// Construction-time bridge (Strategy A, same as sky/gem): the island is
// built inside world.ts BEFORE the picker/camera/renderer exist. The
// component accepts the SceneContext for createX(ctx) composer uniformity
// but uses nothing from it; the `_ctx` arg is unused (see sky/gem precedents).
//
// tick() is OMITTED — island hemispheric lighting is static; there is no
// per-frame work. The SceneComponent contract makes tick optional.

import * as THREE from 'three';

import { ISLAND } from '@/state/stores/settings/island';
import { getWorldBounds, type WorldBounds } from '@/city/utils/floorBounds';
import { buildIslandGeometry, type IslandBuildParams } from './islandGeometry';
import { createIslandMaterial } from './islandShader';
import { RENDER_ORDERS } from '@/city/constants/renderOrders';
import type { SceneComponent, SceneContext } from '../../types';
import { onSettings } from '../../utils/onSettings';

const ISLAND_TOP_Y = -2.0; // Increased from -0.5 for z-fighting prevention (4x separation from city y=0)

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

// Stable seed from bounds so the same repo always gets the same silhouette.
// Exported so tree placement (running in a worker) can rebuild the identical
// polygon without reaching into index.ts's private state.
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

// `_ctx` is accepted for createX(ctx) composer uniformity; the island uses
// nothing from it at construction (no picker/camera/renderer needed; scene-add
// done by world.ts). The `_`-prefix matches the eslint argsIgnorePattern.
export function createIsland(_ctx: SceneContext): Island {
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

  // Settings effect — reacts to ISLAND changes (Save). Replaces the old
  // island.refresh() call in renderLoop.applyTheme(). Reads ISLAND (ENABLED,
  // colors, geometry params) and rebuilds geometry + pushes material uniforms
  // (same writes as the old refresh(), verbatim). Runs once at construction,
  // re-applying the same values the constructor baked (idempotent).
  const stopEffect = onSettings(ISLAND, () => {
    // Geometry colors changed → rebuild (vertex colors are baked into the
    // geometry, not pushed through uniforms). This is cheap for ~1-2k verts.
    setBounds(currentBounds);
    group.visible = ISLAND.value.ENABLED;
    const m = ISLAND.value;
    (material.uniforms.uHemiSkyColor!.value as THREE.Color).set(m.HEMI_SKY_COLOR);
    (material.uniforms.uHemiGroundColor!.value as THREE.Color).set(m.HEMI_GROUND_COLOR);
  });

  function dispose(): void {
    if (group.parent) group.parent.remove(group);
    geometry.dispose();
    material.dispose();
    stopEffect();
  }

  return { group, setBounds, dispose };
}
