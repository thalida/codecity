// floor.test.ts — verifies the createFloor() factory builds the flat
// plane with the documented render order, depth flags, geometry,
// position, and material; that refresh() pushes fresh config values
// (color, size, position, visibility); and that dispose() releases
// GPU resources.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { createFloor } from '@/scene/floor/floor.js';
import { FLOOR } from '@/config/floor.js';
import { RENDER_ORDERS } from '@/constants';

function resetStore() {
  FLOOR.set({
    ENABLED: true,
    COLOR: '#080515',
    SIZE_MULT: 0.9,
    Y_OFFSET: -0.1,
  });
}

describe('createFloor()', () => {
  let floor: ReturnType<typeof createFloor>;

  beforeEach(() => {
    resetStore();
    floor = createFloor();
  });

  afterEach(() => {
    floor.dispose();
  });

  it('builds a flat plane mesh laid horizontally', () => {
    expect(floor.mesh).toBeInstanceOf(THREE.Mesh);
    const geom = floor.mesh.geometry as THREE.PlaneGeometry;
    expect(geom.type).toBe('PlaneGeometry');
    const mat = floor.mesh.material as THREE.MeshBasicMaterial;
    expect(mat).toBeInstanceOf(THREE.MeshBasicMaterial);
    // -π/2 around X lays the plane flat in XZ.
    expect(floor.mesh.rotation.x).toBeCloseTo(-Math.PI / 2);
  });

  it('sits at the documented render order (-800)', () => {
    expect(floor.mesh.renderOrder).toBe(RENDER_ORDERS.FLOOR);
    expect(floor.mesh.renderOrder).toBe(-800);
  });

  it('sits at the Y_OFFSET position below world origin', () => {
    expect(floor.mesh.position.y).toBeCloseTo(-0.1);
  });

  it('uses the default COLOR', () => {
    const mat = floor.mesh.material as THREE.MeshBasicMaterial;
    // '#080515' parsed via THREE.Color with LinearSRGBColorSpace
    // preserves the sRGB byte values: 0x08/255, 0x05/255, 0x15/255.
    expect(mat.color.r).toBeCloseTo(0x08 / 255);
    expect(mat.color.g).toBeCloseTo(0x05 / 255);
    expect(mat.color.b).toBeCloseTo(0x15 / 255);
  });

  it('refresh() pushes fresh config values into the material', () => {
    FLOOR.setKey('COLOR', '#ffffff');
    FLOOR.setKey('Y_OFFSET', -5);
    floor.refresh();
    const mat = floor.mesh.material as THREE.MeshBasicMaterial;
    expect(mat.color.r).toBeCloseTo(1);
    expect(mat.color.g).toBeCloseTo(1);
    expect(mat.color.b).toBeCloseTo(1);
    expect(floor.mesh.position.y).toBeCloseTo(-5);
  });

  it('refresh() hides the mesh when ENABLED is false', () => {
    FLOOR.setKey('ENABLED', false);
    floor.refresh();
    expect(floor.mesh.visible).toBe(false);
    FLOOR.setKey('ENABLED', true);
    floor.refresh();
    expect(floor.mesh.visible).toBe(true);
  });

  it('dispose() releases geometry and material', () => {
    const geom = floor.mesh.geometry;
    const mat = floor.mesh.material as THREE.MeshBasicMaterial;
    let disposedGeom = false;
    let disposedMat = false;
    geom.dispose = () => { disposedGeom = true; };
    const origDispose = mat.dispose.bind(mat);
    mat.dispose = () => { disposedMat = true; origDispose(); };
    floor.dispose();
    expect(disposedGeom).toBe(true);
    expect(disposedMat).toBe(true);
  });
});
