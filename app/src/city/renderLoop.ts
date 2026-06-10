// scene/renderLoop.ts — Scene + rendering pipeline. Builds the city scene,
// renderer, camera, post-fx, picker, fader, outlines, ghosts, paths,
// animator, and drives the per-frame animate loop. Extracted from the old
// main.ts monolith so the entry layer (main.tsx) and useCityScene stay purely
// site-level orchestration (source picker, syntax theme, live updates, URL
// handling, persistence wiring).

import * as THREE from 'three';

import type { Manifest } from '../types';

import { SCENE } from '@/state/stores/settings/scene';
import { createWorld } from './world';
import { createCameraRig } from './runtime/cameraRig';
import { createPicker } from './runtime/picker';
import { createInputHandlers } from './runtime/inputHandlers';
import { showTooltip, hideTooltip } from './runtime/tooltip';
import { createPostFx } from './runtime/postFx';
import { registerRenderer as registerAdPanelRenderer } from './components/buildings/adPanelTextureArray';

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
  // world satisfies CameraRigDeps structurally (its onChange accepts
  // `(diff) => void` callbacks, which a `() => void` callback also is).
  const rig = createCameraRig({ canvas, deps: world });
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
  // Building hover/selection overlays — the body fader, hover/selected
  // outlines, and hover ghost — are owned by the buildings component (built
  // inside world). The component arms them on its first tick() (once the
  // picker is live) and drives them in field-ownership order: fader writes
  // body opacity → outline tracks hover/selected outline transforms + rainbow
  // chase → ghost tracks hover ghost transform. The tree-outline + path-line
  // renderers are likewise owned by the trees / pathLine components (also
  // built inside world, also armed on their first tick()). renderLoop no
  // longer constructs any of them.

  // Tween queue for entering / staying transitions on world.onChange
  // (the dissolved animator — now buildings.animateFrom, Task 13). Subscribed
  // HERE, after the boot applyManifest above, so the boot diff is NOT animated —
  // identical timing to the old createAnimator({ world }) construction at this
  // slot. Tweens own the instance matrix (scale+position), disjoint from the
  // fader's iFade — they cannot conflict by construction.
  world.onChange((diff) => world.getBuildings().animateFrom(diff));

  // applyTheme() — hot-apply the current values from src/config/* to every
  // material / cache that's set once at scene-build time. The Settings UI
  // mutates the config stores (SIDEWALK_COLORS, BUILDING_OUTLINE, etc.)
  // and calls this to flush the changes through. Render-loop values
  // (BUILDING_FADE.*, HOVER.COMMIT_MS) are read fresh each frame and
  // don't need anything here.
  function applyTheme(): void {
    // Streets own their settings reactivity via the streets component's own
    // theme effect (sidewalk hover/selected/default tints, asphalt color, and
    // label height-scale all react to STREETS Save inside the component), so
    // applyTheme() no longer touches sidewalks, asphalt, or street labels.

    scene.background = new THREE.Color(SCENE.value.SKY_COLOR);

    // The building hover/selected outline materials react to BUILDINGS Save via
    // the outline's own theme effect (inside the buildings component), and the
    // shared building material reacts to BUILDINGS/FACADE/SCENE/BLOOM via the
    // component's material effect — so applyTheme() no longer refreshes the
    // building outline materials or the shared building material here.
    postFx.refresh();
    // The Cyberpunk Valley sky pulls fresh SKY_* uniforms (sky color,
    // star density) via its OWN settings effect inside the sky component,
    // so applyTheme() no longer touches the sky.
    // The floating repo-name label also owns its own settings effect, so
    // applyTheme() no longer calls refresh() on it either.
    // Trees (per-instance canopy/trunk recolor + outline materials) react to
    // TREES Save via the trees component's own theme effect; fireflies
    // (BOB/PULSE/EMISSION/FLICKER/ORBIT_SPEED uniforms) react to FIREFLIES
    // Save via the fireflies component's; the path lines (linewidth, opacity,
    // hover color) react to STREETS Save via the pathLine component's — so
    // applyTheme() no longer touches any of them.

    // Ad panels — pushes fresh BLOOM.AD_EMISSION into uEmissionBoost so
    // the emission slider hot-updates without a manifest rebuild. Null
    // until the first manifest with media files applies.
    world.getAdPanels()?.refresh();

    // The gem reacts to GEM/BLOOM Save via its own theme effect (owned by
    // the gem component), so applyTheme() no longer touches the gem.
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
      world.getBuildings().onResize();
      world.getTreesComponent().onResize();
      world.getPathLine().onResize();
      world.getFirefliesComponent().onResize(cw, ch);
      // Synchronous paint to avoid a single-frame blank/cleared canvas
      // between the resize and the next animate() tick. The render path
      // must match animate() so bloom shows immediately on the new size.
      postFx.render();
    },
    onResetView: resetView,
    getRootName: () => world.getRoot()?.name ?? null,
  });

  // Sidewalk tints follow selection / hover via two picker-driven effects
  // owned by the streets component, armed on its first tick() (once the
  // picker is live). renderLoop no longer wires them here. The firefly
  // hover/select boost effects are likewise owned by the fireflies
  // component, armed on its first tick().

  // -- 8. Render loop --------------------------------------------------------
  const startTime = performance.now();
  // Wall-clock time of the previous sky tick (seconds since startTime).
  // null on the first frame; the first sky.tick() advances by 0 so
  // uTime stays at its initial value of 0 until the second frame.
  let _lastSkyTime: number | null = null;

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
        world.getBuildings().onResize();
        world.getTreesComponent().onResize();
        world.getPathLine().onResize();
        world.getFirefliesComponent().onResize(cw, ch);
      }
    }
    // Fireflies tick — drives the bob uTime (single uniform update for all
    // orb instances) + the orbit-ring rainbow chase, and arms the
    // hover/select boost effects on the first call (picker live by frame 1).
    // Same pre-rig slot the old firefly time-uniform block occupied.
    {
      const t = (performance.now() - startTime) / 1000;
      world.getFirefliesComponent().tick(0, { dt: 0, time: t, camera });
    }
    rig.update(0); // first-call: bbox-frames camera
    // Per-frame world-matrix refresh. controls.update() moves the camera
    // but matrixWorldInverse is stale until renderer.render runs; modules
    // below project mesh positions and need fresh world matrices.
    camera.updateMatrixWorld();
    scene.updateMatrixWorld();
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
      // Floating repo-name label tick — advances uTime and rotates the
      // text panel to face the camera. Pulls ANIMATION_SPEED from
      // REPO_LABEL config via the component's own closure.
      const t = (performance.now() - startTime) / 1000;
      world.getRepoLabel().tick(_skyDt, { dt: _skyDt, time: t, camera });
    }
    // Buildings tick — entering/staying tweens run FIRST inside it (the
    // dissolved animator.update(0), formerly at the slot just above), then
    // the overlays: fader (body opacity) → outline (hover/selected
    // transforms + rainbow chase) → ghost (hover transform). The component
    // arms the overlays on its first tick (picker now live) and drives them
    // in that order. Same slot the old fader/outline/ghost update() calls
    // occupied; treeOutline/pathLine now run AFTER (behavior-neutral —
    // disjoint writes, all consumed only at postFx.render below).
    {
      const t = (performance.now() - startTime) / 1000;
      world.getBuildings().tick(_skyDt, { dt: _skyDt, time: t, camera });
    }
    // Trees tick — tree hover/selected outline transforms + rainbow chase
    // (and first-tick arming of the outline renderer). Same slot the old
    // treeOutlineRenderer.update(0) call occupied.
    {
      const t = (performance.now() - startTime) / 1000;
      world.getTreesComponent().tick(_skyDt, { dt: _skyDt, time: t, camera });
    }
    // PathLine tick — selection path line rainbow chase (and first-tick
    // arming of the inner renderer). Same slot the old
    // pathLineRenderer.update(0) call occupied, immediately after trees.
    {
      const t = (performance.now() - startTime) / 1000;
      world.getPathLine().tick(_skyDt, { dt: _skyDt, time: t, camera });
    }
    // Street labels are world-space text on the asphalt — the streets
    // component orients them toward the camera each frame (and lazily arms
    // its sidewalk-tint effects on the first tick, now that the picker is
    // live). Same slot as the old _orientLabelsForCamera call: after
    // the pathLine tick, before the gem tick.
    {
      const t = (performance.now() - startTime) / 1000;
      world.getStreets().tick(_skyDt, { dt: _skyDt, time: t, camera });
    }
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

function _resizeRendererToCanvas(renderer: THREE.WebGLRenderer, canvas: HTMLCanvasElement): void {
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  renderer.setSize(cw, ch, false);
}
