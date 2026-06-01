// state/reactions.ts — Settings-change → scene-rebuild / material-refresh wiring.
//
// Two computed signatures drive ONE effect each:
//   REBUILD_SIGNATURE    → scheduleRebuild   (full applyManifest)
//   MATERIAL_REFRESH_SIGNATURE → refreshMaterials (applyTheme only)
//
// For stores that are split-routed (some keys rebuild, others refresh), the
// computed reads ONLY the relevant keys so the wrong effect doesn't fire.

import { computed, effect, untracked } from '@preact/signals';

import { REBUILD_STATUS, LAST_REBUILD_ERROR, LAST_UPDATED_AT } from '@/state/runtime/manifestPoll';

import {
  // Rebuild-required (full store):
  BUILDING_DIMENSIONS,
  BUILDING_PALETTE,
  STREET_LAYOUT,
  STREET_TIERS,
  GEM_SIZING,
  AD_PANEL,
  LABEL_TYPOGRAPHY,

  // Material-only (full store):
  SCENE,
  SIDEWALK_COLORS,
  ASPHALT,
  BUILDING_OUTLINE,
  BUILDING_AGING,
  PATH_LINE,
  HOVER_PATH_LINE,
  GEM_APPEARANCE,
  GEM_FACE_PALETTE,
  GEM_GLOW,
  BLOOM,
  LIGHTING,
  FACADE_DETAIL,
  WINDOW_LIGHTING,
  REPO_LABEL,

  // Split-routed (specific keys below):
  FACADE_GEOMETRY,
  TREES,
  FOOTPRINT,
  WORLD,
} from '@/state/settings/index';
import { ISLAND } from '@/state/settings/island';
import { FIREFLIES } from '@/state/settings/fireflies';

// Min-dwell for the 'rebuilding' indicator on the material-only path.
const HOT_REBUILD_MIN_DWELL_MS = 220;

interface CommitReactionsOpts {
  world: {
    getManifest(): unknown;
    applyManifest(m: unknown): Promise<void>;
    invalidateLayoutCache(): void;
  };
  applyTheme: () => void;
}

// ── Rebuild signature ─────────────────────────────────────────────────────
// Reads every signal whose change requires a full applyManifest.
// Split-routed stores contribute only their structural keys.
const REBUILD_SIGNATURE = computed(() => ({
  // Full-store rebuild triggers:
  buildingDimensions: BUILDING_DIMENSIONS.value,
  buildingPalette: BUILDING_PALETTE.value,
  streetLayout: STREET_LAYOUT.value,
  streetTiers: STREET_TIERS.value,
  gemSizing: GEM_SIZING.value,
  adPanel: AD_PANEL.value,
  labelTypography: LABEL_TYPOGRAPHY.value,

  // FACADE_GEOMETRY — only the JS-driven keys that bake into per-instance
  // attributes (WINDOW_COLS_MAX, WIDTH_PER_WINDOW_COL, DOOR_WIDTH_FRAC).
  // The shader-side *_FRAC keys live in MATERIAL_REFRESH_SIGNATURE.
  facadeGeometry: {
    windowColsMax: FACADE_GEOMETRY.value.WINDOW_COLS_MAX,
    widthPerWindowCol: FACADE_GEOMETRY.value.WIDTH_PER_WINDOW_COL,
    doorWidthFrac: FACADE_GEOMETRY.value.DOOR_WIDTH_FRAC,
  },

  // TREES — structural keys only (height/width range, facet counts, trunk
  // fractions, density, shading, inset, scatter footprint, age-width floor).
  // Color + trunk color + age-desat keys live in MATERIAL_REFRESH_SIGNATURE.
  trees: {
    minHeight: TREES.value.MIN_HEIGHT,
    maxHeight: TREES.value.MAX_HEIGHT,
    minWidth: TREES.value.MIN_WIDTH,
    maxWidth: TREES.value.MAX_WIDTH,
    facetsLow: TREES.value.FACETS_LOW,
    facetsMid: TREES.value.FACETS_MID,
    facetsHigh: TREES.value.FACETS_HIGH,
    trunkHeightFrac: TREES.value.TRUNK_HEIGHT_FRAC,
    trunkRadiusFrac: TREES.value.TRUNK_RADIUS_FRAC,
    canopyOverlapFrac: TREES.value.CANOPY_TRUNK_OVERLAP_FRAC,
    shadingStrength: TREES.value.SHADING_STRENGTH,
    edgeInset: TREES.value.EDGE_INSET_PERCENT,
    densityFalloff: TREES.value.DENSITY_FALLOFF,
    widthAgeFloor: TREES.value.WIDTH_AGE_FLOOR,
  },

  // FOOTPRINT — only HALO_WIDTH bakes into per-instance Matrix4 data.
  // COLOR + ENABLED + CORNER_RADIUS live in MATERIAL_REFRESH_SIGNATURE.
  footprintHaloWidth: FOOTPRINT.value.HALO_WIDTH,

  // WORLD — GROUND_BUFFER_PERCENT changes the island size and foliage
  // sampling region; requires a full rebuild.
  groundBufferPercent: WORLD.value.GROUND_BUFFER_PERCENT,

  // ISLAND_GEOMETRY shape keys — changing the polygon silhouette
  // invalidates the tree point-in-polygon rejection pass.
  // ENABLED (flips group.visible) lives in MATERIAL_REFRESH_SIGNATURE.
  islandGeometry: {
    sides: ISLAND.value.SIDES,
    irregularity: ISLAND.value.IRREGULARITY,
    tiers: ISLAND.value.TIERS,
    depth: ISLAND.value.DEPTH,
    roundness: ISLAND.value.ROUNDNESS,
    grassThickness: ISLAND.value.GRASS_THICKNESS,
  },

  // FIREFLIES structural keys — ENABLED gates orb creation;
  // SCALE_MIN/MAX bake into per-instance data; ORBIT_RING_ENABLED and
  // ORBIT_RING_THICKNESS bake into TubeGeometry at creation time.
  // Animation/brightness keys live in MATERIAL_REFRESH_SIGNATURE.
  fireflies: {
    enabled: FIREFLIES.value.ENABLED,
    scaleMin: FIREFLIES.value.SCALE_MIN,
    scaleMax: FIREFLIES.value.SCALE_MAX,
    orbitRingEnabled: FIREFLIES.value.ORBIT_RING_ENABLED,
    orbitRingThickness: FIREFLIES.value.ORBIT_RING_THICKNESS,
  },
}));

// ── Material-refresh signature ────────────────────────────────────────────
// Reads every signal whose change requires only applyTheme (no full rebuild).
// Split-routed stores contribute only their material/uniform keys.
const MATERIAL_REFRESH_SIGNATURE = computed(() => ({
  // Full-store material triggers:
  scene: SCENE.value, // sky color + stars + fog (all material-refresh)
  sidewalkColors: SIDEWALK_COLORS.value,
  asphalt: ASPHALT.value,
  buildingOutline: BUILDING_OUTLINE.value,
  buildingAging: BUILDING_AGING.value,
  pathLine: PATH_LINE.value,
  hoverPathLine: HOVER_PATH_LINE.value,
  gemAppearance: GEM_APPEARANCE.value,
  gemFacePalette: GEM_FACE_PALETTE.value,
  gemGlow: GEM_GLOW.value,
  bloom: BLOOM.value,
  lighting: LIGHTING.value,
  facadeDetail: FACADE_DETAIL.value,
  windowLighting: WINDOW_LIGHTING.value,
  repoLabel: REPO_LABEL.value,

  // ISLAND material keys only (the shape keys are in REBUILD_SIGNATURE, so
  // reading the whole store here would double-route a geometry change).
  islandMaterials: {
    grassColor: ISLAND.value.GRASS_COLOR,
    grassSideColor: ISLAND.value.GRASS_SIDE_COLOR,
    rockColor: ISLAND.value.ROCK_COLOR,
    hemiSkyColor: ISLAND.value.HEMI_SKY_COLOR,
    hemiGroundColor: ISLAND.value.HEMI_GROUND_COLOR,
  },

  // Tree outline (folded into TREES as OUTLINE_* keys) — re-tints/re-widths
  // the hover/selected wireframe via treeOutlineRenderer.refreshMaterials().
  treeOutline: {
    width: TREES.value.OUTLINE_WIDTH,
    hoverColor: TREES.value.OUTLINE_HOVER_COLOR,
    hoverOpacity: TREES.value.OUTLINE_HOVER_OPACITY,
    selectedOpacity: TREES.value.OUTLINE_SELECTED_OPACITY,
  },

  // FACADE_GEOMETRY — shader-side *_FRAC keys only; JS-driven keys are
  // in REBUILD_SIGNATURE.
  facadeGeometry: {
    slabHeightFrac: FACADE_GEOMETRY.value.SLAB_HEIGHT_FRAC,
    windowWidthFrac: FACADE_GEOMETRY.value.WINDOW_WIDTH_FRAC,
    windowHeightFrac: FACADE_GEOMETRY.value.WINDOW_HEIGHT_FRAC,
    windowMarginFrac: FACADE_GEOMETRY.value.WINDOW_MARGIN_FRAC,
    doorHeightFrac: FACADE_GEOMETRY.value.DOOR_HEIGHT_FRAC,
    roofBorderFrac: FACADE_GEOMETRY.value.ROOF_BORDER_FRAC,
  },

  // TREES — color + visibility + trunk color + age-desat keys only.
  trees: {
    enabled: TREES.value.ENABLED,
    colorBusyDay: TREES.value.COLOR_BUSY_DAY,
    colorSoloDay: TREES.value.COLOR_SOLO_DAY,
    trunkColor: TREES.value.TRUNK_COLOR,
    ageDesatEnabled: TREES.value.AGE_DESAT_ENABLED,
    ageSatMin: TREES.value.AGE_SATURATION[0],
    ageSatMax: TREES.value.AGE_SATURATION[1],
  },

  // FOOTPRINT — COLOR + ENABLED + CORNER_RADIUS pushed via footprint.refresh().
  footprint: {
    enabled: FOOTPRINT.value.ENABLED,
    cornerRadius: FOOTPRINT.value.CORNER_RADIUS,
    color: FOOTPRINT.value.COLOR,
  },

  // ISLAND_GEOMETRY — ENABLED only (flips group.visible via island.refresh()).
  // Shape keys are in REBUILD_SIGNATURE.
  islandGeometryEnabled: ISLAND.value.ENABLED,

  // FIREFLIES — animation/brightness uniforms pushed via fireflies.refresh().
  fireflies: {
    orbitSpeed: FIREFLIES.value.ORBIT_SPEED,
    bobAmplitude: FIREFLIES.value.BOB_AMPLITUDE,
    bobSpeed: FIREFLIES.value.BOB_SPEED,
    pulseAmplitude: FIREFLIES.value.PULSE_AMPLITUDE,
    pulseSpeed: FIREFLIES.value.PULSE_SPEED,
    emissionStrength: FIREFLIES.value.EMISSION_STRENGTH,
    flickerAmount: FIREFLIES.value.FLICKER_AMOUNT,
  },
}));

export function attachCommitReactions({ world, applyTheme }: CommitReactionsOpts): () => void {
  // Effects fire synchronously on first call. Suppress reactions until all
  // subscriptions are wired so the initial fire doesn't trigger a rebuild.
  let armed = false;

  let hotIdleTimer: ReturnType<typeof setTimeout> | 0 = 0;

  async function scheduleRebuild() {
    if (!armed) return;
    REBUILD_STATUS.value = 'rebuilding';
    try {
      // Config changes that hit this path always invalidate the layout cache:
      // the manifest didn't change but a layout-affecting config value did,
      // so reuseLayoutFrom would skip the recompute and the change would
      // have no visible effect. Live-update polls never trigger scheduleRebuild
      // so they keep using the cache.
      world.invalidateLayoutCache();
      const manifest = world.getManifest();
      if (manifest) {
        await world.applyManifest(manifest);
      }
      REBUILD_STATUS.value = 'idle';
      LAST_REBUILD_ERROR.value = null;
    } catch (err) {
      REBUILD_STATUS.value = 'error';
      LAST_REBUILD_ERROR.value = err instanceof Error ? err.message : String(err);
    }
  }

  function refreshMaterials() {
    if (!armed) return;
    if (hotIdleTimer) clearTimeout(hotIdleTimer);
    REBUILD_STATUS.value = 'rebuilding';
    try {
      applyTheme();
    } catch (err) {
      REBUILD_STATUS.value = 'error';
      LAST_REBUILD_ERROR.value = err instanceof Error ? err.message : String(err);
      return;
    }
    // applyTheme is synchronous; hold the 'rebuilding' indicator for a
    // min-dwell so the user sees the yellow flash. Only transition if no
    // rebuild is also in flight — applyManifest owns the final state then.
    hotIdleTimer = setTimeout(() => {
      hotIdleTimer = 0;
      if (REBUILD_STATUS.value === 'rebuilding') {
        REBUILD_STATUS.value = 'idle';
        LAST_REBUILD_ERROR.value = null;
        LAST_UPDATED_AT.value = Date.now();
      }
    }, HOT_REBUILD_MIN_DWELL_MS);
  }

  // Each effect must track ONLY its signature computed. The imperative work
  // (scheduleRebuild → applyManifest, refreshMaterials → applyTheme) reads
  // OTHER signals — notably applyTheme → _refreshSidewalkTints reads
  // picker.hover / picker.selection — so it must run untracked(); otherwise the
  // effect subscribes to hover/selection after its first run and re-fires on
  // every hover (bug #4: spurious "rebuilding" on tree hover after a save).
  const unsubRebuild = effect(() => {
    void REBUILD_SIGNATURE.value; // establish tracking
    if (!armed) return;
    untracked(() => {
      void scheduleRebuild();
    });
  });

  const unsubMaterials = effect(() => {
    void MATERIAL_REFRESH_SIGNATURE.value; // establish tracking
    if (!armed) return;
    untracked(() => refreshMaterials());
  });

  armed = true;

  return function dispose() {
    armed = false;
    if (hotIdleTimer) {
      clearTimeout(hotIdleTimer);
      hotIdleTimer = 0;
    }
    unsubRebuild();
    unsubMaterials();
  };
}
