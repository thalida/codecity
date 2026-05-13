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

import { REBUILD_STATUS, LAST_REBUILD_ERROR } from '../liveStatus.js';

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
  LABEL_TYPOGRAPHY,
} from './index.js';

// 50 ms debounce so a continuous slider drag (e.g. dragging
// BUILDING_DIMENSIONS.MAX_FLOORS through 30 → 200) coalesces into one
// rebuild after the user stops, instead of one rebuild per slider tick.
const REBUILD_DEBOUNCE_MS = 50;

interface HotReloadOpts {
  cityScene: {
    getManifest(): unknown;
    applyManifest(m: unknown): void;
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
  function scheduleRebuild() {
    if (!armed) return;
    if (rebuildTimer) clearTimeout(rebuildTimer);
    // Flip to 'rebuilding' immediately when the timer is scheduled
    // (not just before applyManifest fires) so the browser has time
    // to paint the indicator before the synchronous rebuild blocks
    // the main thread.
    REBUILD_STATUS.set('rebuilding');
    rebuildTimer = setTimeout(() => {
      rebuildTimer = 0;
      try {
        const manifest = cityScene.getManifest();
        if (manifest) cityScene.applyManifest(manifest);
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
    applyTheme();
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
