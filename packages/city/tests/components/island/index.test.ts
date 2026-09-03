import * as THREE from 'three';
import { describe, it, expect, beforeEach } from 'vitest';
import { createIsland } from '../../../src/components/island';
import { makeCityState } from '../../_helpers/cityFixtures';
import { RENDER_ORDERS } from '../../../src/types/renderOrders';
import type { SceneContext } from '../../../src/types';
import { settingsStore } from '../../_helpers/citySettings';

// The polygon assertions are written against a 12-sided island at these
// proportions, so they are stated here rather than taken from the defaults.
const ISLAND_SETTINGS = {
  ISLAND: {
    ENABLED: true,
    SIDES: 12,
    IRREGULARITY: 0.18,
    TIERS: 2,
    DEPTH: 0.6,
    ROUNDNESS: 0.7,
    GRASS_THICKNESS: 0.025,
  },
};

describe('createIsland', () => {
  let store: ReturnType<typeof settingsStore>;
  // Island reads only settings and cityState at construction (latestWorldBounds
  // starts null → the bounds effect no-ops until setBounds drives it here).
  let fakeCtx: SceneContext;

  beforeEach(() => {
    store = settingsStore(ISLAND_SETTINGS);
    fakeCtx = {
      cityState: makeCityState(store),
      settings: store,
    } as unknown as SceneContext;
  });

  it('returns a Group with island mesh', () => {
    const island = createIsland(fakeCtx);
    expect(island.group).toBeInstanceOf(THREE.Group);
    expect(island.group.children.length).toBeGreaterThanOrEqual(1);
    island.dispose();
  });

  it('positions the group at the default bounds center (0, 0)', () => {
    const island = createIsland(fakeCtx);
    expect(island.group.position.x).toBe(0);
    expect(island.group.position.z).toBe(0);
    island.dispose();
  });

  it('setBounds rebuilds the geometry and repositions', () => {
    const island = createIsland(fakeCtx);
    const islandMesh = island.group.children.find(
      (c) => c.userData.island === 'islandMesh'
    ) as THREE.Mesh;
    const oldGeom = islandMesh.geometry;
    island.setBounds({ cx: 50, cz: 50, halfWidth: 25, halfDepth: 25 });
    expect(islandMesh.geometry).not.toBe(oldGeom);
    expect(island.group.position.x).toBe(50);
    island.dispose();
  });

  it('stays hidden until it has bounds, then follows ISLAND.ENABLED', () => {
    const island = createIsland(fakeCtx);
    // No city yet, so no ground to stand on the fallback rectangle.
    expect(island.group.visible).toBe(false);

    island.setBounds({ cx: 0, cz: 0, halfWidth: 25, halfDepth: 25 });
    expect(island.group.visible).toBe(true);

    // Disable via signal — effect re-runs synchronously in the test env.
    store.update({ ISLAND: { ENABLED: false } });
    expect(island.group.visible).toBe(false);

    island.dispose();
  });

  it('hidden when ISLAND.ENABLED=false at construction', () => {
    store.update({ ISLAND: { ENABLED: false } });
    const island = createIsland(fakeCtx);
    expect(island.group.visible).toBe(false);
    island.dispose();
    store.update({ ISLAND: { ENABLED: true } });
  });

  it('effect re-applies material uniforms when ISLAND changes', () => {
    const island = createIsland(fakeCtx);
    const islandMesh = island.group.children.find(
      (c) => c.userData.island === 'islandMesh'
    ) as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;

    const newSkyColor = '#ff0000';
    store.update({ ISLAND: { HEMI_SKY_COLOR: newSkyColor } });
    const uSkyColor = islandMesh.material.uniforms.uHemiSkyColor?.value as THREE.Color;
    const expected = new THREE.Color(newSkyColor);
    expect(uSkyColor.r).toBeCloseTo(expected.r, 3);

    island.dispose();
  });

  it('uses RENDER_ORDERS.VALLEY_FLOOR for the island mesh', () => {
    const island = createIsland(fakeCtx);
    const islandMesh = island.group.children.find(
      (c) => c.userData.island === 'islandMesh'
    ) as THREE.Mesh;
    expect(islandMesh.renderOrder).toBe(RENDER_ORDERS.VALLEY_FLOOR);
    island.dispose();
  });

  it('dispose() stops the effect: a later ISLAND mutation never toggles the group', () => {
    const island = createIsland(fakeCtx);
    const group = island.group;
    island.setBounds({ cx: 0, cz: 0, halfWidth: 25, halfDepth: 25 });
    expect(group.visible).toBe(true);

    island.dispose();
    // The effect writes group.visible with no null guard, so a subscription
    // that outlived dispose would flip it here.
    store.update({ ISLAND: { ENABLED: false } });

    expect(group.visible).toBe(true);
    store.update({ ISLAND: { ENABLED: true } });
  });
});
