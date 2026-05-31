// sky.test.ts — verifies the createSky() factory builds the icosphere
// mesh with the documented render-order / depth / side flags, that
// refresh() pushes fresh config values into uniforms (the
// hot-reloadable path), that tick() advances uTime, and that
// dispose() releases GPU resources.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { createSky } from '@/scene/components/sky/sky';
import { SKY, SKY_STARS } from '@/state/settings/components/sky';
import { RENDER_ORDERS } from '@/scene/renderOrders';

function resetStores() {
  SKY.value = {
    COLOR: '#010005',
  };
  SKY_STARS.value = {
    ENABLED: true,
    DENSITY: 0.0075,
  };
}

describe('createSky()', () => {
  let sky: ReturnType<typeof createSky>;

  beforeEach(() => {
    resetStores();
    sky = createSky();
  });

  afterEach(() => {
    sky.dispose();
  });

  it('builds an inverted icosphere mesh', () => {
    expect(sky.mesh).toBeInstanceOf(THREE.Mesh);
    const geom = sky.mesh.geometry as THREE.IcosahedronGeometry;
    expect(geom.type).toBe('IcosahedronGeometry');
    const mat = sky.mesh.material as THREE.ShaderMaterial;
    expect(mat).toBeInstanceOf(THREE.ShaderMaterial);
    expect(mat.side).toBe(THREE.BackSide);
    expect(mat.depthWrite).toBe(false);
  });

  it('sits at the documented render order (-1000)', () => {
    expect(sky.mesh.renderOrder).toBe(RENDER_ORDERS.SKY);
    expect(sky.mesh.renderOrder).toBe(-1000);
  });

  it('seeds uSkyColor from SKY.COLOR default', () => {
    const mat = sky.mesh.material as THREE.ShaderMaterial;
    const sky_ = mat.uniforms.uSkyColor.value as THREE.Color;
    // COLOR defaults to '#010005' → 0x01/255, 0x00/255, 0x05/255.
    expect(sky_.r).toBeCloseTo(0x01 / 255);
    expect(sky_.g).toBeCloseTo(0);
    expect(sky_.b).toBeCloseTo(0x05 / 255);
  });

  it('does NOT carry uHorizonColor / uHorizonHeight / uStarMinElevation uniforms', () => {
    const mat = sky.mesh.material as THREE.ShaderMaterial;
    expect(mat.uniforms.uHorizonColor).toBeUndefined();
    expect(mat.uniforms.uHorizonHeight).toBeUndefined();
    expect(mat.uniforms.uStarMinElevation).toBeUndefined();
  });

  it('refresh() pushes fresh config values into uniforms', () => {
    SKY_STARS.value = { ...SKY_STARS.value, DENSITY: 0.01 };
    SKY.value = { ...SKY.value, COLOR: '#ffffff' };
    sky.refresh();
    const mat = sky.mesh.material as THREE.ShaderMaterial;
    expect(mat.uniforms.uStarDensity.value).toBeCloseTo(0.01);
    const sky_ = mat.uniforms.uSkyColor.value as THREE.Color;
    expect(sky_.r).toBeCloseTo(1);
    expect(sky_.g).toBeCloseTo(1);
    expect(sky_.b).toBeCloseTo(1);
  });

  it('tick() advances the uTime uniform', () => {
    const mat = sky.mesh.material as THREE.ShaderMaterial;
    const before = mat.uniforms.uTime.value;
    sky.tick(2.5);
    expect(mat.uniforms.uTime.value).toBeCloseTo(before + 2.5);
    sky.tick(0.1);
    expect(mat.uniforms.uTime.value).toBeCloseTo(before + 2.6);
  });

  it('dispose() releases geometry and material', () => {
    const geom = sky.mesh.geometry;
    const mat = sky.mesh.material as THREE.ShaderMaterial;
    let disposedGeom = false;
    let disposedMat = false;
    geom.dispose = () => {
      disposedGeom = true;
    };
    const origDispose = mat.dispose.bind(mat);
    mat.dispose = () => {
      disposedMat = true;
      origDispose();
    };
    sky.dispose();
    expect(disposedGeom).toBe(true);
    expect(disposedMat).toBe(true);
  });
});
