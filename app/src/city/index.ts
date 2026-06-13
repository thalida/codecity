// city/index.ts — the city composer. createCity(canvas, manifest) folds the
// scene/component construction (formerly world.ts) and the rendering pipeline
// (formerly renderLoop.ts) into one async factory, then drives the frame loop
// via startFrameLoop. Returns the handle App.tsx / useCityScene consume.

import * as THREE from 'three';

import type { Manifest } from '@/types';

import { registerShaderChunks } from './utils/shaders/registerShaderChunks';
import { createBuildings } from './components/buildings';
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
import { registerRenderer as registerAdPanelRenderer } from './components/buildings/adPanelTextureArray';

export async function createCity(canvas: HTMLCanvasElement, manifest: Manifest): Promise<City> {
  // Must precede any ShaderMaterial so #include <chunk> directives resolve.
  registerShaderChunks();

  const scene = new THREE.Scene();

  // Renderer FIRST + register it with the ad-panel texture array BEFORE the
  // boot applyManifest: the cell pass kicks async <img> loads whose onload
  // (early for cached responses) needs the registered renderer to upload the
  // texture layer; without it the panel ramps iTextureFade but samples an
  // unwritten layer and renders transparent.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  registerAdPanelRenderer(renderer);

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

  // Boot apply — AFTER renderer + registerAdPanelRenderer (the ad-panel race),
  // BEFORE the rig (so bbox is set and the rig's first frame can frame the city).
  await applyManifest(manifest);

  // cityState is threaded so the rig re-frames reactively when bbox changes
  // and reads its world-framing inputs (bbox/gem/root street) directly. deps
  // carries only the component-geometry accessors the rig can't reach via state.
  const rig = createCameraRig({
    canvas,
    cityState,
    deps: {
      getTallestBuilding: () => buildings.getTallest(),
      getRepoLabelBounds: () => repoLabel.getPanelBounds(),
      getTreeBoundsBySha: (sha) => trees.getRenderer()?.getTreeBoundsBySha(sha) ?? null,
    },
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

  createInputHandlers({
    canvas,
    picker,
    rig,
    renderer,
    camera: rig.camera,
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
        rig.camera.aspect = cw / Math.max(1, ch);
        rig.camera.updateProjectionMatrix();
        postFx.setSize(cw, ch);
        for (const c of components) c.onResize?.(cw, ch);
      }
    },
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
    /** View/debug read API — the only world surface consumers still touch. */
    world: {
      getRoot: () => cityState.manifest.value?.tree ?? null,
      getManifest: () => cityState.manifest.value,
      getTrees: () => trees.getRenderer(),
      getStreetByDir: (p: string) => cityState.streetsByDirMap.peek()[p] ?? null,
      runCollisionCheck: () => runCollisionCheck(cityState),
      runStemPlacementDiagnostic: () => runStemPlacementDiagnostic(cityState),
    },
  };
}
