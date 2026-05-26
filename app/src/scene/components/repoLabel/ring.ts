// scene/components/repoLabel/ring.ts — Style A: spinning text ring.
//
// One horizontal torus carrying the repo name. Text scrolls around the
// ring via texture-U animation (no geometric rotation — the torus is
// static). cyan→magenta gradient + outer glow falloff.

import * as THREE from 'three';

import vertSrc from './ringText.vert.glsl?raw';
import fragSrc from './ringText.frag.glsl?raw';
import type { RepoLabelStyleInstance } from './styleInstance.js';

const RING_RADIUS = 8;
const TUBE_RADIUS = 0.6;
const RADIAL_SEGMENTS = 16;
const TUBULAR_SEGMENTS = 128;
// Texture-scroll units per second at ANIMATION_SPEED = 1. 0.04 ≈ one
// full revolution every 25 seconds — slow enough to read, fast enough
// to feel alive.
const BASE_SPIN_SPEED = 0.04;

export function createRingStyle(texture: THREE.Texture): RepoLabelStyleInstance {
  const group = new THREE.Group();
  group.name = 'repoLabel:ring';

  const geometry = new THREE.TorusGeometry(
    RING_RADIUS,
    TUBE_RADIUS,
    RADIAL_SEGMENTS,
    TUBULAR_SEGMENTS
  );

  const material = new THREE.ShaderMaterial({
    vertexShader: vertSrc,
    fragmentShader: fragSrc,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    uniforms: {
      uMap: { value: texture },
      uTime: { value: 0 },
      uSpinSpeed: { value: BASE_SPIN_SPEED },
      uOpacity: { value: 1.0 },
    },
  });

  const mesh = new THREE.Mesh(geometry, material);
  // Lay the torus flat (its native orientation is in the XY plane).
  mesh.rotation.x = Math.PI / 2;
  group.add(mesh);

  function tick(dtSeconds: number, _camera: THREE.Camera, animationSpeed: number): void {
    material.uniforms.uTime.value += dtSeconds * animationSpeed;
  }

  function setOpacity(opacity: number): void {
    material.uniforms.uOpacity.value = opacity;
  }

  function dispose(): void {
    geometry.dispose();
    material.dispose();
  }

  return { group, tick, setOpacity, dispose };
}
