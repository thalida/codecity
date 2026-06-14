// sky.test.ts — verifies the createSky(ctx) COMPONENT builds the
// icosphere mesh (exposed as `group`) with the documented render-order /
// depth / side flags, that its settings effect pushes fresh SCENE values
// into uniforms (replacing the old refresh() hot-reload path) and
// re-applies on SCENE mutation, that tick() advances uTime AND follows the
// camera, and that dispose() releases GPU resources + stops the effect.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';

import { createSky } from '@/city/components/sky';
import { SCENE } from '@/state/stores/settings/scene';
import { RENDER_ORDERS } from '@/city/types/renderOrders';
import type { Picker } from '@/city/interaction/picker';
import type { FrameContext, SceneContext } from '@/city/types';

function resetStores() {
  SCENE.value = {
    ...SCENE.value,
    SKY_COLOR: '#010005',
    STARS_ENABLED: true,
    STARS_DENSITY: 0.0075,
  };
}

// The sky uses nothing from ctx at construction; a minimal stub suffices.
function makeCtx(): SceneContext {
  return {
    scene: new THREE.Scene(),
    picker: null as unknown as Picker,
    camera: null as unknown as THREE.PerspectiveCamera,
    renderer: null as unknown as THREE.WebGLRenderer,
  } as unknown as SceneContext;
}

describe('createSky()', () => {
  let sky: ReturnType<typeof createSky>;

  beforeEach(() => {
    resetStores();
    sky = createSky(makeCtx());
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

  it('dispose() stops the effect — later SCENE mutations do not throw', () => {
    sky.dispose();
    expect(() => {
      SCENE.value = { ...SCENE.value, SKY_COLOR: '#abcdef' };
    }).not.toThrow();
  });
});
