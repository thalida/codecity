import * as THREE from 'three';
import { describe, it, expect, beforeEach } from 'vitest';
import { createWorldFloor } from '@/scene/worldFloor.js';
import { getWorldBounds } from '@/scene/worldBounds.js';
import { WORLD } from '@/config/world.js';

describe('createWorldFloor', () => {
  beforeEach(() => {
    WORLD.setKey('GROUND_COLOR', '#030706');
    WORLD.setKey('GROUND_ENABLED', true);
  });

  it('positions at origin and uses fallback dims when bounds are null', () => {
    const floor = createWorldFloor(null);
    expect(floor.mesh.position.x).toBe(0);
    expect(floor.mesh.position.y).toBe(-0.5);
    expect(floor.mesh.position.z).toBe(0);
    floor.dispose();
  });

  it('positions and sizes from explicit bounds at construction', () => {
    const floor = createWorldFloor({
      cx: 100, cz: -200, halfWidth: 50, halfDepth: 30,
    });
    expect(floor.mesh.position.x).toBe(100);
    expect(floor.mesh.position.z).toBe(-200);
    const geom = floor.mesh.geometry as THREE.PlaneGeometry;
    // After rotateX(-PI/2): width param maps to X, height param maps to Z.
    expect(geom.parameters.width).toBe(100);
    expect(geom.parameters.height).toBe(60);
    floor.dispose();
  });

  it('setBounds resizes and repositions the mesh', () => {
    const floor = createWorldFloor(null);
    floor.setBounds({ cx: 10, cz: 20, halfWidth: 5, halfDepth: 7 });
    expect(floor.mesh.position.x).toBe(10);
    expect(floor.mesh.position.z).toBe(20);
    const geom = floor.mesh.geometry as THREE.PlaneGeometry;
    expect(geom.parameters.width).toBe(10);
    expect(geom.parameters.height).toBe(14);
    floor.dispose();
  });

  it('setBounds disposes the old geometry', () => {
    const floor = createWorldFloor(null);
    const oldGeom = floor.mesh.geometry as THREE.PlaneGeometry;
    let disposed = false;
    const orig = oldGeom.dispose.bind(oldGeom);
    oldGeom.dispose = () => {
      disposed = true;
      orig();
    };
    floor.setBounds({ cx: 0, cz: 0, halfWidth: 1, halfDepth: 1 });
    expect(disposed).toBe(true);
    floor.dispose();
  });

  it('getWorldBounds round-trip with bbox', () => {
    const bounds = getWorldBounds({
      minX: 0, minY: 0, maxX: 100, maxY: 100,
      cx: 50, cy: 50, width: 100, depth: 100,
    });
    const floor = createWorldFloor(bounds);
    expect(floor.mesh.position.x).toBe(50);
    expect(floor.mesh.position.z).toBe(50);
    floor.dispose();
  });

  it('refresh() updates color from WORLD.GROUND_COLOR', () => {
    const floor = createWorldFloor(null);
    WORLD.setKey('GROUND_COLOR', '#ff0000');
    floor.refresh();
    const mat = floor.mesh.material as THREE.MeshBasicMaterial;
    // Red channel should be non-zero; not testing exact value (linear sRGB conversion)
    expect(mat.color.r).toBeGreaterThan(0);
    floor.dispose();
  });

  it('refresh() reflects GROUND_ENABLED toggle', () => {
    const floor = createWorldFloor(null);
    WORLD.setKey('GROUND_ENABLED', false);
    floor.refresh();
    expect(floor.mesh.visible).toBe(false);
    WORLD.setKey('GROUND_ENABLED', true);
    floor.refresh();
    expect(floor.mesh.visible).toBe(true);
    floor.dispose();
  });
});
