// web/tests/scene/cityFootprint/footprint.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { createCityFootprint } from '@/scene/cityFootprint/footprint.js';
import { FOOTPRINT } from '@/config/footprint.js';
import { StreetAxis } from '@/types';
import type { CityLayout } from '@/types';

function resetFootprint() {
  FOOTPRINT.set({ ENABLED: true, HALO_WIDTH: 64, CORNER_RADIUS: 24, COLOR: '#0a0b0f' });
}

function singleBuildingLayout(): CityLayout {
  return {
    buildings: [{ x: 0, y: 0, w: 10, d: 10, h: 16, floors: 1, file: { path: 'a', size: 0, lines: 0 } } as never],
    streets: [], paths: [],
    lineStats: { min: 0, max: 0 }, byteStats: { min: 0, max: 0 },
    bbox: { minX: -10, minY: -10, maxX: 10, maxY: 10, cx: 0, cy: 0, width: 20, depth: 20 },
  };
}

describe('createCityFootprint', () => {
  beforeEach(() => resetFootprint());

  it('emits one InstancedMesh instance per layout rect', () => {
    const layout: CityLayout = {
      buildings: [
        { x: 0, y: 0, w: 20, d: 20, h: 32, floors: 2, file: { path: 'a', size: 0, lines: 0 } } as never,
      ],
      streets: [
        { x: 100, y: 0, length: 200, width: 32, orientation: StreetAxis.X, isRoot: true, name: 'main' } as never,
      ],
      paths: [
        { x: 0, y: 50, w: 8, d: 8 } as never,
      ],
      lineStats: { min: 0, max: 0 },
      byteStats: { min: 0, max: 0 },
      bbox: { minX: -100, minY: -100, maxX: 200, maxY: 100, cx: 50, cy: 0, width: 300, depth: 200 },
    };
    const fp = createCityFootprint(layout);
    const mesh = fp.group.children[0] as THREE.InstancedMesh;
    expect(mesh).toBeInstanceOf(THREE.InstancedMesh);
    expect(mesh.count).toBe(3);
  });

  it('attaches a per-instance aHalfExtent attribute carrying inflated half-extents', () => {
    FOOTPRINT.setKey('HALO_WIDTH', 50);
    const layout: CityLayout = {
      buildings: [{ x: 0, y: 0, w: 20, d: 40, h: 32, floors: 2, file: { path: 'a', size: 0, lines: 0 } } as never],
      streets: [], paths: [],
      lineStats: { min: 0, max: 0 }, byteStats: { min: 0, max: 0 },
      bbox: { minX: -10, minY: -20, maxX: 10, maxY: 20, cx: 0, cy: 0, width: 20, depth: 40 },
    };
    const fp = createCityFootprint(layout);
    const mesh = fp.group.children[0] as THREE.InstancedMesh;
    const attr = mesh.geometry.getAttribute('aHalfExtent') as THREE.InstancedBufferAttribute;
    expect(attr).toBeTruthy();
    // Inflated half-width = (20 + 2*50)/2 = 60; half-depth = (40 + 2*50)/2 = 70
    expect(attr.getX(0)).toBeCloseTo(60);
    expect(attr.getY(0)).toBeCloseTo(70);
  });

  it('uses a ShaderMaterial whose uColor matches FOOTPRINT.COLOR', () => {
    FOOTPRINT.setKey('COLOR', '#abcdef');
    const fp = createCityFootprint(singleBuildingLayout());
    const mesh = fp.group.children[0] as THREE.InstancedMesh;
    const mat = mesh.material as THREE.ShaderMaterial;
    expect(mat).toBeInstanceOf(THREE.ShaderMaterial);
    const color = mat.uniforms.uColor.value as THREE.Color;
    const expected = new THREE.Color().setStyle('#abcdef', THREE.LinearSRGBColorSpace);
    expect(color.r).toBeCloseTo(expected.r);
    expect(color.g).toBeCloseTo(expected.g);
    expect(color.b).toBeCloseTo(expected.b);
  });

  it('uCornerRadius uniform matches FOOTPRINT.CORNER_RADIUS', () => {
    FOOTPRINT.setKey('CORNER_RADIUS', 33);
    const fp = createCityFootprint(singleBuildingLayout());
    const mesh = fp.group.children[0] as THREE.InstancedMesh;
    const mat = mesh.material as THREE.ShaderMaterial;
    expect(mat.uniforms.uCornerRadius.value).toBe(33);
  });

  it('hides the group when FOOTPRINT.ENABLED is false', () => {
    FOOTPRINT.setKey('ENABLED', false);
    const fp = createCityFootprint(singleBuildingLayout());
    expect(fp.group.visible).toBe(false);
  });

  it('refresh() picks up COLOR + CORNER_RADIUS + ENABLED changes without rebuild', () => {
    const fp = createCityFootprint(singleBuildingLayout());
    FOOTPRINT.setKey('COLOR', '#112233');
    FOOTPRINT.setKey('CORNER_RADIUS', 8);
    FOOTPRINT.setKey('ENABLED', false);
    fp.refresh();
    const mesh = fp.group.children[0] as THREE.InstancedMesh;
    const mat = mesh.material as THREE.ShaderMaterial;
    const color = mat.uniforms.uColor.value as THREE.Color;
    const expected = new THREE.Color().setStyle('#112233', THREE.LinearSRGBColorSpace);
    expect(color.r).toBeCloseTo(expected.r);
    expect(color.g).toBeCloseTo(expected.g);
    expect(color.b).toBeCloseTo(expected.b);
    expect(mat.uniforms.uCornerRadius.value).toBe(8);
    expect(fp.group.visible).toBe(false);
  });
});
