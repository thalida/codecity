import { describe, it, expect, afterEach } from 'vitest';
import * as THREE from 'three';
import { createRingStyle } from '@/scene/components/repoLabel/ring.js';
import { createRepoNameTexture } from '@/scene/components/repoLabel/textCanvas.js';

describe('createRingStyle()', () => {
  let style: ReturnType<typeof createRingStyle> | null = null;

  afterEach(() => {
    style?.dispose();
    style = null;
  });

  it('returns a group with a single torus mesh', () => {
    const tex = createRepoNameTexture('codecity');
    style = createRingStyle(tex.texture);
    expect(style.group).toBeInstanceOf(THREE.Group);
    expect(style.group.children.length).toBe(1);
    const mesh = style.group.children[0] as THREE.Mesh;
    expect(mesh).toBeInstanceOf(THREE.Mesh);
    expect(mesh.geometry.type).toBe('TorusGeometry');
  });

  it('uses additive blending', () => {
    const tex = createRepoNameTexture('codecity');
    style = createRingStyle(tex.texture);
    const mesh = style.group.children[0] as THREE.Mesh;
    const mat = mesh.material as THREE.ShaderMaterial;
    expect(mat.blending).toBe(THREE.AdditiveBlending);
    expect(mat.transparent).toBe(true);
    expect(mat.depthWrite).toBe(false);
  });

  it('seeds uniforms from the texture and config args', () => {
    const tex = createRepoNameTexture('codecity');
    style = createRingStyle(tex.texture);
    const mat = (style.group.children[0] as THREE.Mesh).material as THREE.ShaderMaterial;
    expect(mat.uniforms.uTime.value).toBe(0);
    expect(mat.uniforms.uMap.value).toBe(tex.texture);
    expect(typeof mat.uniforms.uSpinSpeed.value).toBe('number');
    expect(typeof mat.uniforms.uOpacity.value).toBe('number');
  });

  it('tick(dt, speed) advances uTime by dt * speed', () => {
    const tex = createRepoNameTexture('codecity');
    style = createRingStyle(tex.texture);
    const mat = (style.group.children[0] as THREE.Mesh).material as THREE.ShaderMaterial;
    style.tick(0.5, new THREE.PerspectiveCamera(), 2.0);
    expect(mat.uniforms.uTime.value).toBeCloseTo(1.0);
    style.tick(0.25, new THREE.PerspectiveCamera(), 4.0);
    expect(mat.uniforms.uTime.value).toBeCloseTo(2.0);
  });

  it('setOpacity updates uOpacity', () => {
    const tex = createRepoNameTexture('codecity');
    style = createRingStyle(tex.texture);
    const mat = (style.group.children[0] as THREE.Mesh).material as THREE.ShaderMaterial;
    style.setOpacity(0.4);
    expect(mat.uniforms.uOpacity.value).toBeCloseTo(0.4);
  });

  it('dispose releases geometry and material', () => {
    const tex = createRepoNameTexture('codecity');
    style = createRingStyle(tex.texture);
    const mesh = style.group.children[0] as THREE.Mesh;
    const geomSpy = mesh.geometry.dispose.bind(mesh.geometry);
    let disposed = false;
    mesh.geometry.dispose = () => { disposed = true; geomSpy(); };
    style.dispose();
    expect(disposed).toBe(true);
    style = null;
  });

  it('setDimensions scales the torus mesh', () => {
    const tex = createRepoNameTexture('codecity');
    style = createRingStyle(tex.texture);
    style.setDimensions({ cityRadius: 200, beamLength: 18 });
    const mesh = style.group.children[0] as THREE.Mesh;
    // 0.5 * 200 / 8 = 12.5
    expect(mesh.scale.x).toBeCloseTo(12.5);
    expect(mesh.scale.y).toBeCloseTo(12.5);
    expect(mesh.scale.z).toBeCloseTo(12.5);
  });
});
