// city/components/buildings/material.ts — the one building ShaderMaterial, its
// uniforms, and the icon atlas. Every cell's detail mesh shares it, so mutating
// a uniform here updates the whole city at once.

import * as THREE from 'three';
import { BUILDINGS } from '@/state/stores/settings/buildings';
import { BLOOM } from '@/state/stores/settings/effects';
import { SCENE } from '@/state/stores/settings/scene';
import { RUINS } from '@/state/stores/settings/ruins';
import type { IconAtlas } from './atlas';
import { setColorFromHex } from '@/city/utils/color/setColorFromHex';
import { writeSunDir } from '@/city/utils/shaders/sunDir';
import {
  LIGHTING_SUN_AZIMUTH_DEG,
  LIGHTING_SUN_ELEVATION_DEG,
  LIGHTING_AMBIENT,
  LIGHTING_SUN_CONTRAST,
} from '@/constants/lighting';

// Shader-side facade keys ride uniforms; the JS-side ones bake into per-instance
// attributes, which is why changing them routes to a full rebuild.

import buildingVertSrc from './building.vert.glsl?raw';
import buildingFragSrc from './building.frag.glsl?raw';

// One material for every cell: applyManifest runs repeatedly, and a per-rebuild
// material would accumulate.
let _sharedMaterial: THREE.ShaderMaterial | null = null;

// Pushed in before the cell pass, so buildings have it as they're built. Null
// while it loads or if it failed: the shader paints the bare roof colour.
let _atlas: IconAtlas | null = null;

export function setIconAtlas(atlas: IconAtlas | null): void {
  _atlas = atlas;
  if (_sharedMaterial) {
    _sharedMaterial.uniforms.uIconAtlas.value = atlas ? atlas.texture : null;
    _sharedMaterial.uniforms.uIconSlotSize.value = atlas ? atlas.slotSize : 0;
  }
}

/** The icon atlas the cells resolve per-instance roof UVs from, or null when
 *  it hasn't built yet. Single source, shared with the uIconAtlas uniform. */
export function getIconAtlas(): IconAtlas | null {
  return _atlas;
}

/** Mirrors _sharedMaterial.transparent so the setter can skip a no-op
 *  needsUpdate — the owners call it per sweep and per scrub frame. */
let _translucent = false;

/** Opaque buildings sort front-to-back, so early-z skips the ~620-line facade
 *  shader on hidden fragments; iFade.x is the only alpha, so a fade needs this. */
export function setBuildingsTranslucent(on: boolean): void {
  if (on === _translucent) return;
  _translucent = on;
  if (_sharedMaterial) {
    _sharedMaterial.transparent = on;
    _sharedMaterial.needsUpdate = true;
  }
}

// Grime is age-scaled: a [newest, oldest] range the shader lerps per-building by
// createdAge, written into a Vector2 uniform (both 0 when disabled → mix → 0).
function _grimeIntensityVec(out: THREE.Vector2): THREE.Vector2 {
  const f = BUILDINGS.value;
  const [lo, hi] = f.GRIME_ENABLED ? f.GRIME_INTENSITY : [0, 0];
  return out.set(lo, hi);
}

/** Shared by every cell's detail mesh: a material per cell meant a program
 *  compile per cell, which hung the tab on large repos. */
export function getBuildingMaterial(): THREE.ShaderMaterial {
  if (_sharedMaterial) return _sharedMaterial;
  // Chunks are registered via THREE.ShaderChunk in registerShaderChunks.ts;
  // Three.js's native preprocessor resolves #include <name> at compile time.
  const fragSrc = buildingFragSrc;
  _sharedMaterial = new THREE.ShaderMaterial({
    vertexShader: buildingVertSrc,
    fragmentShader: fragSrc,
    // Opaque unless something is mid-fade — see setBuildingsTranslucent.
    transparent: _translucent,
    uniforms: {
      // Hidden-tier wireframe thickness in screen-pixels. Updated by
      // refreshBuildingMaterial() on Save.
      uOutlineWidth: { value: BUILDINGS.value.OUTLINE_WIDTH },
      // Null until the atlas builds; the shader gates sampling on iIconUV.x.
      uIconAtlas: { value: _atlas ? _atlas.texture : null },
      uIconSlotSize: { value: _atlas ? _atlas.slotSize : 0 },
      // Height-based haze, mixed into the post-tonemap sRGB framebuffer, so the
      // hex bytes pass through unconverted.
      uFogEnabled: { value: SCENE.value.FOG_ENABLED },
      uFogColor: { value: setColorFromHex(new THREE.Color(), SCENE.value.FOG_COLOR) },
      uFogIntensity: { value: SCENE.value.FOG_INTENSITY },
      // Raw fraction — the shader scales it by each building's own height.
      uFogHeightFrac: { value: SCENE.value.FOG_HEIGHT_FRAC },
      // Extra emission on the freshest building's windows, over a baseline 1.
      uWindowEmissionBoost: { value: BUILDINGS.value.WINDOW_EMISSION },
      // Age-driven decay uniforms (createdAge-gated, independent of
      // modifiedAge). See BUILDINGS (aging) config.
      uGrimeIntensity: { value: _grimeIntensityVec(new THREE.Vector2()) },
      uGrimeCoverage: { value: new THREE.Vector2(...BUILDINGS.value.GRIME_COVERAGE) },
      // The placeholder is an overhead sun rather than a zero vector, which
      // would shadow every face if _writeSunDir somehow didn't run.
      uSunDirWorld: { value: new THREE.Vector3(0, 1, 0) },
      uAmbient: { value: LIGHTING_AMBIENT },
      uSunContrast: { value: LIGHTING_SUN_CONTRAST },
      // Seeded from the store so the first frame is already configured; only
      // the shader-side keys, since the rest bake into attributes.
      uSlabHeightFrac: { value: BUILDINGS.value.SLAB_HEIGHT_FRAC },
      uWindowWidthFrac: { value: BUILDINGS.value.WINDOW_WIDTH_FRAC },
      uWindowHeightFrac: { value: BUILDINGS.value.WINDOW_HEIGHT_FRAC },
      uWindowMarginFrac: { value: BUILDINGS.value.WINDOW_MARGIN_FRAC },
      uDoorHeightFrac: { value: BUILDINGS.value.DOOR_HEIGHT_FRAC },
      uRoofBorderFrac: { value: BUILDINGS.value.ROOF_BORDER_FRAC },
      // BUILDINGS store — HSL lightness deltas applied to slab and door
      // via shadeColor/shadeAndShiftHue in the shader.
      uSlabLightnessDelta: { value: BUILDINGS.value.SLAB_LIGHTNESS_DELTA },
      uDoorLightnessDelta: { value: BUILDINGS.value.DOOR_LIGHTNESS_DELTA },
      // Deleted-file cross (RUINS store) — consumed in sRGB like the roof it
      // composites over, so the hex bytes pass through (see setColorFromHex).
      uRuinXEnabled: { value: RUINS.value.X_ENABLED },
      uRuinXColor: { value: setColorFromHex(new THREE.Color(), RUINS.value.X_COLOR) },
      uRuinXWidth: { value: RUINS.value.X_WIDTH },
      // WINDOW_LIGHTING store — per-cell lit/unlit lightness deltas, gap
      // thresholds, and the warm-amber tint for old/dim lit panes.
      uWindowUnlitLightnessDelta: { value: BUILDINGS.value.UNLIT_LIGHTNESS_DELTA },
      uWindowGapBaseThreshold: { value: BUILDINGS.value.GAP_BASE_THRESHOLD },
      uWindowGapAgeBonus: { value: BUILDINGS.value.GAP_AGE_BONUS },
      // Consumed in sRGB, so the hex bytes pass through unconverted.
      uDimGlowColor: { value: setColorFromHex(new THREE.Color(), BUILDINGS.value.DIM_GLOW_COLOR) },
      uLitFreshnessExponent: { value: BUILDINGS.value.LIT_FRESHNESS_EXPONENT },
    },
  });
  writeSunDir(
    _sharedMaterial.uniforms.uSunDirWorld.value as THREE.Vector3,
    LIGHTING_SUN_AZIMUTH_DEG,
    LIGHTING_SUN_ELEVATION_DEG
  );
  return _sharedMaterial;
}

/** Re-apply the committed config to the shared uniforms, so a Save reaches the
 *  whole city without rebuilding any of it. */
export function refreshBuildingMaterial(): void {
  if (!_sharedMaterial) return;
  const sceneCfg = SCENE.value;
  const bloomCfg = BLOOM.value;
  _sharedMaterial.uniforms.uOutlineWidth.value = BUILDINGS.value.OUTLINE_WIDTH;
  // Intensity is zeroed as well as the flag, so the mix is inert even where a
  // driver takes the branch differently.
  _sharedMaterial.uniforms.uFogEnabled.value = sceneCfg.FOG_ENABLED;
  setColorFromHex(_sharedMaterial.uniforms.uFogColor.value as THREE.Color, sceneCfg.FOG_COLOR);
  _sharedMaterial.uniforms.uFogIntensity.value = sceneCfg.FOG_ENABLED ? sceneCfg.FOG_INTENSITY : 0;
  _sharedMaterial.uniforms.uFogHeightFrac.value = sceneCfg.FOG_HEIGHT_FRAC;
  // Without bloom the windows stay LDR, with nothing for the pass to catch.
  _sharedMaterial.uniforms.uWindowEmissionBoost.value = bloomCfg.ENABLED
    ? BUILDINGS.value.WINDOW_EMISSION
    : 0;
  // Scene directional lighting (fixed constants — re-seed idempotently).
  writeSunDir(
    _sharedMaterial.uniforms.uSunDirWorld.value as THREE.Vector3,
    LIGHTING_SUN_AZIMUTH_DEG,
    LIGHTING_SUN_ELEVATION_DEG
  );
  _sharedMaterial.uniforms.uAmbient.value = LIGHTING_AMBIENT;
  _sharedMaterial.uniforms.uSunContrast.value = LIGHTING_SUN_CONTRAST;
  // Shader-side keys only: the rest bake into attributes, so the whole store
  // routes through a rebuild and these come along with it.
  const facade = BUILDINGS.value;
  // Age weathering (grime) — [newest, oldest] ranges the shader lerps
  // per-building by createdAge.
  _grimeIntensityVec(_sharedMaterial.uniforms.uGrimeIntensity.value as THREE.Vector2);
  (_sharedMaterial.uniforms.uGrimeCoverage.value as THREE.Vector2).set(...facade.GRIME_COVERAGE);
  _sharedMaterial.uniforms.uSlabHeightFrac.value = facade.SLAB_HEIGHT_FRAC;
  _sharedMaterial.uniforms.uWindowWidthFrac.value = facade.WINDOW_WIDTH_FRAC;
  _sharedMaterial.uniforms.uWindowHeightFrac.value = facade.WINDOW_HEIGHT_FRAC;
  _sharedMaterial.uniforms.uWindowMarginFrac.value = facade.WINDOW_MARGIN_FRAC;
  _sharedMaterial.uniforms.uDoorHeightFrac.value = facade.DOOR_HEIGHT_FRAC;
  _sharedMaterial.uniforms.uRoofBorderFrac.value = facade.ROOF_BORDER_FRAC;
  // BUILDINGS store — pure uniform refresh, no rebuild required.
  const facadeDetail = BUILDINGS.value;
  _sharedMaterial.uniforms.uSlabLightnessDelta.value = facadeDetail.SLAB_LIGHTNESS_DELTA;
  _sharedMaterial.uniforms.uDoorLightnessDelta.value = facadeDetail.DOOR_LIGHTNESS_DELTA;
  const ruins = RUINS.value;
  _sharedMaterial.uniforms.uRuinXEnabled.value = ruins.X_ENABLED;
  setColorFromHex(_sharedMaterial.uniforms.uRuinXColor.value as THREE.Color, ruins.X_COLOR);
  _sharedMaterial.uniforms.uRuinXWidth.value = ruins.X_WIDTH;
  // WINDOW_LIGHTING store — pure uniform refresh into the pre-allocated
  // THREE.Color uniform values.
  const windowLighting = BUILDINGS.value;
  _sharedMaterial.uniforms.uWindowUnlitLightnessDelta.value = windowLighting.UNLIT_LIGHTNESS_DELTA;
  _sharedMaterial.uniforms.uWindowGapBaseThreshold.value = windowLighting.GAP_BASE_THRESHOLD;
  _sharedMaterial.uniforms.uWindowGapAgeBonus.value = windowLighting.GAP_AGE_BONUS;
  // DIM_GLOW_COLOR is consumed in sRGB space — see the uniform's initializer.
  setColorFromHex(
    _sharedMaterial.uniforms.uDimGlowColor.value as THREE.Color,
    windowLighting.DIM_GLOW_COLOR
  );
  _sharedMaterial.uniforms.uLitFreshnessExponent.value = windowLighting.LIT_FRESHNESS_EXPONENT;
}
