// city/index.ts — the city composer. createCity(canvas, manifest) folds the
// scene and component construction and the rendering pipeline into one async
// factory, then drives the frame loop via startFrameLoop. Returns the handle
// App.tsx / the City component consume.

import * as THREE from 'three';
import { effect, untracked } from '@preact/signals';

import type { Manifest, RangeStat } from '@/types';
import { CURRENT_SOURCE_KEY } from '@/state/stores/source';
import { URL_PARAMS } from '@/constants/urlParams';
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
import { createPostFx, createDirectFx } from './render/postFx';
import { startFrameLoop } from './render/frameLoop';
import { registerRenderer as registerFacadePanelRenderer } from './components/buildings/facadePanelTextureArray';
import { debugLog } from '@/utils/deviceDebugLog';

export async function createCity(canvas: HTMLCanvasElement, manifest: Manifest): Promise<City> {
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
  // buffers past what their GPUs sustain. ?dpr=<n> overrides (diagnostic).
  const dprOverride = Number(
    new URLSearchParams(window.location.search).get(URL_PARAMS.DPR) ?? NaN
  );
  const pixelRatio =
    Number.isFinite(dprOverride) && dprOverride > 0
      ? dprOverride
      : Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  registerFacadePanelRenderer(renderer);

  // Dev-only telemetry: GPU identity + context-loss events. Feature-guarded
  // because the test harness's mocked context has no getExtension.
  const _gl = renderer.getContext();
  if (typeof _gl.getExtension === 'function') {
    const _dbgExt = _gl.getExtension('WEBGL_debug_renderer_info');
    const _gpu = _dbgExt
      ? String(_gl.getParameter(_dbgExt.UNMASKED_RENDERER_WEBGL))
      : String(_gl.getParameter(_gl.RENDERER));
    debugLog('gl', {
      gpu: _gpu,
      pixelRatio,
      drawingBuffer: `${_gl.drawingBufferWidth}x${_gl.drawingBufferHeight}`,
    });
  }
  canvas.addEventListener?.('webglcontextlost', () => debugLog('context-lost'));
  canvas.addEventListener?.('webglcontextrestored', () => debugLog('context-restored'));

  const layoutClient = createLayoutClient();
  const cityState = createCityState(layoutClient);
  // Pulled off cityState for the City handle; components never wire into
  // these — they rebuild reactively off cityState's signals.
  const { applyManifest, invalidateLayoutCache } = cityState;

  // picker is backfilled below (built after the components it reads);
  // armOnFirstTick defers picker-dependent setup, so the null cast is safe.
  const ctx = {
    scene,
    canvas,
    cityState,
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

  // ?hide=<name,...> — diagnostic: blank listed components (groups stay in the
  // scene and tick; they just don't render). Names match this map.
  const componentsByName: Record<string, SceneComponent> = {
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
  };
  const hideList = (new URLSearchParams(window.location.search).get(URL_PARAMS.HIDE) ?? '')
    .split(',')
    .filter(Boolean);
  for (const name of hideList) {
    const target = componentsByName[name];
    if (target) target.group.visible = false;
  }
  if (hideList.length) debugLog('hide', { hidden: hideList.join(',') });

  // Boot apply — AFTER renderer + registerFacadePanelRenderer (the facade-panel race),
  // BEFORE the rig (so bbox is set and the rig's first frame can frame the city).
  await applyManifest(manifest);

  // The rig reads its framing inputs from cityState directly; deps carries
  // only component-geometry accessors state can't reach.
  const rig = createCameraRig({
    canvas,
    cityState,
    deps: {
      getRepoLabelBounds: () => repoLabel.getPanelBounds(),
      getTreeBoundsBySha: (sha) => trees.getRenderer()?.getTreeBoundsBySha(sha) ?? null,
    },
  });
  // Reframe only on a real source change. Tracks cityRevision, not bbox —
  // the final manifest is a reuse apply that leaves bbox frozen.
  let lastReframedSourceKey: string | null = null;
  const stopReframe = effect(() => {
    void cityState.cityRevision.value;
    const key = CURRENT_SOURCE_KEY.peek();
    if (key !== null && key !== lastReframedSourceKey) {
      lastReframedSourceKey = key;
      untracked(() => rig.reset());
    }
  });

  // ?fx=off|ldr — diagnostic pipeline overrides (see constants/urlParams.ts).
  const fxMode = new URLSearchParams(window.location.search).get(URL_PARAMS.FX);
  debugLog('fx-mode', { mode: fxMode ?? 'hdr' });
  const postFx =
    fxMode === 'off'
      ? createDirectFx(renderer, scene, rig.camera)
      : createPostFx(renderer, scene, rig.camera, { ldr: fxMode === 'ldr' });
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
      // ResizeObserver fires on fractional layout jitter; a no-op "resize"
      // reallocates targets mid-frame, garbage on some mobile drivers.
      if (cw === _lastResizeW && ch === _lastResizeH) return;
      _lastResizeW = cw;
      _lastResizeH = ch;
      debugLog('resize', { cw, ch });
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
  // Telemetry scratch: previous frame's camera position, for jump detection.
  const _prevCamPos = new THREE.Vector3();
  let _prevCamPosValid = false;
  // Last size the resize handler acted on — its no-op jitter guard.
  let _lastResizeW = 0;
  let _lastResizeH = 0;
  // Last scrub position the removed-selection prune ran at — so it fires only when
  // the scrub actually MOVES, never on a static selection.
  let _lastPrunedScrubPos = -1;
  const stopFrameLoop = startFrameLoop(components, ctx, {
    rig,
    postFx,
    before(f) {
      // Telemetry: frame stalls + single-frame camera teleports, the two
      // frame-level anomalies that would explain transient corruption.
      if (f.dt > 0.25) debugLog('dt-spike', { ms: Math.round(f.dt * 1000) });
      if (_prevCamPosValid && rig.camera.position.distanceTo(_prevCamPos) > 200) {
        debugLog('camera-jump', {
          from: _prevCamPos.toArray().map((v) => Math.round(v)),
          to: rig.camera.position.toArray().map((v) => Math.round(v)),
        });
      }
      _prevCamPos.copy(rig.camera.position);
      _prevCamPosValid = true;
      // Idempotent per-frame size guard — resyncs renderer + composer to the
      // canvas whenever they diverge (ResizeObserver miss); cheap no-op else.
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      renderer.getSize(renderSize);
      if (cw > 0 && ch > 0 && (renderSize.x !== cw || renderSize.y !== ch)) {
        debugLog('size-resync', { cw, ch, was: `${renderSize.x}x${renderSize.y}` });
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
    /** Full teardown, loop FIRST, renderer LAST — else a remount stacks a
     *  ghost city whose picker still answers raycasts. */
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
      // dispose() leaves the WebGL context alive; without forceContextLoss()
      // every teardown leaks one until Chrome's ~16-per-page cap blocks new.
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
