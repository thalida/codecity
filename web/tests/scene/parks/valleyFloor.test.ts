import * as THREE from 'three';
import { describe, it, expect, beforeEach } from 'vitest';
import { createValleyFloor } from '@/scene/parks/valleyFloor.js';
import { PARKS_PALETTE } from '@/config/parks.js';
import { CAMERA_PERSPECTIVE } from '@/config/view.js';

describe('createValleyFloor', () => {
  beforeEach(() => {
    CAMERA_PERSPECTIVE.setKey('FAR', 5000);
    PARKS_PALETTE.setKey('GROUND_COLOR', '#030706');
    PARKS_PALETTE.setKey('GROUND_ENABLED', true);
  });

  it('positions at origin when gem is null', () => {
    const floor = createValleyFloor(null);
    expect(floor.mesh.position.x).toBe(0);
    expect(floor.mesh.position.y).toBe(-0.5);
    expect(floor.mesh.position.z).toBe(0);
    floor.dispose();
  });

  it('positions at the gem on construction', () => {
    const gem = new THREE.Vector3(123, 0, -456);
    const floor = createValleyFloor(gem);
    expect(floor.mesh.position.x).toBe(123);
    expect(floor.mesh.position.z).toBe(-456);
    floor.dispose();
  });

  it('setAnchor repositions the mesh', () => {
    const floor = createValleyFloor(null);
    floor.setAnchor(new THREE.Vector3(10, 0, 20));
    expect(floor.mesh.position.x).toBe(10);
    expect(floor.mesh.position.z).toBe(20);
    floor.setAnchor(null);
    expect(floor.mesh.position.x).toBe(0);
    expect(floor.mesh.position.z).toBe(0);
    floor.dispose();
  });
});
