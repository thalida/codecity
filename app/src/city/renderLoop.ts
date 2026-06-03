// scene/renderLoop.ts — Scene + rendering pipeline. Builds the city scene,
// renderer, camera, post-fx, picker, fader, outlines, ghosts, paths,
// animator, and drives the per-frame animate loop. Extracted from the old
// main.ts monolith so the entry layer (main.tsx) and useCityScene stay purely
// site-level orchestration (source picker, syntax theme, live updates, URL
// handling, persistence wiring).

import * as THREE from 'three';
import { effect } from '@preact/signals';

import { STREETS } from '../state/stores/settings/streets';
import { NodeKind, StreetAxis } from '../types';
import type { Manifest } from '../types';

import { SCENE } from '@/state/stores/settings/scene';
import { createWorld } from './world';
import { refreshBuildingMaterial } from './components/buildings/buildings';
import { createCameraRig } from './system/cameraRig';
import { createAnimator } from './system/animator';
import { createPicker } from './system/picker';
import { createInputHandlers } from './system/inputHandlers';
import { createBuildingFader } from './effects/buildingFader';
import { createOutlineRenderer } from './effects/outlineRenderer';
import { createTreeOutlineRenderer } from './effects/treeOutlineRenderer';
import { createGhostRenderer } from './effects/ghostRenderer';
import { createPathLineRenderer } from './effects/pathLineRenderer';
import { showTooltip, hideTooltip } from './effects/tooltip';
import { createPostFx } from './system/postFx';
import { registerRenderer as registerAdPanelRenderer } from './components/adPanels/adPanelTextureArray';

export async function startRenderLoop(canvas: HTMLCanvasElement, manifest: Manifest) {
  // Every visual / layout tunable comes from the named exports of
  // src/defaults.js. Render-loop code reads them fresh each frame (or
  // each event), so the Settings UI can mutate the imported objects in
  // place and changes take effect immediately. Material-level
  // applications (line widths, hex color caches, scene background) are
  // re-synced via applyTheme() — exposed to the Settings UI through
  // showLeftSidebar().

  // -- 1. City scene + meshes --------------------------------------------------
  // Manifest-bound state — meshes, lookup maps, outlines, ghosts — lives
  // in scene/world.js. main.js no longer caches mesh refs locally —
  // every other module reads world directly through accessors.
  const world = createWorld(canvas);
  const scene = world.scene;

  // -- 2. Renderer (created BEFORE applyManifest) ------------------------------
  // applyManifest's cell pass creates InstancedAdPanels and immediately
  // kicks off async image loads for every media building. Those uploads
  // need the WebGLRenderer to run renderer.copyTextureToTexture. Creating
  // the renderer here (rather than after applyManifest) means
  // AdPanelTextureArray always has a registered renderer by the time any
  // <img>.onload fires — which can happen surprisingly early for cached
  // responses. With the previous order, the first few cached images
  // could race the renderer registration, skip the upload, but still
  // ramp iTextureFade to 1.0 → the panel sampled an unwritten layer
  // and rendered fully transparent ("ad missing").
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
  });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  _resizeRendererToCanvas(renderer, canvas);
  registerAdPanelRenderer(renderer);

  await world.applyManifest(manifest);

  // -- 4. Camera + controls ----------------------------------------------------
  // Camera, OrbitControls, pose persistence, framing, and the focus/reset
  // animations all live in scene/cameraRig.js. Local aliases are kept for
  // brevity in event handlers and resize logic below.
  const rig = createCameraRig({ canvas, world });
  const camera = rig.camera;
  // Expose for visual regression tests. Harmless in production (just a
  // global ref); only used by tests/visual/setup.ts.
  (window as Window & { __rig?: typeof rig }).__rig = rig;

  // Reset shared by every entry point: R key, header gem button, in-scene
  // gem click/dblclick. Does NOT rebuild the city manifest — a page reload
  // is required for that.
  const resetView = rig.reset;

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
  // The selection key is in-memory only (not persisted): it starts null on
  // a fresh load and is re-resolved against each freshly-built city so the
  // selection survives in-session rebuilds.
  const picker = createPicker({ canvas, camera, world });

  // Populate the shared SceneContext that components built inside world
  // (the gem) captured at construction. This runs before animate() is first
  // called, so the gem's tick() sees a live picker on frame 1. The gem's
  // theme effect only reads GEM/BLOOM signals, so it was already safe at
  // construction (before the picker existed).
  {
    const ctx = world.getSceneCtx();
    ctx.picker = picker;
    ctx.camera = camera;
    ctx.renderer = renderer;
  }

  // -- 6. Per-frame visual modules ---------------------------------------------
  // Four siblings, all subscribed to picker / world so they react
  // to selection / hover / manifest changes on their own. Animate loop
  // drives them in field-ownership order: fader writes body opacity →
  // outlineRenderer tracks hover/selected outline transforms + rainbow
  // chase → ghostRenderer tracks hover ghost transform → pathLineRenderer
  // ticks the rainbow chase on the selection line.
  const fader = createBuildingFader({ world, picker });
  const outlineRenderer = createOutlineRenderer({
    canvas,
    scene,
    world,
    picker,
  });
  const treeOutlineRenderer = createTreeOutlineRenderer({
    canvas,
    scene,
    picker,
    getTrees: () => world.getTrees(),
  });
  const ghostRenderer = createGhostRenderer({ scene, world, picker });
  const pathLineRenderer = createPathLineRenderer({
    canvas,
    scene,
    world,
    picker,
  });

  // Tween queue for entering / staying transitions on world.onChange.
  // Animator owns mesh.scale + mesh.position (disjoint from buildingFader's
  // material.opacity), so they cannot conflict by construction.
  const animator = createAnimator({ world });

  // SIDEWALK_COLORS holds CSS strings; we pre-convert to numeric hex so
  // the per-frame tint loop calls material.color.setHex() without
  // re-parsing every frame. applyTheme() refreshes these whenever the
  // Settings UI mutates SIDEWALK_COLORS.
  const _swc0 = STREETS.value;
  let SIDEWALK_HOVER_COLOR = new THREE.Color(_swc0.SIDEWALK_HOVER).getHex();
  let SIDEWALK_SELECTED_COLOR = new THREE.Color(_swc0.SIDEWALK_SELECTED).getHex();
  let SIDEWALK_DEFAULT_COLOR = new THREE.Color(_swc0.SIDEWALK_DEFAULT).getHex();

  // _refreshSidewalkTints() — repaint every sidewalk's material.color
  // based on the current picker.selection / picker.hover state.
  function _refreshSidewalkTints(): void {
    const sel = picker.selection.value;
    const hov = picker.hover.value;
    const streetPickables = world.getStreetPickables();
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
    }
  }

  // applyTheme() — hot-apply the current values from src/config/* to every
  // material / cache that's set once at scene-build time. The Settings UI
  // mutates the config stores (SIDEWALK_COLORS, BUILDING_OUTLINE, etc.)
  // and calls this to flush the changes through. Render-loop values
  // (BUILDING_FADE.*, HOVER.COMMIT_MS) are read fresh each frame and
  // don't need anything here.
  function applyTheme(): void {
    const sidewalk = STREETS.value;

    SIDEWALK_HOVER_COLOR = new THREE.Color(sidewalk.SIDEWALK_HOVER).getHex();
    SIDEWALK_SELECTED_COLOR = new THREE.Color(sidewalk.SIDEWALK_SELECTED).getHex();
    SIDEWALK_DEFAULT_COLOR = new THREE.Color(sidewalk.SIDEWALK_DEFAULT).getHex();
    const streetPickables = world.getStreetPickables();
    for (const sw of streetPickables) {
      sw.userData.origColor = SIDEWALK_DEFAULT_COLOR;
    }
    _refreshSidewalkTints();

    const asphaltHex = new THREE.Color(STREETS.value.ASPHALT_COLOR).getHex();
    const asphaltMeshes = world.getAsphaltMeshes();
    for (const mesh of asphaltMeshes) {
      mesh.material.color.setHex(asphaltHex);
    }

    scene.background = new THREE.Color(SCENE.value.SKY_COLOR);

    outlineRenderer.refreshMaterials();
    treeOutlineRenderer.refreshMaterials();
    pathLineRenderer.refreshMaterials();
    refreshBuildingMaterial();
    postFx.refresh();
    // The Cyberpunk Valley sky pulls fresh SKY_* uniforms (sky color,
    // star density) via its OWN settings effect inside the sky component,
    // so applyTheme() no longer touches the sky.
    // Floating repo-name label — pulls fresh STYLE/ENABLED/OPACITY/
    // HEIGHT_ABOVE_CITY/ANIMATION_SPEED. Swaps the active style mesh
    // when STYLE changed; otherwise just updates uniforms + transform.
    world.getRepoLabel().refresh();

    // Cyberpunk Valley floating island — pulls fresh ISLAND_MATERIALS /
    // ISLAND_GEOMETRY / ISLAND_UNDERGLOW config so colour pickers + toggles
    // hot-update without a manifest rebuild.
    world.getIsland().refresh();

    // Cyberpunk Valley trees — pushes fresh TREE_GREENS + TRUNK_COLOR
    // into per-instance color buffers. Null until the first manifest applies.
    world.getTrees()?.refresh();
    // Cyberpunk Valley fireflies — pushes fresh BOB/PULSE/EMISSION/FLICKER/
    // ORBIT_SPEED uniforms into the shader. Null until the first manifest
    // applies; guard with optional chain. Structural keys (ENABLED,
    // SCALE_MIN/MAX) take the rebuild path via configCommitReactions.
    world.getFireflies()?.refresh();

    // Cyberpunk Valley city footprint — pushes fresh COLOR + ENABLED
    // onto the slab material / group visibility. Null until the first
    // manifest applies; guard with optional chain.
    world.getCityFootprint()?.refresh();

    // Ad panels — pushes fresh BLOOM.AD_EMISSION into uEmissionBoost so
    // the emission slider hot-updates without a manifest rebuild. Null
    // until the first manifest with media files applies.
    world.getAdPanels()?.refresh();

    // The gem reacts to GEM/BLOOM Save via its own theme effect (owned by
    // the gem component), so applyTheme() no longer touches the gem.

    const labelCfg = STREETS.value;
    const streetLabels = world.getStreetLabels();
    for (const lg of streetLabels) {
      const origFrac = lg.userData.origHeightFrac;
      if (origFrac && lg.children[0]) {
        const s = labelCfg.LABEL_HEIGHT_FRAC / origFrac;
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
      treeOutlineRenderer.onResize();
      pathLineRenderer.onResize();
      world.getFireflies()?.onResize(cw, ch);
      // Synchronous paint to avoid a single-frame blank/cleared canvas
      // between the resize and the next animate() tick. The render path
      // must match animate() so bloom shows immediately on the new size.
      postFx.render();
    },
    onResetView: resetView,
    getRootName: () => world.getRoot()?.name ?? null,
  });

  // Sidewalk tints follow selection / hover. Two effects keep tracking
  // narrow — one signal per effect, no over-tracking.
  effect(() => {
    void picker.selection.value;
    _refreshSidewalkTints();
  });
  effect(() => {
    void picker.hover.value;
    _refreshSidewalkTints();
  });

  // Firefly hover / select boost. Re-fetches world.getFireflies() each fire
  // so the wiring survives world rebuilds (new renderer starts with -1
  // uniforms and the next signal change pushes current hover/selection in).
  effect(() => {
    const h = picker.hover.value;
    const fireflies = world.getFireflies();
    if (!fireflies) return;
    fireflies.setHoveredCommit(h && h.kind === NodeKind.Commit ? h.commit.sha : null);
  });
  effect(() => {
    const sel = picker.selection.value;
    const fireflies = world.getFireflies();
    if (!fireflies) return;
    fireflies.setSelectedCommit(sel && sel.kind === NodeKind.Commit ? sel.commit.sha : null);
  });

  // -- 8. Render loop --------------------------------------------------------
  const startTime = performance.now();
  // Wall-clock time of the previous sky tick (seconds since startTime).
  // null on the first frame; the first sky.tick() advances by 0 so
  // uTime stays at its initial value of 0 until the second frame.
  let _lastSkyTime: number | null = null;
  const labelRight = new THREE.Vector3();

  // Reused scratch vector to avoid per-frame allocations from renderer.getSize().
  const _renderSize = new THREE.Vector2();
  function animate() {
    // Idempotent per-frame size guard. Resyncs renderer + composer + post
    // passes to canvas.clientWidth/Height whenever they diverge; cheap
    // no-op when they don't. Safety net for any canvas-size divergence the
    // ResizeObserver missed (e.g. transient layout race during sidebar
    // toggle); not needed during normal operation.
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
        treeOutlineRenderer.onResize();
        pathLineRenderer.onResize();
        world.getFireflies()?.onResize(cw, ch);
      }
    }
    // Drive firefly bob — single uniform update for all orb instances.
    {
      const fireflies = world.getFireflies();
      if (fireflies) {
        fireflies.setTime((performance.now() - startTime) / 1000);
      }
    }
    rig.update(0); // first-call: bbox-frames camera
    // Per-frame world-matrix refresh. controls.update() moves the camera
    // but matrixWorldInverse is stale until renderer.render runs; modules
    // below project mesh positions and need fresh world matrices.
    camera.updateMatrixWorld();
    scene.updateMatrixWorld();
    animator.update(0); // entering / staying tweens (scale, position)
    // Per-frame dt in seconds from the same startTime the gem animation
    // uses (no fresh timer; one wall-clock source per frame keeps
    // everything in lockstep). The sky's own twinkle + camera-follow
    // tick runs LAST, immediately before postFx.render() (see comment
    // there); this dt is captured here and passed to it then.
    const _skyDt = (() => {
      const nowS = (performance.now() - startTime) / 1000;
      const dt = _lastSkyTime === null ? 0 : Math.max(0, nowS - _lastSkyTime);
      _lastSkyTime = nowS;
      return dt;
    })();
    {
      // Island tick: updates uSunDirWorld uniform from the sun direction.
      // (No ordering dependency on the sky — island.tick() is a static
      // hemispheric-lighting no-op.)
      world.getIsland().tick();
      // Floating repo-name label tick — advances per-style uTime and
      // (for the Hologram style) rotates the text panel to face the
      // camera. Pulls the active ANIMATION_SPEED from REPO_LABEL config.
      world.getRepoLabel().tick(_skyDt, camera);
    }
    fader.update(0); // body opacity per fade tier
    outlineRenderer.update(0); // hover/selected outline transforms + rainbow chase
    treeOutlineRenderer.update(0); // tree hover/selected outline transforms + rainbow chase
    ghostRenderer.update(0); // hover ghost transform
    pathLineRenderer.update(0); // selection path line rainbow chase
    // Street labels are world-space text on the asphalt — orient toward
    // camera each frame so they remain readable from any rotation.
    _orientLabelsForCamera(world.getStreetLabels(), camera, labelRight);
    // Root gem — rotation / bob / hover-scale / glow palette cycle / HDR
    // bloom push all live in the gem component's tick(). It uses absolute
    // time (frame.time), not dt, and reads hover via the SceneContext picker
    // captured at construction. dt is non-critical here.
    {
      const t = (performance.now() - startTime) / 1000;
      world.getGem().tick(0, { dt: 0, time: t, camera });
    }
    // Sky tick — star twinkle (uTime += dt) AND sync the sphere to the
    // camera. Runs RIGHT BEFORE the render call so its world matrix is
    // guaranteed fresh. Doing the camera-follow earlier in animate()
    // (where scene.updateMatrixWorld() also ran) caused the sphere's
    // world matrix to be stale during fast orbit movements — visible as
    // black flicker around the edges of an off-center sphere disc,
    // because the camera was momentarily outside its own sky sphere.
    // Nothing between the twinkle and the render samples uTime, so
    // running the twinkle here (vs. mid-frame) is behavior-identical.
    {
      const t = (performance.now() - startTime) / 1000;
      world.getSky().tick(_skyDt, { dt: _skyDt, time: t, camera });
    }
    postFx.render();
    requestAnimationFrame(animate);
  }
  animate();

  // Expose world, applyTheme, picker, rig, and resetView to the boot
  // block (App.tsx) so setupLiveUpdates can swap in fresh manifests,
  // attachCommitReactions can dispatch material refreshes, and the
  // shell components can read picker.selection / picker.hover via
  // SCENE_HANDLE signal.
  return {
    world,
    applyTheme,
    picker,
    rig,
    resetView,
    /** Focus the camera on the node at `path`: resolve via the picker, dispatch
     *  to the rig. The single-call focus equivalent of picker.selectByPath /
     *  hoverByPath, so callers needn't reach into both subsystems. */
    focusByPath(path: string): void {
      rig.focusSelection(picker.targetForPath(path));
    },
  };
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
  // Camera-orbit dead zone before the street label flips to match the
  // new viewing angle. Was previously tunable; the default proved
  // universally good and the control was removed (2026-05-26).
  const THRESH = 0.15;

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
