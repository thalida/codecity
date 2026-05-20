// sky.test.ts — verifies the createSky() factory builds the icosphere
// mesh with the documented render-order / depth / side flags, that
// refresh() pushes fresh config values into uniforms (the
// hot-reloadable path), that tick() advances uTime, that ENABLED=false
// hides the mesh, and that dispose() releases GPU resources.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { createSky } from '@/scene/sky/sky.js';
import { SKY_GRADIENT, SKY_STARS } from '@/config/sky.js';
import { RENDER_ORDERS } from '@/constants';

// Reset stores to defaults between tests so leakage between tests
// can't make assertions pass for the wrong reason.
function resetStores() {
  SKY_GRADIENT.set({
    ENABLED: true,
    TOP: '#000000', UPPER_MID: '#000005', MID: '#01010d',
    LOWER_MID: '#02021a', HORIZON: '#040328',
    GROUND_COLOR: '#000000',
    STOP_TOP: 0.0, STOP_UPPER_MID: 0.35, STOP_MID: 0.55,
    STOP_LOWER_MID: 0.75, STOP_HORIZON: 0.95,
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

  it('seeds gradient uniforms from SKY_GRADIENT defaults', () => {
    const mat = sky.mesh.material as THREE.ShaderMaterial;
    const top = mat.uniforms.uGradientTop.value as THREE.Color;
    // '#000000' parsed via THREE.Color with LinearSRGBColorSpace
    // is pure black — every channel is zero.
    expect(top.r).toBeCloseTo(0);
    expect(top.g).toBeCloseTo(0);
    expect(top.b).toBeCloseTo(0);
    expect(mat.uniforms.uStopTop.value).toBeCloseTo(0.0);
    expect(mat.uniforms.uStopHorizon.value).toBeCloseTo(0.95);
    expect(mat.uniforms.uGradientEnabled.value).toBe(1.0);
  });

  it('seeds uGroundColor from SKY_GRADIENT.GROUND_COLOR', () => {
    const mat = sky.mesh.material as THREE.ShaderMaterial;
    const ground = mat.uniforms.uGroundColor.value as THREE.Color;
    // '#000000' → pure black (matches TOP exactly for seamless fill).
    expect(ground.r).toBeCloseTo(0);
    expect(ground.g).toBeCloseTo(0);
    expect(ground.b).toBeCloseTo(0);
  });

  it('precomputes sin(MIN_ELEVATION_DEG) into uStarMinElevation', () => {
    const mat = sky.mesh.material as THREE.ShaderMaterial;
    expect(mat.uniforms.uStarMinElevation.value).toBeCloseTo(Math.sin((8 * Math.PI) / 180));
  });

  it('refresh() pushes fresh config values into uniforms', () => {
    SKY_STARS.setKey('BRIGHTNESS', 2.7);
    SKY_GRADIENT.setKey('GROUND_COLOR', '#abcdef');
    SKY_GRADIENT.setKey('TOP', '#ffffff');
    sky.refresh();
    const mat = sky.mesh.material as THREE.ShaderMaterial;
    expect(mat.uniforms.uStarBrightness.value).toBeCloseTo(2.7);
    const ground = mat.uniforms.uGroundColor.value as THREE.Color;
    expect(ground.r).toBeCloseTo(0xab / 255);
    expect(ground.g).toBeCloseTo(0xcd / 255);
    expect(ground.b).toBeCloseTo(0xef / 255);
    const top = mat.uniforms.uGradientTop.value as THREE.Color;
    expect(top.r).toBeCloseTo(1);
    expect(top.g).toBeCloseTo(1);
    expect(top.b).toBeCloseTo(1);
  });

  it('refresh() hides the mesh when SKY_GRADIENT.ENABLED is false', () => {
    SKY_GRADIENT.setKey('ENABLED', false);
    sky.refresh();
    expect(sky.mesh.visible).toBe(false);
    SKY_GRADIENT.setKey('ENABLED', true);
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
