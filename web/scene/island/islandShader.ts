// scene/island/islandShader.ts — ShaderMaterial for the floating island.
//
// Hemispheric lighting model: warm HEMI_SKY_COLOR from +Y, cool
// HEMI_GROUND_COLOR from -Y, blended by normal.y. No sun direction
// involved — the island is self-lit and independent of the city's
// day/night cycle. Optional underglow accent remains as a small additive
// tint capped at 0.5 so it can't dominate.

import * as THREE from 'three';
import { ISLAND_MATERIALS, ISLAND_UNDERGLOW, ISLAND_ATMOSPHERE } from '@/config/island.js';

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

uniform vec3 uHemiSkyColor;
uniform vec3 uHemiGroundColor;
uniform vec3 uUnderglowColor;
uniform float uUnderglowStrength;

#include <fog_uniforms_glsl_inline>
#include <fog_apply_glsl_inline>

void main() {
  vec3 n = normalize(vNormalWorld);

  // Hemispheric model: warm key light from +Y (sky), cool fill from -Y
  // (ground). Blend by normal.y so up-facing surfaces get the sky color,
  // down-facing get the ground color, side-facing gets the gradient.
  // Single coherent lighting model — no sun direction, no additive glow.
  float hemi = clamp(n.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 hemiTint = mix(uHemiGroundColor, uHemiSkyColor, hemi);
  vec3 lit = vColor * hemiTint * vAO;

  // Optional underglow accent: only applied when ENABLED, as a small
  // additive tint on faces pointing strongly down. Capped at 0.5 so it
  // can't dominate.
  lit += max(-n.y, 0.0) * uUnderglowStrength * uUnderglowColor * 0.5;

  float viewDist = length(vWorldPos - cameraPosition);
  vec3 foggy = applyFog(lit, vWorldPos, viewDist);
  gl_FragColor = vec4(foggy, 1.0);
}
`;

export function createIslandMaterial(): THREE.ShaderMaterial {
  const mats = ISLAND_MATERIALS.get();
  const ug = ISLAND_UNDERGLOW.get();
  const atm = ISLAND_ATMOSPHERE.get();
  return new THREE.ShaderMaterial({
    vertexShader: vertSrc,
    fragmentShader: fragSrc,
    uniforms: {
      uHemiSkyColor: { value: new THREE.Color(mats.HEMI_SKY_COLOR) },
      uHemiGroundColor: { value: new THREE.Color(mats.HEMI_GROUND_COLOR) },
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
    // Bias the island AWAY from the camera in the depth buffer so city
    // surfaces (sidewalks, asphalt, footprint slab) at y≈0 always win the
    // depth contest against the island top (~y=-2). Factor/units bumped
    // 1→4 because at city-scale (thousands of wu wide) the depth
    // precision near far-clip degrades and 1/1 wasn't enough margin.
    polygonOffset: true,
    polygonOffsetFactor: 4,
    polygonOffsetUnits: 4,
  });
}
