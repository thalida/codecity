// tilt.test.ts — composeShearMatrix: the single CPU mirror of the vertex
// shader's Y-driven XZ lean shear, shared by the outline mesh (visible
// skew) and the picker raycast (click targets on the leaned silhouette).

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { composeShearMatrix } from '@/city/components/buildings/tilt';

/** Apply the composed matrix to a local point and return [x, y, z]. */
function transform(
  position: THREE.Vector3,
  scale: THREE.Vector3,
  tiltX: number,
  tiltZ: number,
  local: [number, number, number]
): [number, number, number] {
  const m = composeShearMatrix(position, scale, tiltX, tiltZ, new THREE.Matrix4());
  const v = new THREE.Vector3(local[0], local[1], local[2]).applyMatrix4(m);
  return [v.x, v.y, v.z];
}

describe('composeShearMatrix()', () => {
  it('zero tilt is a plain TRS (scale + translate, no rotation/shear)', () => {
    const pos = new THREE.Vector3(10, 4, -6);
    const scale = new THREE.Vector3(2, 8, 3);
    const out = new THREE.Matrix4();
    composeShearMatrix(pos, scale, 0, 0, out);

    // Compare against THREE's own TRS compose with identity rotation.
    const expected = new THREE.Matrix4().compose(pos, new THREE.Quaternion(), scale);
    for (let i = 0; i < 16; i++) {
      expect(out.elements[i]).toBeCloseTo(expected.elements[i], 10);
    }
  });

  it('returns the same matrix instance it was handed (no allocation)', () => {
    const out = new THREE.Matrix4();
    const ret = composeShearMatrix(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1, 1, 1),
      0.1,
      0.2,
      out
    );
    expect(ret).toBe(out);
  });

  it('non-zero tilt shears XZ proportional to world Y (lean formula)', () => {
    // Building of height sy=10 centered at py=5, unit footprint, at origin.
    const pos = new THREE.Vector3(0, 5, 0);
    const scale = new THREE.Vector3(1, 10, 1);
    const tiltX = 0.03;
    const tiltZ = -0.02;

    // Roof-center local (0, 0.5, 0): worldY = 0.5*10 + 5 = 10.
    //   X = 0 + 0 + 10*tiltX = 0.3
    //   Y = 10
    //   Z = 0 + 0 + 10*tiltZ = -0.2
    const top = transform(pos, scale, tiltX, tiltZ, [0, 0.5, 0]);
    expect(top[0]).toBeCloseTo(10 * tiltX, 10);
    expect(top[1]).toBeCloseTo(10, 10);
    expect(top[2]).toBeCloseTo(10 * tiltZ, 10);

    // Base-center local (0, -0.5, 0): worldY = -0.5*10 + 5 = 0 → no shear.
    const base = transform(pos, scale, tiltX, tiltZ, [0, -0.5, 0]);
    expect(base[0]).toBeCloseTo(0, 10);
    expect(base[1]).toBeCloseTo(0, 10);
    expect(base[2]).toBeCloseTo(0, 10);
  });

  it('writes the exact 16-float row-major shear matrix', () => {
    const pos = new THREE.Vector3(7, 3, -2);
    const scale = new THREE.Vector3(2, 6, 4);
    const tiltX = 0.05;
    const tiltZ = 0.1;
    const out = composeShearMatrix(pos, scale, tiltX, tiltZ, new THREE.Matrix4());

    const sx = 2,
      sy = 6,
      sz = 4;
    const px = 7,
      py = 3,
      pz = -2;
    // Row-major expectation (same args order .set() consumed historically).
    const rowMajor = [
      sx,
      sy * tiltX,
      0,
      px + py * tiltX,
      0,
      sy,
      0,
      py,
      0,
      sy * tiltZ,
      sz,
      pz + py * tiltZ,
      0,
      0,
      0,
      1,
    ];
    // Matrix4.elements is column-major: element[col*4 + row].
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        expect(out.elements[col * 4 + row]).toBeCloseTo(rowMajor[row * 4 + col], 10);
      }
    }
  });

  // The ground haze normalizes worldPos.y by vScale.y, which the vertex shader
  // reads as length(instanceMatrix[1]). Nothing else consumes vScale.y, so a
  // drift here would silently rescale the haze on every building.
  it('column 1 length is the building height, and the base sits at y=0', () => {
    for (const h of [32, 352, 1024]) {
      const out = composeShearMatrix(
        new THREE.Vector3(100, h / 2, 200),
        new THREE.Vector3(20, h, 20),
        0.04,
        -0.03,
        new THREE.Matrix4()
      );
      const e = out.elements;
      // GLSL instanceMatrix[1] is column 1 == elements[4..6]. The lean overstates
      // it by 1/cos(lean) — a relative error, so compare the ratio.
      expect(new THREE.Vector3(e[4], e[5], e[6]).length() / h).toBeCloseTo(1, 2);

      expect(new THREE.Vector3(0, -0.5, 0).applyMatrix4(out).y).toBeCloseTo(0, 10);
      expect(new THREE.Vector3(0, 0.5, 0).applyMatrix4(out).y).toBeCloseTo(h, 10);
    }
  });
});
