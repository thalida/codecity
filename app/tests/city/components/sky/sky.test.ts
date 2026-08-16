// The sky component: the icosphere and its render-order, depth and side flags,
// the settings effect pushing SCENE into uniforms, tick advancing uTime and
// following the camera, and dispose releasing GPU resources.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';

import { createSky } from '@/city/components/sky';
import { SCENE } from '@/state/settings/fields/scene';
import { RENDER_ORDERS } from '@/city/types/renderOrders';
import type { FrameContext } from '@/city/types';
import { makeSceneContext } from '../../../_helpers/cityFixtures';

function resetStores() {
  SCENE.value = {
    ...SCENE.value,
    SKY_COLOR: '#010005',
    STARS_ENABLED: true,
    STARS_DENSITY: 0.0075,
    AURORA_ENABLED: true,
    AURORA_INTENSITY: 0.022,
  };
}

// The sky uses nothing from ctx at construction; a minimal stub suffices.

describe('createSky()', () => {
  let sky: ReturnType<typeof createSky>;

  beforeEach(() => {
    resetStores();
    sky = createSky(makeSceneContext());
  });

  afterEach(() => {
    sky.dispose();
  });

  it('builds an inverted icosphere mesh (exposed as `group`)', () => {
    expect(sky.group).toBeInstanceOf(THREE.Mesh);
    const geom = sky.group.geometry as THREE.IcosahedronGeometry;
    expect(geom.type).toBe('IcosahedronGeometry');
    const mat = sky.group.material as THREE.ShaderMaterial;
    expect(mat).toBeInstanceOf(THREE.ShaderMaterial);
    expect(mat.side).toBe(THREE.BackSide);
    expect(mat.depthWrite).toBe(false);
  });

  it('sits at the documented render order (-1000)', () => {
    expect(sky.group.renderOrder).toBe(RENDER_ORDERS.SKY);
    expect(sky.group.renderOrder).toBe(-1000);
  });

  it('effect seeds uSkyColor from SKY_COLOR at construction', () => {
    const mat = sky.group.material as THREE.ShaderMaterial;
    const sky_ = mat.uniforms.uSkyColor.value as THREE.Color;
    // SKY_COLOR is '#010005' → 0x01/255, 0x00/255, 0x05/255.
    expect(sky_.r).toBeCloseTo(0x01 / 255);
    expect(sky_.g).toBeCloseTo(0);
    expect(sky_.b).toBeCloseTo(0x05 / 255);
  });

  it('does NOT carry uHorizonColor / uHorizonHeight / uStarMinElevation uniforms', () => {
    const mat = sky.group.material as THREE.ShaderMaterial;
    expect(mat.uniforms.uHorizonColor).toBeUndefined();
    expect(mat.uniforms.uHorizonHeight).toBeUndefined();
    expect(mat.uniforms.uStarMinElevation).toBeUndefined();
  });

  it('settings effect re-applies fresh config into uniforms on SCENE mutation', () => {
    SCENE.value = { ...SCENE.value, STARS_DENSITY: 0.01, SKY_COLOR: '#ffffff' };
    const mat = sky.group.material as THREE.ShaderMaterial;
    expect(mat.uniforms.uStarDensity.value).toBeCloseTo(0.01);
    const sky_ = mat.uniforms.uSkyColor.value as THREE.Color;
    expect(sky_.r).toBeCloseTo(1);
    expect(sky_.g).toBeCloseTo(1);
    expect(sky_.b).toBeCloseTo(1);
  });

  it('settings effect reflects STARS_ENABLED toggling into uStarsEnabled', () => {
    const mat = sky.group.material as THREE.ShaderMaterial;
    SCENE.value = { ...SCENE.value, STARS_ENABLED: false };
    expect(mat.uniforms.uStarsEnabled.value).toBe(0.0);
    SCENE.value = { ...SCENE.value, STARS_ENABLED: true };
    expect(mat.uniforms.uStarsEnabled.value).toBe(1.0);
  });

  it('settings effect reflects AURORA_ENABLED / AURORA_INTENSITY into uniforms', () => {
    const mat = sky.group.material as THREE.ShaderMaterial;
    SCENE.value = { ...SCENE.value, AURORA_ENABLED: false, AURORA_INTENSITY: 0.05 };
    expect(mat.uniforms.uAuroraEnabled.value).toBe(0.0);
    expect(mat.uniforms.uAuroraIntensity.value).toBeCloseTo(0.05);
    SCENE.value = { ...SCENE.value, AURORA_ENABLED: true };
    expect(mat.uniforms.uAuroraEnabled.value).toBe(1.0);
  });

  it('tick() advances uTime AND copies the camera position into group.position', () => {
    const mat = sky.group.material as THREE.ShaderMaterial;
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(7, 8, 9);
    const frame: FrameContext = { dt: 2.5, time: 100, camera };

    const before = mat.uniforms.uTime.value;
    sky.tick!(2.5, frame);
    expect(mat.uniforms.uTime.value).toBeCloseTo(before + 2.5);
    expect(sky.group.position.x).toBeCloseTo(7);
    expect(sky.group.position.y).toBeCloseTo(8);
    expect(sky.group.position.z).toBeCloseTo(9);

    camera.position.set(1, 2, 3);
    sky.tick!(0.1, { dt: 0.1, time: 100.1, camera });
    expect(mat.uniforms.uTime.value).toBeCloseTo(before + 2.6);
    expect(sky.group.position.x).toBeCloseTo(1);
    expect(sky.group.position.z).toBeCloseTo(3);
  });

  it('dispose() releases geometry and material', () => {
    const geom = sky.group.geometry;
    const mat = sky.group.material as THREE.ShaderMaterial;
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

  it('dispose() stops the effect: a later SCENE mutation never reaches the uniforms', () => {
    const mat = sky.group.material as THREE.ShaderMaterial;
    const before = (mat.uniforms.uSkyColor.value as THREE.Color).getHex();
    expect(before).not.toBe(0xabcdef); // otherwise the assertion below is vacuous

    sky.dispose();
    SCENE.value = { ...SCENE.value, SKY_COLOR: '#abcdef' };

    expect((mat.uniforms.uSkyColor.value as THREE.Color).getHex()).toBe(before);
  });
});
