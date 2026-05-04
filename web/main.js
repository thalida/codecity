// main.js — Entry point. Fetches the manifest from the local Python server
// at /api/manifest, lays out the city, builds the scene, and starts the
// render loop with orbit/pan/zoom controls and raycast picking.

import * as THREE from 'three';
import { listenKeys } from 'nanostores';
import './styles.css';

import * as Config from './config/index.js';
import {
  BUILDING_PALETTE,
  SCENE_COLORS,
  ASPHALT,
  SIDEWALK_COLORS,
  LABEL_TYPOGRAPHY,
  GEM_ANIMATION,
  GEM_APPEARANCE,
  GEM_SIZING,
  INPUT_TIMING,
  LIVE_UPDATES,
  POLL_SECONDS_MIN,
  POLL_SECONDS_MAX
} from './config/index.js';
import { attachPersistence, persistStore } from './config/persist.js';
import { attachHotReload } from './config/hotReload.js';
import { NODE_KIND, DOM_IDS, STREET_AXIS } from './constants.js';

import { regenerateLabelTexture } from './scene/engine.js';
import { createCityScene } from './scene/cityScene.js';
import { createCameraRig } from './scene/cameraRig.js';
import { createAnimator } from './scene/animator.js';
import { createPicker, PICKER_SELECTION_KEY } from './scene/picker.js';
import { createInputHandlers } from './scene/inputHandlers.js';
import { createBuildingFader } from './scene/effects/buildingFader.js';
import { createOutlineRenderer } from './scene/effects/outlineRenderer.js';
import { createPathLineRenderer } from './scene/effects/pathLineRenderer.js';
import { createCoordinator } from './coordinator.js';
import { showTooltip, hideTooltip } from './views/shell/tooltip.js';


function startRenderLoop(canvas, manifest) {
  // Every visual / layout tunable comes from the named exports of
  // src/defaults.js. Render-loop code reads them fresh each frame (or
  // each event), so the Settings UI can mutate the imported objects in
  // place and changes take effect immediately. Material-level
  // applications (line widths, hex color caches, scene background) are
  // re-synced via applyTheme() — exposed to the Settings UI through
  // showLeftSidebar().

  var huePalette = BUILDING_PALETTE.get().HUE_EXT_MAP || {};

  // -- 1. City scene + meshes --------------------------------------------------
  // Manifest-bound state — meshes, lookup maps, outlines, ghosts — lives
  // in scene/cityScene.js. main.js no longer caches mesh refs locally —
  // every other module reads cityScene directly through accessors.
  var cityScene = createCityScene(canvas);
  var scene = cityScene.scene;
  cityScene.applyManifest(manifest);

  // Hot-reload the label fill color: FILL is baked into the CanvasTexture
  // at scene-build, so a "live" change requires regenerating each label's
  // texture. listenKeys fires only when FILL specifically changes (not on
  // every applyTheme call), so unrelated tweaks don't pay the texture
  // regen cost. Reads streetLabels fresh from cityScene each fire so
  // it works after applyManifest rebinds the array.
  listenKeys(LABEL_TYPOGRAPHY, ['FILL'], function () {
    var labels = cityScene.getStreetLabels();
    for (var li = 0; li < labels.length; li++) {
      regenerateLabelTexture(labels[li]);
    }
  });

  // -- 3. Renderer -------------------------------------------------------------
  var renderer = new THREE.WebGLRenderer({
    canvas: canvas,
    antialias: true,
    alpha: false
  });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  _resizeRendererToCanvas(renderer, canvas);

  // -- 4. Camera + controls ----------------------------------------------------
  // Camera, OrbitControls, pose persistence, framing, and the focus/reset
  // animations all live in scene/cameraRig.js. Local aliases are kept for
  // brevity in event handlers and resize logic below.
  var rig = createCameraRig({ canvas: canvas, cityScene: cityScene });
  var camera = rig.camera;

  // -- 5. Picker (raycaster + hover/selection state) --------------------------
  // Picker owns the hover + selection atoms (consumed below by the
  // outline / path-line / fader / sidebar code via subscription).
  // Selection persistence is wired in the boot block before startRenderLoop
  // runs — the saved {kind, path} key is hydrated into PICKER_SELECTION_KEY
  // before this picker resolves it against the freshly-built city.
  var picker = createPicker({ canvas: canvas, camera: camera, cityScene: cityScene });

  // -- 6. Per-frame visual modules ---------------------------------------------
  // Three siblings, all subscribed to picker / cityScene so they react
  // to selection / hover / manifest changes on their own. Animate loop
  // drives them in field-ownership order: fader writes body opacity →
  // outlineRenderer reads outlineOp/ghostOp from userData and writes
  // outline + ghost opacity → pathLineRenderer ticks the rainbow chase
  // on the selection line.
  var fader            = createBuildingFader({ cityScene: cityScene, picker: picker });
  var outlineRenderer  = createOutlineRenderer({
    canvas: canvas, scene: scene, cityScene: cityScene, picker: picker,
  });
  var pathLineRenderer = createPathLineRenderer({
    canvas: canvas, scene: scene, cityScene: cityScene, picker: picker,
  });

  // Tween queue for entering / staying transitions on cityScene.onChange.
  // Animator owns mesh.scale + mesh.position (disjoint from buildingFader's
  // material.opacity), so they cannot conflict by construction.
  var animator = createAnimator({ cityScene: cityScene });

  // -- 7. Sidebar coordinator (appHeader + appFooter + leftSidebar) ----------
  // Owns the lifecycle of the three component panes and wires picker
  // changes into their displays. Tree-row clicks/hovers/focus dispatches
  // route back through picker + rig the same as canvas-driven actions.
  var sidebars = createCoordinator({
    cityScene: cityScene, picker: picker, rig: rig,
    huePalette: huePalette,
    applyTheme: applyTheme,
  });

  // SIDEWALK_COLORS holds CSS strings; we pre-convert to numeric hex so
  // the per-frame tint loop calls material.color.setHex() without
  // re-parsing every frame. applyTheme() refreshes these whenever the
  // Settings UI mutates SIDEWALK_COLORS.
  var _swc0 = SIDEWALK_COLORS.get();
  var SIDEWALK_HOVER_COLOR    = new THREE.Color(_swc0.HOVER).getHex();
  var SIDEWALK_SELECTED_COLOR = new THREE.Color(_swc0.SELECTED).getHex();
  var SIDEWALK_DEFAULT_COLOR  = new THREE.Color(_swc0.DEFAULT).getHex();

  // _refreshSidewalkTints() — repaint every sidewalk's material.color
  // based on the current picker.selection / picker.hover state. Building
  // connector strips for the same dir follow the same tint.
  function _refreshSidewalkTints() {
    var sel = picker.selection.get();
    var hov = picker.hover.get();
    var streetPickables = cityScene.getStreetPickables();
    for (var ri = 0; ri < streetPickables.length; ri++) {
      var sw = streetPickables[ri];
      if (sw.userData.origColor == null) {
        sw.userData.origColor = sw.material.color.getHex();
      }
      var expected = null;
      if (sel && sel.kind === NODE_KIND.DIRECTORY && sel.sidewalk === sw) {
        expected = SIDEWALK_SELECTED_COLOR;
      } else if (hov && hov.kind === NODE_KIND.DIRECTORY && hov.sidewalk === sw) {
        expected = SIDEWALK_HOVER_COLOR;
      }
      var swColor = expected != null ? expected : sw.userData.origColor;
      sw.material.color.setHex(swColor);
      var swDir = sw.userData.street && sw.userData.street.dir;
      var connectors = swDir ? cityScene.getPathConnectorsByDir(swDir.path) : null;
      if (connectors) {
        for (var ci = 0; ci < connectors.length; ci++) {
          var pm = connectors[ci];
          if (pm.userData.origColor == null) {
            pm.userData.origColor = pm.material.color.getHex();
          }
          pm.material.color.setHex(swColor);
        }
      }
    }
  }

  // applyTheme() — hot-apply the current values from src/config/* to every
  // material / cache that's set once at scene-build time. The Settings UI
  // mutates the config stores (SIDEWALK_COLORS, BUILDING_OUTLINE, etc.)
  // and calls this to flush the changes through. Render-loop values
  // (BUILDING_FADE.*, HOVER.COMMIT_MS) are read fresh each frame and
  // don't need anything here.
  function applyTheme() {
    var sidewalk = SIDEWALK_COLORS.get();
    var sceneCol = SCENE_COLORS.get();

    SIDEWALK_HOVER_COLOR    = new THREE.Color(sidewalk.HOVER).getHex();
    SIDEWALK_SELECTED_COLOR = new THREE.Color(sidewalk.SELECTED).getHex();
    SIDEWALK_DEFAULT_COLOR  = new THREE.Color(sidewalk.DEFAULT).getHex();
    var streetPickables = cityScene.getStreetPickables();
    for (var si = 0; si < streetPickables.length; si++) {
      streetPickables[si].userData.origColor = SIDEWALK_DEFAULT_COLOR;
    }
    _refreshSidewalkTints();

    var asphaltHex = new THREE.Color(ASPHALT.get().COLOR).getHex();
    var asphaltMeshes = cityScene.getAsphaltMeshes();
    for (var ai = 0; ai < asphaltMeshes.length; ai++) {
      asphaltMeshes[ai].material.color.setHex(asphaltHex);
    }

    scene.background = new THREE.Color(sceneCol.GROUND);

    outlineRenderer.refreshMaterials();
    pathLineRenderer.refreshMaterials();

    var gemAppearance = GEM_APPEARANCE.get();
    var rootGemEdges = cityScene.getRootGemEdges();
    var rootGemBody  = cityScene.getRootGemBody();
    var rootGem      = cityScene.getRootGem();
    if (rootGemEdges && rootGemEdges.material && rootGemEdges.material.color) {
      rootGemEdges.material.color.set(gemAppearance.EDGE_COLOR);
    }
    if (rootGemBody && rootGemBody.material) {
      rootGemBody.material.opacity = gemAppearance.BODY_OPACITY;
    }
    if (rootGem && rootGem.userData.streetWidth != null) {
      var hoverFrac = GEM_SIZING.get().HOVER_LIFT_FRAC;
      rootGem.userData.baseY = rootGem.userData.radius +
                               rootGem.userData.streetWidth * hoverFrac;
    }

    var labelCfg = LABEL_TYPOGRAPHY.get();
    var streetLabels = cityScene.getStreetLabels();
    for (var li = 0; li < streetLabels.length; li++) {
      var lg = streetLabels[li];
      var origFrac = lg.userData.origHeightFrac;
      if (origFrac && lg.children[0]) {
        var s = labelCfg.HEIGHT_FRAC / origFrac;
        lg.children[0].scale.set(s, s, 1);
      }
    }
  }

  // -- 8. Pointer / keyboard / resize wiring ----------------------------------
  // All canvas DOM events, the keyboard shortcuts, the resize observer,
  // and the hover-commit pipeline live in scene/inputHandlers.js.
  // It calls picker.setHover/setSelection on hits and rig.reset/focus on
  // gestures, with no other dependencies into main.
  createInputHandlers({
    canvas: canvas, picker: picker, rig: rig,
    renderer: renderer, camera: camera, scene: scene,
    showTooltip: showTooltip, hideTooltip: hideTooltip,
    onResize: function () {
      outlineRenderer.onResize();
      pathLineRenderer.onResize();
    },
  });

  // Sidewalk tints are scene-state that follow selection / hover. Subscribe
  // directly to picker so the tint refresh fires alongside the renderers.
  picker.selection.subscribe(function () { _refreshSidewalkTints(); });
  picker.hover.subscribe(function ()     { _refreshSidewalkTints(); });

  // -- 8. Render loop --------------------------------------------------------
  var startTime = performance.now();
  var labelRight = new THREE.Vector3();

  function animate() {
    rig.update(0);                     // first-call: bbox-frames camera
    // Per-frame world-matrix refresh. controls.update() moves the camera
    // but matrixWorldInverse is stale until renderer.render runs; modules
    // below project mesh positions and need fresh world matrices.
    camera.updateMatrixWorld();
    scene.updateMatrixWorld();
    animator.update(0);                // entering / staying tweens (scale, position)
    fader.update(0);                   // body opacity per fade tier
    outlineRenderer.update(0);         // outline + ghost opacity, hover/selected outlines, rainbow chase
    pathLineRenderer.update(0);        // selection path line rainbow chase
    _orientLabelsForCamera(cityScene.getStreetLabels(), camera, labelRight);
    var rootGem = cityScene.getRootGem();
    if (rootGem) {
      var gemAnim = GEM_ANIMATION.get();
      var t = (performance.now() - startTime) / 1000;
      rootGem.rotation.y = t * gemAnim.ROTATION_SPEED;
      rootGem.position.y = rootGem.userData.baseY + Math.sin(t * gemAnim.BOB_FREQUENCY) * rootGem.userData.bobAmp;
      // Scale-up affordance on hover so the gem reads as clickable.
      var hov = picker.hover.get();
      var gemTargetScale = (hov && hov.kind === NODE_KIND.GEM) ? gemAnim.HOVER_SCALE : 1.0;
      var curS = rootGem.scale.x;
      var nextS = curS + (gemTargetScale - curS) * gemAnim.SCALE_LERP_SPEED;
      rootGem.scale.set(nextS, nextS, nextS);
    }
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }
  animate();

  // Expose cityScene + applyTheme to the boot block so setupLiveUpdates
  // can swap in fresh manifests, and attachHotReload can dispatch
  // material refreshes without restarting the renderer.
  return { cityScene: cityScene, applyTheme: applyTheme };
}


// Keep flat street labels readable at any orbit. Flip decision comes from the
// camera's world-right vector (matrixWorld column 0), not position — at top-down
// the camera can sit over center yet still be rotated 180° around Y.
function _orientLabelsForCamera(labels, camera, labelRight) {
  labelRight.setFromMatrixColumn(camera.matrixWorld, 0);
  var rightX = labelRight.x;
  var rightZ = labelRight.z;

  // Hysteresis: only flip when the relevant axis crosses ±THRESH, not 0.
  // Without this, near-top-down camera positions (where rightX/rightZ are
  // near zero) cause floating-point jitter from OrbitControls' damping to
  // flip labels back and forth every frame.
  var THRESH = LABEL_TYPOGRAPHY.get().FLIP_HYSTERESIS;

  for (var i = 0; i < labels.length; i++) {
    var lbl = labels[i];
    var street = lbl.userData.street;
    var base = lbl.userData.baseRotY || 0;
    var axis  = (street.orientation === STREET_AXIS.X) ? rightX : rightZ;
    var flipped = lbl.userData.flipped || false;
    if (flipped) {
      // Currently flipped — only un-flip when axis clearly crosses POSITIVE.
      if (axis > THRESH) flipped = false;
    } else {
      // Not flipped — only flip when axis clearly crosses NEGATIVE.
      if (axis < -THRESH) flipped = true;
    }
    lbl.userData.flipped = flipped;
    lbl.rotation.y = base + (flipped ? Math.PI : 0);
  }
}


function _resizeRendererToCanvas(renderer, canvas) {
  var cw = canvas.clientWidth;
  var ch = canvas.clientHeight;
  renderer.setSize(cw, ch, false);
}


// Build the /api/manifest URL from the current page's query params.
// CLI opens the page with either ?path=… or ?clone=…&branch=… so the
// server knows what to scan; we just forward those through.
function manifestUrl() {
  var qp = new URLSearchParams(window.location.search);
  var u = new URL('/api/manifest', window.location.origin);
  if (qp.has('clone')) {
    u.searchParams.set('clone', qp.get('clone'));
    if (qp.has('branch')) u.searchParams.set('branch', qp.get('branch'));
  } else if (qp.has('path')) {
    u.searchParams.set('path', qp.get('path'));
  }
  return u.toString();
}


// Live-update poll loop. When LIVE_UPDATES.ENABLED flips on we start
// re-fetching the manifest at the user-configured interval; when its
// signature changes vs. the last render, we hand the new manifest to
// cityScene.applyManifest, which rebuilds the city in place. Camera +
// selection survive because picker.selectionKey is persisted and
// re-resolved on every cityScene rebuild, and cameraRig keeps its pose
// across applyManifest calls (no re-frame).
function _clampPollSeconds(s) {
  if (typeof s !== 'number' || !isFinite(s)) return POLL_SECONDS_MIN;
  return Math.min(POLL_SECONDS_MAX, Math.max(POLL_SECONDS_MIN, s));
}

function setupLiveUpdates(handle, initialSignature) {
  var lastSignature = initialSignature || '';
  var timer = null;
  var inFlight = false;

  function tick() {
    if (inFlight) return;
    inFlight = true;
    fetch(manifestUrl())
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (m) {
        if (m && m.signature && m.signature !== lastSignature) {
          lastSignature = m.signature;
          handle.cityScene.applyManifest(m);
        }
      })
      .catch(function () { /* keep polling on transient errors */ })
      .finally(function () { inFlight = false; });
  }

  function start() {
    stop();
    var seconds = _clampPollSeconds(LIVE_UPDATES.get().POLL_SECONDS);
    timer = window.setInterval(tick, seconds * 1000);
  }
  function stop() {
    if (timer != null) { window.clearInterval(timer); timer = null; }
  }

  LIVE_UPDATES.subscribe(function (val) {
    if (val.ENABLED) start(); else stop();
  });
}


// Boot. Guarded by a canvas check so unit tests can import this module
// without triggering any DOM/network side effects.
var _canvas = document.getElementById(DOM_IDS.CANVAS);
if (_canvas) {
  (async function boot() {
    var resp = await fetch(manifestUrl());
    if (!resp.ok) throw new Error('manifest fetch failed: ' + resp.status);
    var manifest = await resp.json();
    // Hydrate every config store from localStorage BEFORE scene build so
    // any user tweaks from prior sessions take effect during the initial
    // layout/render.
    attachPersistence(Config);
    // Picker's selectionKey atom isn't part of the Config barrel, so
    // wire its persistence directly. Hydrating BEFORE startRenderLoop
    // lets the picker's first key→selection resolve see the saved key.
    persistStore('PICKER_SELECTION_KEY', PICKER_SELECTION_KEY);
    var handle = startRenderLoop(_canvas, manifest);
    attachHotReload({
      cityScene:  handle.cityScene,
      applyTheme: handle.applyTheme,
    });
    setupLiveUpdates(handle, manifest.signature);
  })();
}
