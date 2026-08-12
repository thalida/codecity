// city/index.ts — the city composer. createCity(canvas, manifest) folds the
// scene and component construction and the rendering pipeline into one async
// factory, then drives the frame loop via startFrameLoop. Returns the handle
// App.tsx / the City component consume.

import * as THREE from 'three';
import { effect, untracked } from '@preact/signals';

import type { Manifest, RangeStat } from '@/types';
import { CURRENT_SOURCE_KEY } from '@/state/stores/source';
import { MANIFEST } from '@/state/stores/manifest';
import { TIMELINE_MODE, SCRUB_DRAGGING, SCRUB_POS } from '@/state/stores/timeline';

import { registerShaderChunks } from './utils/shaders/registerShaderChunks';
import { createBuildings } from './components/buildings';
import { makeHeightContext } from './layout/dimensions';
import { createScrubController } from './timeline/scrubController';
import type { PathTimeline } from './timeline/replay';
import { createLayoutClient } from './layout';
import { createCityState } from './state';
import { runCollisionCheck, runStemPlacementDiagnostic } from './diagnostics';
import { createGem } from './components/gem';
import { createSky } from './components/sky';
import { createIsland } from './components/island';
import { createRepoLabel } from './components/repoLabel';
import { createFootprint } from './components/footprint';
import { createStreets } from './components/streets';
import { createTrees } from './components/trees';
import { createFireflies } from './components/fireflies';
import { createPathLine } from './components/pathLine';
import type { City, SceneComponent, SceneContext } from './types';
import { createCameraRig } from './render/cameraRig';
import { createPicker } from './interaction/picker';
import { createInputHandlers } from './interaction/inputHandlers';
import { showTooltip, hideTooltip } from './interaction/tooltip';
import { createPostFx } from './render/postFx';
import { startFrameLoop } from './render/frameLoop';
import { registerRenderer as registerFacadePanelRenderer } from './components/buildings/facadePanelTextureArray';

export async function createCity(canvas: HTMLCanvasElement, manifest: Manifest): Promise<City> {
  // Must precede any ShaderMaterial so #include <chunk> directives resolve.
  registerShaderChunks();

  const scene = new THREE.Scene();

  // Renderer FIRST + register it with the ad-panel texture array BEFORE the
  // boot applyManifest: the cell pass kicks async <img> loads whose onload
  // (early for cached responses) needs the registered renderer to upload the
  // texture layer; without it the panel ramps iTextureFade but samples an
  // unwritten layer and renders transparent.
  // antialias OFF: every scene pixel goes through the EffectComposer's
  // offscreen HDR targets, so the canvas only ever receives a fullscreen
  // quad — default-framebuffer MSAA antialiases nothing yet allocates a
  // 4x multisample buffer. On high-DPR phones that pressure makes Adreno/
  // Mali drop tile memory mid-frame (whole-frame garbage flicker).
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    powerPreference: 'high-performance',
  });
  // Pixel-ratio cap for the same reason: phones report 3–3.5x, which cubes
  // the fp16 composer buffers past what their GPUs sustain. 2x matches
  // desktop retina; smoothing comes from that supersampling, not MSAA.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  registerFacadePanelRenderer(renderer);

  const layoutClient = createLayoutClient();
  const cityState = createCityState(layoutClient);
  // applyManifest + invalidateLayoutCache are cityState's (the manifest
  // pipeline); pulled out here for the City handle + reaction wiring. Components
  // don't wire into them — they rebuild reactively off cityState's signals.
  const { applyManifest, invalidateLayoutCache } = cityState;

  // picker is populated below (it's built after the components, since
  // picker.world reads their handles); components defer picker-dependent setup
  // to the first tick via armOnFirstTick, so the null + cast is safe.
  const ctx = {
    scene,
    canvas,
    cityState,
    picker: null,
  } as unknown as SceneContext;

  // Component construction order is load-bearing: gem before repoLabel (its
  // beam foot tracks the gem group); streets before buildings + pathLine
  // (their deps read streets by dir at call time).
  const gem = createGem(ctx);
  const sky = createSky(ctx);
  const island = createIsland(ctx);
  const repoLabel = createRepoLabel(ctx, { getGem: () => gem.getRootGroup() });
  const footprint = createFootprint(ctx);
  const streets = createStreets(ctx);
  const buildings = createBuildings(ctx);
  const trees = createTrees(ctx);
  const fireflies = createFireflies(ctx);
  const pathLine = createPathLine(ctx);
  // The component set, in TICK order — the only ordering that's load-bearing at
  // runtime:
  //   - sky LAST: its camera-follow must run immediately before postFx.render
  //     so the sphere's world matrix is fresh.
  //   - gem after repoLabel: gem.tick bobs gem.position.y and repoLabel's beam
  //     foot reads it, so repoLabel sees the previous frame's y (a deliberate,
  //     pre-existing 1-frame lag — don't reorder to "fix" it).
  //   - island/footprint have no tick(); harmless in the array.
  // Draw order is governed entirely by RENDER_ORDERS (three sorts the render
  // list by renderOrder, then depth, then object-creation id — never by
  // scene-graph child index), so scene.add order is free: we add in this same
  // order rather than maintain a second sequence.
  const components: SceneComponent[] = [
    fireflies,
    repoLabel,
    buildings,
    trees,
    pathLine,
    streets,
    gem,
    island,
    footprint,
    sky,
  ];
  for (const c of components) scene.add(c.group);

  // Boot apply — AFTER renderer + registerFacadePanelRenderer (the facade-panel race),
  // BEFORE the rig (so bbox is set and the rig's first frame can frame the city).
  await applyManifest(manifest);

  // cityState is threaded so the rig re-frames reactively when bbox changes and
  // reads its world-framing inputs (bbox/gem/root street/tallest building)
  // directly. deps carries only the component-geometry accessors the rig can't
  // reach via state.
  const rig = createCameraRig({
    canvas,
    cityState,
    deps: {
      getRepoLabelBounds: () => repoLabel.getPanelBounds(),
      getTreeBoundsBySha: (sha) => trees.getRenderer()?.getTreeBoundsBySha(sha) ?? null,
    },
  });
  // Snap the camera when a NEW source's city has applied (initial load or repo
  // switch). Track cityRevision (every apply), not bbox: the final manifest is a
  // reuse apply that leaves bbox frozen, so a bbox-only effect would miss it. The
  // key guard skips the empty boot (key null — no source yet) and same-source
  // re-applies (live-updates, config saves) — only a real source change reframes.
  let lastReframedSourceKey: string | null = null;
  const stopReframe = effect(() => {
    void cityState.cityRevision.value;
    const key = CURRENT_SOURCE_KEY.peek();
    if (key !== null && key !== lastReframedSourceKey) {
      lastReframedSourceKey = key;
      untracked(() => rig.reset());
    }
  });

  const postFx = createPostFx(renderer, scene, rig.camera);
  postFx.setSize(canvas.clientWidth, canvas.clientHeight);

  const picker = createPicker({
    canvas,
    camera: rig.camera,
    cityState,
    world: {
      getStreetPickables: () => streets.getPickables(),
      getRootGem: () => gem.getRootGroup(),
      getCells: () => buildings.getCells(),
      getTrees: () => trees.getRenderer(),
      getBuildingByPath: (p) => buildings.getBuildingByPath(p),
      getSidewalkByDir: (p) => streets.getSidewalkByDir(p),
      getStreetByDir: (p) => cityState.streetsByDirMap.peek()[p] ?? null,
      getBuildingIndex: () => buildings.getBuildingIndex(),
    },
  });

  // Backfill the picker BEFORE the frame loop so components arm on frame 1.
  ctx.picker = picker;

  const handlers = createInputHandlers({
    canvas,
    picker,
    rig,
    renderer,
    cityState,
    showTooltip,
    hideTooltip,
    onResize() {
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      postFx.setSize(cw, ch);
      for (const c of components) c.onResize?.(cw, ch);
      // Synchronous paint so the canvas doesn't flash blank between resize and
      // the next frame; render path matches the loop so bloom shows immediately.
      postFx.render();
    },
    onResetView: rig.reset,
  });

  // Scrub controller: built on entering Timeline mode (useTimelineMode); held here to dispose on uninstall.
  let _scrubController: ReturnType<typeof createScrubController> | null = null;

  // Reused scratch vector to avoid per-frame allocations from renderer.getSize().
  const renderSize = new THREE.Vector2();
  // Last scrub position the removed-selection prune ran at — so it fires only when
  // the scrub actually MOVES, never on a static selection.
  let _lastPrunedScrubPos = -1;
  const stopFrameLoop = startFrameLoop(components, ctx, {
    rig,
    postFx,
    before() {
      // Idempotent per-frame size guard — resyncs renderer + composer to the
      // canvas whenever they diverge (ResizeObserver miss); cheap no-op else.
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      renderer.getSize(renderSize);
      if (cw > 0 && ch > 0 && (renderSize.x !== cw || renderSize.y !== ch)) {
        renderer.setSize(cw, ch, false);
        rig.camera.aspect = cw / Math.max(1, ch);
        rig.camera.updateProjectionMatrix();
        postFx.setSize(cw, ch);
        for (const c of components) c.onResize?.(cw, ch);
      }
    },
    after() {
      // Drop a selection the scrub removed, but not mid-drag: closing the right
      // sidebar then reflows the track under the pointer and jumps the position.
      if (!TIMELINE_MODE.peek() || SCRUB_DRAGGING.peek()) return;
      const pos = SCRUB_POS.peek();
      if (pos === _lastPrunedScrubPos) return;
      _lastPrunedScrubPos = pos;
      picker.pruneScrubHiddenSelection();
    },
  });

  const timelineApi = {
    installScrubController(
      timelines: Map<string, PathTimeline>,
      commitLineRanges: RangeStat[]
    ): void {
      _scrubController?.dispose();
      _scrubController = createScrubController({
        buildings: {
          getBuildingIndex: () => buildings.getBuildingIndex(),
          applyScrub: (states) => buildings.applyScrub(states),
        },
        streets: { applyScrub: (states) => streets.applyScrub(states) },
        footprints: { applyScrub: (states) => footprint.applyScrub(states) },
        picker,
        timelines,
        commitLineRanges,
        heightCtx: makeHeightContext(cityState.manifest.peek()?.stats),
        scannedAt: cityState.manifest.peek()?.scanned_at,
        streetsByDir: cityState.streetsByDirMap.peek(),
        scrubGates: [
          { setScrubCommit: (i) => trees.setScrubCommit(i) },
          { setScrubCommit: (i) => fireflies.setScrubCommit(i) },
        ],
      });
      buildings.setScrubController(_scrubController);
    },
    uninstallScrubController(): void {
      buildings.setScrubController(null);
      _scrubController?.dispose();
      _scrubController = null;
    },
    setStreetsTransparent: (on: boolean): void => streets.setStreetsTransparent(on),
    setFootprintsTransparent: (on: boolean): void => footprint.setFootprintsTransparent(on),
  };

  // Every Timeline exit. The union city holds buildings that do not exist at
  // HEAD, so only a rebuild from the live MANIFEST is a valid live city.
  const stopTimelineTeardown = effect(() => {
    if (TIMELINE_MODE.value || !_scrubController) return;
    timelineApi.uninstallScrubController();
    const live = MANIFEST.peek() as Manifest | null;
    // Best-effort: a dispose or a newer apply can supersede this mid-flight,
    // and neither is a failure worth surfacing from a teardown.
    if (live) void applyManifest(live).catch(() => {});
  });

  return {
    scene,
    picker,
    rig,
    applyManifest,
    invalidateLayoutCache,
    /** Focus the camera on the node at `path`: resolve via the picker, dispatch
     *  to the rig. */
    focusByPath(path: string): void {
      rig.focusSelection(picker.targetForPath(path));
    },
    /** Scene-internal read/debug API — what the view layer can't get from the
     *  canonical MANIFEST signal (the live tree renderer + the two diagnostics). */
    world: {
      getTrees: () => trees.getRenderer(),
      runCollisionCheck: () => runCollisionCheck(cityState),
      runStemPlacementDiagnostic: () => runStemPlacementDiagnostic(cityState),
    },
    timeline: timelineApi,
    /** Tear the whole city down: stop the frame loop, detach input listeners,
     *  dispose the picker/rig/postFx/components (GPU geometry + their effects),
     *  the layout worker, and the renderer. Without this, a remount (or HMR)
     *  leaks the renderer + frame loop, stacking a second city on the same
     *  canvas — the old one keeps rendering as a faint ghost and its picker
     *  still answers raycasts. Order: stop the loop FIRST so nothing ticks or
     *  renders mid-teardown; renderer LAST. */
    dispose(): void {
      stopFrameLoop();
      stopReframe();
      stopTimelineTeardown();
      _scrubController?.dispose();
      handlers.dispose();
      picker.dispose();
      rig.dispose();
      postFx.dispose();
      for (const c of components) c.dispose();
      layoutClient.dispose();
      // dispose() frees GPU resources but leaves the WebGL context alive;
      // forceContextLoss() actually releases it. Without this, every teardown
      // (HMR reload, project switch) leaks a context until Chrome hits its
      // per-page cap (~16) and blocks new ones ("context loss ... blocked").
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
