// city/index.ts — the city composer. createCity(canvas, manifest) folds the
// scene and component construction and the rendering pipeline into one async
// factory, then drives the frame loop via startFrameLoop. Returns the handle
// App.tsx / the City component consume.

import * as THREE from 'three';

import { registerShaderChunks } from './utils/shaders/registerShaderChunks';
import { createBuildings } from './components/buildings';
import { makeHeightContext } from './layout/dimensions';
import { createScrubController } from './timeline/scrubController';
import type { PathTimeline } from './timeline/replay';
import { createLayoutClient } from './layout';
import { createTreePlacementClient } from './components/trees/treePlacementClient';
import { createCityState } from './state';
import { createCityResources } from './resources';
import { createSettingsStore } from './settings/store';
import { createEmitter } from './events';
import { createClient } from './client';
import { createSourceLoader } from './loadSource';
import { createTimelineState } from './timeline/state';
import type { CitySettingsPatch } from './settings';
import { layoutConfigFrom } from './layout/config';
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
import { createFootprint } from './components/footprint';
import { createStreets } from './components/streets';
import { createTrees } from './components/trees';
import { createFireflies } from './components/fireflies';
import { createPathLine } from './components/pathLine';
import type { City, FocusRef, SceneComponent, SceneContext } from './types';
import { createCameraRig, type FocusMode } from './render/cameraRig';
import { createPicker } from './interaction/picker';
import { createInputHandlers } from './interaction/inputHandlers';
import { createPostFx } from './render/postFx';
import { startFrameLoop } from './render/frameLoop';
import type { Manifest, RangeStat } from '@/city/types/manifest';

export async function createCity(
  canvas: HTMLCanvasElement,
  {
    settings: initialSettings,
    baseUrl = '/api',
    keyboard = true,
  }: {
    settings?: CitySettingsPatch;
    baseUrl?: string;
    /** The city's own shortcuts (Esc, R, focus). `false` turns them off; a
     *  predicate is asked per keystroke, which is how a consumer with a modal
     *  open keeps the keyboard while it is. */
    keyboard?: boolean | (() => boolean);
  } = {}
): Promise<City> {
  // Before anything that reads a setting: the material, the state pipeline and
  // every component resolve their values off this one instance's store.
  const settings = createSettingsStore(initialSettings);
  // This city's own subscribers. A second city on the page emits to its own,
  // so its build cannot move the overlay above the one being read.
  const events = createEmitter();
  // Same-origin only, and a path rather than an origin: a city fetches from the
  // server that served the page it is on.
  const client = createClient({ baseUrl });
  // The history this city is showing. Per instance, so two cities scrub their
  // own repos and neither drags the other's position.
  const timeline = createTimelineState();

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
  // Every GPU handle this city owns alone; registers the renderer for
  // facade-panel uploads (cached <img> onloads can race construction).
  const resources = createCityResources(renderer, settings);

  const layoutClient = createLayoutClient();
  // Both off-thread build workers, owned here and handed to the store that runs
  // the build. Lazy: neither spawns until its first compute().
  const treePlacementClient = createTreePlacementClient();
  const cityState = createCityState(layoutClient, treePlacementClient, resources, settings, events);
  // Pulled off cityState for the City handle; components never wire into
  // these — they rebuild reactively off cityState's signals.
  const { applyManifest: _applyManifest, buildStagesFor, invalidateLayoutCache } = cityState;

  // The last manifest applied at HEAD. Held because leaving Timeline has to
  // rebuild from it, and the union city on screen is not it.
  let liveManifest: Manifest | null = null;

  /** applyManifest, with a failure reported to this city's subscribers rather
   *  than left for every caller to catch and route somewhere. */
  async function applyManifest(...args: Parameters<typeof _applyManifest>): Promise<void> {
    try {
      await _applyManifest(...args);
      if (!timeline.mode) liveManifest = args[0];
    } catch (err) {
      events.emit('build:error', { error: err });
      throw err;
    }
  }

  // Fetches this city's own repo and applies what comes back. Declared after
  // applyManifest so the stream reaches the error reporting too.
  const sourceLoader = createSourceLoader({ client, events, applyManifest });

  // picker is backfilled below (built after the components it reads);
  // armOnFirstTick defers picker-dependent setup, so the null cast is safe.
  const ctx = {
    scene,
    canvas,
    cityState,
    resources,
    settings,
    timeline,
    client,
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

  // The rig reads its framing inputs from cityState directly; deps carries
  // only component-geometry accessors state can't reach.
  const rig = createCameraRig({
    canvas,
    cityState,
    settings,
    deps: {
      // From the manifest + settings, never the label's meshes: those land on
      // the first tick, and framing that waits frames a different city (#62).
      getRepoLabelBounds: () =>
        repoLabelBounds(
          cityState.manifest?.tree?.name,
          cityState.gemWorldPos,
          settings.REPO_LABEL,
          settings.BUILDING_DIMENSIONS
        ),
      getTreeBoundsBySha: (sha) => trees.getRenderer()?.getTreeBoundsBySha(sha) ?? null,
    },
  });
  // Reframe only on a real source change — this city's own, not the page's.
  // cityRevision bumps after the apply's batch flushed, so the camera is aimed
  // at a built city, not half of one.
  let lastReframedSourceKey: string | null = null;
  const stopReframe = cityState.on('published', () => {
    const key = sourceLoader.key();
    if (key === null || key === lastReframedSourceKey) return;
    // No city yet: claiming the key here would make the first real one, which
    // is what there is to frame, skip its reframe.
    if (cityState.manifest === null) return;
    lastReframedSourceKey = key;
    rig.reset();
  });

  // The build is over when the city is ON SCREEN, not when applyStructure
  // returns: it starts the rebuilds without holding them (see render/LOADING.md).
  const stopOnScreen = cityState.on('published', () => {
    if (cityState.manifest === null) return;
    void buildings.whenSettled().then(() => {
      // Two frames: render() only issues the GL commands, and the pixels land
      // a compositor pass later.
      requestAnimationFrame(() => requestAnimationFrame(() => events.emit('build:done', {})));
    });
  });

  const postFx = createPostFx(renderer, scene, rig.camera, settings);
  postFx.setSize(canvas.clientWidth, canvas.clientHeight);

  const picker = createPicker({
    canvas,
    camera: rig.camera,
    cityState,
    events,
    timeline,
    world: {
      getStreetPickables: () => streets.getPickables(),
      getRootGem: () => gem.getRootGroup(),
      getCells: () => buildings.getCells(),
      getTrees: () => trees.getRenderer(),
      getBuildingByPath: (p) => buildings.getBuildingByPath(p),
      getSidewalkByDir: (p) => streets.getSidewalkByDir(p),
      getStreetByDir: (p) => cityState.streetsByDirMap[p] ?? null,
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
    events,
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
    keyboardEnabled: typeof keyboard === 'function' ? keyboard : () => keyboard,
    onFocusSelection() {
      // Reported, not acted on beyond the camera: a keystroke inside the canvas
      // is "look at it", and what the chrome around it should do about that
      // belongs to whoever drew the chrome.
      if (focus(null)) events.emit('focus', { target: picker.selection });
    },
  });

  // Scrub controller: built on entering Timeline mode (useTimelineMode); held here to dispose on uninstall.
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
      if (!timeline.mode || timeline.dragging) return;
      const pos = timeline.pos;
      if (pos === _lastPrunedScrubPos) return;
      _lastPrunedScrubPos = pos;
      picker.pruneScrubHiddenSelection();
    },
  });

  const timelineApi = {
    ...timeline,
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
        heightCtx: makeHeightContext(cityState.manifest?.stats),
        scannedAt: cityState.manifest?.scanned_at,
        streetsByDir: cityState.streetsByDirMap,
        settings,
        timeline,
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
  // HEAD, so only a rebuild from this city's own live manifest is a valid live
  // city — the app's would be a different repo on the landing.
  const stopTimelineTeardown = timeline.on('mode', () => {
    if (timeline.mode || !_scrubController) return;
    timelineApi.uninstallScrubController();
    const live = liveManifest;
    // Best-effort: a dispose or a newer apply can supersede this mid-flight,
    // and neither is a failure worth surfacing from a teardown.
    if (live) void applyManifest(live).catch(() => {});
  });

  /** Select what `ref` names and aim the camera at it: the one place a ref
   *  becomes a focus. Null means "whatever is already selected". False when
   *  there is nothing to look at, so a caller's chrome can stay put. */
  function focus(ref: FocusRef, mode?: FocusMode): boolean {
    const sel =
      ref === null
        ? picker.selection
        : 'sha' in ref
          ? picker.selectByCommit(ref.sha)
          : picker.selectByPath(ref.path);
    if (!sel) return false;
    rig.focusSelection(sel, mode);
    return true;
  }

  return {
    scene,
    picker,
    rig,
    focus,
    /** The escape hatch, documented rather than discovered: a consumer doing
     *  something this API has no opinion about gets the raw renderer. Nothing
     *  in here promises to keep working if you write to it. */
    three: { scene, renderer, camera: rig.camera },
    on: events.on,
    client,
    loadSource: sourceLoader.load,
    cancelLoad: sourceLoader.cancel,
    settings,
    updateSettings: settings.update,
    applyManifest,
    buildStagesFor,
    invalidateLayoutCache,
    /** Scene-internal read/debug API — what the view layer can't get from the
     *  canonical MANIFEST signal (the live tree renderer + the two diagnostics). */
    world: {
      getTrees: () => trees.getRenderer(),
      runCollisionCheck: () => runCollisionCheck(cityState),
      runStemPlacementDiagnostic: () =>
        runStemPlacementDiagnostic(cityState, layoutConfigFrom(settings)),
      runTreeGroundingDiagnostic: () =>
        runTreeGroundingDiagnostic(trees.getRenderer()?.group ?? null, ISLAND_TOP_Y),
    },
    timeline: timelineApi,
    /** Full teardown, loop FIRST, renderer LAST — else a remount stacks a
     *  ghost city whose picker still answers raycasts. */
    dispose(): void {
      // Listeners first: nothing below may call back into a view that is on its
      // way out, and a torn-down city has nothing left worth reporting.
      events.clear();
      sourceLoader.dispose();
      timeline.dispose();
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
      resources.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
