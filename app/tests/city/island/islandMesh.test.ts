import * as THREE from 'three';
import { describe, it, expect, beforeEach } from 'vitest';
import { createIsland } from '@/city/components/island/islandMesh';
import { ISLAND } from '@/state/stores/settings/island';
import { RENDER_ORDERS } from '@/city/renderOrders';

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
    const island = createIsland(null);
    expect(island.group).toBeInstanceOf(THREE.Group);
    expect(island.group.children.length).toBeGreaterThanOrEqual(1);
    island.dispose();
  });

  it('positions the group at the bounds center', () => {
    const island = createIsland({ cx: 100, cz: -200, halfWidth: 50, halfDepth: 30 });
    expect(island.group.position.x).toBe(100);
    expect(island.group.position.z).toBe(-200);
    island.dispose();
  });

  it('setBounds rebuilds the geometry and repositions', () => {
    const island = createIsland(null);
    const islandMesh = island.group.children.find(
      (c) => c.userData.island === 'islandMesh'
    ) as THREE.Mesh;
    const oldGeom = islandMesh.geometry;
    island.setBounds({ cx: 50, cz: 50, halfWidth: 25, halfDepth: 25 });
    expect(islandMesh.geometry).not.toBe(oldGeom);
    expect(island.group.position.x).toBe(50);
    island.dispose();
  });

  it('hidden when GEOMETRY.ENABLED=false', () => {
    ISLAND.value = { ...ISLAND.value, ENABLED: false };
    const island = createIsland(null);
    expect(island.group.visible).toBe(false);
    island.dispose();
    ISLAND.value = { ...ISLAND.value, ENABLED: true };
  });

  it('uses RENDER_ORDERS.VALLEY_FLOOR for the island mesh', () => {
    const island = createIsland(null);
    const islandMesh = island.group.children.find(
      (c) => c.userData.island === 'islandMesh'
    ) as THREE.Mesh;
    expect(islandMesh.renderOrder).toBe(RENDER_ORDERS.VALLEY_FLOOR);
    island.dispose();
  });

  it('dispose releases geometry + material', () => {
    const island = createIsland(null);
    expect(() => island.dispose()).not.toThrow();
  });
});
