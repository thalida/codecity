// city/index.ts — the city composer. createCityScene(canvas, manifest) folds the
// scene and component construction and the rendering pipeline into one async
// factory, then drives the frame loop via startFrameLoop. Returns the handle
// App.tsx / the City component consume.

import * as THREE from 'three';
import { effect, signal, untracked } from '@preact/signals';

import type { RangeStat } from '@/types';

import { until } from '@/utils/until';
import { registerShaderChunks } from './utils/shaders/registerShaderChunks';
import { createBuildings } from './components/buildings';
import { makeHeightContext } from './layout/dimensions';
import { createScrubController } from './timeline/scrubController';
import type { PathTimeline } from './timeline/replay';
import { createLayoutClient } from './layout';
import { createTreePlacementClient } from './components/trees/treePlacementClient';
import { createCitySceneState } from './state';
import {
  runCollisionCheck,
  runStemPlacementDiagnostic,
  runTreeGroundingDiagnostic,
} from './diagnostics';
import { createGem } from './components/gem';
import { createSky } from './components/sky';
import { createIsland, ISLAND_TOP_Y } from './components/island';
import { createRepoLabel } from './components/repoLabel';
import { repoLabelBounds } from './components/repoLabel/bounds';
import { REPO_LABEL } from '@/state/settings/fields/gem';
import { BUILDING_DIMENSIONS } from '@/state/settings/fields/buildings';
import { createFootprint } from './components/footprint';
import { createStreets } from './components/streets';
import { createTrees } from './components/trees';
import { createFireflies } from './components/fireflies';
import { createPathLine } from './components/pathLine';
import type { CityScene, CityBindings, SceneComponent, SceneContext } from './types';
import { createCameraRig, CameraMode } from './render/cameraRig';
import { createPicker } from './interaction/picker';
import { createInputHandlers } from './interaction/inputHandlers';
import { showTooltip, hideTooltip } from './interaction/tooltip';
import { createPostFx } from './render/postFx';
import { startFrameLoop } from './render/frameLoop';
import { registerRenderer as registerFacadePanelRenderer } from './components/buildings/facadePanelTextureArray';

export async function createCityScene(
  canvas: HTMLCanvasElement,
  { cameraMode = CameraMode.Project, report, subjectKey, timeline }: CityBindings
): Promise<CityScene> {
  // Must precede any ShaderMaterial so #include <chunk> directives resolve.
  registerShaderChunks();

  const scene = new THREE.Scene();

  // Renderer FIRST, registered pre-apply (cached <img> onloads need it).
  // antialias OFF: with the composer, canvas MSAA does nothing yet costs 4x.
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    powerPreference: 'high-performance',
  });
  // Cap at 2x (desktop-retina parity): phone 3–3.5x DPRs cube the fp16
  // composer buffers past what their GPUs sustain.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  registerFacadePanelRenderer(renderer);

  const layoutClient = createLayoutClient();
  // Both off-thread build workers, owned here and handed to the store that runs
  // the build. Lazy: neither spawns until its first compute().
  const treePlacementClient = createTreePlacementClient();
  const sceneState = createCitySceneState(layoutClient, treePlacementClient, report);
  // Pulled off sceneState for the City handle; components never wire into
  // these — they rebuild reactively off sceneState's signals.
  const { applyManifest, buildStagesFor, invalidateLayoutCache } = sceneState;

  // picker is backfilled below (built after the components it reads);
  // armOnFirstTick defers picker-dependent setup, so the null cast is safe.
  const ctx = {
    scene,
    canvas,
    sceneState,
    timeline: timeline ?? null,
    picker: null,
  } as unknown as SceneContext;

  // Construction order is load-bearing: gem before repoLabel, streets
  // before buildings + pathLine (deps read at call time).
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
  // TICK order (draw order is RENDER_ORDERS' job): sky LAST; gem after
  // repoLabel — the beam foot reads last frame's bob ON PURPOSE.
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

  // No boot apply: a scene with no manifest is a real state, so the components
  // start empty and the first applyManifest is the first city there has been.

  // The rig reads its framing inputs from sceneState directly; deps carries
  // only component-geometry accessors state can't reach.
  const rig = createCameraRig({
    canvas,
    sceneState,
    mode: cameraMode,
    deps: {
      // From the manifest + settings, never the label's meshes: those land on
      // the first tick, and framing that waits frames a different city (#62).
      getRepoLabelBounds: () =>
        repoLabelBounds(
          sceneState.manifest.peek()?.tree?.name,
          sceneState.gemWorldPos.peek(),
          REPO_LABEL.peek(),
          BUILDING_DIMENSIONS.peek()
        ),
      getTreeBoundsBySha: (sha) => trees.getRenderer()?.getTreeBoundsBySha(sha) ?? null,
    },
  });
  // Reframe only on a real subject change. cityRevision bumps after the apply's
  // batch flushed, so the camera is aimed at a built city, not half of one.
  let framedSubject: string | null = null;
  const stopReframe = effect(() => {
    void sceneState.cityRevision.value;
    const subject = subjectKey();
    if (subject === null || subject === framedSubject) return;
    // No city yet: claiming the subject here would make the first real one,
    // which is what there is to frame, skip its reframe.
    if (sceneState.manifest.peek() === null) return;
    framedSubject = subject;
    untracked(() => rig.reset());
  });

  // On screen means presented, not applyStructure returning (render/LOADING.md).
  // Holds the revision whose frame the compositor has actually shown.
  const presented = signal(-1);
  const gone = signal(false);
  const stopOnScreen = effect(() => {
    const revision = sceneState.cityRevision.value;
    if (sceneState.manifest.peek() === null) return;
    untracked(() => {
      void buildings.whenSettled().then(() => {
        // Two frames: render() only issues the GL commands, and the pixels land
        // a compositor pass later.
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            // max, not assign: a superseded build's frame can land after a
            // newer one's, and the newer one is what is on screen.
            presented.value = Math.max(presented.peek(), revision);
            report.markIdle();
          })
        );
      });
    });
  });

  /** Resolves once a frame carrying the latest build has been presented, or at
   *  once when one has. A disposed city never presents again, so that frees it. */
  function whenOnScreen(): Promise<void> {
    return until(() => gone.value || presented.value >= sceneState.cityRevision.value);
  }

  const postFx = createPostFx(renderer, scene, rig.camera);
  postFx.setSize(canvas.clientWidth, canvas.clientHeight);

  const picker = createPicker({
    canvas,
    camera: rig.camera,
    sceneState,
    timeline: timeline?.store ?? null,
    world: {
      getStreetPickables: () => streets.getPickables(),
      getRootGem: () => gem.getRootGroup(),
      getCells: () => buildings.getCells(),
      getTrees: () => trees.getRenderer(),
      getBuildingByPath: (p) => buildings.getBuildingByPath(p),
      getSidewalkByDir: (p) => streets.getSidewalkByDir(p),
      getStreetByDir: (p) => sceneState.streetsByDirMap.peek()[p] ?? null,
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
    sceneState,
    timeline: timeline?.store ?? null,
    showTooltip,
    hideTooltip,
    onResize() {
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      // ResizeObserver fires on fractional layout jitter; a no-op "resize"
      // reallocates targets mid-frame, garbage on some mobile drivers.
      if (cw === _lastResizeW && ch === _lastResizeH) return;
      _lastResizeW = cw;
      _lastResizeH = ch;
      postFx.setSize(cw, ch);
      for (const c of components) c.onResize?.(cw, ch);
      // Synchronous paint so the canvas doesn't flash blank between resize and
      // the next frame; render path matches the loop so bloom shows immediately.
      postFx.render();
    },
    onResetView: rig.reset,
  });

  // Scrub controller: built on entering Timeline mode; held here to dispose on uninstall.
  let _scrubController: ReturnType<typeof createScrubController> | null = null;

  // Reused scratch vector to avoid per-frame allocations from renderer.getSize().
  const renderSize = new THREE.Vector2();
  // Last size the resize handler acted on — its no-op jitter guard.
  let _lastResizeW = 0;
  let _lastResizeH = 0;
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
      if (!timeline?.store.mode.peek() || timeline.store.dragging.peek()) return;
      const pos = timeline.store.scrubPos.peek();
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
      // Nothing scrubs this city, so there is no position to gate it on: a
      // scrubber handed to one is a caller pointing at the wrong instance.
      if (!timeline) return;
      _scrubController?.dispose();
      _scrubController = createScrubController({
        timeline: timeline.store,
        buildings: {
          getBuildingIndex: () => buildings.getBuildingIndex(),
          applyScrub: (states) => buildings.applyScrub(states),
        },
        streets: { applyScrub: (states) => streets.applyScrub(states) },
        footprints: { applyScrub: (states) => footprint.applyScrub(states) },
        picker,
        timelines,
        commitLineRanges,
        heightCtx: makeHeightContext(sceneState.manifest.peek()?.stats),
        scannedAt: sceneState.manifest.peek()?.scanned_at,
        streetsByDir: sceneState.streetsByDirMap.peek(),
        scrubGates: [
          {
            setScrubCommit: (i) => trees.setScrubCommit(i),
            setScrubNow: (ms) => trees.setScrubNow(ms),
          },
          {
            setScrubCommit: (i) => fireflies.setScrubCommit(i),
            setScrubNow: (ms) => fireflies.setScrubNow(ms),
          },
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
  // HEAD, so only a rebuild from the live manifest is a valid live city.
  const stopTimelineTeardown = timeline
    ? effect(() => {
        if (timeline.store.mode.value || !_scrubController) return;
        timelineApi.uninstallScrubController();
        const live = timeline.liveManifest();
        // Best-effort: a dispose or a newer apply can supersede this mid-flight,
        // and neither is a failure worth surfacing from a teardown.
        if (live) void applyManifest(live).catch(() => {});
      })
    : () => {};

  /** Re-pack what is already on screen: the settings path. A union city under
   *  a scrubber was not built from one manifest, so it reassembles instead. */
  async function repack(): Promise<void> {
    if (timeline?.store.mode.peek()) return timeline.reassemble();
    const showing = sceneState.manifest.peek();
    if (showing) await applyManifest(showing);
  }

  return {
    manifest: sceneState.manifest,
    whenOnScreen,
    repack,
    scene,
    picker,
    rig,
    applyManifest,
    buildStagesFor,
    invalidateLayoutCache,
    /** Scene-internal read/debug API — what the view layer can't get from the
     *  canonical MANIFEST signal (the live tree renderer + the two diagnostics). */
    world: {
      getTrees: () => trees.getRenderer(),
      runCollisionCheck: () => runCollisionCheck(sceneState),
      runStemPlacementDiagnostic: () => runStemPlacementDiagnostic(sceneState),
      runTreeGroundingDiagnostic: () =>
        runTreeGroundingDiagnostic(trees.getRenderer()?.group ?? null, ISLAND_TOP_Y),
    },
    timeline: timelineApi,
    /** Full teardown, loop FIRST, renderer LAST — else a remount stacks a
     *  ghost city whose picker still answers raycasts. */
    dispose(): void {
      // Nothing more will be presented, so anything waiting for a frame is
      // waiting for one that is not coming.
      gone.value = true;
      stopFrameLoop();
      stopReframe();
      stopOnScreen();
      stopTimelineTeardown();
      _scrubController?.dispose();
      handlers.dispose();
      picker.dispose();
      rig.dispose();
      postFx.dispose();
      for (const c of components) c.dispose();
      layoutClient.dispose();
      treePlacementClient.dispose();
      // dispose() leaves the WebGL context alive; without forceContextLoss()
      // every teardown leaks one until Chrome's ~16-per-page cap blocks new.
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
