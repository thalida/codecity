// scene/island/islandShader.ts — ShaderMaterial for the floating island.
//
// Hemispheric lighting model: warm HEMI_SKY_COLOR from +Y, cool
// HEMI_GROUND_COLOR from -Y, blended by normal.y. No sun direction
// involved — the island is self-lit and independent of the city's
// day/night cycle.

import * as THREE from 'three';
import { ISLAND } from '@/state/stores/settings/island';

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

  vec3 foggy = applyFog(lit, vWorldPos);
  gl_FragColor = vec4(foggy, 1.0);
}
`;

export function createIslandMaterial(): THREE.ShaderMaterial {
  const mats = ISLAND.value;
  return new THREE.ShaderMaterial({
    vertexShader: vertSrc,
    fragmentShader: fragSrc,
    uniforms: {
      uHemiSkyColor: { value: new THREE.Color(mats.HEMI_SKY_COLOR) },
      uHemiGroundColor: { value: new THREE.Color(mats.HEMI_GROUND_COLOR) },
      // Height-fog uniforms — island doesn't use them; declared so the
      // shared chunk compiles and uFogEnabled stays false.
      uFogEnabled: { value: false },
      uFogColor: { value: new THREE.Color('#000000') },
      uFogIntensity: { value: 0 },
      uFogHeight: { value: 1 },
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
