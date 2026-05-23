// scene/instanced/buildings.ts — Shared building material + icon atlas.
//
// Owns the singleton ShaderMaterial used by every cell's detail mesh
// (scene/instanced/buildingsCell.ts attaches per-cell instance buffers to a
// new InstancedMesh that references this material). Also owns the icon
// atlas reference and the refresh hook that re-applies live-tunable
// uniforms on config-store changes.

import * as THREE from 'three';
import {
  BLOOM,
  BUILDING_AGING,
  BUILDING_DIMENSIONS,
  BUILDING_OUTLINE,
  BUILDING_PALETTE,
  FACADE_DETAIL,
  FACADE_GEOMETRY,
  LIGHTING,
  SCENE_COLORS,
  WINDOW_LIGHTING,
} from '@/config/index.js';
import { ISLAND_ATMOSPHERE } from '@/config/island.js';
import type { IconAtlas } from '../iconAtlas.js';
import { writeSunDir } from '@/scene/lighting/sunDir.js';

// ---------------------------------------------------------------------------
// Per-instance facade attributes (window column count + door width) are
// sourced from the FACADE_GEOMETRY store. The shader-side keys
// (SLAB/WINDOW/DOOR/ROOF_*_FRAC) are pushed through uniforms — see
// refreshBuildingMaterial(); the JS-side keys read below feed into baked
// per-instance attributes, so changes to them trigger a full rebuild via
// hotReload.ts.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Shared material singleton
// ---------------------------------------------------------------------------

import buildingVertSrc from '../shaders/building.vert.glsl?raw';
import buildingFragSrc from '../shaders/building.frag.glsl?raw';
import hslGlslSrc from '../shaders/hsl.glsl?raw';
import { FOG_UNIFORMS_GLSL, FOG_APPLY_GLSL } from '../lighting/fogChunk.js';

// Lazy singleton material — created once and reused across all cells.
// applyManifest can be called multiple times (hot-reload); the singleton
// pattern ensures we don't accumulate materials on each rebuild.
let _sharedMaterial: THREE.ShaderMaterial | null = null;

// The icon atlas the buildings sample for roof glyphs. main.ts builds
// it after the initial manifest fetch and pushes it in via
// setIconAtlas before the first applyManifest, so the very first
// frame already has roof icons. Stays null while it's still loading
// or if the atlas build failed — the shader treats iconUV.x < 0 as
// "no icon" and just paints the base roof color.
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
  const dims = BUILDING_DIMENSIONS.get();
  const maxHeight = Math.max(1, dims.MAX_FLOORS * dims.FLOOR_HEIGHT);
  return SCENE_COLORS.get().FOG_HEIGHT_FRAC * maxHeight;
}

function getBuildingMaterial(): THREE.ShaderMaterial {
  if (_sharedMaterial) return _sharedMaterial;
  // Inline the hsl helpers and fog chunk into the fragment source at the
  // placeholder comments the shader author left for exactly this purpose.
  const fragSrc = buildingFragSrc
    .replace('#include <hsl_glsl_inline>', hslGlslSrc)
    .replace('#include <fog_uniforms_glsl_inline>', FOG_UNIFORMS_GLSL)
    .replace('#include <fog_apply_glsl_inline>', FOG_APPLY_GLSL);
  _sharedMaterial = new THREE.ShaderMaterial({
    vertexShader: buildingVertSrc,
    fragmentShader: fragSrc,
    // transparent: true so iFade.x can fade buildings (Task 11).
    transparent: true,
    uniforms: {
      // Hidden-tier wireframe thickness in screen-pixels. Updated by
      // refreshBuildingMaterial() on hot-reload.
      uOutlineWidth: { value: BUILDING_OUTLINE.get().WIDTH },
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
      uFogEnabled: { value: SCENE_COLORS.get().FOG_ENABLED },
      uFogColor: { value: new THREE.Color().setStyle(SCENE_COLORS.get().FOG_COLOR, THREE.LinearSRGBColorSpace) },
      uFogIntensity: { value: SCENE_COLORS.get().FOG_INTENSITY },
      uFogHeight: { value: _computeFogHeight() },
      // Distance-fog uniforms — fades by view distance. Driven by
      // ISLAND_ATMOSPHERE.DISTANCE_FOG_*; refreshed via refreshBuildingMaterial().
      // Defaults to disabled (DISTANCE_FOG_ENABLED: false) — users opt in via Controls.
      uDistanceFogEnabled: { value: ISLAND_ATMOSPHERE.get().DISTANCE_FOG_ENABLED },
      uDistanceFogColor: { value: new THREE.Color(ISLAND_ATMOSPHERE.get().DISTANCE_FOG_COLOR) },
      uDistanceFogNear: { value: ISLAND_ATMOSPHERE.get().DISTANCE_FOG_NEAR },
      uDistanceFogFar: { value: ISLAND_ATMOSPHERE.get().DISTANCE_FOG_FAR },
      // Extra HDR emission applied to the freshest building's lit
      // windows on top of a baseline 1.0. 0 = no bloom contribution
      // from windows; higher = brighter glow on new buildings.
      uWindowEmissionBoost: { value: BLOOM.get().WINDOW_EMISSION },
      // Age-driven decay uniforms (createdAge-gated, independent of
      // modifiedAge). See BUILDING_AGING config.
      uGrimeIntensity: {
        value: BUILDING_AGING.get().GRIME_ENABLED ? BUILDING_AGING.get().GRIME_INTENSITY : 0,
      },
      uGrimeCoverage: { value: BUILDING_AGING.get().GRIME_COVERAGE },
      uTiltMaxRad: {
        value: BUILDING_AGING.get().TILT_ENABLED
          ? (BUILDING_AGING.get().TILT_DEGREES * Math.PI) / 180
          : 0,
      },
      // Scene directional lighting (LIGHTING store). uSunDirWorld is
      // re-initialised below from the current LIGHTING values so the
      // first frame already has the configured sun direction; the
      // ambient and contrast scalars are seeded inline. The (0,1,0)
      // placeholder gives an overhead sun if _writeSunDir somehow
      // doesn't run, rather than the all-faces-shadow look a zero
      // vector would produce.
      uSunDirWorld: { value: new THREE.Vector3(0, 1, 0) },
      uAmbient: { value: LIGHTING.get().AMBIENT },
      uSunContrast: { value: LIGHTING.get().SUN_CONTRAST },
      // Procedural facade geometry (FACADE_GEOMETRY store). Seeded from
      // the current store snapshot so the first frame renders with the
      // configured values; refreshBuildingMaterial() pushes updates on
      // hot-reload. Only the shader-side keys appear here — the JS-side
      // keys (WINDOW_COLS_MAX, WIDTH_PER_WINDOW_COL, DOOR_WIDTH_FRAC_OF_PATH)
      // bake into per-instance attributes in buildBuildingInstanceBuffer above.
      uSlabHeightFrac: { value: FACADE_GEOMETRY.get().SLAB_HEIGHT_FRAC },
      uWindowWidthFrac: { value: FACADE_GEOMETRY.get().WINDOW_WIDTH_FRAC },
      uWindowHeightFrac: { value: FACADE_GEOMETRY.get().WINDOW_HEIGHT_FRAC },
      uWindowMarginFrac: { value: FACADE_GEOMETRY.get().WINDOW_MARGIN_FRAC },
      uDoorHeightFrac: { value: FACADE_GEOMETRY.get().DOOR_HEIGHT_FRAC },
      uRoofBorderFrac: { value: FACADE_GEOMETRY.get().ROOF_BORDER_FRAC },
      // FACADE_DETAIL store — HSL lightness deltas applied to slab, door,
      // and roof-border via shadeColor/shadeAndShiftHue in the shader.
      uSlabLightnessDelta: { value: FACADE_DETAIL.get().SLAB_LIGHTNESS_DELTA },
      uDoorLightnessDelta: { value: FACADE_DETAIL.get().DOOR_LIGHTNESS_DELTA },
      uRoofBorderLightnessDelta: { value: FACADE_DETAIL.get().ROOF_BORDER_LIGHTNESS_DELTA },
      // WINDOW_LIGHTING store — per-cell lit/unlit lightness deltas, gap
      // thresholds, and the warm-amber tint for old/dim lit panes.
      uWindowUnlitLightnessDelta: { value: WINDOW_LIGHTING.get().UNLIT_LIGHTNESS_DELTA },
      uWindowGapBaseThreshold: { value: WINDOW_LIGHTING.get().GAP_BASE_THRESHOLD },
      uWindowGapAgeBonus: { value: WINDOW_LIGHTING.get().GAP_AGE_BONUS },
      // setStyle(..., LinearSRGBColorSpace) skips Three's automatic sRGB→linear
      // conversion. The shader consumes uDimGlowColor in sRGB space (the prior
      // hardcoded vec3(0.5, 0.4, 0.15) was sRGB), so we pass the hex bytes
      // through unchanged.
      uDimGlowColor: { value: new THREE.Color().setStyle(WINDOW_LIGHTING.get().DIM_GLOW_COLOR, THREE.LinearSRGBColorSpace) },
      uLitFreshnessExponent: { value: WINDOW_LIGHTING.get().LIT_FRESHNESS_EXPONENT },
    },
  });
  writeSunDir(_sharedMaterial.uniforms.uSunDirWorld.value as THREE.Vector3);
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
 * applyTheme() coordinator hook: push fresh BUILDING_OUTLINE.WIDTH into
 * the shared building material's uOutlineWidth uniform so the Hidden-tier
 * wireframe thickness honors live config edits.
 */
export function refreshBuildingMaterial(): void {
  if (!_sharedMaterial) return;
  const sceneCfg = SCENE_COLORS.get();
  const bloomCfg = BLOOM.get();
  const atm = ISLAND_ATMOSPHERE.get();
  _sharedMaterial.uniforms.uOutlineWidth.value = BUILDING_OUTLINE.get().WIDTH;
  // Height fog: uFogEnabled drives the GLSL branch; uFogIntensity is also
  // zeroed when disabled so the mix() is a no-op even if the bool branch
  // ever short-circuits differently on a given driver.
  _sharedMaterial.uniforms.uFogEnabled.value = sceneCfg.FOG_ENABLED;
  (_sharedMaterial.uniforms.uFogColor.value as THREE.Color).setStyle(
    sceneCfg.FOG_COLOR,
    THREE.LinearSRGBColorSpace,
  );
  _sharedMaterial.uniforms.uFogIntensity.value = sceneCfg.FOG_ENABLED ? sceneCfg.FOG_INTENSITY : 0;
  _sharedMaterial.uniforms.uFogHeight.value = _computeFogHeight();
  // BLOOM.ENABLED off → no HDR push for windows, so they stay LDR and
  // produce nothing the bloom pass (also bypassed via postFx.refresh)
  // could pick up.
  _sharedMaterial.uniforms.uWindowEmissionBoost.value = bloomCfg.ENABLED ? bloomCfg.WINDOW_EMISSION : 0;
  const aging = BUILDING_AGING.get();
  _sharedMaterial.uniforms.uGrimeIntensity.value = aging.GRIME_ENABLED ? aging.GRIME_INTENSITY : 0;
  _sharedMaterial.uniforms.uGrimeCoverage.value = aging.GRIME_COVERAGE;
  _sharedMaterial.uniforms.uTiltMaxRad.value = aging.TILT_ENABLED
    ? (aging.TILT_DEGREES * Math.PI) / 180
    : 0;
  // Scene directional lighting (LIGHTING store).
  const lighting = LIGHTING.get();
  writeSunDir(_sharedMaterial.uniforms.uSunDirWorld.value as THREE.Vector3);
  _sharedMaterial.uniforms.uAmbient.value = lighting.AMBIENT;
  _sharedMaterial.uniforms.uSunContrast.value = lighting.SUN_CONTRAST;
  // Procedural facade geometry (FACADE_GEOMETRY store) — shader-side keys.
  // The JS-side keys (WINDOW_COLS_MAX, WIDTH_PER_WINDOW_COL, DOOR_WIDTH_FRAC_OF_PATH) require a full
  // rebuild because they bake into per-instance attributes; hotReload.ts
  // routes the whole store through scheduleRebuild so the uniforms here
  // are kept fresh on the next rebuild without separate plumbing.
  const facade = FACADE_GEOMETRY.get();
  _sharedMaterial.uniforms.uSlabHeightFrac.value = facade.SLAB_HEIGHT_FRAC;
  _sharedMaterial.uniforms.uWindowWidthFrac.value = facade.WINDOW_WIDTH_FRAC;
  _sharedMaterial.uniforms.uWindowHeightFrac.value = facade.WINDOW_HEIGHT_FRAC;
  _sharedMaterial.uniforms.uWindowMarginFrac.value = facade.WINDOW_MARGIN_FRAC;
  _sharedMaterial.uniforms.uDoorHeightFrac.value = facade.DOOR_HEIGHT_FRAC;
  _sharedMaterial.uniforms.uRoofBorderFrac.value = facade.ROOF_BORDER_FRAC;
  // FACADE_DETAIL store — pure uniform refresh, no rebuild required.
  const facadeDetail = FACADE_DETAIL.get();
  _sharedMaterial.uniforms.uSlabLightnessDelta.value = facadeDetail.SLAB_LIGHTNESS_DELTA;
  _sharedMaterial.uniforms.uDoorLightnessDelta.value = facadeDetail.DOOR_LIGHTNESS_DELTA;
  _sharedMaterial.uniforms.uRoofBorderLightnessDelta.value = facadeDetail.ROOF_BORDER_LIGHTNESS_DELTA;
  // WINDOW_LIGHTING store — pure uniform refresh. .set(cssString) on the
  // pre-allocated THREE.Color preserves the linear-sRGB conversion path.
  const windowLighting = WINDOW_LIGHTING.get();
  _sharedMaterial.uniforms.uWindowUnlitLightnessDelta.value = windowLighting.UNLIT_LIGHTNESS_DELTA;
  _sharedMaterial.uniforms.uWindowGapBaseThreshold.value = windowLighting.GAP_BASE_THRESHOLD;
  _sharedMaterial.uniforms.uWindowGapAgeBonus.value = windowLighting.GAP_AGE_BONUS;
  // Pass DIM_GLOW_COLOR through unchanged — shader treats it as sRGB,
  // matching the prior hardcoded vec3(0.5, 0.4, 0.15) literal.
  (_sharedMaterial.uniforms.uDimGlowColor.value as THREE.Color).setStyle(
    windowLighting.DIM_GLOW_COLOR,
    THREE.LinearSRGBColorSpace,
  );
  _sharedMaterial.uniforms.uLitFreshnessExponent.value = windowLighting.LIT_FRESHNESS_EXPONENT;
  // Distance-fog uniforms (ISLAND_ATMOSPHERE store) — pushed alongside
  // height-fog updates so live config changes apply without a rebuild.
  _sharedMaterial.uniforms.uDistanceFogEnabled.value = atm.DISTANCE_FOG_ENABLED;
  (_sharedMaterial.uniforms.uDistanceFogColor.value as THREE.Color).set(atm.DISTANCE_FOG_COLOR);
  _sharedMaterial.uniforms.uDistanceFogNear.value = atm.DISTANCE_FOG_NEAR;
  _sharedMaterial.uniforms.uDistanceFogFar.value = atm.DISTANCE_FOG_FAR;
}
