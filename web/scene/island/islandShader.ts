// scene/island/islandShader.ts — ShaderMaterial for the floating island.
//
// Shader-baked lighting using the same uniforms convention as buildings.ts
// (uSunDirWorld, uSunContrast, uAmbient). Adds an underglow term that
// tints downward-facing surfaces warm. No real Three.js lights involved.

import * as THREE from 'three';
import { ISLAND_MATERIALS, ISLAND_UNDERGLOW, ISLAND_ATMOSPHERE } from '@/config/island.js';
import { sunDirFromLighting } from '@/scene/lighting/sunDir.js';

const vertSrc = /* glsl */ `
attribute vec3 color;
attribute float ao;

varying vec3 vColor;
varying vec3 vNormalWorld;
varying vec3 vWorldPos;
varying float vAO;

void main() {
  vColor = color;
  vAO = ao;
  vNormalWorld = normalize(mat3(modelMatrix) * normal);
  vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragSrc = /* glsl */ `
precision highp float;

varying vec3 vColor;
varying vec3 vNormalWorld;
varying vec3 vWorldPos;
varying float vAO;

uniform vec3 uSunDirWorld;
uniform float uSunContrast;
uniform float uAmbient;
uniform vec3 uUnderglowColor;
uniform float uUnderglowStrength;

#include <fog_uniforms_glsl_inline>
#include <fog_apply_glsl_inline>

void main() {
  vec3 n = normalize(vNormalWorld);
  float sunLambert = max(dot(n, uSunDirWorld), 0.0);
  float lighting = sunLambert * uSunContrast + uAmbient;

  vec3 lit = vColor * lighting * vAO;
  vec3 upDir = vec3(0.0, 1.0, 0.0);
  float downward = max(dot(n, -upDir), 0.0);
  lit += downward * uUnderglowStrength * uUnderglowColor;

  float viewDist = length(vWorldPos - cameraPosition);
  vec3 foggy = applyFog(lit, vWorldPos, viewDist);
  gl_FragColor = vec4(foggy, 1.0);
}
`;

export function createIslandMaterial(): THREE.ShaderMaterial {
  const mats = ISLAND_MATERIALS.get();
  const ug = ISLAND_UNDERGLOW.get();
  const atm = ISLAND_ATMOSPHERE.get();
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
      // Height-fog uniforms — island doesn't use them; declared so the
      // shared chunk compiles and uFogEnabled stays false.
      uFogEnabled: { value: false },
      uFogColor: { value: new THREE.Color('#000000') },
      uFogIntensity: { value: 0 },
      uFogHeight: { value: 1 },
      // Distance-fog uniforms — actively driven by ISLAND_ATMOSPHERE.
      uDistanceFogEnabled: { value: atm.DISTANCE_FOG_ENABLED },
      uDistanceFogColor: { value: new THREE.Color(atm.DISTANCE_FOG_COLOR) },
      uDistanceFogNear: { value: atm.DISTANCE_FOG_NEAR },
      uDistanceFogFar: { value: atm.DISTANCE_FOG_FAR },
    },
    side: THREE.FrontSide,
    toneMapped: true,
  });
}
