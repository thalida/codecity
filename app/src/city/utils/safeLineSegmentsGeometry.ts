// city/utils/safeLineSegmentsGeometry.ts — LineSegmentsGeometry with flat
// (non-interleaved) instanced attributes. The stock class packs each segment's
// start/end into one interleaved buffer read at byte offsets, a layout some
// Android GPU drivers mis-fetch per instance: path lines grow a phantom
// diagonal "closing" segment and outline quads explode across the screen.
// Desktop ANGLE fetches it correctly, so the corruption is phone-only.
// The fat-lines shader reads attributes by name and never sees the layout.

import * as THREE from 'three';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';

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

  /** Split `(abc abc)`-per-segment data into two flat divisor-1 attributes,
   *  reusing the existing arrays when the segment count is unchanged (the
   *  rainbow chase rewrites colors every frame). */
  private _writeSegmentPair(nameA: string, nameB: string, src: Float32Array): void {
    const segments = src.length / 6;
    let a = this.getAttribute(nameA) as THREE.InstancedBufferAttribute | undefined;
    let b = this.getAttribute(nameB) as THREE.InstancedBufferAttribute | undefined;
    if (!a || !b || a.count !== segments) {
      a = new THREE.InstancedBufferAttribute(new Float32Array(segments * 3), 3);
      b = new THREE.InstancedBufferAttribute(new Float32Array(segments * 3), 3);
      this.setAttribute(nameA, a);
      this.setAttribute(nameB, b);
    }
    const aArr = a.array as Float32Array;
    const bArr = b.array as Float32Array;
    for (let i = 0; i < segments; i++) {
      aArr[i * 3] = src[i * 6];
      aArr[i * 3 + 1] = src[i * 6 + 1];
      aArr[i * 3 + 2] = src[i * 6 + 2];
      bArr[i * 3] = src[i * 6 + 3];
      bArr[i * 3 + 1] = src[i * 6 + 4];
      bArr[i * 3 + 2] = src[i * 6 + 5];
    }
    a.needsUpdate = true;
    b.needsUpdate = true;
  }
}
