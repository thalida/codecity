import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { buildLabelAtlas } from '@/city/components/labels/labelAtlas';
import { attachLabelMeshToCell, writeLabelToSlot } from '@/city/components/labels/labelsCell';
import type { CellTile } from '@/city/layout/cellTile';
import { NodeKind } from '@/types/index';
import { LABEL_ELEVATION } from '@/constants/streets';
import { TYPOGRAPHY } from '../../../_helpers/typography';
import { building } from '../../../_helpers/buildingFixture';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal CellTile-shaped object for testing. The labelMesh is a
 * real THREE.InstancedMesh so attribute reads work correctly.
 */
function makeFakeCell(capacity = 4): CellTile {
  const placeholderGeom = new THREE.BoxGeometry(1, 1, 1);
  const placeholderMat = new THREE.MeshBasicMaterial({ visible: false });
  const labelMesh = new THREE.InstancedMesh(placeholderGeom, placeholderMat, capacity);
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < capacity; i++) labelMesh.setMatrixAt(i, zero);
  labelMesh.instanceMatrix.needsUpdate = true;

  return {
    cellId: 0,
    cx: 0,
    cz: 0,
    boundsSphere: new THREE.Sphere(),
    capacity,
    used: 0,
    freeSlots: [],
    detailMesh: new THREE.InstancedMesh(placeholderGeom, placeholderMat, capacity),
    labelMesh,
    streetMesh: null,
    buildings: new Array(capacity).fill(null),
    dirs: new Set(),
  };
}

// Build a label-test building for a given file name + slot. The label-write
// path reads `file.name` (atlas key) and `h`/`x`/`y` for positioning.
function buildingForLabel(name: string, slotId: number) {
  return building({
    x: 10,
    y: 20,
    w: 8,
    d: 8,
    h: 4,
    cellId: 0,
    slotId,
    file: {
      name,
      type: NodeKind.File,
      path: `src/${name}`,
      fullPath: `/repo/src/${name}`,
      extension: 'ts',
      size: 100,
      lines: 10,
      binary: false,
      created: '2024-01-01T00:00:00Z',
      modified: '2024-01-01T00:00:00Z',
      git: { created: null, modified: null },
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('attachLabelMeshToCell', () => {
  it('replaces placeholder geometry with iUvRect + iFlip attributes', () => {
    const cell = makeFakeCell(4);
    const fakeTexture = new THREE.CanvasTexture(document.createElement('canvas'));
    const uniforms: Record<string, THREE.IUniform> = { uMap: { value: fakeTexture } };

    attachLabelMeshToCell(cell, uniforms);

    const geom = cell.labelMesh.geometry;
    expect(geom.getAttribute('iUvRect')).toBeDefined();
    expect(geom.getAttribute('iFlip')).toBeDefined();

    // iUvRect should be a vec4 per instance (itemSize = 4).
    const iUvRect = geom.getAttribute('iUvRect') as THREE.InstancedBufferAttribute;
    expect(iUvRect.itemSize).toBe(4);
    expect(iUvRect.count).toBe(4); // capacity

    // iFlip should be a float per instance (itemSize = 1).
    const iFlip = geom.getAttribute('iFlip') as THREE.InstancedBufferAttribute;
    expect(iFlip.itemSize).toBe(1);
  });

  it('installs a ShaderMaterial with the provided uniforms', () => {
    const cell = makeFakeCell(2);
    const fakeTexture = new THREE.CanvasTexture(document.createElement('canvas'));
    const uniforms: Record<string, THREE.IUniform> = { uMap: { value: fakeTexture } };

    attachLabelMeshToCell(cell, uniforms);

    const mat = cell.labelMesh.material as THREE.ShaderMaterial;
    expect(mat).toBeInstanceOf(THREE.ShaderMaterial);
    expect(mat.uniforms.uMap.value).toBe(fakeTexture);
  });
});

describe('writeLabelToSlot', () => {
  it('writes a non-zero matrix and UV rect for a known label', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const cell = makeFakeCell(4);
    const fakeTexture = new THREE.CanvasTexture(document.createElement('canvas'));
    const uniforms: Record<string, THREE.IUniform> = { uMap: { value: fakeTexture } };
    attachLabelMeshToCell(cell, uniforms);

    const atlas = buildLabelAtlas(['index.ts'], TYPOGRAPHY);
    const b = buildingForLabel('index.ts', 0);

    writeLabelToSlot(cell, b, atlas);

    const tmpM = new THREE.Matrix4();
    cell.labelMesh.getMatrixAt(0, tmpM);

    // A non-zero-scale matrix has a non-zero determinant.
    expect(Math.abs(tmpM.determinant())).toBeGreaterThan(0);

    // iUvRect at slot 0 should reference the atlas rect for 'index.ts'.
    const rect = atlas.rectByText.get('index.ts')!;
    const iUvRectAttr = cell.labelMesh.geometry.getAttribute(
      'iUvRect'
    ) as THREE.InstancedBufferAttribute;
    expect(iUvRectAttr.getX(0)).toBeCloseTo(rect.u);
    expect(iUvRectAttr.getY(0)).toBeCloseTo(rect.v);
    expect(iUvRectAttr.getZ(0)).toBeCloseTo(rect.w);
    expect(iUvRectAttr.getW(0)).toBeCloseTo(rect.h);
  });

  it('writes a zero-scale matrix when label is not in the atlas', () => {
    const cell = makeFakeCell(4);
    const fakeTexture = new THREE.CanvasTexture(document.createElement('canvas'));
    const uniforms: Record<string, THREE.IUniform> = { uMap: { value: fakeTexture } };
    attachLabelMeshToCell(cell, uniforms);

    // Atlas built without 'missing.ts'.
    const atlas = buildLabelAtlas(['other.ts'], TYPOGRAPHY);
    const b = buildingForLabel('missing.ts', 1);

    writeLabelToSlot(cell, b, atlas);

    const tmpM = new THREE.Matrix4();
    cell.labelMesh.getMatrixAt(1, tmpM);

    // Zero-scale matrix has determinant ≈ 0.
    expect(Math.abs(tmpM.determinant())).toBeCloseTo(0);
  });

  it('positions the label above the building roof (y = b.h + ELEVATION)', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const cell = makeFakeCell(4);
    const fakeTexture = new THREE.CanvasTexture(document.createElement('canvas'));
    const uniforms: Record<string, THREE.IUniform> = { uMap: { value: fakeTexture } };
    attachLabelMeshToCell(cell, uniforms);

    const atlas = buildLabelAtlas(['roof.ts'], TYPOGRAPHY);
    const b = buildingForLabel('roof.ts', 2);

    writeLabelToSlot(cell, b, atlas);

    const tmpM = new THREE.Matrix4();
    cell.labelMesh.getMatrixAt(2, tmpM);

    // Extract translation (column 3 of the matrix).
    const pos = new THREE.Vector3();
    pos.setFromMatrixPosition(tmpM);

    // y should equal b.h + LABEL_ELEVATION (the evicted designer constant, 0).
    expect(pos.y).toBeCloseTo(b.h + LABEL_ELEVATION);
    expect(pos.x).toBeCloseTo(b.x);
    expect(pos.z).toBeCloseTo(b.y);
  });
});
