// config/hotReload.js — every config store classified as either
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
var REBUILD_DEBOUNCE_MS = 50;


export function attachHotReload({ cityScene, applyTheme }) {
  // nanostores `.subscribe()` fires synchronously with the current
  // value when called. We wait until all subscriptions are wired
  // before allowing reactions to run, so the initial fire doesn't
  // trigger a wasteful rebuild.
  var armed = false;

  var rebuildTimer = 0;
  function scheduleRebuild() {
    if (!armed) return;
    if (rebuildTimer) clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(function () {
      rebuildTimer = 0;
      var manifest = cityScene.getManifest();
      if (manifest) cityScene.applyManifest(manifest);
    }, REBUILD_DEBOUNCE_MS);
  }

  function refreshMaterials() {
    if (!armed) return;
    applyTheme();
  }

  var rebuildStores = [
    BUILDING_DIMENSIONS,
    BUILDING_PALETTE,
    STREET_LAYOUT,
    STREET_TIERS,
    GEM_SIZING,
    // LABEL_TYPOGRAPHY: most keys (font-size / padding / stroke / etc.)
    // change canvas dimensions and need a rebuild. The FILL key is
    // hot-reloadable — handled by main.js's listenKeys subscription
    // that calls regenerateLabelTexture.
    LABEL_TYPOGRAPHY,
  ];

  var hotStores = [
    SCENE_COLORS,
    SIDEWALK_COLORS,
    ASPHALT,
    BUILDING_OUTLINE,
    PATH_LINE,
    HOVER_PATH_LINE,
    GEM_APPEARANCE,
  ];

  var unsubs = [];
  for (var i = 0; i < rebuildStores.length; i++) {
    unsubs.push(rebuildStores[i].subscribe(scheduleRebuild));
  }
  for (var j = 0; j < hotStores.length; j++) {
    unsubs.push(hotStores[j].subscribe(refreshMaterials));
  }
  armed = true;

  return function dispose() {
    armed = false;
    if (rebuildTimer) { clearTimeout(rebuildTimer); rebuildTimer = 0; }
    for (var k = 0; k < unsubs.length; k++) {
      try { if (typeof unsubs[k] === 'function') unsubs[k](); }
      catch (_) { /* noop */ }
    }
    unsubs.length = 0;
  };
}
