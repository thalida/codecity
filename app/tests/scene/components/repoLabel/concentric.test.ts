import { describe, it, expect, afterEach } from 'vitest';
import * as THREE from 'three';
import { createConcentricStyle } from '@/scene/components/repoLabel/concentric.js';
import { createRepoNameTexture } from '@/scene/components/repoLabel/textCanvas.js';

describe('createConcentricStyle()', () => {
  let style: ReturnType<typeof createConcentricStyle> | null = null;

  afterEach(() => {
    style?.dispose();
    style = null;
  });

  it('returns a group with an outer text ring and an inner decorative ring', () => {
    const tex = createRepoNameTexture('codecity');
    style = createConcentricStyle(tex.texture);
    expect(style.group.children.length).toBe(2);
    const meshes = style.group.children as THREE.Mesh[];
    for (const m of meshes) {
      expect(m.geometry.type).toBe('TorusGeometry');
    }
  });

  it('outer ring rotation is locked to horizontal', () => {
    const tex = createRepoNameTexture('codecity');
    style = createConcentricStyle(tex.texture);
    // Outer ring is the first child (added first in the factory).
    const outer = style.group.children[0];
    expect(outer.rotation.x).toBeCloseTo(Math.PI / 2);
  });

  it('inner ring spins on its local Y axis as tick advances', () => {
    const tex = createRepoNameTexture('codecity');
    style = createConcentricStyle(tex.texture);
    const inner = style.group.children[1];
    const before = inner.rotation.y;
    style.tick(1.0, new THREE.PerspectiveCamera(), 1.0);
    expect(inner.rotation.y).not.toBeCloseTo(before);
  });

  it('setOpacity propagates to both ring materials', () => {
    const tex = createRepoNameTexture('codecity');
    style = createConcentricStyle(tex.texture);
    style.setOpacity(0.25);
    for (const child of style.group.children) {
      const mat = (child as THREE.Mesh).material as THREE.ShaderMaterial;
      expect(mat.uniforms.uOpacity.value).toBeCloseTo(0.25);
    }
  });

  it('dispose releases both ring geometries and materials', () => {
    const tex = createRepoNameTexture('codecity');
    style = createConcentricStyle(tex.texture);
    let disposeCount = 0;
    for (const child of style.group.children) {
      const m = child as THREE.Mesh;
      const orig = m.geometry.dispose.bind(m.geometry);
      m.geometry.dispose = () => { disposeCount++; orig(); };
    }
    style.dispose();
    expect(disposeCount).toBe(2);
    style = null;
  });
});
