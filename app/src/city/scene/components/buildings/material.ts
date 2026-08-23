// city/components/buildings/material.ts — ONE city's building ShaderMaterial,
// its uniforms, and its icon atlas. Every cell of that city shares it, so a
// uniform written here updates the whole city at once and no other.

import * as THREE from 'three';
import type { CityConfig } from '@/city/session/config';
import type { IconAtlas } from './atlas';
import { setColorFromHex } from '@/city/scene/utils/color/setColorFromHex';
import { writeSunDir } from '@/city/scene/utils/shaders/sunDir';
import {
  LIGHTING_SUN_AZIMUTH_DEG,
  LIGHTING_SUN_ELEVATION_DEG,
  LIGHTING_AMBIENT,
  LIGHTING_SUN_CONTRAST,
} from '@/city/scene/constants/lighting';

// Shader-side facade keys ride uniforms; the JS-side ones bake into per-instance
// attributes, which is why changing them routes to a full rebuild.

import buildingVertSrc from './building.vert.glsl?raw';
import buildingFragSrc from './building.frag.glsl?raw';

/** One city's buildings, as the GPU sees them: the material every cell of it
 *  shares, and the icon atlas its roofs sample. */
export class BuildingMaterial {
  constructor(private readonly config: CityConfig) {}

  // One material for every cell of this city: applyManifest runs repeatedly,
  // and a per-rebuild material would accumulate.
  private material: THREE.ShaderMaterial | null = null;

  // Pushed in before the cell pass, so buildings have it as they're built. Null
  // while it loads or if it failed: the shader paints the bare roof colour.
  private atlas: IconAtlas | null = null;

  /** Mirrors the material's `transparent` so the setter can skip a no-op
   *  needsUpdate — the owners call it per sweep and per scrub frame. */
  private translucent = false;

  setIconAtlas(atlas: IconAtlas | null): void {
    this.atlas = atlas;
    if (this.material) {
      this.material.uniforms.uIconAtlas.value = atlas ? atlas.texture : null;
      this.material.uniforms.uIconSlotSize.value = atlas ? atlas.slotSize : 0;
    }
  }

  /** The icon atlas the cells resolve per-instance roof UVs from, or null when
   *  it hasn't built yet. Single source, shared with the uIconAtlas uniform. */
  getIconAtlas(): IconAtlas | null {
    return this.atlas;
  }

  /** Opaque buildings sort front-to-back, so early-z skips the ~620-line facade
   *  shader on hidden fragments; iFade.x is the only alpha, so a fade needs this. */
  setTranslucent(on: boolean): void {
    if (on === this.translucent) return;
    this.translucent = on;
    if (this.material) {
      this.material.transparent = on;
      this.material.needsUpdate = true;
    }
  }

  // Grime is age-scaled: a [newest, oldest] range the shader lerps per-building
  // by createdAge, into a Vector2 (both 0 when disabled → mix → 0).
  private grimeIntensityVec(out: THREE.Vector2): THREE.Vector2 {
    const f = this.config.BUILDINGS.value;
    const [lo, hi] = f.GRIME_ENABLED ? f.GRIME_INTENSITY : [0, 0];
    return out.set(lo, hi);
  }

  /** Shared by every cell's detail mesh: a material per cell meant a program
   *  compile per cell, which hung the tab on large repos. */
  get(): THREE.ShaderMaterial {
    if (this.material) return this.material;
    // Chunks are registered via THREE.ShaderChunk in registerShaderChunks.ts;
    // Three.js's native preprocessor resolves #include <name> at compile time.
    const fragSrc = buildingFragSrc;
    this.material = new THREE.ShaderMaterial({
      vertexShader: buildingVertSrc,
      fragmentShader: fragSrc,
      // Opaque unless something is mid-fade — see setBuildingsTranslucent.
      transparent: this.translucent,
      uniforms: {
        // Hidden-tier wireframe thickness in screen-pixels. Updated by
        // refreshBuildingMaterial() on Save.
        uOutlineWidth: { value: this.config.BUILDINGS.value.OUTLINE_WIDTH },
        // Null until the atlas builds; the shader gates sampling on iIconUV.x.
        uIconAtlas: { value: this.atlas ? this.atlas.texture : null },
        uIconSlotSize: { value: this.atlas ? this.atlas.slotSize : 0 },
        // Height-based haze, mixed into the post-tonemap sRGB framebuffer, so the
        // hex bytes pass through unconverted.
        uFogEnabled: { value: this.config.SCENE.value.FOG_ENABLED },
        uFogColor: { value: setColorFromHex(new THREE.Color(), this.config.SCENE.value.FOG_COLOR) },
        uFogIntensity: { value: this.config.SCENE.value.FOG_INTENSITY },
        // Raw fraction — the shader scales it by each building's own height.
        uFogHeightFrac: { value: this.config.SCENE.value.FOG_HEIGHT_FRAC },
        // Extra emission on the freshest building's windows, over a baseline 1.
        uWindowEmissionBoost: { value: this.config.BUILDINGS.value.WINDOW_EMISSION },
        // Age-driven decay uniforms (createdAge-gated, independent of
        // modifiedAge). See BUILDINGS (aging) config.
        uGrimeIntensity: { value: this.grimeIntensityVec(new THREE.Vector2()) },
        uGrimeCoverage: { value: new THREE.Vector2(...this.config.BUILDINGS.value.GRIME_COVERAGE) },
        // The placeholder is an overhead sun rather than a zero vector, which
        // would shadow every face if _writeSunDir somehow didn't run.
        uSunDirWorld: { value: new THREE.Vector3(0, 1, 0) },
        uAmbient: { value: LIGHTING_AMBIENT },
        uSunContrast: { value: LIGHTING_SUN_CONTRAST },
        // Seeded from the store so the first frame is already configured; only
        // the shader-side keys, since the rest bake into attributes.
        uSlabHeightFrac: { value: this.config.BUILDINGS.value.SLAB_HEIGHT_FRAC },
        uWindowWidthFrac: { value: this.config.BUILDINGS.value.WINDOW_WIDTH_FRAC },
        uWindowHeightFrac: { value: this.config.BUILDINGS.value.WINDOW_HEIGHT_FRAC },
        uWindowMarginFrac: { value: this.config.BUILDINGS.value.WINDOW_MARGIN_FRAC },
        uDoorHeightFrac: { value: this.config.BUILDINGS.value.DOOR_HEIGHT_FRAC },
        uRoofBorderFrac: { value: this.config.BUILDINGS.value.ROOF_BORDER_FRAC },
        // BUILDINGS store — HSL lightness deltas applied to slab and door
        // via shadeColor/shadeAndShiftHue in the shader.
        uSlabLightnessDelta: { value: this.config.BUILDINGS.value.SLAB_LIGHTNESS_DELTA },
        uDoorLightnessDelta: { value: this.config.BUILDINGS.value.DOOR_LIGHTNESS_DELTA },
        // Deleted-file cross (RUINS store) — consumed in sRGB like the roof it
        // composites over, so the hex bytes pass through (see setColorFromHex).
        uRuinXEnabled: { value: this.config.RUINS.value.X_ENABLED },
        uRuinXColor: { value: setColorFromHex(new THREE.Color(), this.config.RUINS.value.X_COLOR) },
        uRuinXWidth: { value: this.config.RUINS.value.X_WIDTH },
        // WINDOW_LIGHTING store — per-cell lit/unlit lightness deltas, gap
        // thresholds, and the warm-amber tint for old/dim lit panes.
        uWindowUnlitLightnessDelta: { value: this.config.BUILDINGS.value.UNLIT_LIGHTNESS_DELTA },
        uWindowGapBaseThreshold: { value: this.config.BUILDINGS.value.GAP_BASE_THRESHOLD },
        uWindowGapAgeBonus: { value: this.config.BUILDINGS.value.GAP_AGE_BONUS },
        // Consumed in sRGB, so the hex bytes pass through unconverted.
        uDimGlowColor: {
          value: setColorFromHex(new THREE.Color(), this.config.BUILDINGS.value.DIM_GLOW_COLOR),
        },
        uLitFreshnessExponent: { value: this.config.BUILDINGS.value.LIT_FRESHNESS_EXPONENT },
      },
    });
    writeSunDir(
      this.material.uniforms.uSunDirWorld.value as THREE.Vector3,
      LIGHTING_SUN_AZIMUTH_DEG,
      LIGHTING_SUN_ELEVATION_DEG
    );
    return this.material;
  }

  /** Re-apply the committed config to this city's uniforms, so a Save reaches
   *  all of it without rebuilding any of it. */
  refresh(): void {
    if (!this.material) return;
    const sceneCfg = this.config.SCENE.value;
    const bloomCfg = this.config.BLOOM.value;
    this.material.uniforms.uOutlineWidth.value = this.config.BUILDINGS.value.OUTLINE_WIDTH;
    // Intensity is zeroed as well as the flag, so the mix is inert even where a
    // driver takes the branch differently.
    this.material.uniforms.uFogEnabled.value = sceneCfg.FOG_ENABLED;
    setColorFromHex(this.material.uniforms.uFogColor.value as THREE.Color, sceneCfg.FOG_COLOR);
    this.material.uniforms.uFogIntensity.value = sceneCfg.FOG_ENABLED ? sceneCfg.FOG_INTENSITY : 0;
    this.material.uniforms.uFogHeightFrac.value = sceneCfg.FOG_HEIGHT_FRAC;
    // Without bloom the windows stay LDR, with nothing for the pass to catch.
    this.material.uniforms.uWindowEmissionBoost.value = bloomCfg.ENABLED
      ? this.config.BUILDINGS.value.WINDOW_EMISSION
      : 0;
    // Scene directional lighting (fixed constants — re-seed idempotently).
    writeSunDir(
      this.material.uniforms.uSunDirWorld.value as THREE.Vector3,
      LIGHTING_SUN_AZIMUTH_DEG,
      LIGHTING_SUN_ELEVATION_DEG
    );
    this.material.uniforms.uAmbient.value = LIGHTING_AMBIENT;
    this.material.uniforms.uSunContrast.value = LIGHTING_SUN_CONTRAST;
    // Shader-side keys only: the rest bake into attributes, so the whole store
    // routes through a rebuild and these come along with it.
    const facade = this.config.BUILDINGS.value;
    // Age weathering (grime) — [newest, oldest] ranges the shader lerps
    // per-building by createdAge.
    this.grimeIntensityVec(this.material.uniforms.uGrimeIntensity.value as THREE.Vector2);
    (this.material.uniforms.uGrimeCoverage.value as THREE.Vector2).set(...facade.GRIME_COVERAGE);
    this.material.uniforms.uSlabHeightFrac.value = facade.SLAB_HEIGHT_FRAC;
    this.material.uniforms.uWindowWidthFrac.value = facade.WINDOW_WIDTH_FRAC;
    this.material.uniforms.uWindowHeightFrac.value = facade.WINDOW_HEIGHT_FRAC;
    this.material.uniforms.uWindowMarginFrac.value = facade.WINDOW_MARGIN_FRAC;
    this.material.uniforms.uDoorHeightFrac.value = facade.DOOR_HEIGHT_FRAC;
    this.material.uniforms.uRoofBorderFrac.value = facade.ROOF_BORDER_FRAC;
    // BUILDINGS store — pure uniform refresh, no rebuild required.
    const facadeDetail = this.config.BUILDINGS.value;
    this.material.uniforms.uSlabLightnessDelta.value = facadeDetail.SLAB_LIGHTNESS_DELTA;
    this.material.uniforms.uDoorLightnessDelta.value = facadeDetail.DOOR_LIGHTNESS_DELTA;
    const ruins = this.config.RUINS.value;
    this.material.uniforms.uRuinXEnabled.value = ruins.X_ENABLED;
    setColorFromHex(this.material.uniforms.uRuinXColor.value as THREE.Color, ruins.X_COLOR);
    this.material.uniforms.uRuinXWidth.value = ruins.X_WIDTH;
    // WINDOW_LIGHTING store — pure uniform refresh into the pre-allocated
    // THREE.Color uniform values.
    const windowLighting = this.config.BUILDINGS.value;
    this.material.uniforms.uWindowUnlitLightnessDelta.value = windowLighting.UNLIT_LIGHTNESS_DELTA;
    this.material.uniforms.uWindowGapBaseThreshold.value = windowLighting.GAP_BASE_THRESHOLD;
    this.material.uniforms.uWindowGapAgeBonus.value = windowLighting.GAP_AGE_BONUS;
    // DIM_GLOW_COLOR is consumed in sRGB space — see the uniform's initializer.
    setColorFromHex(
      this.material.uniforms.uDimGlowColor.value as THREE.Color,
      windowLighting.DIM_GLOW_COLOR
    );
    this.material.uniforms.uLitFreshnessExponent.value = windowLighting.LIT_FRESHNESS_EXPONENT;
  }
}
