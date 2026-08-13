// SafeLineSegmentsGeometry exists because the stock interleaved-with-offset
// instance layout is mis-fetched by some Android GPU drivers (phantom
// "closing" segments, exploded quads). These pin the flat layout's contract.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { SafeLineSegmentsGeometry } from '@/city/utils/safeLineSegmentsGeometry';

const TWO_SEGMENTS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

describe('SafeLineSegmentsGeometry', () => {
  it('splits (start,end) pairs into two flat non-interleaved attributes', () => {
    const geo = new SafeLineSegmentsGeometry();
    geo.setPositions(TWO_SEGMENTS);
    const start = geo.getAttribute('instanceStart') as THREE.InstancedBufferAttribute;
    const end = geo.getAttribute('instanceEnd') as THREE.InstancedBufferAttribute;
    expect(start).toBeInstanceOf(THREE.InstancedBufferAttribute);
    expect(end).toBeInstanceOf(THREE.InstancedBufferAttribute);
    expect(Array.from(start.array)).toEqual([0, 1, 2, 6, 7, 8]);
    expect(Array.from(end.array)).toEqual([3, 4, 5, 9, 10, 11]);
    expect(geo.instanceCount).toBe(2);
  });

  it('reuses the attribute arrays when the segment count is unchanged', () => {
    const geo = new SafeLineSegmentsGeometry();
    geo.setColors(TWO_SEGMENTS);
    const first = geo.getAttribute('instanceColorStart');
    geo.setColors(TWO_SEGMENTS.map((v) => v * 2));
    expect(geo.getAttribute('instanceColorStart')).toBe(first);
    expect(Array.from(geo.getAttribute('instanceColorStart').array)).toEqual([0, 2, 4, 12, 14, 16]);
  });

  it('reallocates when the segment count changes', () => {
    const geo = new SafeLineSegmentsGeometry();
    geo.setPositions(TWO_SEGMENTS);
    geo.setPositions([0, 0, 0, 1, 1, 1]);
    expect(geo.instanceCount).toBe(1);
    expect((geo.getAttribute('instanceStart') as THREE.InstancedBufferAttribute).count).toBe(1);
  });

  it('computes bounds from the flat layout (culling still works)', () => {
    const geo = new SafeLineSegmentsGeometry();
    geo.setPositions(TWO_SEGMENTS);
    expect(geo.boundingBox?.min.toArray()).toEqual([0, 1, 2]);
    expect(geo.boundingBox?.max.toArray()).toEqual([9, 10, 11]);
  });
});
