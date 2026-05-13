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

import { REBUILD_STATUS, LAST_REBUILD_ERROR, LAST_UPDATED_AT } from '../liveStatus.js';

import {
  // Rebuild-required (affects layout or geometry):
  BUILDING_DIMENSIONS,
  BUILDING_PALETTE,
  STREET_LAYOUT,
  STREET_TIERS,
  GEM_SIZING,

  // Hot-reloadable (live material updates only):
  SCENE_COLORS,
  SIDEWALK_COLORS,
  ASPHALT,
  BUILDING_OUTLINE,
  PATH_LINE,
  HOVER_PATH_LINE,
  GEM_APPEARANCE,
  GEM_GLOW,
  LABEL_TYPOGRAPHY,
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
        if (manifest) await cityScene.applyManifest(manifest);
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
    // LABEL_TYPOGRAPHY: all keys (font-size / padding / stroke / fill / etc.)
    // trigger a full applyManifest() rebuild. The old per-texture
    // regenerateLabelTexture hot-path is removed (Task 20); for v1, a
    // full rebuild on label-typography change is acceptable — hot-reload
    // here is rare.
    LABEL_TYPOGRAPHY,
  ];

  const hotStores = [
    SCENE_COLORS,
    SIDEWALK_COLORS,
    ASPHALT,
    BUILDING_OUTLINE,
    PATH_LINE,
    HOVER_PATH_LINE,
    GEM_APPEARANCE,
    GEM_GLOW,
  ];

  const unsubs: Array<() => void> = [];
  for (const store of rebuildStores) {
    unsubs.push(store.subscribe(scheduleRebuild));
  }
  for (const store of hotStores) {
    unsubs.push(store.subscribe(refreshMaterials));
  }
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
