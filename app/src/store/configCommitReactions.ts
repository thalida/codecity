// store/configCommitReactions.ts — every config store classified as either
// "rebuild-required" or "material-only", and wired to the matching
// reaction that fires once when the user clicks Save in the Controls pane.
//
// All widgets in the Controls pane write to the draft layer
// (`configDrafts.setDraft`). Nothing touches the real store until Save
// calls `configDrafts.commit()`, which fires every queued `setKey` in a
// synchronous burst. Each `setKey` triggers any nanostore subscriber
// registered below — that is the ONLY moment these reactions run.
//
//   rebuild-required → world.applyManifest(getManifest()) for a full
//                       geometry + layout recompute via the layout worker.
//   material-only    → applyTheme() — synchronous material / uniform
//                       refreshes on the existing scene meshes.
//
// Adding a new config row is a one-line entry in the appropriate set
// below — the reactions pick it up automatically.

import { listenKeys } from 'nanostores';

import { REBUILD_STATUS, LAST_REBUILD_ERROR, LAST_UPDATED_AT } from '@/store/liveStatus.js';

import {
  // Rebuild-required (affects layout or geometry):
  BUILDING_DIMENSIONS,
  BUILDING_PALETTE,
  STREET_LAYOUT,
  STREET_TIERS,
  GEM_SIZING,
  AD_PANEL,

  // Material-only (live material updates only):
  SCENE_COLORS,
  SIDEWALK_COLORS,
  ASPHALT,
  BUILDING_OUTLINE,
  BUILDING_AGING,
  PATH_LINE,
  HOVER_PATH_LINE,
  GEM_APPEARANCE,
  GEM_FACE_PALETTE,
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

  // Cyberpunk Valley — world sizing (GROUND_BUFFER_PERCENT → rebuild;
  // visual island config lives in ISLAND.* → material-only via island.refresh()):
  WORLD,

  // Cyberpunk Valley — trees (structural in TREES → rebuild):
  TREES,

  // Cyberpunk Valley — tree hover/select outlines (material-only via
  // treeOutlineRenderer.refreshMaterials() inside applyTheme()):
  TREE_OUTLINE,

  // Cyberpunk Valley — footprint (HALO_WIDTH bakes into instance
  // matrices → rebuild; COLOR/ENABLED → material-only via footprint.refresh()):
  FOOTPRINT,

  // Cyberpunk Valley — floating repo-name label (all keys material-only
  // via repoLabel.refresh() inside applyTheme()):
  REPO_LABEL,
} from '@/config/index.js';
import {
  // Cyberpunk Valley — island geometry and materials
  // (all material-only via island.refresh() inside applyTheme()):
  ISLAND_GEOMETRY,
  ISLAND_MATERIALS,
} from '@/config/components/island.js';

// Min-dwell for the 'rebuilding' indicator on the material-only path.
// applyTheme() is synchronous and finishes within microseconds, so without
// a forced floor the user never sees the yellow flash. ~220 ms is long
// enough to register visually but short enough to feel snappy.
const HOT_REBUILD_MIN_DWELL_MS = 220;

interface CommitReactionsOpts {
  world: {
    getManifest(): unknown;
    applyManifest(m: unknown): Promise<void>;
    invalidateLayoutCache(): void;
  };
  applyTheme: () => void;
}

export function attachCommitReactions({ world, applyTheme }: CommitReactionsOpts): () => void {
  // nanostores `.subscribe()` fires synchronously with the current
  // value when called. We wait until all subscriptions are wired
  // before allowing reactions to run, so the initial fire doesn't
  // trigger a wasteful rebuild.
  let armed = false;

  let hotIdleTimer: ReturnType<typeof setTimeout> | 0 = 0;

  async function scheduleRebuild() {
    if (!armed) return;
    REBUILD_STATUS.set('rebuilding');
    try {
      // Config changes that hit this path always invalidate the layout
      // cache: the manifest didn't change but a layout-affecting config
      // value did, so reuseLayoutFrom would skip the recompute and the
      // change would have no visible effect (building dims, street widths,
      // street layout, gem sizing, label typography). Live-update polls
      // never trigger scheduleRebuild so they keep using the cache.
      world.invalidateLayoutCache();
      const manifest = world.getManifest();
      if (manifest) {
        await world.applyManifest(manifest);
      }
      REBUILD_STATUS.set('idle');
      LAST_REBUILD_ERROR.set(null);
    } catch (err) {
      REBUILD_STATUS.set('error');
      LAST_REBUILD_ERROR.set(err instanceof Error ? err.message : String(err));
    }
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
    // LABEL_TYPOGRAPHY: all keys (text/outline color, outline width, label
    // size) trigger a full applyManifest() rebuild. The old per-texture
    // regenerateLabelTexture hot-path is removed (Task 20); for v1, a
    // full rebuild on label-typography change is acceptable — Save on
    // label-typography change is rare.
    LABEL_TYPOGRAPHY,
    // FACADE_GEOMETRY: WINDOW_COLS_MAX / WIDTH_PER_WINDOW_COL /
    // DOOR_WIDTH_FRAC bake into per-instance attributes
    // (buf.cols / buf.doorWidth), so a change requires re-running
    // buildBuildingInstanceBuffer via applyManifest. The shader-side
    // keys (SLAB/WINDOW/DOOR/ROOF_*_FRAC) are also pushed via the
    // materialOnlyStores entry below — split-routing the same store
    // keeps the wiring trivial. If the rebuild churn ever becomes a
    // perf concern we can switch to listenKeys to gate scheduleRebuild
    // on just the three JS keys.
    FACADE_GEOMETRY,
    // TREES is intentionally NOT here as a whole-store subscription:
    // color + visibility + trunk-color keys live in materialOnlyStores and
    // refresh via trees.refresh(); structural keys (height range,
    // shape toggles, shading strength, inset, footprint) get narrow
    // listenKeys subscriptions below.
    //
    // FOOTPRINT is intentionally NOT here as a whole-store subscription:
    // only HALO_WIDTH is structural, and we gate it via listenKeys below.
    // COLOR + ENABLED live in materialOnlyStores and refresh via footprint.refresh().
  ];

  const materialOnlyStores = [
    SCENE_COLORS,
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
    // FACADE_GEOMETRY: shader-side keys (SLAB/WINDOW/DOOR/ROOF_*_FRAC)
    // are pushed through refreshBuildingMaterial() — Save on these
    // gives immediate visual feedback without waiting for the rebuild
    // triggered from rebuildStores above.
    FACADE_GEOMETRY,
    // FACADE_DETAIL and WINDOW_LIGHTING are pure shader uniforms (no
    // per-instance attributes), so they live exclusively in materialOnlyStores —
    // refreshBuildingMaterial() pushes them on every Save.
    FACADE_DETAIL,
    WINDOW_LIGHTING,
    // SKY_* — pure uniform refreshes via sky.refresh() inside applyTheme().
    // No rebuild path; the sky is a single mesh whose shader uniforms are
    // mutated in place. Master ENABLED toggle on SKY flips mesh.visible
    // (also handled by sky.refresh()).
    SKY,
    SKY_STARS,
    // WORLD: only GROUND_BUFFER_PERCENT remains; it gets a narrow
    // listenKeys subscription below so the slider doesn't trigger a
    // spurious applyManifest for non-structural changes.
    WORLD,
    // TREES color + visibility + trunk color. trees.refresh() rewrites
    // per-instance colors and material color; the structural keys are
    // gated to scheduleRebuild via listenKeys below.
    TREES,
    // FOOTPRINT.COLOR + FOOTPRINT.ENABLED are pushed via
    // footprint.refresh() inside applyTheme() — no rebuild required.
    // FOOTPRINT.HALO_WIDTH gets a narrow listenKeys subscription below so
    // the color slider doesn't trigger a spurious applyManifest.
    FOOTPRINT,
    // ISLAND_* — all keys are material-only via island.refresh() inside
    // applyTheme(). Geometry changes (SIDES, IRREGULARITY, TIERS, DEPTH)
    // trigger a cheap vertex-count rebuild inside refresh() → setBounds();
    // material keys push uniforms directly. No full rebuild needed.
    ISLAND_GEOMETRY,
    ISLAND_MATERIALS,
    // REPO_LABEL — every key (ENABLED, STYLE, HEIGHT_ABOVE_CITY,
    // ANIMATION_SPEED, OPACITY) is pushed via
    // repoLabel.refresh() inside applyTheme(). STYLE triggers a cheap
    // mesh swap inside refresh(); the others update uniforms or the
    // group transform directly. No applyManifest rebuild needed.
    REPO_LABEL,
    // TREE_OUTLINE — WIDTH, HOVER_COLOR, HOVER_OPACITY, SELECTED_OPACITY
    // all push through treeOutlineRenderer.refreshMaterials() inside
    // applyTheme(). No rebuild needed.
    TREE_OUTLINE,
  ];

  const unsubs: Array<() => void> = [];
  for (const store of rebuildStores) {
    unsubs.push(store.subscribe(scheduleRebuild));
  }
  for (const store of materialOnlyStores) {
    unsubs.push(store.subscribe(refreshMaterials));
  }
  // HALO_WIDTH bakes into per-instance Matrix4 data at createCityFootprint
  // time, so changing it requires a full applyManifest rebuild. The other
  // FOOTPRINT keys (COLOR, ENABLED) are handled by the materialOnlyStores
  // subscription above; gating the rebuild on HALO_WIDTH alone avoids a
  // wasted rebuild on every color drag.
  unsubs.push(listenKeys(FOOTPRINT, ['HALO_WIDTH'], scheduleRebuild));
  // TREES structural keys: every one of these either changes geometry
  // (height range, shading strength) or per-shape allocation (shape
  // toggles) or the placement pass (inset, footprint). All require a
  // full applyManifest rebuild. Color + trunk color live on the
  // refresh path via the TREES materialOnlyStores subscription above.
  // TREES_ENABLED is intentionally excluded — it only flips mesh.visible
  // via trees.refresh() (trees are placed regardless of visibility).
  unsubs.push(
    listenKeys(
      TREES,
      [
        'TREE_MIN_HEIGHT',
        'TREE_MAX_HEIGHT',
        'TREE_MIN_WIDTH',
        'TREE_MAX_WIDTH',
        'TREE_FACETS_LOW',
        'TREE_FACETS_MID',
        'TREE_FACETS_HIGH',
        'TRUNK_HEIGHT_FRAC',
        'TRUNK_RADIUS_FRAC_OF_CANOPY',
        'CANOPY_TRUNK_OVERLAP_FRAC',
        'TREE_SHADING_STRENGTH',
        'EDGE_INSET_PERCENT',
        'TREE_DENSITY_FALLOFF',
        'SCATTER_FOOTPRINT_FRAC_OF_MAX_WIDTH',
        'TREE_WIDTH_AGE_FLOOR',
      ],
      scheduleRebuild
    )
  );
  // GROUND_BUFFER_PERCENT changes the island size (and therefore
  // the foliage sampling region), so it requires a full rebuild.
  // Visual island config lives in ISLAND.* and is hot-patched via island.refresh().
  unsubs.push(listenKeys(WORLD, ['GROUND_BUFFER_PERCENT'], scheduleRebuild));
  // ISLAND_GEOMETRY shape keys change the polygon silhouette the tree
  // placement uses for its point-in-polygon rejection. island.refresh()
  // rebuilds the island mesh, but trees were placed against the OLD
  // polygon — they need a re-place via applyManifest. ENABLED is
  // excluded since it just flips group.visible (no shape change).
  unsubs.push(
    listenKeys(
      ISLAND_GEOMETRY,
      ['SIDES', 'IRREGULARITY', 'TIERS', 'DEPTH', 'ROUNDNESS', 'GRASS_THICKNESS'],
      scheduleRebuild
    )
  );
  armed = true;

  return function dispose() {
    armed = false;
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
