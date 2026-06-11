import * as THREE from 'three';
import { describe, it, expect, beforeEach } from 'vitest';
import { createIsland } from '@/city/components/island';
import { createCityState } from '@/city/state/cityState';
import { ISLAND } from '@/state/stores/settings/island';
import { RENDER_ORDERS } from '@/city/constants/renderOrders';
import type { SceneContext } from '@/city/types';

// Island ignores ctx at construction (see component comment: Strategy A,
// same as sky/gem). An empty object cast is sufficient.
const fakeCtx = {} as unknown as SceneContext;

describe('createIsland', () => {
  beforeEach(() => {
    ISLAND.value = {
      ...ISLAND.value,
      ENABLED: true,
      SIDES: 12,
      IRREGULARITY: 0.18,
      TIERS: 2,
      DEPTH: 0.6,
      ROUNDNESS: 0.7,
      GRASS_THICKNESS: 0.025,
    };
  });

  it('returns a Group with island mesh', () => {
    const island = createIsland(fakeCtx, createCityState());
    expect(island.group).toBeInstanceOf(THREE.Group);
    expect(island.group.children.length).toBeGreaterThanOrEqual(1);
    island.dispose();
  });

  it('positions the group at the default bounds center (0, 0)', () => {
    const island = createIsland(fakeCtx, createCityState());
    expect(island.group.position.x).toBe(0);
    expect(island.group.position.z).toBe(0);
    island.dispose();
  });

  it('setBounds rebuilds the geometry and repositions', () => {
    const island = createIsland(fakeCtx, createCityState());
    const islandMesh = island.group.children.find(
      (c) => c.userData.island === 'islandMesh'
    ) as THREE.Mesh;
    const oldGeom = islandMesh.geometry;
    island.setBounds({ cx: 50, cz: 50, halfWidth: 25, halfDepth: 25 });
    expect(islandMesh.geometry).not.toBe(oldGeom);
    expect(island.group.position.x).toBe(50);
    island.dispose();
  });

  it('effect re-applies visibility when ISLAND.ENABLED changes', () => {
    const island = createIsland(fakeCtx, createCityState());
    // Initially enabled (beforeEach sets ENABLED: true).
    expect(island.group.visible).toBe(true);

    // Disable via signal — effect re-runs synchronously in the test env.
    ISLAND.value = { ...ISLAND.value, ENABLED: false };
    expect(island.group.visible).toBe(false);

    island.dispose();
  });

  it('hidden when ISLAND.ENABLED=false at construction', () => {
    ISLAND.value = { ...ISLAND.value, ENABLED: false };
    const island = createIsland(fakeCtx, createCityState());
    expect(island.group.visible).toBe(false);
    island.dispose();
    ISLAND.value = { ...ISLAND.value, ENABLED: true };
  });

  it('effect re-applies material uniforms when ISLAND changes', () => {
    const island = createIsland(fakeCtx, createCityState());
    const islandMesh = island.group.children.find(
      (c) => c.userData.island === 'islandMesh'
    ) as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;

    const newSkyColor = '#ff0000';
    ISLAND.value = { ...ISLAND.value, HEMI_SKY_COLOR: newSkyColor };
    const uSkyColor = islandMesh.material.uniforms.uHemiSkyColor?.value as THREE.Color;
    const expected = new THREE.Color(newSkyColor);
    expect(uSkyColor.r).toBeCloseTo(expected.r, 3);

    island.dispose();
  });

  it('uses RENDER_ORDERS.VALLEY_FLOOR for the island mesh', () => {
    const island = createIsland(fakeCtx, createCityState());
    const islandMesh = island.group.children.find(
      (c) => c.userData.island === 'islandMesh'
    ) as THREE.Mesh;
    expect(islandMesh.renderOrder).toBe(RENDER_ORDERS.VALLEY_FLOOR);
    island.dispose();
  });

  it('dispose releases geometry + material and stops the effect', () => {
    const island = createIsland(fakeCtx, createCityState());
    expect(() => island.dispose()).not.toThrow();

    // After dispose, ISLAND signal changes must NOT throw (stopEffect called).
    expect(() => {
      ISLAND.value = { ...ISLAND.value, ENABLED: false };
    }).not.toThrow();
    ISLAND.value = { ...ISLAND.value, ENABLED: true };
  });
});
