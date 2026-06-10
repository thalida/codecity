// city/components/buildings/material.ts — Shared building material + icon atlas.
//
// Owns the singleton ShaderMaterial used by every cell's detail mesh
// (buildingsCell.ts attaches per-cell instance buffers to a
// new InstancedMesh that references this material). Also owns the icon
// atlas reference and the refresh hook that re-applies Save-committed
// uniforms on config-store changes.

import * as THREE from 'three';
import { BUILDINGS, BUILDING_DIMENSIONS } from '@/state/stores/settings/buildings';
import { FACADE } from '@/state/stores/settings/facade';
import { BLOOM } from '@/state/stores/settings/effects';
import { SCENE } from '@/state/stores/settings/scene';
import type { IconAtlas } from './atlas';
import { writeSunDir } from '@/city/utils/lighting/sunDir';
import {
  LIGHTING_SUN_AZIMUTH_DEG,
  LIGHTING_SUN_ELEVATION_DEG,
  LIGHTING_AMBIENT,
  LIGHTING_SUN_CONTRAST,
} from '@/constants/lighting';

// ---------------------------------------------------------------------------
// Per-instance facade attributes (window column count + door width) are
// sourced from the FACADE_GEOMETRY store. The shader-side keys
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

// The icon atlas the buildings sample for roof glyphs. world.applyManifest
// builds it (gated on tree_signature) and pushes it in via setIconAtlas before
// the cell pass, so the buildings have it as they're constructed. Stays null
// while it's still loading or if the atlas build failed — the shader treats
// iconUV.x < 0 as "no icon" and just paints the base roof color.
let _atlas: IconAtlas | null = null;

export function setIconAtlas(atlas: IconAtlas | null): void {
  _atlas = atlas;
  if (_sharedMaterial) {
    _sharedMaterial.uniforms.uIconAtlas.value = atlas ? atlas.texture : null;
    _sharedMaterial.uniforms.uIconSlotSize.value = atlas ? atlas.slotSize : 0;
  }
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

function getBuildingMaterial(): THREE.ShaderMaterial {
  if (_sharedMaterial) return _sharedMaterial;
  // Chunks are registered via THREE.ShaderChunk in registerShaderChunks.ts;
  // Three.js's native preprocessor resolves #include <name> at compile time.
  const fragSrc = buildingFragSrc;
  _sharedMaterial = new THREE.ShaderMaterial({
    vertexShader: buildingVertSrc,
    fragmentShader: fragSrc,
    // transparent: true so iFade.x can fade buildings (Task 11).
    transparent: true,
    uniforms: {
      // Hidden-tier wireframe thickness in screen-pixels. Updated by
      // refreshBuildingMaterial() on Save via applyTheme().
      uOutlineWidth: { value: BUILDINGS.value.OUTLINE_WIDTH },
      // Atlas of file-type icons; sampled per-instance via iIconUV for
      // the roof face. Null until the atlas builds — the shader gates
      // sampling behind iIconUV.x >= 0.
      uIconAtlas: { value: _atlas ? _atlas.texture : null },
      uIconSlotSize: { value: _atlas ? _atlas.slotSize : 0 },
      // Ground-haze uniforms — height-based volumetric fog applied
      // in the building shader. Independent of camera distance.
      // Fog color is mixed into the post-tonemap sRGB framebuffer; pass
      // the CSS hex through unchanged via LinearSRGBColorSpace so Three's
      // automatic sRGB->linear conversion doesn't darken it. Same
      // convention as uDimGlowColor.
      // uFogEnabled drives the boolean branch in the shared fog chunk;
      // uFogIntensity is still set to 0 when disabled (belt-and-suspenders).
      uFogEnabled: { value: SCENE.value.FOG_ENABLED },
      uFogColor: {
        value: new THREE.Color().setStyle(SCENE.value.FOG_COLOR, THREE.LinearSRGBColorSpace),
      },
      uFogIntensity: { value: SCENE.value.FOG_INTENSITY },
      uFogHeight: { value: _computeFogHeight() },
      // Extra HDR emission applied to the freshest building's lit
      // windows on top of a baseline 1.0. 0 = no bloom contribution
      // from windows; higher = brighter glow on new buildings.
      uWindowEmissionBoost: { value: BLOOM.value.WINDOW_EMISSION },
      // Age-driven decay uniforms (createdAge-gated, independent of
      // modifiedAge). See BUILDINGS (aging) config.
      uGrimeIntensity: {
        value: BUILDINGS.value.GRIME_ENABLED ? BUILDINGS.value.GRIME_INTENSITY : 0,
      },
      uGrimeCoverage: { value: BUILDINGS.value.GRIME_COVERAGE },
      uTiltMaxRad: {
        value: BUILDINGS.value.TILT_ENABLED ? (BUILDINGS.value.TILT_DEGREES * Math.PI) / 180 : 0,
      },
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
      // Procedural facade geometry (FACADE_GEOMETRY store). Seeded from
      // the current store snapshot so the first frame renders with the
      // configured values; refreshBuildingMaterial() pushes updates on
      // Save via applyTheme(). Only the shader-side keys appear here — the JS-side
      // keys (WINDOW_COLS_MAX, WIDTH_PER_WINDOW_COL, DOOR_WIDTH_FRAC)
      // bake into per-instance attributes in buildBuildingInstanceBuffer above.
      uSlabHeightFrac: { value: FACADE.value.SLAB_HEIGHT_FRAC },
      uWindowWidthFrac: { value: FACADE.value.WINDOW_WIDTH_FRAC },
      uWindowHeightFrac: { value: FACADE.value.WINDOW_HEIGHT_FRAC },
      uWindowMarginFrac: { value: FACADE.value.WINDOW_MARGIN_FRAC },
      uDoorHeightFrac: { value: FACADE.value.DOOR_HEIGHT_FRAC },
      uRoofBorderFrac: { value: FACADE.value.ROOF_BORDER_FRAC },
      // FACADE_DETAIL store — HSL lightness deltas applied to slab, door,
      // and roof-border via shadeColor/shadeAndShiftHue in the shader.
      uSlabLightnessDelta: { value: FACADE.value.SLAB_LIGHTNESS_DELTA },
      uDoorLightnessDelta: { value: FACADE.value.DOOR_LIGHTNESS_DELTA },
      uRoofBorderLightnessDelta: { value: FACADE.value.ROOF_BORDER_LIGHTNESS_DELTA },
      // WINDOW_LIGHTING store — per-cell lit/unlit lightness deltas, gap
      // thresholds, and the warm-amber tint for old/dim lit panes.
      uWindowUnlitLightnessDelta: { value: FACADE.value.UNLIT_LIGHTNESS_DELTA },
      uWindowGapBaseThreshold: { value: FACADE.value.GAP_BASE_THRESHOLD },
      uWindowGapAgeBonus: { value: FACADE.value.GAP_AGE_BONUS },
      // setStyle(..., LinearSRGBColorSpace) skips Three's automatic sRGB→linear
      // conversion. The shader consumes uDimGlowColor in sRGB space (the prior
      // hardcoded vec3(0.5, 0.4, 0.15) was sRGB), so we pass the hex bytes
      // through unchanged.
      uDimGlowColor: {
        value: new THREE.Color().setStyle(FACADE.value.DIM_GLOW_COLOR, THREE.LinearSRGBColorSpace),
      },
      uLitFreshnessExponent: { value: FACADE.value.LIT_FRESHNESS_EXPONENT },
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
 * Return the shared building material's uniforms dict so cell-aware
 * factories (buildingsCell.ts) can share the same uniform VALUE objects.
 * Lazily initialises the singleton material if it hasn't been created yet.
 *
 * Cell-path usage: each CellTile gets its own ShaderMaterial created by
 * attachBuildingMeshToCell, but they all reference the same uniform value
 * objects returned here — so refreshBuildingMaterial() updates all cells
 * automatically (it mutates the value objects in-place).
 */
export function getSharedBuildingUniforms(): Record<string, THREE.IUniform> {
  return getBuildingMaterial().uniforms;
}

/**
 * applyTheme() coordinator hook: push fresh BUILDINGS.OUTLINE_WIDTH into
 * the shared building material's uOutlineWidth uniform so the Hidden-tier
 * wireframe thickness honors live config edits.
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
  (_sharedMaterial.uniforms.uFogColor.value as THREE.Color).setStyle(
    sceneCfg.FOG_COLOR,
    THREE.LinearSRGBColorSpace
  );
  _sharedMaterial.uniforms.uFogIntensity.value = sceneCfg.FOG_ENABLED ? sceneCfg.FOG_INTENSITY : 0;
  _sharedMaterial.uniforms.uFogHeight.value = _computeFogHeight();
  // BLOOM.ENABLED off → no HDR push for windows, so they stay LDR and
  // produce nothing the bloom pass (also bypassed via postFx.refresh)
  // could pick up.
  _sharedMaterial.uniforms.uWindowEmissionBoost.value = bloomCfg.ENABLED
    ? bloomCfg.WINDOW_EMISSION
    : 0;
  const aging = BUILDINGS.value;
  _sharedMaterial.uniforms.uGrimeIntensity.value = aging.GRIME_ENABLED ? aging.GRIME_INTENSITY : 0;
  _sharedMaterial.uniforms.uGrimeCoverage.value = aging.GRIME_COVERAGE;
  _sharedMaterial.uniforms.uTiltMaxRad.value = aging.TILT_ENABLED
    ? (aging.TILT_DEGREES * Math.PI) / 180
    : 0;
  // Scene directional lighting (fixed constants — re-seed idempotently).
  writeSunDir(
    _sharedMaterial.uniforms.uSunDirWorld.value as THREE.Vector3,
    LIGHTING_SUN_AZIMUTH_DEG,
    LIGHTING_SUN_ELEVATION_DEG
  );
  _sharedMaterial.uniforms.uAmbient.value = LIGHTING_AMBIENT;
  _sharedMaterial.uniforms.uSunContrast.value = LIGHTING_SUN_CONTRAST;
  // Procedural facade geometry (FACADE_GEOMETRY store) — shader-side keys.
  // The JS-side keys (WINDOW_COLS_MAX, WIDTH_PER_WINDOW_COL, DOOR_WIDTH_FRAC) require a full
  // rebuild because they bake into per-instance attributes; state/settingsReactions.ts
  // routes the whole store through scheduleRebuild so the uniforms here
  // are kept fresh on the next rebuild without separate plumbing.
  const facade = FACADE.value;
  _sharedMaterial.uniforms.uSlabHeightFrac.value = facade.SLAB_HEIGHT_FRAC;
  _sharedMaterial.uniforms.uWindowWidthFrac.value = facade.WINDOW_WIDTH_FRAC;
  _sharedMaterial.uniforms.uWindowHeightFrac.value = facade.WINDOW_HEIGHT_FRAC;
  _sharedMaterial.uniforms.uWindowMarginFrac.value = facade.WINDOW_MARGIN_FRAC;
  _sharedMaterial.uniforms.uDoorHeightFrac.value = facade.DOOR_HEIGHT_FRAC;
  _sharedMaterial.uniforms.uRoofBorderFrac.value = facade.ROOF_BORDER_FRAC;
  // FACADE_DETAIL store — pure uniform refresh, no rebuild required.
  const facadeDetail = FACADE.value;
  _sharedMaterial.uniforms.uSlabLightnessDelta.value = facadeDetail.SLAB_LIGHTNESS_DELTA;
  _sharedMaterial.uniforms.uDoorLightnessDelta.value = facadeDetail.DOOR_LIGHTNESS_DELTA;
  _sharedMaterial.uniforms.uRoofBorderLightnessDelta.value =
    facadeDetail.ROOF_BORDER_LIGHTNESS_DELTA;
  // WINDOW_LIGHTING store — pure uniform refresh. .set(cssString) on the
  // pre-allocated THREE.Color preserves the linear-sRGB conversion path.
  const windowLighting = FACADE.value;
  _sharedMaterial.uniforms.uWindowUnlitLightnessDelta.value = windowLighting.UNLIT_LIGHTNESS_DELTA;
  _sharedMaterial.uniforms.uWindowGapBaseThreshold.value = windowLighting.GAP_BASE_THRESHOLD;
  _sharedMaterial.uniforms.uWindowGapAgeBonus.value = windowLighting.GAP_AGE_BONUS;
  // Pass DIM_GLOW_COLOR through unchanged — shader treats it as sRGB,
  // matching the prior hardcoded vec3(0.5, 0.4, 0.15) literal.
  (_sharedMaterial.uniforms.uDimGlowColor.value as THREE.Color).setStyle(
    windowLighting.DIM_GLOW_COLOR,
    THREE.LinearSRGBColorSpace
  );
  _sharedMaterial.uniforms.uLitFreshnessExponent.value = windowLighting.LIT_FRESHNESS_EXPONENT;
}
