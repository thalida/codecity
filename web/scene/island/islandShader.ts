// scene/island/islandShader.ts — ShaderMaterial for the floating island.
//
// Shader-baked lighting using the same uniforms convention as buildings.ts
// (uSunDirWorld, uSunContrast, uAmbient). Adds an underglow term that
// tints downward-facing surfaces warm. No real Three.js lights involved.

import * as THREE from 'three';
import { ISLAND_MATERIALS, ISLAND_UNDERGLOW } from '@/config/island.js';
import { sunDirFromLighting } from '@/scene/lighting/sunDir.js';

const vertSrc = /* glsl */ `
attribute vec3 color;
attribute float ao;

varying vec3 vColor;
varying vec3 vNormalWorld;
varying float vAO;

void main() {
  vColor = color;
  vAO = ao;
  // Transform normal to world space. The island mesh sits in world
  // coordinates with no rotation, so modelMatrix is essentially a
  // translation; normalMatrix gives us the correct world normal even
  // if that changes later.
  vNormalWorld = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragSrc = /* glsl */ `
precision highp float;

varying vec3 vColor;
varying vec3 vNormalWorld;
varying float vAO;

uniform vec3 uSunDirWorld;
uniform float uSunContrast;
uniform float uAmbient;
uniform vec3 uUnderglowColor;
uniform float uUnderglowStrength;

void main() {
  vec3 n = normalize(vNormalWorld);

  // Directional + ambient lighting, baked-style (no Three.js lights).
  float sunLambert = max(dot(n, uSunDirWorld), 0.0);
  float lighting = sunLambert * uSunContrast + uAmbient;

  vec3 lit = vColor * lighting * vAO;

  // Underglow: faces pointing down get a warm additive tint.
  vec3 upDir = vec3(0.0, 1.0, 0.0);
  float downward = max(dot(n, -upDir), 0.0);
  lit += downward * uUnderglowStrength * uUnderglowColor;

  gl_FragColor = vec4(lit, 1.0);
}
`;

export function createIslandMaterial(): THREE.ShaderMaterial {
  const mats = ISLAND_MATERIALS.get();
  const ug = ISLAND_UNDERGLOW.get();
  const sun = sunDirFromLighting();
  return new THREE.ShaderMaterial({
    vertexShader: vertSrc,
    fragmentShader: fragSrc,
    uniforms: {
      uSunDirWorld: { value: sun },
      uSunContrast: { value: mats.SUN_CONTRAST },
      uAmbient: { value: mats.AMBIENT },
      uUnderglowColor: { value: new THREE.Color(ug.ENABLED ? ug.COLOR : '#000000') },
      uUnderglowStrength: { value: ug.ENABLED ? ug.STRENGTH : 0 },
    },
    side: THREE.FrontSide,
    toneMapped: true,
  });
}
