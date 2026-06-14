// city/components/buildings/material.ts — The one building ShaderMaterial.
//
// Owns the single ShaderMaterial every cell's detail mesh renders with (a
// lazy singleton — getBuildingMaterial()), its uniforms bag, the icon atlas,
// and refreshBuildingMaterial() which re-applies Save-committed uniforms on
// config-store changes. cellMesh.ts attaches this material to each cell and
// reads the atlas (getIconAtlas()) for per-instance roof UVs; mutating a
// uniform value object here updates every cell, since they all share it.

import * as THREE from 'three';
import { BUILDINGS, BUILDING_DIMENSIONS } from '@/state/stores/settings/buildings';
import { BLOOM } from '@/state/stores/settings/effects';
import { SCENE } from '@/state/stores/settings/scene';
import type { IconAtlas } from './atlas';
import { setColorFromHex } from '@/city/utils/color/setColorFromHex';
import { writeSunDir } from '@/city/utils/shaders/sunDir';
import {
  LIGHTING_SUN_AZIMUTH_DEG,
  LIGHTING_SUN_ELEVATION_DEG,
  LIGHTING_AMBIENT,
  LIGHTING_SUN_CONTRAST,
} from '@/constants/lighting';

// ---------------------------------------------------------------------------
// Per-instance facade attributes (window column count + door width) are
// sourced from the BUILDINGS store. The shader-side keys
// (SLAB/WINDOW/DOOR/ROOF_*_FRAC) are pushed through uniforms — see
// refreshBuildingMaterial(); the JS-side keys read below feed into baked
// per-instance attributes, so changes to them trigger a full rebuild via
// state/settingsReactions.ts.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Shared material singleton
// ---------------------------------------------------------------------------

import buildingVertSrc from './building.vert.glsl?raw';
import buildingFragSrc from './building.frag.glsl?raw';

// Lazy singleton material — created once and reused across all cells.
// applyManifest can be called multiple times (e.g. on Save-triggered rebuild); the singleton
// pattern ensures we don't accumulate materials on each rebuild.
let _sharedMaterial: THREE.ShaderMaterial | null = null;

// The icon atlas the buildings sample for roof glyphs. cityState.applyManifest
// builds it (gated on tree_signature) and pushes it in via setIconAtlas before
// the cell pass, so the buildings have it as they're constructed. Stays null
// while it's still loading or if the atlas build failed — the shader treats
// iconUV.x < 0 as "no icon" and just paints the base roof color. Two consumers:
// the uIconAtlas/uIconSlotSize uniforms (sampled by the shader) and cellMesh's
// per-instance iIconUV write (via getIconAtlas()) — both off this one ref.
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

// Half-fall-off height for ground haze, in world units. Computed as
// FOG_HEIGHT_FRAC × the tallest possible building (MAX_FLOORS × FLOOR_HEIGHT)
// so the haze sits in the same relative band of the skyline regardless
// of how the user has tuned building sizes.
function _computeFogHeight(): number {
  const dims = BUILDING_DIMENSIONS.value;
  const maxHeight = Math.max(1, dims.MAX_FLOORS * dims.FLOOR_HEIGHT);
  return SCENE.value.FOG_HEIGHT_FRAC * maxHeight;
}

// Grime/tilt are age-scaled: each is a [newest, oldest] range the shader lerps
// per-building by createdAge. These write the two endpoints into a Vector2
// uniform (both 0 when the effect is disabled, so the shader's mix → 0).
function _grimeIntensityVec(out: THREE.Vector2): THREE.Vector2 {
  const f = BUILDINGS.value;
  const [lo, hi] = f.GRIME_ENABLED ? f.GRIME_INTENSITY : [0, 0];
  return out.set(lo, hi);
}

function _tiltRadVec(out: THREE.Vector2): THREE.Vector2 {
  const f = BUILDINGS.value;
  const [lo, hi] = f.TILT_ENABLED ? f.TILT_DEGREES : [0, 0];
  return out.set((lo * Math.PI) / 180, (hi * Math.PI) / 180);
}

/**
 * The one rendered building ShaderMaterial — a lazy singleton shared by every
 * cell's detail mesh (see cellMesh.attachBuildingMeshToCell). Reusing one
 * material across all cells avoids the per-cell program-compile cost that hung
 * the tab on large repos. Mutating its uniform value objects (via
 * refreshBuildingMaterial / setIconAtlas) updates every cell at once.
 */
export function getBuildingMaterial(): THREE.ShaderMaterial {
  if (_sharedMaterial) return _sharedMaterial;
  // Chunks are registered via THREE.ShaderChunk in registerShaderChunks.ts;
  // Three.js's native preprocessor resolves #include <name> at compile time.
  const fragSrc = buildingFragSrc;
  _sharedMaterial = new THREE.ShaderMaterial({
    vertexShader: buildingVertSrc,
    fragmentShader: fragSrc,
    // transparent: true so iFade.x can fade buildings.
    transparent: true,
    uniforms: {
      // Hidden-tier wireframe thickness in screen-pixels. Updated by
      // refreshBuildingMaterial() on Save.
      uOutlineWidth: { value: BUILDINGS.value.OUTLINE_WIDTH },
      // Atlas of file-type icons; sampled per-instance via iIconUV for
      // the roof face. Null until the atlas builds — the shader gates
      // sampling behind iIconUV.x >= 0.
      uIconAtlas: { value: _atlas ? _atlas.texture : null },
      uIconSlotSize: { value: _atlas ? _atlas.slotSize : 0 },
      // Ground-haze uniforms — height-based volumetric fog applied
      // in the building shader. Independent of camera distance.
      // Fog color is mixed into the post-tonemap sRGB framebuffer, so the
      // hex bytes pass through unchanged (see setColorFromHex).
      // uFogEnabled drives the boolean branch in the shared fog chunk;
      // uFogIntensity is still set to 0 when disabled (belt-and-suspenders).
      uFogEnabled: { value: SCENE.value.FOG_ENABLED },
      uFogColor: { value: setColorFromHex(new THREE.Color(), SCENE.value.FOG_COLOR) },
      uFogIntensity: { value: SCENE.value.FOG_INTENSITY },
      uFogHeight: { value: _computeFogHeight() },
      // Extra HDR emission applied to the freshest building's lit
      // windows on top of a baseline 1.0. 0 = no bloom contribution
      // from windows; higher = brighter glow on new buildings.
      uWindowEmissionBoost: { value: BUILDINGS.value.WINDOW_EMISSION },
      // Age-driven decay uniforms (createdAge-gated, independent of
      // modifiedAge). See BUILDINGS (aging) config.
      uGrimeIntensity: { value: _grimeIntensityVec(new THREE.Vector2()) },
      uGrimeCoverage: { value: new THREE.Vector2(...BUILDINGS.value.GRIME_COVERAGE) },
      uTiltRad: { value: _tiltRadVec(new THREE.Vector2()) },
      // Scene directional lighting (fixed LIGHTING_* constants). uSunDirWorld is
      // re-initialised below from those constants so the
      // first frame already has the configured sun direction; the
      // ambient and contrast scalars are seeded inline. The (0,1,0)
      // placeholder gives an overhead sun if _writeSunDir somehow
      // doesn't run, rather than the all-faces-shadow look a zero
      // vector would produce.
      uSunDirWorld: { value: new THREE.Vector3(0, 1, 0) },
      uAmbient: { value: LIGHTING_AMBIENT },
      uSunContrast: { value: LIGHTING_SUN_CONTRAST },
      // Procedural facade geometry (BUILDINGS store). Seeded from
      // the current store snapshot so the first frame renders with the
      // configured values; refreshBuildingMaterial() pushes updates on
      // Save. Only the shader-side keys appear here — the JS-side
      // keys (WINDOW_COLS_MAX, WIDTH_PER_WINDOW_COL, DOOR_WIDTH_FRAC)
      // bake into per-instance attributes in cellMesh.ts (writeBuildingToSlot).
      uSlabHeightFrac: { value: BUILDINGS.value.SLAB_HEIGHT_FRAC },
      uWindowWidthFrac: { value: BUILDINGS.value.WINDOW_WIDTH_FRAC },
      uWindowHeightFrac: { value: BUILDINGS.value.WINDOW_HEIGHT_FRAC },
      uWindowMarginFrac: { value: BUILDINGS.value.WINDOW_MARGIN_FRAC },
      uDoorHeightFrac: { value: BUILDINGS.value.DOOR_HEIGHT_FRAC },
      uRoofBorderFrac: { value: BUILDINGS.value.ROOF_BORDER_FRAC },
      // BUILDINGS store — HSL lightness deltas applied to slab, door,
      // and roof-border via shadeColor/shadeAndShiftHue in the shader.
      uSlabLightnessDelta: { value: BUILDINGS.value.SLAB_LIGHTNESS_DELTA },
      uDoorLightnessDelta: { value: BUILDINGS.value.DOOR_LIGHTNESS_DELTA },
      uRoofBorderLightnessDelta: { value: BUILDINGS.value.ROOF_BORDER_LIGHTNESS_DELTA },
      // WINDOW_LIGHTING store — per-cell lit/unlit lightness deltas, gap
      // thresholds, and the warm-amber tint for old/dim lit panes.
      uWindowUnlitLightnessDelta: { value: BUILDINGS.value.UNLIT_LIGHTNESS_DELTA },
      uWindowGapBaseThreshold: { value: BUILDINGS.value.GAP_BASE_THRESHOLD },
      uWindowGapAgeBonus: { value: BUILDINGS.value.GAP_AGE_BONUS },
      // The shader consumes uDimGlowColor in sRGB space (the prior hardcoded
      // vec3(0.5, 0.4, 0.15) was sRGB), so the hex bytes pass through
      // unchanged (see setColorFromHex).
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

/**
 * Re-apply the Save-committed config to the shared material's uniforms. Called
 * from the buildings component's settings effect (reacts to BUILDINGS /
 * SCENE / BLOOM / BUILDING_DIMENSIONS) so live config edits — e.g. the Hidden-
 * tier wireframe thickness from BUILDINGS.OUTLINE_WIDTH — take effect at once.
 */
export function refreshBuildingMaterial(): void {
  if (!_sharedMaterial) return;
  const sceneCfg = SCENE.value;
  const bloomCfg = BLOOM.value;
  _sharedMaterial.uniforms.uOutlineWidth.value = BUILDINGS.value.OUTLINE_WIDTH;
  // Height fog: uFogEnabled drives the GLSL branch; uFogIntensity is also
  // zeroed when disabled so the mix() is a no-op even if the bool branch
  // ever short-circuits differently on a given driver.
  _sharedMaterial.uniforms.uFogEnabled.value = sceneCfg.FOG_ENABLED;
  setColorFromHex(_sharedMaterial.uniforms.uFogColor.value as THREE.Color, sceneCfg.FOG_COLOR);
  _sharedMaterial.uniforms.uFogIntensity.value = sceneCfg.FOG_ENABLED ? sceneCfg.FOG_INTENSITY : 0;
  _sharedMaterial.uniforms.uFogHeight.value = _computeFogHeight();
  // BLOOM.ENABLED off → no HDR push for windows, so they stay LDR and
  // produce nothing the bloom pass (also bypassed via postFx.refresh)
  // could pick up.
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
  // Procedural facade geometry (BUILDINGS store) — shader-side keys.
  // The JS-side keys (WINDOW_COLS_MAX, WIDTH_PER_WINDOW_COL, DOOR_WIDTH_FRAC) require a full
  // rebuild because they bake into per-instance attributes; state/settingsReactions.ts
  // routes the whole store through scheduleRebuild so the uniforms here
  // are kept fresh on the next rebuild without separate plumbing.
  const facade = BUILDINGS.value;
  // Age weathering (grime + tilt) — [newest, oldest] ranges the shader lerps
  // per-building by createdAge.
  _grimeIntensityVec(_sharedMaterial.uniforms.uGrimeIntensity.value as THREE.Vector2);
  (_sharedMaterial.uniforms.uGrimeCoverage.value as THREE.Vector2).set(...facade.GRIME_COVERAGE);
  _tiltRadVec(_sharedMaterial.uniforms.uTiltRad.value as THREE.Vector2);
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
  _sharedMaterial.uniforms.uRoofBorderLightnessDelta.value =
    facadeDetail.ROOF_BORDER_LIGHTNESS_DELTA;
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
