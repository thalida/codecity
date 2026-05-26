// scene/components/repoLabel/concentric.ts — Style E: concentric rings.
//
// Two horizontal-ish torus meshes:
//   outer — same shader as the Ring style, carrying the repo name.
//   inner — smaller, no text, dashed cyan glow; spins geometrically on
//           its own Y axis (counter-clockwise relative to outer) and
//           precesses slowly on Z.

import * as THREE from 'three';

import ringVertSrc from './ringText.vert.glsl?raw';
import ringFragSrc from './ringText.frag.glsl?raw';
import innerFragSrc from './innerRing.frag.glsl?raw';
import type { RepoLabelStyleInstance } from './styleInstance.js';

const OUTER_RADIUS = 8;
const OUTER_TUBE = 0.6;
const INNER_RADIUS = OUTER_RADIUS * 0.55;
const INNER_TUBE = OUTER_TUBE * 0.4;
const RADIAL_SEGMENTS = 16;
const TUBULAR_SEGMENTS = 128;
// Outer-ring spin (texture U scroll). Negative = counter-clockwise.
const OUTER_SPIN_SPEED = -0.04;
// Inner-ring geometric spin (radians per second at ANIMATION_SPEED=1).
const INNER_SPIN_RATE = 0.04 * 2.0 * Math.PI * 1.4;
// Inner-ring precession (radians per second on Z).
const INNER_PRECESSION_RATE = (3 * Math.PI) / 180;
// Initial Z tilt of the inner ring.
const INNER_INITIAL_TILT = (25 * Math.PI) / 180;

export function createConcentricStyle(texture: THREE.Texture): RepoLabelStyleInstance {
  const group = new THREE.Group();
  group.name = 'repoLabel:concentric';

  // ---- Outer text ring ----
  const outerGeom = new THREE.TorusGeometry(
    OUTER_RADIUS,
    OUTER_TUBE,
    RADIAL_SEGMENTS,
    TUBULAR_SEGMENTS
  );
  const outerMat = new THREE.ShaderMaterial({
    vertexShader: ringVertSrc,
    fragmentShader: ringFragSrc,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    uniforms: {
      uMap: { value: texture },
      uTime: { value: 0 },
      uSpinSpeed: { value: OUTER_SPIN_SPEED },
      uOpacity: { value: 1.0 },
    },
  });
  const outer = new THREE.Mesh(outerGeom, outerMat);
  outer.rotation.x = Math.PI / 2;
  group.add(outer);

  // ---- Inner decorative ring ----
  const innerGeom = new THREE.TorusGeometry(
    INNER_RADIUS,
    INNER_TUBE,
    RADIAL_SEGMENTS,
    TUBULAR_SEGMENTS
  );
  const innerMat = new THREE.ShaderMaterial({
    vertexShader: ringVertSrc,
    fragmentShader: innerFragSrc,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    uniforms: { uOpacity: { value: 1.0 } },
  });
  const inner = new THREE.Mesh(innerGeom, innerMat);
  inner.rotation.x = Math.PI / 2;
  inner.rotation.z = INNER_INITIAL_TILT;
  group.add(inner);

  function tick(dtSeconds: number, _camera: THREE.Camera, animationSpeed: number): void {
    outerMat.uniforms.uTime.value += dtSeconds * animationSpeed;
    // Spin and precess the inner ring geometrically.
    inner.rotation.y += dtSeconds * animationSpeed * INNER_SPIN_RATE;
    inner.rotation.z += dtSeconds * animationSpeed * INNER_PRECESSION_RATE;
  }

  function setOpacity(opacity: number): void {
    outerMat.uniforms.uOpacity.value = opacity;
    innerMat.uniforms.uOpacity.value = opacity;
  }

  function dispose(): void {
    outerGeom.dispose();
    outerMat.dispose();
    innerGeom.dispose();
    innerMat.dispose();
  }

  return { group, tick, setOpacity, dispose };
}
