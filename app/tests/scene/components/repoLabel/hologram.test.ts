import { describe, it, expect, afterEach } from 'vitest';
import * as THREE from 'three';
import { createHologramStyle } from '@/scene/components/repoLabel/hologram.js';
import { createRepoNameTexture } from '@/scene/components/repoLabel/textCanvas.js';

describe('createHologramStyle()', () => {
  let style: ReturnType<typeof createHologramStyle> | null = null;

  afterEach(() => {
    style?.dispose();
    style = null;
  });

  it('returns a group with a beam mesh and a text-panel mesh', () => {
    const tex = createRepoNameTexture('codecity');
    style = createHologramStyle(tex.texture, tex.aspect);
    expect(style.group.children.length).toBe(2);
    const types = style.group.children
      .map((c) => ((c as THREE.Mesh).geometry as { type?: string }).type)
      .sort();
    expect(types).toContain('CylinderGeometry');
    expect(types).toContain('PlaneGeometry');
  });

  it('tick rotates the text panel to face the camera (Y-locked)', () => {
    const tex = createRepoNameTexture('codecity');
    style = createHologramStyle(tex.texture, tex.aspect);
    // World-anchor the panel so its position is non-zero (mimics what
    // setAnchor does in the real flow).
    style.group.position.set(0, 50, 0);
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(100, 50, 0); // east of the label
    style.tick(0.016, camera, 1.0);
    // Panel is the PlaneGeometry child. Its world quaternion should
    // rotate the +Z forward vector toward the camera in XZ only.
    const panel = style.group.children.find(
      (c) => ((c as THREE.Mesh).geometry as { type?: string }).type === 'PlaneGeometry'
    ) as THREE.Mesh;
    panel.updateMatrixWorld(true);
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(panel.quaternion);
    // Forward should point roughly toward +X (camera direction), with
    // y ≈ 0 (Y-locked billboard).
    expect(forward.x).toBeGreaterThan(0.5);
    expect(Math.abs(forward.y)).toBeLessThan(0.05);
  });

  it('setOpacity propagates to both materials', () => {
    const tex = createRepoNameTexture('codecity');
    style = createHologramStyle(tex.texture, tex.aspect);
    style.setOpacity(0.3);
    for (const child of style.group.children) {
      const mat = (child as THREE.Mesh).material as THREE.ShaderMaterial;
      expect(mat.uniforms.uOpacity.value).toBeCloseTo(0.3);
    }
  });

  it('dispose releases both meshes', () => {
    const tex = createRepoNameTexture('codecity');
    style = createHologramStyle(tex.texture, tex.aspect);
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
