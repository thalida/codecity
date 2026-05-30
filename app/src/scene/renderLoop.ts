// renderLoop.ts — Scene + rendering pipeline. Builds the city scene,
// renderer, camera, post-fx, picker, fader, outlines, ghosts, paths,
// animator, and drives the per-frame animate loop. Extracted from main.ts
// so that main.ts is purely site-level orchestration (source picker,
// syntax theme, live updates, URL handling, persistence wiring).

import * as THREE from 'three';

import {
  ASPHALT,
  SIDEWALK_COLORS,
  LABEL_TYPOGRAPHY,
  GEM_ANIMATION,
  GEM_APPEARANCE,
  GEM_FACE_PALETTE,
  GEM_GLOW,
  GEM_SIZING,
  BLOOM,
} from '../state/settings/index';
import { NodeKind, StreetAxis } from '../types';
import type { Manifest } from '../types';

import { SKY } from '@/state/settings/components/sky';
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
import { showTooltip, hideTooltip } from '../views/components/tooltip';
import { createPostFx } from './system/postFx';
import { registerRenderer as registerAdPanelRenderer } from './components/adPanels/adPanelTextureArray';
import { labelFromManifest } from '@/utils/sources';

// Rewrite manifest.tree.name to the friendly label derived from display_root
// so that every downstream consumer (root street label, file tree root row,
// footer name, document.title) shows the human-readable source name instead
// of the cache-directory hash. Server returns the cache path as `root`; this
// client-side mutation is the single point of policy. Must be called BEFORE
// applyManifest so the scene is built with the correct name from the start.
export function _applyDisplayLabel(manifest: Manifest): void {
  const friendly = labelFromManifest(manifest);
  if (manifest.tree && friendly) {
    manifest.tree.name = friendly;
  }
}

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
  _applyDisplayLabel(manifest);

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
  // Selection persistence is wired in the boot block before startRenderLoop
  // runs — the saved {kind, path} key is hydrated into PICKER_SELECTION_KEY
  // before this picker resolves it against the freshly-built city.
  const picker = createPicker({ canvas, camera, world });

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
  const _swc0 = SIDEWALK_COLORS.value;
  let SIDEWALK_HOVER_COLOR = new THREE.Color(_swc0.HOVER).getHex();
  let SIDEWALK_SELECTED_COLOR = new THREE.Color(_swc0.SELECTED).getHex();
  let SIDEWALK_DEFAULT_COLOR = new THREE.Color(_swc0.DEFAULT).getHex();

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
    const sidewalk = SIDEWALK_COLORS.value;

    SIDEWALK_HOVER_COLOR = new THREE.Color(sidewalk.HOVER).getHex();
    SIDEWALK_SELECTED_COLOR = new THREE.Color(sidewalk.SELECTED).getHex();
    SIDEWALK_DEFAULT_COLOR = new THREE.Color(sidewalk.DEFAULT).getHex();
    const streetPickables = world.getStreetPickables();
    for (const sw of streetPickables) {
      sw.userData.origColor = SIDEWALK_DEFAULT_COLOR;
    }
    _refreshSidewalkTints();

    const asphaltHex = new THREE.Color(ASPHALT.value.COLOR).getHex();
    const asphaltMeshes = world.getAsphaltMeshes();
    for (const mesh of asphaltMeshes) {
      mesh.material.color.setHex(asphaltHex);
    }

    scene.background = new THREE.Color(SKY.value.COLOR);

    outlineRenderer.refreshMaterials();
    treeOutlineRenderer.refreshMaterials();
    pathLineRenderer.refreshMaterials();
    refreshBuildingMaterial();
    postFx.refresh();
    // Cyberpunk Valley sky — pulls fresh SKY_* uniforms (sky color,
    // star density, twinkle params). Hot-reloaded via the
    // hotStores route in app/config/hotReload.ts.
    world.getSky().refresh();
    // Floating repo-name label — pulls fresh STYLE/ENABLED/OPACITY/
    // HEIGHT_ABOVE_CITY/ANIMATION_SPEED. Swaps the active style mesh
    // when STYLE changed; otherwise just updates uniforms + transform.
    world.getRepoLabel().refresh();

    // Cyberpunk Valley floating island — pulls fresh ISLAND_MATERIALS /
    // ISLAND_GEOMETRY / ISLAND_UNDERGLOW config so colour pickers + toggles
    // hot-update without a manifest rebuild.
    world.getIsland().refresh();

    // Cyberpunk Valley trees — pushes fresh TREE_GREENS + TREE_TRUNK_COLOR
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

    const gemAppearance = GEM_APPEARANCE.value;
    const rootGemEdges = world.getRootGemEdges();
    const rootGemBody = world.getRootGemBody();
    const rootGem = world.getRootGem();
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
    // Per-face colors live on the gem body's geometry as a BufferAttribute,
    // baked at construction. Rewrite it in place on Save so palette tweaks
    // take effect without a full applyManifest rebuild.
    if (rootGemBody?.geometry?.attributes.color) {
      const palette = GEM_FACE_PALETTE.value;
      const paletteHexes = [
        palette.FACE_1,
        palette.FACE_2,
        palette.FACE_3,
        palette.FACE_4,
        palette.FACE_5,
        palette.FACE_6,
        palette.FACE_7,
        palette.FACE_8,
      ];
      const faceColors = paletteHexes.map((hex) => {
        const c = new THREE.Color(hex);
        return [c.r, c.g, c.b] as [number, number, number];
      });
      const geo = rootGemBody.geometry;
      const colorAttr = geo.attributes.color as THREE.BufferAttribute;
      const vertexCount = geo.attributes.position.count;
      const faceCount = vertexCount / 3;
      const arr = colorAttr.array as Float32Array;
      for (let f = 0; f < faceCount; f++) {
        const fc = faceColors[f % faceColors.length];
        for (let v = 0; v < 3; v++) {
          const idx = (f * 3 + v) * 3;
          arr[idx] = fc[0];
          arr[idx + 1] = fc[1];
          arr[idx + 2] = fc[2];
        }
      }
      colorAttr.needsUpdate = true;
    }
    if (rootGem && rootGem.userData.streetWidth != null) {
      const hoverFrac = GEM_SIZING.value.HOVER_LIFT_FRAC;
      rootGem.userData.baseY = rootGem.userData.radius + rootGem.userData.streetWidth * hoverFrac;
    }

    // Glow halo: scale, opacity, visibility from GEM_GLOW config. Color
    // is driven per-frame by the render loop (palette cycle), so we
    // don't touch it here.
    if (rootGem && rootGem.userData.radius != null) {
      const glowCfg = GEM_GLOW.value;
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

    const labelCfg = LABEL_TYPOGRAPHY.value;
    const streetLabels = world.getStreetLabels();
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

  // Sidewalk tints are scene-state that follow selection / hover. Subscribe
  // directly to picker so the tint refresh fires alongside the renderers.
  picker.selection.subscribe(() => {
    _refreshSidewalkTints();
  });
  picker.hover.subscribe(() => {
    _refreshSidewalkTints();
  });

  // Firefly hover / select boost. Always re-fetches world.getFireflies() so
  // the subscription stays valid across world rebuilds — the new renderer
  // starts with uniforms at -1 (no highlight), and the next subscription
  // fire will push the current hover/selection into it.
  picker.hover.subscribe((h) => {
    const fireflies = world.getFireflies();
    if (!fireflies) return;
    if (h && h.kind === NodeKind.Commit) {
      fireflies.setHoveredCommit(h.commit.sha);
    } else {
      fireflies.setHoveredCommit(null);
    }
  });
  picker.selection.subscribe((sel) => {
    const fireflies = world.getFireflies();
    if (!fireflies) return;
    if (sel && sel.kind === NodeKind.Commit) {
      fireflies.setSelectedCommit(sel.commit.sha);
    } else {
      fireflies.setSelectedCommit(null);
    }
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
    // Sky star twinkle — the only animation in Cyberpunk Valley.
    // Compute dt in seconds from the same startTime the gem
    // animation uses (no fresh timer; one wall-clock source per frame
    // keeps everything in lockstep). The sphere-follow-camera
    // position sync was moved to immediately before postFx.render()
    // (see comment there); doing it mid-frame raced with scene
    // matrix updates and during fast orbit movements caused the
    // sphere to render at the previous frame's position, projecting
    // an off-center sphere disc and showing scene.background as
    // black flicker around the edges.
    {
      const nowS = (performance.now() - startTime) / 1000;
      const sky = world.getSky();
      const dt = _lastSkyTime === null ? 0 : Math.max(0, nowS - _lastSkyTime);
      _lastSkyTime = nowS;
      sky.tick(dt);
      // Island tick: updates uSunDirWorld uniform from the sun direction
      // shared by the sky. Must run after sky.tick() so the sun direction
      // is current before the island shader samples it.
      world.getIsland().tick();
      // Floating repo-name label tick — advances per-style uTime and
      // (for the Hologram style) rotates the text panel to face the
      // camera. Pulls the active ANIMATION_SPEED from REPO_LABEL config.
      world.getRepoLabel().tick(dt, camera);
    }
    fader.update(0); // body opacity per fade tier
    outlineRenderer.update(0); // hover/selected outline transforms + rainbow chase
    treeOutlineRenderer.update(0); // tree hover/selected outline transforms + rainbow chase
    ghostRenderer.update(0); // hover ghost transform
    pathLineRenderer.update(0); // selection path line rainbow chase
    // Street labels are world-space text on the asphalt — orient toward
    // camera each frame so they remain readable from any rotation.
    _orientLabelsForCamera(world.getStreetLabels(), camera, labelRight);
    const rootGem = world.getRootGem();
    if (rootGem) {
      const gemAnim = GEM_ANIMATION.value;
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
      const hov = picker.hover.value;
      const gemTargetScale = hov && hov.kind === NodeKind.Gem ? gemAnim.HOVER_SCALE : 1.0;
      const curS = rootGem.scale.x;
      const nextS = curS + (gemTargetScale - curS) * gemAnim.SCALE_LERP_SPEED;
      rootGem.scale.set(nextS, nextS, nextS);

      // Glow color: animate through GEM_FACE_PALETTE when ANIMATE_COLORS
      // is on; otherwise fall back to the gem's EDGE_COLOR. Two halos
      // cycle on different phases so the gem reads with two colors at
      // any moment, blending as they cross.
      const glowCfg = GEM_GLOW.value;
      const inner = rootGem.userData.innerGlowSprite as THREE.Sprite | null;
      const outer = rootGem.userData.outerGlowSprite as THREE.Sprite | null;
      if (inner || outer) {
        if (glowCfg.ANIMATE_COLORS) {
          const palette = GEM_FACE_PALETTE.value;
          const hexes = [
            palette.FACE_1,
            palette.FACE_2,
            palette.FACE_3,
            palette.FACE_4,
            palette.FACE_5,
            palette.FACE_6,
            palette.FACE_7,
            palette.FACE_8,
          ];
          const period = Math.max(0.001, glowCfg.CYCLE_PERIOD_SECONDS);
          if (inner)
            _setPaletteColor((inner.material as THREE.SpriteMaterial).color, hexes, t, period, 0);
          if (outer)
            _setPaletteColor((outer.material as THREE.SpriteMaterial).color, hexes, t, period, 0.5);
        } else {
          const edge = GEM_APPEARANCE.value.EDGE_COLOR;
          if (inner) (inner.material as THREE.SpriteMaterial).color.set(edge);
          if (outer) (outer.material as THREE.SpriteMaterial).color.set(edge);
        }
        // HDR push for selective gem bloom. Sprite color was just set
        // to an LDR palette value; multiplying scales it past 1.0 in
        // linear space so the bloom pass picks it up independently of
        // BLOOM.WINDOW_EMISSION. 1.0 = no bloom from gem; higher = more.
        // Gated on BLOOM.ENABLED so the "flat" comparison mode skips
        // the HDR push entirely.
        const bloomCfg = BLOOM.value;
        const gemEmission = bloomCfg.ENABLED ? bloomCfg.GEM_EMISSION : 1.0;
        if (gemEmission !== 1) {
          if (inner) (inner.material as THREE.SpriteMaterial).color.multiplyScalar(gemEmission);
          if (outer) (outer.material as THREE.SpriteMaterial).color.multiplyScalar(gemEmission);
        }
      }
    }
    // Sync the Cyberpunk Valley sky sphere to the camera RIGHT BEFORE
    // the render call so its world matrix is guaranteed fresh. Doing
    // this earlier in animate() (where scene.updateMatrixWorld() also
    // ran) caused the sphere's world matrix to be stale during fast
    // orbit movements — visible as black flicker around the edges of
    // an off-center sphere disc, because the camera was momentarily
    // outside its own sky sphere.
    {
      const sky = world.getSky();
      sky.mesh.position.copy(camera.position);
      sky.mesh.updateMatrixWorld(true);
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
  return { world, applyTheme, picker, rig, resetView };
}

// Cycle a THREE.Color in place through a palette of [r,g,b] triples,
// smoothly interpolating between adjacent palette entries. One full
// loop through every color takes `period` seconds; `offset` (0..1)
// shifts the starting phase so multiple sprites can run different
// "ahead-of-each-other" cadences without allocating new Colors.
function _setPaletteColor(
  out: THREE.Color,
  palette: ReadonlyArray<string>,
  t: number,
  period: number,
  offset: number
): void {
  const n = palette.length;
  if (n === 0) return;
  const phase = (((t / period + offset) % 1) + 1) % 1; // wrap negatives
  const idxf = phase * n;
  const a = Math.floor(idxf) % n;
  const b = (a + 1) % n;
  const f = idxf - Math.floor(idxf);
  const A = new THREE.Color(palette[a]);
  const B = new THREE.Color(palette[b]);
  out.setRGB(A.r + (B.r - A.r) * f, A.g + (B.g - A.g) * f, A.b + (B.b - A.b) * f);
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
