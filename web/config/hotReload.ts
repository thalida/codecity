// config/hotReload.ts — every config store classified as either
// "rebuild-required" or "hot-reloadable", and wired to the matching
// reaction:
//
//   rebuild-required → debounced cityScene.applyManifest(getManifest())
//                       so a slider drag coalesces into one rebuild
//   hot-reloadable   → applyTheme() (renderer modules' refreshMaterials
//                       coordinator), or no-op for stores that are read
//                       fresh per frame
//
// Adding a new config row is a one-line entry in the appropriate set
// below — the reactions below pick it up automatically.

import { listenKeys } from 'nanostores';

import { REBUILD_STATUS, LAST_REBUILD_ERROR, LAST_UPDATED_AT } from '../liveStatus.js';

import {
  // Rebuild-required (affects layout or geometry):
  BUILDING_DIMENSIONS,
  BUILDING_PALETTE,
  STREET_LAYOUT,
  STREET_TIERS,
  GEM_SIZING,
  AD_PANEL,

  // Hot-reloadable (live material updates only):
  SCENE_COLORS,
  SIDEWALK_COLORS,
  ASPHALT,
  BUILDING_OUTLINE,
  BUILDING_AGING,
  PATH_LINE,
  HOVER_PATH_LINE,
  GEM_APPEARANCE,
  GEM_GLOW,
  LABEL_TYPOGRAPHY,
  BLOOM,
  LIGHTING,
  FACADE_DETAIL,
  WINDOW_LIGHTING,

  // Mixed (subscribed to BOTH lists — see below):
  FACADE_GEOMETRY,

  // Cyberpunk Valley — sky (uniform-only, no rebuild):
  SKY,
  SKY_STARS,

  // Cyberpunk Valley — world floor (GROUND_BUFFER_PERCENT → rebuild;
  // GROUND_COLOR/GROUND_ENABLED → hot path via worldFloor.refresh()):
  WORLD,

  // Cyberpunk Valley — trees (structural in TREES → rebuild):
  TREES,

  // Cyberpunk Valley — bushes (structural in BUSHES → rebuild;
  // BUSH_* colors → hot path via bushes.refresh()):
  BUSHES,

  // Cyberpunk Valley — footprint (HALO_WIDTH bakes into instance
  // matrices → rebuild; COLOR/ENABLED → hot path via footprint.refresh()):
  FOOTPRINT,
} from './index.js';

// 50 ms debounce so a continuous slider drag (e.g. dragging
// BUILDING_DIMENSIONS.MAX_FLOORS through 30 → 200) coalesces into one
// rebuild after the user stops, instead of one rebuild per slider tick.
const REBUILD_DEBOUNCE_MS = 50;

// Min-dwell for the 'rebuilding' indicator on the hot-reload path.
// applyTheme() is synchronous and finishes within microseconds, so without
// a forced floor the user never sees the yellow flash. ~220 ms is long
// enough to register visually but short enough to feel snappy.
const HOT_REBUILD_MIN_DWELL_MS = 220;

interface HotReloadOpts {
  cityScene: {
    getManifest(): unknown;
    applyManifest(m: unknown): Promise<void>;
  };
  applyTheme: () => void;
}

export function attachHotReload({ cityScene, applyTheme }: HotReloadOpts): () => void {
  // nanostores `.subscribe()` fires synchronously with the current
  // value when called. We wait until all subscriptions are wired
  // before allowing reactions to run, so the initial fire doesn't
  // trigger a wasteful rebuild.
  let armed = false;

  let rebuildTimer: ReturnType<typeof setTimeout> | 0 = 0;
  let hotIdleTimer: ReturnType<typeof setTimeout> | 0 = 0;

  function scheduleRebuild() {
    if (!armed) return;
    if (rebuildTimer) clearTimeout(rebuildTimer);
    // Flip to 'rebuilding' immediately when the timer is scheduled
    // (not just before applyManifest fires) so the indicator paints
    // before the debounce gap closes. applyManifest is async now —
    // its layout phase runs off-thread via the layout worker, and only
    // the mesh-construction tail blocks the main thread.
    REBUILD_STATUS.set('rebuilding');
    rebuildTimer = setTimeout(async () => {
      rebuildTimer = 0;
      try {
        const manifest = cityScene.getManifest();
        // getManifest() returns null only during scene teardown — not a
        // path reachable via store mutation under normal use. The 'idle'
        // transition below is safe even in that no-op branch.
        if (manifest) {
          // [boot-diag] hotReload rebuild path
          console.log('[boot] applyManifest caller=hotReload/scheduleRebuild', {
            stack: new Error().stack?.split('\n').slice(0, 6).join(' | '),
          });
          await cityScene.applyManifest(manifest);
        }
        // LAST_UPDATED_AT is set by the coordinator's cityScene.onChange
        // listener after applyManifest's _emit(changeCbs, ...) fires —
        // not set here. refreshMaterials below uses its own hot-path
        // timestamp set because applyTheme doesn't fire onChange.
        REBUILD_STATUS.set('idle');
        LAST_REBUILD_ERROR.set(null);
      } catch (err) {
        REBUILD_STATUS.set('error');
        LAST_REBUILD_ERROR.set(err instanceof Error ? err.message : String(err));
      }
    }, REBUILD_DEBOUNCE_MS);
  }

  function refreshMaterials() {
    if (!armed) return;
    if (hotIdleTimer) clearTimeout(hotIdleTimer);
    REBUILD_STATUS.set('rebuilding');
    try {
      applyTheme();
    } catch (err) {
      REBUILD_STATUS.set('error');
      LAST_REBUILD_ERROR.set(err instanceof Error ? err.message : String(err));
      return;
    }
    // applyTheme is synchronous; hold the 'rebuilding' indicator on
    // screen for a min-dwell so the user can see the yellow flash.
    // Only transition if no rebuild is also in flight — applyManifest's
    // own try/catch owns the final state in that case.
    hotIdleTimer = setTimeout(() => {
      hotIdleTimer = 0;
      if (REBUILD_STATUS.get() === 'rebuilding') {
        REBUILD_STATUS.set('idle');
        LAST_REBUILD_ERROR.set(null);
        LAST_UPDATED_AT.set(Date.now());
      }
    }, HOT_REBUILD_MIN_DWELL_MS);
  }

  const rebuildStores = [
    BUILDING_DIMENSIONS,
    BUILDING_PALETTE,
    STREET_LAYOUT,
    STREET_TIERS,
    GEM_SIZING,
    // AD_PANEL: margin / offset / placeholder bake into per-mesh
    // PlaneGeometry + MeshBasicMaterial calls inside createAdPanel().
    // Slider changes only take effect on the next applyManifest →
    // rebuild required.
    AD_PANEL,
    // LABEL_TYPOGRAPHY: all keys (font-size / padding / stroke / fill / etc.)
    // trigger a full applyManifest() rebuild. The old per-texture
    // regenerateLabelTexture hot-path is removed (Task 20); for v1, a
    // full rebuild on label-typography change is acceptable — hot-reload
    // here is rare.
    LABEL_TYPOGRAPHY,
    // FACADE_GEOMETRY: WINDOW_COLS_MAX / WIDTH_PER_WINDOW_COL /
    // DOOR_WIDTH_FRAC_OF_PATH bake into per-instance attributes
    // (buf.cols / buf.doorWidth), so a change requires re-running
    // buildBuildingInstanceBuffer via applyManifest. The shader-side
    // keys (SLAB/WINDOW/DOOR/ROOF_*_FRAC) are also pushed live via the
    // hotStores entry below — split-routing the same store keeps the
    // wiring trivial. If the rebuild churn ever becomes a perf concern
    // we can switch to listenKeys to gate scheduleRebuild on just the
    // three JS keys.
    FACADE_GEOMETRY,
    // TREES is intentionally NOT here as a whole-store subscription:
    // color + visibility + trunk-color keys live in hotStores and
    // refresh via trees.refresh(); structural keys (height range,
    // shape toggles, shading strength, inset, footprint) get narrow
    // listenKeys subscriptions below.
    // BUSHES is intentionally NOT here as a whole-store subscription:
    // only BUSHES_ENABLED is structural, and we gate it via listenKeys
    // below. Color + emission keys live in hotStores and refresh via
    // bushes.refresh().
    //
    // FOOTPRINT is intentionally NOT here as a whole-store subscription:
    // only HALO_WIDTH is structural, and we gate it via listenKeys below.
    // COLOR + ENABLED live in hotStores and refresh via footprint.refresh().
  ];

  const hotStores = [
    SCENE_COLORS,
    SIDEWALK_COLORS,
    ASPHALT,
    BUILDING_OUTLINE,
    BUILDING_AGING,
    PATH_LINE,
    HOVER_PATH_LINE,
    GEM_APPEARANCE,
    GEM_GLOW,
    BLOOM,
    LIGHTING,
    // FACADE_GEOMETRY: shader-side keys (SLAB/WINDOW/DOOR/ROOF_*_FRAC)
    // are pushed through refreshBuildingMaterial() — sliders on these
    // give instant visual feedback without waiting for the rebuild
    // triggered from rebuildStores above.
    FACADE_GEOMETRY,
    // FACADE_DETAIL and WINDOW_LIGHTING are pure shader uniforms (no
    // per-instance attributes), so they live exclusively in hotStores —
    // refreshBuildingMaterial() pushes them on every slider tick.
    FACADE_DETAIL,
    WINDOW_LIGHTING,
    // SKY_* — pure uniform refreshes via sky.refresh() inside applyTheme().
    // No rebuild path; the sky is a single mesh whose shader uniforms are
    // mutated in place. Master ENABLED toggle on SKY flips mesh.visible
    // (also handled by sky.refresh()).
    SKY,
    SKY_STARS,
    // WORLD: GROUND_COLOR + GROUND_ENABLED are pushed live via
    // worldFloor.refresh() inside applyTheme() — no rebuild required.
    // GROUND_BUFFER_PERCENT gets a narrow listenKeys subscription below so
    // dragging the color slider doesn't trigger a spurious applyManifest.
    WORLD,
    // TREES color + visibility + trunk color. trees.refresh() rewrites
    // per-instance colors and material color; the structural keys are
    // gated to scheduleRebuild via listenKeys below.
    TREES,
    // BUSHES: color arrays + emission boost. bushRenderer.refresh() pushes
    // these into per-instance color buffers + ShaderMaterial uniforms —
    // no rebuild, no re-placement.
    BUSHES,
    // FOOTPRINT.COLOR + FOOTPRINT.ENABLED are pushed live via
    // footprint.refresh() inside applyTheme() — no rebuild required.
    // FOOTPRINT.HALO_WIDTH gets a narrow listenKeys subscription below so
    // dragging the color slider doesn't trigger a spurious applyManifest.
    FOOTPRINT,
  ];

  const unsubs: Array<() => void> = [];
  for (const store of rebuildStores) {
    unsubs.push(store.subscribe(scheduleRebuild));
  }
  for (const store of hotStores) {
    unsubs.push(store.subscribe(refreshMaterials));
  }
  // HALO_WIDTH bakes into per-instance Matrix4 data at createCityFootprint
  // time, so changing it requires a full applyManifest rebuild. The other
  // FOOTPRINT keys (COLOR, ENABLED) are handled by the hotStores subscription
  // above; gating the rebuild on HALO_WIDTH alone avoids a wasted rebuild on
  // every color drag.
  unsubs.push(listenKeys(FOOTPRINT, ['HALO_WIDTH'], scheduleRebuild));
  // Toggling BUSHES_ENABLED changes whether the bush placement pass
  // runs, so it needs a rebuild — not just a visibility flip via
  // bushes.refresh(). TREES_ENABLED only flips mesh.visible (trees are
  // always placed; rendering is toggled independently).
  unsubs.push(listenKeys(BUSHES, ['BUSHES_ENABLED'], scheduleRebuild));
  // TREES structural keys: every one of these either changes geometry
  // (height range, shading strength) or per-shape allocation (shape
  // toggles) or the placement pass (inset, footprint). All require a
  // full applyManifest rebuild. Color + trunk color live on the
  // refresh path via the TREES hotStores subscription above.
  // TREES_ENABLED is intentionally excluded — it only flips mesh.visible
  // via trees.refresh() (trees are placed regardless of visibility).
  unsubs.push(listenKeys(TREES, [
    'TREE_MIN_HEIGHT',
    'TREE_MAX_HEIGHT',
    'TREE_MIN_WIDTH',
    'TREE_MAX_WIDTH',
    'TRUNK_HEIGHT_FRAC',
    'TRUNK_RADIUS_FRAC_OF_CANOPY',
    'CANOPY_TRUNK_OVERLAP_FRAC',
    'TREE_SHADING_STRENGTH',
    'EDGE_INSET_PERCENT',
    'TREE_DENSITY_FALLOFF',
    'SCATTER_FOOTPRINT_FRAC_OF_MAX_WIDTH',
  ], scheduleRebuild));
  // GROUND_BUFFER_PERCENT changes the world plane size (and therefore
  // the foliage sampling region), so it requires a full rebuild.
  // GROUND_COLOR / GROUND_ENABLED stay on the hot path via worldFloor.refresh().
  unsubs.push(listenKeys(WORLD, ['GROUND_BUFFER_PERCENT'], scheduleRebuild));
  armed = true;

  return function dispose() {
    armed = false;
    if (rebuildTimer) {
      clearTimeout(rebuildTimer);
      rebuildTimer = 0;
    }
    if (hotIdleTimer) {
      clearTimeout(hotIdleTimer);
      hotIdleTimer = 0;
    }
    for (const unsub of unsubs) {
      try {
        if (typeof unsub === 'function') unsub();
      } catch (_) {
        /* noop */
      }
    }
    unsubs.length = 0;
  };
}
