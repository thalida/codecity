// main.ts — Entry point. Fetches the manifest from the local Python server
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
  LIVE_UPDATES,
  POLL_SECONDS_MIN,
  POLL_SECONDS_MAX,
} from './config/index.js';
import { IS_RELOADING } from './liveStatus.js';
import { attachPersistence, persistStore } from './config/persist.js';
import { attachHotReload } from './config/hotReload.js';
import { DOM_IDS } from './constants';
import { NodeKind, StreetAxis } from './types';
import type { Manifest } from './types';

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

function startRenderLoop(canvas: HTMLCanvasElement, manifest: Manifest) {
  // Every visual / layout tunable comes from the named exports of
  // src/defaults.js. Render-loop code reads them fresh each frame (or
  // each event), so the Settings UI can mutate the imported objects in
  // place and changes take effect immediately. Material-level
  // applications (line widths, hex color caches, scene background) are
  // re-synced via applyTheme() — exposed to the Settings UI through
  // showLeftSidebar().

  const huePalette = BUILDING_PALETTE.get().HUE_EXT_MAP || {};

  // -- 1. City scene + meshes --------------------------------------------------
  // Manifest-bound state — meshes, lookup maps, outlines, ghosts — lives
  // in scene/cityScene.js. main.js no longer caches mesh refs locally —
  // every other module reads cityScene directly through accessors.
  const cityScene = createCityScene(canvas);
  const scene = cityScene.scene;
  cityScene.applyManifest(manifest);

  // Hot-reload the label fill color: FILL is baked into the CanvasTexture
  // at scene-build, so a "live" change requires regenerating each label's
  // texture. listenKeys fires only when FILL specifically changes (not on
  // every applyTheme call), so unrelated tweaks don't pay the texture
  // regen cost. Reads streetLabels fresh from cityScene each fire so
  // it works after applyManifest rebinds the array.
  listenKeys(LABEL_TYPOGRAPHY, ['FILL'], () => {
    const labels = cityScene.getStreetLabels();
    for (const label of labels) {
      regenerateLabelTexture(label);
    }
  });

  // -- 3. Renderer -------------------------------------------------------------
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
  });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  _resizeRendererToCanvas(renderer, canvas);

  // -- 4. Camera + controls ----------------------------------------------------
  // Camera, OrbitControls, pose persistence, framing, and the focus/reset
  // animations all live in scene/cameraRig.js. Local aliases are kept for
  // brevity in event handlers and resize logic below.
  const rig = createCameraRig({ canvas, cityScene });
  const camera = rig.camera;

  // -- 5. Picker (raycaster + hover/selection state) --------------------------
  // Picker owns the hover + selection atoms (consumed below by the
  // outline / path-line / fader / sidebar code via subscription).
  // Selection persistence is wired in the boot block before startRenderLoop
  // runs — the saved {kind, path} key is hydrated into PICKER_SELECTION_KEY
  // before this picker resolves it against the freshly-built city.
  const picker = createPicker({ canvas, camera, cityScene });

  // -- 6. Per-frame visual modules ---------------------------------------------
  // Three siblings, all subscribed to picker / cityScene so they react
  // to selection / hover / manifest changes on their own. Animate loop
  // drives them in field-ownership order: fader writes body opacity →
  // outlineRenderer reads outlineOp/ghostOp from userData and writes
  // outline + ghost opacity → pathLineRenderer ticks the rainbow chase
  // on the selection line.
  const fader = createBuildingFader({ cityScene, picker });
  const outlineRenderer = createOutlineRenderer({
    canvas,
    scene,
    cityScene,
    picker,
  });
  const pathLineRenderer = createPathLineRenderer({
    canvas,
    scene,
    cityScene,
    picker,
  });

  // Tween queue for entering / staying transitions on cityScene.onChange.
  // Animator owns mesh.scale + mesh.position (disjoint from buildingFader's
  // material.opacity), so they cannot conflict by construction.
  const animator = createAnimator({ cityScene });

  // -- 7. Sidebar coordinator (appHeader + appFooter + leftSidebar) ----------
  // Owns the lifecycle of the three component panes and wires picker
  // changes into their displays. Tree-row clicks/hovers/focus dispatches
  // route back through picker + rig the same as canvas-driven actions.
  createCoordinator({
    cityScene,
    picker,
    rig,
    huePalette,
    applyTheme,
  });

  // SIDEWALK_COLORS holds CSS strings; we pre-convert to numeric hex so
  // the per-frame tint loop calls material.color.setHex() without
  // re-parsing every frame. applyTheme() refreshes these whenever the
  // Settings UI mutates SIDEWALK_COLORS.
  const _swc0 = SIDEWALK_COLORS.get();
  let SIDEWALK_HOVER_COLOR = new THREE.Color(_swc0.HOVER).getHex();
  let SIDEWALK_SELECTED_COLOR = new THREE.Color(_swc0.SELECTED).getHex();
  let SIDEWALK_DEFAULT_COLOR = new THREE.Color(_swc0.DEFAULT).getHex();

  // _refreshSidewalkTints() — repaint every sidewalk's material.color
  // based on the current picker.selection / picker.hover state. Building
  // connector strips for the same dir follow the same tint.
  function _refreshSidewalkTints(): void {
    const sel = picker.selection.get();
    const hov = picker.hover.get();
    const streetPickables = cityScene.getStreetPickables();
    for (const sw of streetPickables) {
      if (sw.userData.origColor == null) {
        sw.userData.origColor = sw.material.color.getHex();
      }
      let expected = null;
      if (sel?.kind === NodeKind.Directory && sel.sidewalk === sw) {
        expected = SIDEWALK_SELECTED_COLOR;
      } else if (hov?.kind === NodeKind.Directory && hov.sidewalk === sw) {
        expected = SIDEWALK_HOVER_COLOR;
      }
      const swColor = expected ?? sw.userData.origColor;
      sw.material.color.setHex(swColor);
      const swDir = sw.userData.street?.dir;
      const connectors = swDir ? cityScene.getPathConnectorsByDir(swDir.path) : null;
      if (connectors) {
        for (const pm of connectors) {
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
  function applyTheme(): void {
    const sidewalk = SIDEWALK_COLORS.get();
    const sceneCol = SCENE_COLORS.get();

    SIDEWALK_HOVER_COLOR = new THREE.Color(sidewalk.HOVER).getHex();
    SIDEWALK_SELECTED_COLOR = new THREE.Color(sidewalk.SELECTED).getHex();
    SIDEWALK_DEFAULT_COLOR = new THREE.Color(sidewalk.DEFAULT).getHex();
    const streetPickables = cityScene.getStreetPickables();
    for (const sw of streetPickables) {
      sw.userData.origColor = SIDEWALK_DEFAULT_COLOR;
    }
    _refreshSidewalkTints();

    const asphaltHex = new THREE.Color(ASPHALT.get().COLOR).getHex();
    const asphaltMeshes = cityScene.getAsphaltMeshes();
    for (const mesh of asphaltMeshes) {
      mesh.material.color.setHex(asphaltHex);
    }

    scene.background = new THREE.Color(sceneCol.GROUND);

    outlineRenderer.refreshMaterials();
    pathLineRenderer.refreshMaterials();

    const gemAppearance = GEM_APPEARANCE.get();
    const rootGemEdges = cityScene.getRootGemEdges();
    const rootGemBody = cityScene.getRootGemBody();
    const rootGem = cityScene.getRootGem();
    if (rootGemEdges?.material?.color) {
      rootGemEdges.material.color.set(gemAppearance.EDGE_COLOR);
    }
    if (rootGemBody?.material) {
      rootGemBody.material.opacity = gemAppearance.BODY_OPACITY;
    }
    if (rootGem && rootGem.userData.streetWidth != null) {
      const hoverFrac = GEM_SIZING.get().HOVER_LIFT_FRAC;
      rootGem.userData.baseY = rootGem.userData.radius + rootGem.userData.streetWidth * hoverFrac;
    }

    const labelCfg = LABEL_TYPOGRAPHY.get();
    const streetLabels = cityScene.getStreetLabels();
    for (const lg of streetLabels) {
      const origFrac = lg.userData.origHeightFrac;
      if (origFrac && lg.children[0]) {
        const s = labelCfg.HEIGHT_FRAC / origFrac;
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
    canvas,
    picker,
    rig,
    renderer,
    camera,
    scene,
    showTooltip,
    hideTooltip,
    onResize() {
      outlineRenderer.onResize();
      pathLineRenderer.onResize();
    },
  });

  // Sidewalk tints are scene-state that follow selection / hover. Subscribe
  // directly to picker so the tint refresh fires alongside the renderers.
  picker.selection.subscribe(() => {
    _refreshSidewalkTints();
  });
  picker.hover.subscribe(() => {
    _refreshSidewalkTints();
  });

  // -- 8. Render loop --------------------------------------------------------
  const startTime = performance.now();
  const labelRight = new THREE.Vector3();

  function animate() {
    rig.update(0); // first-call: bbox-frames camera
    // Per-frame world-matrix refresh. controls.update() moves the camera
    // but matrixWorldInverse is stale until renderer.render runs; modules
    // below project mesh positions and need fresh world matrices.
    camera.updateMatrixWorld();
    scene.updateMatrixWorld();
    animator.update(0); // entering / staying tweens (scale, position)
    fader.update(0); // body opacity per fade tier
    outlineRenderer.update(0); // outline + ghost opacity, hover/selected outlines, rainbow chase
    pathLineRenderer.update(0); // selection path line rainbow chase
    _orientLabelsForCamera(cityScene.getStreetLabels(), camera, labelRight);
    const rootGem = cityScene.getRootGem();
    if (rootGem) {
      const gemAnim = GEM_ANIMATION.get();
      const t = (performance.now() - startTime) / 1000;
      rootGem.rotation.y = t * gemAnim.ROTATION_SPEED;
      rootGem.position.y =
        rootGem.userData.baseY + Math.sin(t * gemAnim.BOB_FREQUENCY) * rootGem.userData.bobAmp;
      // Scale-up affordance on hover so the gem reads as clickable.
      const hov = picker.hover.get();
      const gemTargetScale = hov && hov.kind === NodeKind.Gem ? gemAnim.HOVER_SCALE : 1.0;
      const curS = rootGem.scale.x;
      const nextS = curS + (gemTargetScale - curS) * gemAnim.SCALE_LERP_SPEED;
      rootGem.scale.set(nextS, nextS, nextS);
    }
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }
  animate();

  // Expose cityScene + applyTheme to the boot block so setupLiveUpdates
  // can swap in fresh manifests, and attachHotReload can dispatch
  // material refreshes without restarting the renderer.
  return { cityScene, applyTheme };
}

// Keep flat street labels readable at any orbit. Flip decision comes from the
// camera's world-right vector (matrixWorld column 0), not position — at top-down
// the camera can sit over center yet still be rotated 180° around Y.
function _orientLabelsForCamera(
  labels: THREE.Group[],
  camera: THREE.PerspectiveCamera,
  labelRight: THREE.Vector3
): void {
  labelRight.setFromMatrixColumn(camera.matrixWorld, 0);
  const rightX = labelRight.x;
  const rightZ = labelRight.z;

  // Hysteresis: only flip when the relevant axis crosses ±THRESH, not 0.
  // Without this, near-top-down camera positions (where rightX/rightZ are
  // near zero) cause floating-point jitter from OrbitControls' damping to
  // flip labels back and forth every frame.
  const THRESH = LABEL_TYPOGRAPHY.get().FLIP_HYSTERESIS;

  for (const lbl of labels) {
    const street = lbl.userData.street;
    const base = lbl.userData.baseRotY || 0;
    const axis = street.orientation === StreetAxis.X ? rightX : rightZ;
    let flipped = lbl.userData.flipped || false;
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

function _resizeRendererToCanvas(renderer: THREE.WebGLRenderer, canvas: HTMLCanvasElement): void {
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  renderer.setSize(cw, ch, false);
}

// Build a /api/<endpoint> URL from the current page's query params.
// CLI opens the page with either ?path=… or ?clone=…&branch=… so the
// server knows what to scan; we just forward those through.
function _apiUrl(endpoint: string): string {
  const qp = new URLSearchParams(window.location.search);
  const u = new URL(endpoint, window.location.origin);
  if (qp.has('clone')) {
    u.searchParams.set('clone', qp.get('clone'));
    if (qp.has('branch')) u.searchParams.set('branch', qp.get('branch'));
  } else if (qp.has('path')) {
    u.searchParams.set('path', qp.get('path'));
  }
  return u.toString();
}

function manifestUrl(): string {
  return _apiUrl('/api/manifest');
}

function signatureUrl(): string {
  return _apiUrl('/api/manifest/signature');
}

// Live-update poll loop. When LIVE_UPDATES.ENABLED flips on we start
// re-fetching the manifest at the user-configured interval; when its
// signature changes vs. the last render, we hand the new manifest to
// cityScene.applyManifest, which rebuilds the city in place. Camera +
// selection survive because picker.selectionKey is persisted and
// re-resolved on every cityScene rebuild, and cameraRig keeps its pose
// across applyManifest calls (no re-frame).
//
// Two-stage poll: each tick first hits /api/manifest/signature (cheap —
// stat-only walk, no file content reads, no per-file git history) and
// only fetches the full /api/manifest when the signature has changed.
// On a large repo the no-op poll cost drops by ~10×. IS_RELOADING is
// only set during the actual manifest fetch so the footer's "reloading…"
// indicator doesn't flicker on every cheap signature check; concurrent
// ticks are gated by the local `inFlight` flag.
function _clampPollSeconds(s: number | unknown): number {
  if (typeof s !== 'number' || !isFinite(s)) return POLL_SECONDS_MIN;
  return Math.min(POLL_SECONDS_MAX, Math.max(POLL_SECONDS_MIN, s));
}

interface LiveUpdateHandle {
  cityScene: ReturnType<typeof startRenderLoop>['cityScene'];
  applyTheme: () => void;
}

interface SignatureResponse {
  root: string;
  scanned_at: string;
  signature: string;
}

function setupLiveUpdates(handle: LiveUpdateHandle, initialSignature: string): void {
  let lastSignature = initialSignature || '';
  let timer: number | null = null;
  let inFlight = false;

  async function tick(): Promise<void> {
    if (inFlight) return;
    inFlight = true;
    try {
      const sigResp = await fetch(signatureUrl());
      if (!sigResp.ok) return;
      const sig: SignatureResponse | null = await sigResp.json();
      if (!sig?.signature || sig.signature === lastSignature) return;

      IS_RELOADING.set(true);
      try {
        const mResp = await fetch(manifestUrl());
        if (!mResp.ok) return;
        const m: Manifest | null = await mResp.json();
        if (m?.signature && m.signature !== lastSignature) {
          lastSignature = m.signature;
          handle.cityScene.applyManifest(m);
        }
      } finally {
        IS_RELOADING.set(false);
      }
    } catch {
      /* keep polling on transient errors */
    } finally {
      inFlight = false;
    }
  }

  function start(): void {
    stop();
    const seconds = _clampPollSeconds(LIVE_UPDATES.get().POLL_SECONDS);
    timer = window.setInterval(tick, seconds * 1000);
  }
  function stop(): void {
    if (timer != null) {
      window.clearInterval(timer);
      timer = null;
    }
  }

  LIVE_UPDATES.subscribe((val) => {
    if (val.ENABLED) start();
    else stop();
  });
}

// Boot. Guarded by a canvas check so unit tests can import this module
// without triggering any DOM/network side effects.
const _canvas = document.getElementById(DOM_IDS.CANVAS) as HTMLCanvasElement | null;
if (_canvas) {
  (async function boot() {
    const resp = await fetch(manifestUrl());
    if (!resp.ok) throw new Error(`manifest fetch failed: ${resp.status}`);
    const manifest: Manifest = await resp.json();
    // Hydrate every config store from localStorage BEFORE scene build so
    // any user tweaks from prior sessions take effect during the initial
    // layout/render.
    attachPersistence(Config);
    // Picker's selectionKey atom isn't part of the Config barrel, so
    // wire its persistence directly. Hydrating BEFORE startRenderLoop
    // lets the picker's first key→selection resolve see the saved key.
    persistStore('PICKER_SELECTION_KEY', PICKER_SELECTION_KEY);
    const handle = startRenderLoop(_canvas, manifest);
    attachHotReload({
      cityScene: handle.cityScene,
      applyTheme: handle.applyTheme,
    });
    setupLiveUpdates(handle, manifest.signature);
  })();
}
