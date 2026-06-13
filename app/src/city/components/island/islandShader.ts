// city/components/island/islandShader.ts — ShaderMaterial for the floating island.
//
// Hemispheric lighting model: warm HEMI_SKY_COLOR from +Y, cool
// HEMI_GROUND_COLOR from -Y, blended by normal.y. No sun direction
// involved — the island is self-lit and independent of the city's
// day/night cycle.

import * as THREE from 'three';
import { ISLAND } from '@/state/stores/settings/island';

import vertSrc from './island.vert.glsl?raw';
import fragSrc from './island.frag.glsl?raw';

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
