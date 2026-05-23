import * as THREE from 'three';
import { describe, it, expect } from 'vitest';
import { createShadowDisc } from '@/scene/island/shadowDisc.js';
import { ISLAND_ATMOSPHERE } from '@/config/island.js';
import { RENDER_ORDERS } from '@/constants';

describe('createShadowDisc', () => {
  it('returns a Mesh with CircleGeometry and a transparent MeshBasicMaterial', () => {
    const disc = createShadowDisc({ islandRadius: 100, bottomY: -60 });
    expect(disc.mesh).toBeInstanceOf(THREE.Mesh);
    expect(disc.mesh.geometry).toBeInstanceOf(THREE.CircleGeometry);
    expect(disc.mesh.material).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect((disc.mesh.material as THREE.MeshBasicMaterial).transparent).toBe(true);
    expect((disc.mesh.material as THREE.MeshBasicMaterial).depthWrite).toBe(false);
    disc.dispose();
  });

  it('positions disc at bottomY - drop distance', () => {
    ISLAND_ATMOSPHERE.setKey('SHADOW_DROP_DISTANCE', 2);
    const disc = createShadowDisc({ islandRadius: 100, bottomY: -60 });
    // drop = islandRadius * SHADOW_DROP_DISTANCE = 200
    expect(disc.mesh.position.y).toBeCloseTo(-60 - 200, 5);
    disc.dispose();
    ISLAND_ATMOSPHERE.setKey('SHADOW_DROP_DISTANCE', 1.5);
  });

  it('uses RENDER_ORDERS.VALLEY_FLOOR', () => {
    const disc = createShadowDisc({ islandRadius: 100, bottomY: -60 });
    expect(disc.mesh.renderOrder).toBe(RENDER_ORDERS.VALLEY_FLOOR);
    disc.dispose();
  });

  it('hidden when SHADOW_DISC_ENABLED=false', () => {
    ISLAND_ATMOSPHERE.setKey('SHADOW_DISC_ENABLED', false);
    const disc = createShadowDisc({ islandRadius: 100, bottomY: -60 });
    expect(disc.mesh.visible).toBe(false);
    disc.dispose();
    ISLAND_ATMOSPHERE.setKey('SHADOW_DISC_ENABLED', true);
  });
});
