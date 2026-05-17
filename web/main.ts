// main.ts — Entry point. Fetches the manifest from the local Python server
// at /api/manifest, lays out the city, builds the scene, and starts the
// render loop with orbit/pan/zoom controls and raycast picking.

import * as THREE from 'three';

import './styles.css';

import * as Config from './config/index.js';
import {
  SCENE_COLORS,
  ASPHALT,
  SIDEWALK_COLORS,
  LABEL_TYPOGRAPHY,
  GEM_ANIMATION,
  GEM_APPEARANCE,
  GEM_FACE_PALETTE,
  GEM_GLOW,
  GEM_SIZING,
  BLOOM,
  LIVE_UPDATES,
  POLL_SECONDS_MIN,
  POLL_SECONDS_MAX,
  SCAN_FILTERS,
} from './config/index.js';
import { REBUILD_STATUS, LAST_REBUILD_ERROR, refreshManifest, setRefreshManifest } from './liveStatus.js';
import { attachPersistence, persistAtomPerSource } from './config/persist.js';
import { SYNTAX_THEME } from './config/syntaxTheme.js';
import { sourceKey, CURRENT_SOURCE_KEY } from './sourceContext.js';
import { attachHotReload } from './config/hotReload.js';
import { DOM_IDS } from './constants';
import { NodeKind, StreetAxis } from './types';
import type { Manifest } from './types';

import { createCityScene } from './scene/cityScene.js';
import { refreshBuildingMaterial } from './scene/instanced/buildings.js';
import { refreshBillboards } from './scene/billboards.js';
import type { SceneBlock } from './scene/blocks.js';
import { createCameraRig } from './scene/cameraRig.js';
import { createAnimator } from './scene/animator.js';
import { createPicker, PICKER_SELECTION_KEY } from './scene/picker.js';
import { createInputHandlers } from './scene/inputHandlers.js';
import { createBuildingFader } from './scene/effects/buildingFader.js';
import { createOutlineRenderer } from './scene/effects/outlineRenderer.js';
import { createGhostRenderer } from './scene/effects/ghostRenderer.js';
import { createPathLineRenderer } from './scene/effects/pathLineRenderer.js';
import { createCoordinator } from './coordinator.js';
import { showTooltip, hideTooltip } from './views/shell/tooltip.js';
import { buildApiUrl } from './url.js';
import { buildIconAtlas } from './scene/iconAtlas.js';
import { setIconAtlas } from './scene/instanced/buildings.js';
import { createSourcePicker, type SourcePayload } from './views/shell/sourcePicker.js';
import { createLoadingOverlay } from './views/shell/loadingOverlay.js';
import { streamManifest } from './manifestStream.js';
import { pushRecent } from './views/shell/sourceRecents.js';
import { createPostFx } from './scene/postFx.js';
import { labelFromDisplayRoot } from './views/shell/displayLabel.js';

// Rewrite manifest.tree.name to the friendly label derived from display_root
// so that every downstream consumer (root street label, file tree root row,
// footer name, document.title) shows the human-readable source name instead
// of the cache-directory hash. Server returns the cache path as `root`; this
// client-side mutation is the single point of policy. Must be called BEFORE
// applyManifest so the scene is built with the correct name from the start.
function _applyDisplayLabel(manifest: Manifest): void {
  const friendly = labelFromDisplayRoot(manifest.display_root, manifest.tree?.name ?? '');
  if (manifest.tree && friendly) {
    manifest.tree.name = friendly;
  }
}

async function startRenderLoop(canvas: HTMLCanvasElement, manifest: Manifest) {
  // Every visual / layout tunable comes from the named exports of
  // src/defaults.js. Render-loop code reads them fresh each frame (or
  // each event), so the Settings UI can mutate the imported objects in
  // place and changes take effect immediately. Material-level
  // applications (line widths, hex color caches, scene background) are
  // re-synced via applyTheme() — exposed to the Settings UI through
  // showLeftSidebar().

  // -- 1. City scene + meshes --------------------------------------------------
  // Manifest-bound state — meshes, lookup maps, outlines, ghosts — lives
  // in scene/cityScene.js. main.js no longer caches mesh refs locally —
  // every other module reads cityScene directly through accessors.
  const cityScene = createCityScene(canvas);
  const scene = cityScene.scene;
  _applyDisplayLabel(manifest);
  await cityScene.applyManifest(manifest);

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
  // Expose for visual regression tests. Harmless in production (just a
  // global ref); only used by tests/visual/setup.ts.
  (window as Window & { __rig?: typeof rig }).__rig = rig;

  // -- 4b. Post-processing -----------------------------------------------------
  // UnrealBloomPass on top of the main render so emissive windows actually
  // glow into the surrounding pixels (cyberpunk neon look). Cost is screen-
  // space, independent of building count. animate() and the resize handler
  // both call postFx.render() instead of renderer.render(scene, camera) so
  // bloom is part of every paint.
  const postFx = createPostFx(renderer, scene, camera);
  {
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    postFx.setSize(cw, ch);
  }

  // -- 5. Picker (raycaster + hover/selection state) --------------------------
  // Picker owns the hover + selection atoms (consumed below by the
  // outline / path-line / fader / sidebar code via subscription).
  // Selection persistence is wired in the boot block before startRenderLoop
  // runs — the saved {kind, path} key is hydrated into PICKER_SELECTION_KEY
  // before this picker resolves it against the freshly-built city.
  const picker = createPicker({ canvas, camera, cityScene });

  // -- 6. Per-frame visual modules ---------------------------------------------
  // Four siblings, all subscribed to picker / cityScene so they react
  // to selection / hover / manifest changes on their own. Animate loop
  // drives them in field-ownership order: fader writes body opacity →
  // outlineRenderer tracks hover/selected outline transforms + rainbow
  // chase → ghostRenderer tracks hover ghost transform → pathLineRenderer
  // ticks the rainbow chase on the selection line.
  const fader = createBuildingFader({ cityScene, picker });
  const outlineRenderer = createOutlineRenderer({
    canvas,
    scene,
    cityScene,
    picker,
  });
  const ghostRenderer = createGhostRenderer({ scene, cityScene, picker });
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
  const coordinator = createCoordinator({
    cityScene,
    picker,
    rig,
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
    refreshBuildingMaterial();
    postFx.refresh();

    // Push fresh BLOOM.BILLBOARD_EMISSION into every billboard's
    // panel material so the bloom slider affects billboards live.
    const billboardGroups: THREE.Group[] = [];
    for (const block of cityScene.getBlocks()) {
      if (block.billboards) for (const g of block.billboards) billboardGroups.push(g);
    }
    refreshBillboards(billboardGroups);

    const gemAppearance = GEM_APPEARANCE.get();
    const rootGemEdges = cityScene.getRootGemEdges();
    const rootGemBody = cityScene.getRootGemBody();
    const rootGem = cityScene.getRootGem();
    if (rootGemEdges?.material?.color) {
      rootGemEdges.material.color.set(gemAppearance.EDGE_COLOR);
    }
    if (rootGemBody?.material) {
      const op = gemAppearance.BODY_OPACITY;
      rootGemBody.material.opacity = op;
      // Toggle `transparent` to match the opacity. Without this, dropping
      // opacity below 1 has no visual effect after the gem was created
      // with opacity = 1.
      const wantTransparent = op < 1;
      if (rootGemBody.material.transparent !== wantTransparent) {
        rootGemBody.material.transparent = wantTransparent;
        rootGemBody.material.needsUpdate = true;
      }
    }
    if (rootGem && rootGem.userData.streetWidth != null) {
      const hoverFrac = GEM_SIZING.get().HOVER_LIFT_FRAC;
      rootGem.userData.baseY = rootGem.userData.radius + rootGem.userData.streetWidth * hoverFrac;
    }

    // Glow halo: scale, opacity, visibility from GEM_GLOW config. Color
    // is driven per-frame by the render loop (palette cycle), so we
    // don't touch it here.
    if (rootGem && rootGem.userData.radius != null) {
      const glowCfg = GEM_GLOW.get();
      const r = rootGem.userData.radius as number;
      const inner = rootGem.userData.innerGlowSprite as THREE.Sprite | null;
      const outer = rootGem.userData.outerGlowSprite as THREE.Sprite | null;
      if (inner) {
        inner.visible = glowCfg.ENABLED;
        inner.scale.set(r * glowCfg.INNER_SCALE, r * glowCfg.INNER_SCALE, 1);
        (inner.material as THREE.SpriteMaterial).opacity = glowCfg.INNER_OPACITY;
      }
      if (outer) {
        outer.visible = glowCfg.ENABLED;
        outer.scale.set(r * glowCfg.OUTER_SCALE, r * glowCfg.OUTER_SCALE, 1);
        (outer.material as THREE.SpriteMaterial).opacity = glowCfg.OUTER_OPACITY;
      }
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
    showTooltip,
    hideTooltip,
    onResize() {
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      postFx.setSize(cw, ch);
      outlineRenderer.onResize();
      pathLineRenderer.onResize();
      // Synchronous paint to avoid a single-frame blank/cleared canvas
      // between the resize and the next animate() tick. The render path
      // must match animate() so bloom shows immediately on the new size.
      postFx.render();
    },
    // Same action as the header gem button: rebuild the manifest +
    // reset the camera. Fired by the R key and by clicking the root
    // gem mesh in the scene.
    onRefresh() {
      void refreshManifest();
      rig.reset();
    },
    getRootName: () => cityScene.getRoot()?.name ?? null,
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

  // Reused scratch vector to avoid per-frame allocations from renderer.getSize().
  const _renderSize = new THREE.Vector2();
  function animate() {
    // Idempotent per-frame size guard. The ResizeObserver wires onResize
    // for sidebar / window changes, but transient races can leave the
    // EffectComposer's HDR render targets at a stale size — manifests as
    // the city getting rendered into a small region of an otherwise-black
    // canvas. Re-syncing here is cheap (no-op when sizes match) and
    // catches anything the observer-driven path misses.
    {
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      renderer.getSize(_renderSize);
      if (cw > 0 && ch > 0 && (_renderSize.x !== cw || _renderSize.y !== ch)) {
        renderer.setSize(cw, ch, false);
        camera.aspect = cw / Math.max(1, ch);
        camera.updateProjectionMatrix();
        postFx.setSize(cw, ch);
        outlineRenderer.onResize();
        pathLineRenderer.onResize();
      }
    }
    rig.update(0); // first-call: bbox-frames camera
    // Per-frame world-matrix refresh. controls.update() moves the camera
    // but matrixWorldInverse is stale until renderer.render runs; modules
    // below project mesh positions and need fresh world matrices.
    camera.updateMatrixWorld();
    scene.updateMatrixWorld();
    animator.update(0); // entering / staying tweens (scale, position)
    fader.update(0); // body opacity per fade tier
    outlineRenderer.update(0); // hover/selected outline transforms + rainbow chase
    ghostRenderer.update(0); // hover ghost transform
    pathLineRenderer.update(0); // selection path line rainbow chase
    // Street labels are world-space text on the asphalt — orient toward
    // camera each frame so they remain readable from any rotation.
    _orientLabelsForCamera(cityScene.getStreetLabels(), camera, labelRight);
    _orientBlockLabelsForCamera(cityScene.getBlocks(), camera, labelRight);
    const rootGem = cityScene.getRootGem();
    if (rootGem) {
      const gemAnim = GEM_ANIMATION.get();
      const t = (performance.now() - startTime) / 1000;
      rootGem.rotation.y = t * gemAnim.ROTATION_SPEED;
      // BOB_AMPLITUDE_FRAC is read live each frame so the slider
      // updates without a rebuild. The gem radius is cached on
      // userData at gem-build time (it depends on root-street width).
      rootGem.position.y =
        rootGem.userData.baseY +
        Math.sin(t * gemAnim.BOB_FREQUENCY) *
          (rootGem.userData.radius * gemAnim.BOB_AMPLITUDE_FRAC);
      // Scale-up affordance on hover so the gem reads as clickable.
      const hov = picker.hover.get();
      const gemTargetScale = hov && hov.kind === NodeKind.Gem ? gemAnim.HOVER_SCALE : 1.0;
      const curS = rootGem.scale.x;
      const nextS = curS + (gemTargetScale - curS) * gemAnim.SCALE_LERP_SPEED;
      rootGem.scale.set(nextS, nextS, nextS);

      // Glow color: animate through GEM_FACE_PALETTE when ANIMATE_COLORS
      // is on; otherwise fall back to the gem's EDGE_COLOR. Two halos
      // cycle on different phases so the gem reads with two colors at
      // any moment, blending as they cross.
      const glowCfg = GEM_GLOW.get();
      const inner = rootGem.userData.innerGlowSprite as THREE.Sprite | null;
      const outer = rootGem.userData.outerGlowSprite as THREE.Sprite | null;
      if (inner || outer) {
        if (glowCfg.ANIMATE_COLORS) {
          const palette = GEM_FACE_PALETTE.get();
          const period = Math.max(0.001, glowCfg.CYCLE_PERIOD_SECONDS);
          if (inner) _setPaletteColor((inner.material as THREE.SpriteMaterial).color, palette, t, period, 0);
          if (outer) _setPaletteColor((outer.material as THREE.SpriteMaterial).color, palette, t, period, 0.5);
        } else {
          const edge = GEM_APPEARANCE.get().EDGE_COLOR;
          if (inner) (inner.material as THREE.SpriteMaterial).color.set(edge);
          if (outer) (outer.material as THREE.SpriteMaterial).color.set(edge);
        }
        // HDR push for selective gem bloom. Sprite color was just set
        // to an LDR palette value; multiplying scales it past 1.0 in
        // linear space so the bloom pass picks it up independently of
        // BLOOM.WINDOW_EMISSION. 1.0 = no bloom from gem; higher = more.
        // Gated on BLOOM.ENABLED so the "flat" comparison mode skips
        // the HDR push entirely.
        const bloomCfg = BLOOM.get();
        const gemEmission = bloomCfg.ENABLED ? bloomCfg.GEM_EMISSION : 1.0;
        if (gemEmission !== 1) {
          if (inner) (inner.material as THREE.SpriteMaterial).color.multiplyScalar(gemEmission);
          if (outer) (outer.material as THREE.SpriteMaterial).color.multiplyScalar(gemEmission);
        }
      }
    }
    postFx.render();
    requestAnimationFrame(animate);
  }
  animate();

  // Expose cityScene, applyTheme, and coordinator to the boot block so
  // setupLiveUpdates can swap in fresh manifests, attachHotReload can
  // dispatch material refreshes, and applyNewSource can update the header
  // branch pill + repo link after a mid-session source switch.
  return { cityScene, applyTheme, coordinator };
}

// Cycle a THREE.Color in place through a palette of [r,g,b] triples,
// smoothly interpolating between adjacent palette entries. One full
// loop through every color takes `period` seconds; `offset` (0..1)
// shifts the starting phase so multiple sprites can run different
// "ahead-of-each-other" cadences without allocating new Colors.
function _setPaletteColor(
  out: THREE.Color,
  palette: ReadonlyArray<readonly [number, number, number]>,
  t: number,
  period: number,
  offset: number
): void {
  const n = palette.length;
  if (n === 0) return;
  const phase = (((t / period) + offset) % 1 + 1) % 1; // wrap negatives
  const idxf = phase * n;
  const a = Math.floor(idxf) % n;
  const b = (a + 1) % n;
  const f = idxf - Math.floor(idxf);
  const A = palette[a];
  const B = palette[b];
  out.setRGB(
    A[0] + (B[0] - A[0]) * f,
    A[1] + (B[1] - A[1]) * f,
    A[2] + (B[2] - A[2]) * f
  );
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

// Per-block instanced-label sibling of _orientLabelsForCamera. Each block's
// labelsMesh stores per-instance iFlip; we toggle 0/1 based on the camera's
// world-right vector against the block's primary-street axis. Hysteresis state
// piggybacks on labelsMesh.userData.flipped (same idea as the legacy Group path).
function _orientBlockLabelsForCamera(
  blocks: SceneBlock[],
  camera: THREE.PerspectiveCamera,
  labelRight: THREE.Vector3,
): void {
  labelRight.setFromMatrixColumn(camera.matrixWorld, 0);
  const rightX = labelRight.x;
  const rightZ = labelRight.z;
  const THRESH = LABEL_TYPOGRAPHY.get().FLIP_HYSTERESIS;

  for (const block of blocks) {
    const mesh = block.labelsMesh;
    if (!mesh) continue;
    const street = block.primaryStreet;
    if (!street) continue;
    const axis = street.orientation === StreetAxis.X ? rightX : rightZ;
    let flipped: boolean = mesh.userData.flipped || false;
    if (flipped) {
      if (axis > THRESH) flipped = false;
    } else {
      if (axis < -THRESH) flipped = true;
    }
    if (flipped === mesh.userData.flipped) continue;
    mesh.userData.flipped = flipped;
    const flipAttr = mesh.geometry.getAttribute('iFlip') as THREE.InstancedBufferAttribute | undefined;
    if (!flipAttr) continue;
    const v = flipped ? 1 : 0;
    const arr = flipAttr.array as Float32Array;
    for (let i = 0; i < arr.length; i++) arr[i] = v;
    flipAttr.needsUpdate = true;
  }
}

function _resizeRendererToCanvas(renderer: THREE.WebGLRenderer, canvas: HTMLCanvasElement): void {
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  renderer.setSize(cw, ch, false);
}

// URL builders delegate to the pure helper in web/url.ts so tests can
// exercise the query-param logic without faking out window.*.
function manifestUrl(): string {
  return buildApiUrl(
    '/api/manifest',
    window.location.search,
    window.location.origin
  );
}

function signatureUrl(): string {
  return buildApiUrl(
    '/api/manifest/signature',
    window.location.search,
    window.location.origin
  );
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
// On a large repo the no-op poll cost drops by ~10×. REBUILD_STATUS is
// only flipped during the actual manifest fetch so the footer's
// "rebuilding…" indicator only lights up when there's real work.
function _clampPollSeconds(s: number | unknown): number {
  if (typeof s !== 'number' || !isFinite(s)) return POLL_SECONDS_MIN;
  return Math.min(POLL_SECONDS_MAX, Math.max(POLL_SECONDS_MIN, s));
}

interface LiveUpdateHandle {
  cityScene: Awaited<ReturnType<typeof startRenderLoop>>['cityScene'];
  applyTheme: () => void;
}

interface SignatureResponse {
  root: string;
  scanned_at: string;
  signature: string;
}

function setupLiveUpdates(
  handle: LiveUpdateHandle,
  initialSignature: string,
): { setSignature(sig: string): void } {
  let lastSignature = initialSignature || '';
  let timer: number | null = null;
  let inFlight = false;
  let needsRefresh = false;

  // Single fetch+apply path. Always flips REBUILD_STATUS to 'rebuilding'
  // for the duration — both the poll's "signature changed" branch and
  // the toggle handler funnel through here so the footer indicator
  // behaves identically. A non-2xx response or a JSON parse error
  // resolves to 'error' with the message captured in LAST_REBUILD_ERROR.
  async function refreshManifest(): Promise<void> {
    REBUILD_STATUS.set('rebuilding');
    try {
      for await (const event of streamManifest(manifestUrl())) {
        if (event.phase === 'error') throw new Error(event.error);
        const m = event.manifest;
        if (m?.signature) {
          lastSignature = m.signature;
          _applyDisplayLabel(m);
          await handle.cityScene.applyManifest(m);
        }
      }
      REBUILD_STATUS.set('idle');
      LAST_REBUILD_ERROR.set(null);
    } catch (err) {
      REBUILD_STATUS.set('error');
      LAST_REBUILD_ERROR.set(err instanceof Error ? err.message : String(err));
    }
  }

  // Poll tick: cheap signature first, full manifest only on change.
  // After a refresh, re-check needsRefresh in case a toggle fired
  // mid-flight and queued itself.
  async function tick(): Promise<void> {
    if (inFlight) return;
    inFlight = true;
    try {
      do {
        needsRefresh = false;
        const sigResp = await fetch(signatureUrl());
        if (!sigResp.ok) break;
        const sig: SignatureResponse | null = await sigResp.json();
        if (!sig?.signature || sig.signature === lastSignature) break;
        await refreshManifest();
      } while (needsRefresh);
    } catch (_) {
      // Signature-fetch errors (network blip on the cheap probe) are
      // intentionally not surfaced through REBUILD_STATUS — no rebuild
      // attempt happened. The next tick retries. Only failures inside
      // refreshManifest (the full fetch + applyManifest) populate the
      // error indicator.
    } finally {
      inFlight = false;
    }
  }

  // Toggle handler: bypass the cheap check (the manifest WILL differ),
  // but defer to the polling closure's inFlight gate so the two paths
  // can't trample each other.
  async function refreshFromToggle(): Promise<void> {
    if (inFlight) {
      needsRefresh = true;
      return;
    }
    inFlight = true;
    try {
      do {
        needsRefresh = false;
        await refreshManifest();
      } while (needsRefresh);
    } catch {
      /* keep polling */
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

  // Expose the manual-refresh entrypoint to anything outside the
  // live-poll loop (e.g. the footer's refresh button) so they can
  // trigger the same fetch+apply chain without re-implementing it.
  setRefreshManifest(refreshFromToggle);

  LIVE_UPDATES.subscribe((val) => {
    if (val.ENABLED) start();
    else stop();
  });

  // Toggling SHOW_ALL_FILES ALWAYS triggers a refresh, regardless of
  // whether live polling is enabled — the user explicitly asked for a
  // different scan and should see it immediately.
  let _scanFiltersBootstrapped = false;
  SCAN_FILTERS.subscribe(() => {
    // Skip the first synchronous fire from .subscribe() so we don't
    // double-fetch on initial hydration.
    if (!_scanFiltersBootstrapped) {
      _scanFiltersBootstrapped = true;
      return;
    }
    refreshFromToggle();
  });

  return {
    setSignature(sig: string) {
      lastSignature = sig;
    },
  };
}

// ── Boot helpers ────────────────────────────────────────────────────────────

function _srcKind(src: string): 'git' | 'local' {
  return /:\/\//.test(src) || /^[^@]+@[^:]+:/.test(src) ? 'git' : 'local';
}

function _deriveLabel(src: string): string {
  if (_srcKind(src) === 'git') {
    // git URL — try "owner/repo" from the last two path segments
    const m = src.match(/[\/:]([^\/]+)\/([^\/]+?)(?:\.git)?$/);
    if (m) return `${m[1]}/${m[2]}`;
    return src;
  }
  // Local path — basename
  const parts = src.split(/[\/\\]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : src;
}

const EMPTY_MANIFEST: Manifest = {
  root: '',
  scanned_at: new Date().toISOString(),
  signature: '',
  tree: {
    name: '',
    type: NodeKind.Directory,
    path: '',
    fullPath: '',
    children: [],
    children_count: 0,
    children_file_count: 0,
    children_dir_count: 0,
    descendants_count: 0,
    descendants_file_count: 0,
    descendants_dir_count: 0,
    descendants_size: 0,
  },
  repo: null,
};

// _applyHljsTheme — swap the <link id="hljs-theme"> element's href so
// the chosen highlight.js CSS theme loads immediately without a re-render.
// The .hljs-* token classes are already in the DOM; only the colours change.
// Called once on boot (after attachPersistence hydrates the stored choice)
// and again on every subsequent SYNTAX_THEME change.
const HLJS_VERSION = '11.11.1';
function _applyHljsTheme(theme: string): void {
  const id = 'hljs-theme';
  let link = document.getElementById(id) as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }
  link.href = `https://cdn.jsdelivr.net/npm/highlight.js@${HLJS_VERSION}/styles/${theme}.min.css`;
}

// Boot. Guarded by a canvas check so unit tests can import this module
// without triggering any DOM/network side effects.
const _canvas = document.getElementById(DOM_IDS.CANVAS) as HTMLCanvasElement | null;
if (_canvas) {
  (async function boot() {
    // Hydrate every config store from localStorage BEFORE the initial
    // manifest fetch so SCAN_FILTERS.SHOW_ALL_FILES (which feeds
    // manifestUrl) reflects the user's persisted toggle from a prior
    // session — otherwise the first paint ignores the saved value and
    // only corrects itself on the next poll.
    attachPersistence(Config);

    // Apply the persisted (or default) syntax theme immediately after
    // hydration, then track future changes. The subscribe call fires
    // synchronously on registration — that first fire covers the boot case.
    SYNTAX_THEME.subscribe(_applyHljsTheme);

    // One-shot migration: pre-this-change, PICKER_SELECTION_KEY and cameraPose
    // were both persisted as global keys. If they're still there AND we have a
    // source loaded (URL has ?src=), copy them under the source's namespace
    // and drop the legacy slots.
    {
      const qp = new URLSearchParams(window.location.search);
      if (qp.has('src')) {
        const k = sourceKey(qp.get('src')!, qp.get('branch') ?? undefined);

        const legacySel = localStorage.getItem('cc.PICKER_SELECTION_KEY');
        if (legacySel !== null) {
          if (localStorage.getItem(`cc.source.${k}.selection`) === null) {
            localStorage.setItem(`cc.source.${k}.selection`, legacySel);
          }
          localStorage.removeItem('cc.PICKER_SELECTION_KEY');
        }

        const legacyCam = localStorage.getItem('cc.cameraPose');
        if (legacyCam !== null) {
          if (localStorage.getItem(`cc.source.${k}.cameraPose`) === null) {
            localStorage.setItem(`cc.source.${k}.cameraPose`, legacyCam);
          }
          localStorage.removeItem('cc.cameraPose');
        }
      }
    }

    // Set CURRENT_SOURCE_KEY from URL params BEFORE wiring per-source
    // persistence so hydration sees the right key.
    {
      const qp = new URLSearchParams(window.location.search);
      if (qp.has('src')) {
        CURRENT_SOURCE_KEY.set(sourceKey(qp.get('src')!, qp.get('branch') ?? undefined));
      }
    }

    persistAtomPerSource('selection', PICKER_SELECTION_KEY, null);

    const qp = new URLSearchParams(window.location.search);
    const hasSrc = qp.has('src');

    const loadingOverlay = createLoadingOverlay();

    let initialManifest: Manifest;
    let initialError: string | null = null;
    if (hasSrc) {
      const _bootSrc = qp.get('src')!;
      const _bootBranch = qp.get('branch') ?? undefined;
      loadingOverlay.show({
        kind: _srcKind(_bootSrc),
        label: _deriveLabel(_bootSrc),
        branch: _bootBranch,
      });
      try {
        let lastEvent: { manifest: Manifest } | null = null;
        for await (const event of streamManifest(manifestUrl())) {
          if (event.phase === 'error') throw new Error(event.error);
          if (event.phase === 'skeleton') {
            loadingOverlay.setStep('building');
            loadingOverlay.hide();
          }
          lastEvent = { manifest: event.manifest };
        }
        initialManifest = lastEvent!.manifest;
      } catch (err) {
        initialError = err instanceof Error ? err.message : String(err);
        initialManifest = EMPTY_MANIFEST;
      }
    } else {
      initialManifest = EMPTY_MANIFEST;
    }

    if (hasSrc && !initialError) {
      try {
        const atlas = await buildIconAtlas(initialManifest);
        setIconAtlas(atlas);
      } catch (err) {
        console.warn('[codecity] icon atlas build failed; roofs will render without icons', err);
      }
    }

    const handle = await startRenderLoop(_canvas, initialManifest);
    attachHotReload({
      cityScene: handle.cityScene,
      applyTheme: handle.applyTheme,
    });

    let liveUpdatesStarted = false;
    let _liveUpdates: { setSignature(sig: string): void } | null = null;
    if (hasSrc && !initialError) {
      _liveUpdates = setupLiveUpdates(handle, initialManifest.signature);
      liveUpdatesStarted = true;
    }

    let picker: ReturnType<typeof createSourcePicker>;

    // Remember the dismissible flag of the most recent open() call so error
    // reopen preserves it (header-switch reopen stays dismissible after a
    // failed submit; cold-boot reopen stays non-dismissible).
    let _lastDismissible = false;

    async function applyNewSource(payload: SourcePayload): Promise<void> {
      const dismissibleOnError = _lastDismissible;
      loadingOverlay.show({
        kind: _srcKind(payload.src),
        label: _deriveLabel(payload.src),
        branch: payload.branch,
      });
      try {
        const url = new URL('/api/manifest', window.location.origin);
        url.searchParams.set('src', payload.src);
        if (payload.branch) url.searchParams.set('branch', payload.branch);

        let manifest: Manifest | null = null;
        for await (const event of streamManifest(url.toString())) {
          if (event.phase === 'error') throw new Error(event.error);
          if (event.phase === 'skeleton') {
            loadingOverlay.setStep('building');
            loadingOverlay.hide();
            // Apply the skeleton so the new city paints in immediately —
            // the final event will tween into final heights.
            _applyDisplayLabel(event.manifest);
            await handle.cityScene.applyManifest(event.manifest);
          }
          manifest = event.manifest;
        }
        if (!manifest) throw new Error('No manifest received');

        // Update URL first so per-source persistence subscriptions see the
        // right CURRENT_SOURCE_KEY on the next tick.
        const pageUrl = new URL(window.location.href);
        pageUrl.searchParams.set('src', payload.src);
        if (payload.branch) pageUrl.searchParams.set('branch', payload.branch);
        else pageUrl.searchParams.delete('branch');
        history.replaceState(null, '', pageUrl.toString());

        CURRENT_SOURCE_KEY.set(sourceKey(payload.src, payload.branch));

        try {
          setIconAtlas(await buildIconAtlas(manifest));
        } catch (err) {
          console.warn('[codecity] icon atlas build failed', err);
        }

        _applyDisplayLabel(manifest);
        await handle.cityScene.applyManifest(manifest);

        // Update the header (project label, branch pill) + footer (repo link)
        // AFTER applyManifest so cityScene.getManifest() inside the coordinator
        // resolves to the just-applied manifest — otherwise the label is stale.
        handle.coordinator.setSourceInfo(
          payload.branch,
          _srcKind(payload.src) === 'git' ? payload.src : undefined,
        );

        _liveUpdates?.setSignature(manifest.signature);
        pushRecent({ src: payload.src, branch: payload.branch, label: _deriveLabel(payload.src) });

        if (!liveUpdatesStarted) {
          _liveUpdates = setupLiveUpdates(handle, manifest.signature);
          liveUpdatesStarted = true;
        }
      } catch (err) {
        picker.open({
          dismissible: dismissibleOnError,
          prefill: payload,
          error: err instanceof Error ? err.message : String(err),
        });
        return;
      } finally {
        loadingOverlay.hide();
      }
    }

    picker = createSourcePicker({
      onSubmit: (payload) => {
        picker.close();
        applyNewSource(payload);
      },
    });

    // Boot decisions:
    if (initialError) {
      // Direct-boot fetch failed → modal in non-dismissible mode with the error.
      _lastDismissible = false;
      picker.open({
        dismissible: false,
        prefill: { src: qp.get('src')!, branch: qp.get('branch') ?? undefined },
        error: initialError,
      });
    } else if (!hasSrc) {
      // Cold boot, no URL params → modal in non-dismissible mode.
      _lastDismissible = false;
      picker.open({ dismissible: false });
    } else {
      // Boot complete with manifest applied.
      loadingOverlay.hide();
    }

    // Wire the header "switch source" button via a global hook.
    (window as Window & { __openSourcePicker?: () => void }).__openSourcePicker = () => {
      const cur = new URLSearchParams(window.location.search);
      _lastDismissible = true;
      picker.open({
        dismissible: true,
        prefill: cur.has('src')
          ? { src: cur.get('src')!, branch: cur.get('branch') ?? undefined }
          : undefined,
      });
    };
  })();
}
