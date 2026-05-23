import * as THREE from 'three';
import { describe, it, expect } from 'vitest';
import { createUnderglowCore } from '@/scene/island/underglowCore.js';

describe('createUnderglowCore', () => {
  it('returns a Mesh with IcosahedronGeometry and a ShaderMaterial', () => {
    const core = createUnderglowCore({ bottomY: -60, bottomRadius: 30 });
    expect(core.mesh).toBeInstanceOf(THREE.Mesh);
    expect(core.mesh.geometry).toBeInstanceOf(THREE.IcosahedronGeometry);
    expect(core.mesh.material).toBeInstanceOf(THREE.ShaderMaterial);
    core.dispose();
  });

  it('positions core just below the bottom cluster', () => {
    const core = createUnderglowCore({ bottomY: -60, bottomRadius: 30 });
    expect(core.mesh.position.y).toBeLessThan(-60);
    core.dispose();
  });

  it('refresh() picks up new UNDERGLOW config values', async () => {
    const core = createUnderglowCore({ bottomY: -60, bottomRadius: 30 });
    const mat = core.mesh.material as THREE.ShaderMaterial;
    const beforeIntensity = mat.uniforms.uIntensity!.value;
    // Bump intensity via config; refresh; verify uniform changed.
    const { ISLAND_UNDERGLOW } = await import('@/config/island.js');
    ISLAND_UNDERGLOW.setKey('CORE_INTENSITY', beforeIntensity * 2);
    core.refresh();
    expect(mat.uniforms.uIntensity!.value).toBeCloseTo(beforeIntensity * 2, 5);
    core.dispose();
  });

  it('hides mesh when CORE_ENABLED is false', async () => {
    const { ISLAND_UNDERGLOW } = await import('@/config/island.js');
    ISLAND_UNDERGLOW.setKey('CORE_ENABLED', false);
    const core = createUnderglowCore({ bottomY: -60, bottomRadius: 30 });
    expect(core.mesh.visible).toBe(false);
    core.dispose();
    ISLAND_UNDERGLOW.setKey('CORE_ENABLED', true); // reset
  });
});
