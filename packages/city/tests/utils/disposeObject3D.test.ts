// disposeObject3D.test.ts — parity proof for the shared per-Object3D GPU
// disposer extracted from the gem/streets/buildings/world hand-copies.
// Verifies: geometry + material + texture-prop disposal on a built subtree,
// the sharedMaterial guard (module-owned material is NOT freed), idempotency
// via userData.disposed, and array-material awareness.

import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';

import { disposeObject3D } from '../../src/utils/disposeObject3D';

// A material whose .dispose and texture-valued props we can spy on. We attach
// a fake texture under an own property (mirrors how three materials carry maps).
function makeSpyMaterial() {
  const tex = { isTexture: true, dispose: vi.fn() };
  const mat = new THREE.MeshBasicMaterial();
  // Stash a texture-valued own property so the texture-walk picks it up.
  (mat as unknown as Record<string, unknown>).map = tex;
  const disposeSpy = vi.spyOn(mat, 'dispose');
  return { mat, tex, disposeSpy };
}

describe('disposeObject3D', () => {
  it('disposes geometry + material + texture-valued material props', () => {
    const geom = new THREE.BufferGeometry();
    const geomSpy = vi.spyOn(geom, 'dispose');
    const { mat, tex, disposeSpy } = makeSpyMaterial();
    const mesh = new THREE.Mesh(geom, mat);

    disposeObject3D(mesh);

    expect(geomSpy).toHaveBeenCalledTimes(1);
    expect(disposeSpy).toHaveBeenCalledTimes(1);
    expect(tex.dispose).toHaveBeenCalledTimes(1);
  });

  it('disposes a whole subtree when passed to Object3D.traverse()', () => {
    const root = new THREE.Group();
    const childGeom = new THREE.BufferGeometry();
    const childGeomSpy = vi.spyOn(childGeom, 'dispose');
    const { mat, disposeSpy } = makeSpyMaterial();
    root.add(new THREE.Mesh(childGeom, mat));

    root.traverse(disposeObject3D);

    expect(childGeomSpy).toHaveBeenCalledTimes(1);
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });

  it('SKIPS material disposal when userData.sharedMaterial is set', () => {
    const geom = new THREE.BufferGeometry();
    const geomSpy = vi.spyOn(geom, 'dispose');
    const { mat, tex, disposeSpy } = makeSpyMaterial();
    const mesh = new THREE.Mesh(geom, mat);
    mesh.userData.sharedMaterial = true;

    disposeObject3D(mesh);

    // Geometry is still released, but the shared material (and its textures)
    // must NOT be disposed — freeing it would blank every mesh sharing it.
    expect(geomSpy).toHaveBeenCalledTimes(1);
    expect(disposeSpy).not.toHaveBeenCalled();
    expect(tex.dispose).not.toHaveBeenCalled();
  });

  it('is idempotent — a second call no-ops via userData.disposed', () => {
    const geom = new THREE.BufferGeometry();
    const geomSpy = vi.spyOn(geom, 'dispose');
    const { mat, disposeSpy } = makeSpyMaterial();
    const mesh = new THREE.Mesh(geom, mat);

    disposeObject3D(mesh);
    expect(mesh.userData.disposed).toBe(true);
    disposeObject3D(mesh);

    expect(geomSpy).toHaveBeenCalledTimes(1);
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });

  it('is array-material aware — disposes every material in the array', () => {
    const geom = new THREE.BufferGeometry();
    const a = makeSpyMaterial();
    const b = makeSpyMaterial();
    const mesh = new THREE.Mesh(geom, [a.mat, b.mat]);

    disposeObject3D(mesh);

    expect(a.disposeSpy).toHaveBeenCalledTimes(1);
    expect(b.disposeSpy).toHaveBeenCalledTimes(1);
    expect(a.tex.dispose).toHaveBeenCalledTimes(1);
    expect(b.tex.dispose).toHaveBeenCalledTimes(1);
  });

  it('no-ops on null', () => {
    expect(() => disposeObject3D(null)).not.toThrow();
  });
});
