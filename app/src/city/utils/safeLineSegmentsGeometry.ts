// city/utils/safeLineSegmentsGeometry.ts — LineSegmentsGeometry with flat,
// non-interleaved instance attributes. The stock interleaved-at-byte-offsets
// layout is mis-fetched by some Android drivers (phantom "closing" segments,
// exploded quads); the shader reads by name and never sees the difference.

import * as THREE from 'three';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { FLOATS_PER_SEGMENT, VEC3_COMPONENTS } from '@/city/utils/bufferLayout';

export class SafeLineSegmentsGeometry extends LineSegmentsGeometry {
  override setPositions(array: Float32Array | number[]): this {
    const src = array instanceof Float32Array ? array : new Float32Array(array);
    this._writeSegmentPair('instanceStart', 'instanceEnd', src);
    this.instanceCount = this.attributes.instanceStart.count;
    this.computeBoundingBox();
    this.computeBoundingSphere();
    return this;
  }

  override setColors(array: Float32Array | number[]): this {
    const src = array instanceof Float32Array ? array : new Float32Array(array);
    this._writeSegmentPair('instanceColorStart', 'instanceColorEnd', src);
    return this;
  }

  /** Split `(abc abc)`-per-segment data into two flat attributes, reusing
   *  the arrays at a stable segment count (the rainbow rewrites per frame). */
  private _writeSegmentPair(nameA: string, nameB: string, src: Float32Array): void {
    const segments = src.length / FLOATS_PER_SEGMENT;
    let a = this.getAttribute(nameA) as THREE.InstancedBufferAttribute | undefined;
    let b = this.getAttribute(nameB) as THREE.InstancedBufferAttribute | undefined;
    if (!a || !b || a.count !== segments) {
      const floats = segments * VEC3_COMPONENTS;
      a = new THREE.InstancedBufferAttribute(new Float32Array(floats), VEC3_COMPONENTS);
      b = new THREE.InstancedBufferAttribute(new Float32Array(floats), VEC3_COMPONENTS);
      this.setAttribute(nameA, a);
      this.setAttribute(nameB, b);
    }
    const aArr = a.array as Float32Array;
    const bArr = b.array as Float32Array;
    for (let i = 0; i < segments; i++) {
      const out = i * VEC3_COMPONENTS;
      const start = i * FLOATS_PER_SEGMENT;
      const end = start + VEC3_COMPONENTS;
      aArr[out] = src[start];
      aArr[out + 1] = src[start + 1];
      aArr[out + 2] = src[start + 2];
      bArr[out] = src[end];
      bArr[out + 1] = src[end + 1];
      bArr[out + 2] = src[end + 2];
    }
    a.needsUpdate = true;
    b.needsUpdate = true;
  }
}
