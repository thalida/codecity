// sky.test.ts — verifies the createSky() factory builds the icosphere
// mesh with the documented render-order / depth / side flags, that
// refresh() pushes fresh config values into uniforms (the
// hot-reloadable path), that tick() advances uTime, that ENABLED=false
// hides the mesh, and that dispose() releases GPU resources.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { createSky } from '@/scene/sky/sky.js';
import { SKY, SKY_STARS } from '@/config/sky.js';
import { RENDER_ORDERS } from '@/constants';

function resetStores() {
  SKY.set({
    ENABLED: true,
    COLOR: '#000000',
    HORIZON_COLOR: '#04030c',
    HORIZON_HEIGHT: 0.15,
  });
  SKY_STARS.set({
    ENABLED: true, DENSITY: 0.0075, SIZE: 0.15, BRIGHTNESS: 1.2,
    TWINKLE_ENABLED: true, TWINKLE_SPEED: 0.5,
    TWINKLE_AMPLITUDE: 1.0, MIN_ELEVATION_DEG: 8,
  });
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

  it('seeds uSkyColor / uHorizonColor / uHorizonHeight from SKY defaults', () => {
    const mat = sky.mesh.material as THREE.ShaderMaterial;
    const sky_ = mat.uniforms.uSkyColor.value as THREE.Color;
    const horizon = mat.uniforms.uHorizonColor.value as THREE.Color;
    // COLOR defaults to '#000000' → pure black.
    expect(sky_.r).toBeCloseTo(0);
    expect(sky_.g).toBeCloseTo(0);
    expect(sky_.b).toBeCloseTo(0);
    // HORIZON_COLOR default '#04030c' → 0x04/255, 0x03/255, 0x0c/255.
    expect(horizon.r).toBeCloseTo(0x04 / 255);
    expect(horizon.g).toBeCloseTo(0x03 / 255);
    expect(horizon.b).toBeCloseTo(0x0c / 255);
    expect(mat.uniforms.uHorizonHeight.value).toBeCloseTo(0.15);
  });

  it('precomputes sin(MIN_ELEVATION_DEG) into uStarMinElevation', () => {
    const mat = sky.mesh.material as THREE.ShaderMaterial;
    expect(mat.uniforms.uStarMinElevation.value).toBeCloseTo(Math.sin((8 * Math.PI) / 180));
  });

  it('refresh() pushes fresh config values into uniforms', () => {
    SKY_STARS.setKey('BRIGHTNESS', 2.7);
    SKY.setKey('COLOR', '#ffffff');
    SKY.setKey('HORIZON_COLOR', '#112233');
    SKY.setKey('HORIZON_HEIGHT', 0.42);
    sky.refresh();
    const mat = sky.mesh.material as THREE.ShaderMaterial;
    expect(mat.uniforms.uStarBrightness.value).toBeCloseTo(2.7);
    const sky_ = mat.uniforms.uSkyColor.value as THREE.Color;
    expect(sky_.r).toBeCloseTo(1);
    expect(sky_.g).toBeCloseTo(1);
    expect(sky_.b).toBeCloseTo(1);
    const horizon = mat.uniforms.uHorizonColor.value as THREE.Color;
    expect(horizon.r).toBeCloseTo(0x11 / 255);
    expect(horizon.g).toBeCloseTo(0x22 / 255);
    expect(horizon.b).toBeCloseTo(0x33 / 255);
    expect(mat.uniforms.uHorizonHeight.value).toBeCloseTo(0.42);
  });

  it('refresh() hides the mesh when SKY.ENABLED is false', () => {
    SKY.setKey('ENABLED', false);
    sky.refresh();
    expect(sky.mesh.visible).toBe(false);
    SKY.setKey('ENABLED', true);
    sky.refresh();
    expect(sky.mesh.visible).toBe(true);
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
    geom.dispose = () => { disposedGeom = true; };
    const origDispose = mat.dispose.bind(mat);
    mat.dispose = () => { disposedMat = true; origDispose(); };
    sky.dispose();
    expect(disposedGeom).toBe(true);
    expect(disposedMat).toBe(true);
  });
});
