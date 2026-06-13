// city/index.ts — the city composer. createCity(canvas, manifest) folds the
// scene/component construction (formerly world.ts) and the rendering pipeline
// (formerly renderLoop.ts) into one async factory, then drives the frame loop
// via startFrameLoop. Returns the handle App.tsx / useCityScene consume.

import * as THREE from 'three';

import type { Manifest } from '@/types';

import { SCENE } from '@/state/stores/settings/scene';
import { registerShaderChunks } from './utils/shaders/registerShaderChunks';
import { createBuildings } from './components/buildings';
import { findLayoutOverlaps, layoutCityWithTrace } from './layout/algorithm';
import { createLayoutClient } from './layout';
import { createApplyManifest } from './state/applyManifest';
import { createCityState } from './state';
import { _formatCollisionReport, _formatStemDiagnostic } from './diagnostics';
import { createGem } from './components/gem';
import { createSky } from './components/sky';
import { createIsland } from './components/island';
import { createRepoLabel } from './components/repoLabel';
import { createFootprint } from './components/footprint';
import { createStreets } from './components/streets';
import { createTrees } from './components/trees';
import { createFireflies } from './components/fireflies';
import { createPathLine } from './components/pathLine';
import { createTreePlacementClient } from './components/trees/treePlacementClient';
import type { City, SceneComponent, SceneContext } from './types';
import { createCameraRig } from './render/cameraRig';
import { createPicker } from './interaction/picker';
import { createInputHandlers } from './interaction/inputHandlers';
import { showTooltip, hideTooltip } from './interaction/tooltip';
import { createPostFx } from './render/postFx';
import { startFrameLoop } from './render/frameLoop';
import { registerRenderer as registerAdPanelRenderer } from './components/buildings/adPanelTextureArray';

export async function createCity(canvas: HTMLCanvasElement, manifest: Manifest): Promise<City> {
  // Must precede any ShaderMaterial so #include <chunk> directives resolve.
  registerShaderChunks();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SCENE.value.SKY_COLOR);
  const cityState = createCityState();

  // picker/camera/renderer are populated below before the first frame; the
  // gem (and other components) read them only in tick(), so the cast is safe.
  const ctx = {
    scene,
    cityState,
    picker: null,
    camera: null,
    renderer: null,
  } as unknown as SceneContext;

  // Renderer FIRST + register it with the ad-panel texture array BEFORE the
  // boot applyManifest: the cell pass kicks async <img> loads whose onload
  // (early for cached responses) needs the registered renderer to upload the
  // texture layer; without it the panel ramps iTextureFade but samples an
  // unwritten layer and renders transparent.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  registerAdPanelRenderer(renderer);

  // Component construction order is load-bearing: gem before repoLabel (its
  // beam foot tracks the gem group); streets before buildings + pathLine
  // (their deps read streets by dir at call time).
  const gem = createGem(ctx);
  const sky = createSky(ctx);
  const island = createIsland(ctx);
  const repoLabel = createRepoLabel(ctx, { getGem: () => gem.gem });
  const treePlacementClient = createTreePlacementClient();
  const footprint = createFootprint(ctx);
  const streets = createStreets(ctx);
  const buildings = createBuildings(ctx, { getStreetByDir: (p) => streets.getStreetByDir(p) });
  const trees = createTrees(ctx);
  const fireflies = createFireflies(ctx);
  const pathLine = createPathLine(ctx, {
    // .peek() not .value: invoked from inside the renderer's selection/hover
    // effects; a tracking read would subscribe those to gemWorldPos. The
    // renderer's dedicated rebuild effect tracks gemWorldPos directly.
    getGemWorldPos: () => cityState.gemWorldPos.peek(),
    getStreetsByDirMap: () => streets.streetsByDirMap(),
  });
  const layoutClient = createLayoutClient();

  const { applyManifest, invalidateLayoutCache } = createApplyManifest({
    components: {
      gem,
      sky,
      island,
      repoLabel,
      footprint,
      streets,
      buildings,
      trees,
      fireflies,
      pathLine,
    },
    scene,
    layoutClient,
    treePlacementClient,
    cityState,
  });

  function runCollisionCheck(): void {
    const layout = cityState.layout.value;
    if (!layout) {
      console.warn('[collision] no layout — apply a manifest first');
      return;
    }
    const overlaps = findLayoutOverlaps(layout);
    const totalRects = layout.streets.length + layout.buildings.length;
    const report = _formatCollisionReport(overlaps, totalRects);
    if (report.level === 'info') {
      console.info(report.summary);
    } else {
      console.warn(report.summary);
      for (const line of report.details) {
        console.warn(line);
      }
    }
  }

  function runStemPlacementDiagnostic(): void {
    const m = cityState.manifest.value;
    if (!m) {
      console.warn('[stem-diag] no manifest — apply one first');
      return;
    }
    const { trace } = layoutCityWithTrace(
      m as unknown as Parameters<typeof layoutCityWithTrace>[0]
    );
    for (const line of _formatStemDiagnostic(trace)) {
      console.log(line);
    }
  }

  // Boot apply — AFTER renderer + registerAdPanelRenderer (the ad-panel race),
  // BEFORE the rig (so bbox is set and the rig's first frame can frame the city).
  await applyManifest(manifest);

  // cityState is threaded so the rig re-frames reactively when bbox changes.
  const rig = createCameraRig({
    canvas,
    cityState,
    deps: {
      getBbox: () => cityState.bbox.value,
      getGemWorldPos: () => cityState.gemWorldPos.value,
      getRootStreet: () => cityState.rootStreet.value,
      getTallestBuilding: () => buildings.tallest(),
      getRepoLabelBounds: () => repoLabel.getPanelBounds(),
      getTreeBoundsBySha: (sha) => trees.handle()?.getTreeBoundsBySha(sha) ?? null,
    },
  });
  const camera = rig.camera;
  // Exposed for visual regression tests (tests/visual/setup.ts).
  (window as Window & { __rig?: typeof rig }).__rig = rig;
  const resetView = rig.reset;

  const postFx = createPostFx(renderer, scene, camera);
  postFx.setSize(canvas.clientWidth, canvas.clientHeight);

  const picker = createPicker({
    canvas,
    camera,
    cityState,
    world: {
      getStreetPickables: () => streets.pickables(),
      getRootGem: () => gem.gem,
      getCells: () => buildings.getCells(),
      getTrees: () => trees.handle(),
      getBuildingByPath: (p) => buildings.getByPath(p),
      getSidewalkByDir: (p) => streets.getSidewalkByDir(p),
      getStreetByDir: (p) => streets.getStreetByDir(p),
      getBuildingIndex: () => buildings.getBuildingIndex(),
    },
  });

  // Populate ctx BEFORE the frame loop so components' tick() sees a live
  // picker/camera/renderer on frame 1.
  ctx.picker = picker;
  ctx.camera = camera;
  ctx.renderer = renderer;

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
      buildings.onResize();
      trees.onResize();
      pathLine.onResize();
      fireflies.onResize(cw, ch);
      // Synchronous paint so the canvas doesn't flash blank between resize and
      // the next frame; render path matches the loop so bloom shows immediately.
      postFx.render();
    },
    onResetView: resetView,
    getRootName: () => cityState.manifest.value?.tree?.name ?? null,
  });

  function applyTheme(): void {
    scene.background = new THREE.Color(SCENE.value.SKY_COLOR);
    postFx.refresh();
    // Null until the first manifest with media files applies.
    buildings.getAdPanels()?.refresh();
  }

  // Tick order (sky LAST — its camera-follow must run immediately before
  // postFx.render so the sphere's world matrix is fresh). island/footprint
  // have no tick(); harmless in the array.
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
  // scene.add in CONSTRUCTION order (not tick order) to preserve draw sort.
  scene.add(gem.group);
  scene.add(sky.group);
  scene.add(island.group);
  scene.add(repoLabel.group);
  scene.add(footprint.group);
  scene.add(streets.group);
  scene.add(buildings.group);
  scene.add(trees.group);
  scene.add(fireflies.group);
  scene.add(pathLine.group);

  // Reused scratch vector to avoid per-frame allocations from renderer.getSize().
  const renderSize = new THREE.Vector2();
  startFrameLoop(components, ctx, {
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
        camera.aspect = cw / Math.max(1, ch);
        camera.updateProjectionMatrix();
        postFx.setSize(cw, ch);
        buildings.onResize();
        trees.onResize();
        pathLine.onResize();
        fireflies.onResize(cw, ch);
      }
    },
  });

  return {
    scene,
    picker,
    rig,
    resetView,
    applyTheme,
    applyManifest,
    invalidateLayoutCache,
    /** Focus the camera on the node at `path`: resolve via the picker, dispatch
     *  to the rig. */
    focusByPath(path: string): void {
      rig.focusSelection(picker.targetForPath(path));
    },
    /** View/debug read API — the only world surface consumers still touch. */
    world: {
      getRoot: () => cityState.manifest.value?.tree ?? null,
      getManifest: () => cityState.manifest.value,
      getTrees: () => trees.handle(),
      getStreetByDir: (p: string) => streets.getStreetByDir(p),
      runCollisionCheck,
      runStemPlacementDiagnostic,
    },
  };
}
