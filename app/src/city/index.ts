// city/index.ts — the city composer. createCity(canvas, manifest) folds the
// scene/component construction (formerly world.ts) and the rendering pipeline
// (formerly renderLoop.ts) into one async factory, then drives the frame loop
// via startFrameLoop. Returns the handle App.tsx / useCityScene consume.
//
// worldAccessor below is a structural shim: the ~40 getters every current
// consumer (PickerWorld, CameraRigDeps, every handle.world.* reader) reads
// off the old world object. It satisfies those contracts identically and is
// dissolved in a later commit once consumers read components/cityState direct.

import * as THREE from 'three';

import type { Manifest, Building } from '@/types';

import { SCENE } from '@/state/stores/settings/scene';
import { registerShaderChunks } from './utils/color/registerShaderChunks';
import { disposeObject3D } from './utils/disposeObject3D';
import type { CellTile } from './components/buildings/cellTile';
import type { BuildingIndex } from './components/buildings/buildingIndex';
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
import type { SceneComponent, SceneContext } from './types';
import { createCameraRig } from './render/cameraRig';
import { createPicker } from './render/picker';
import { createInputHandlers } from './render/inputHandlers';
import { showTooltip, hideTooltip } from './render/tooltip';
import { createPostFx } from './render/postFx';
import { startFrameLoop } from './render/frameLoop';
import { registerRenderer as registerAdPanelRenderer } from './components/buildings/adPanelTextureArray';

export async function createCity(canvas: HTMLCanvasElement, manifest: Manifest) {
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

  function disposeMesh(mesh: THREE.Mesh): void {
    if (!mesh || (mesh.userData && mesh.userData.disposed)) return;
    if (mesh.parent) mesh.parent.remove(mesh);
    disposeObject3D(mesh);
  }

  const { applyManifest, resetCaches, invalidateLayoutCache } = createApplyManifest({
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

  // Structural compatibility shim — see file header.
  const worldAccessor = {
    scene,
    applyManifest,
    disposeMesh,
    resetCache(): void {
      resetCaches();
      buildings.disposeAdPanels();
    },
    invalidateLayoutCache,
    runCollisionCheck(): void {
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
    },
    runStemPlacementDiagnostic(): void {
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
    },

    getSky() {
      return sky;
    },
    getRepoLabel() {
      return repoLabel;
    },
    getTrees() {
      return trees.handle();
    },
    getFireflies() {
      return fireflies.handle();
    },
    getManifest() {
      return cityState.manifest.value;
    },
    getBbox() {
      return cityState.bbox.value;
    },
    getWorldBounds() {
      return cityState.latestWorldBounds.value;
    },
    getRoot() {
      const m = cityState.manifest.value;
      return m && m.tree;
    },
    getMaxBuildingHeight() {
      return buildings.maxHeight();
    },
    getTallestBuilding() {
      return buildings.tallest();
    },
    getBuildingPickables() {
      return buildings.pickables();
    },
    getStreetPickables() {
      return streets.pickables();
    },
    getStreetLabels() {
      return streets.labels();
    },
    getAsphaltMeshes() {
      return streets.asphalt();
    },
    getRootGem() {
      return gem.gem;
    },
    getRepoLabelBounds() {
      return repoLabel.getPanelBounds();
    },
    getGem() {
      return gem;
    },
    getStreets() {
      return streets;
    },
    getRootStreet() {
      return cityState.rootStreet.value;
    },
    getGemWorldPos() {
      return cityState.gemWorldPos.value;
    },
    getTreeBoundsBySha(sha: string) {
      return trees.handle()?.getTreeBoundsBySha(sha) ?? null;
    },
    getBuildingByPath(p: string) {
      return buildings.getByPath(p);
    },
    getSidewalkByDir(p: string) {
      return streets.getSidewalkByDir(p);
    },
    getStreetByDir(p: string) {
      return streets.getStreetByDir(p);
    },
    getBuildingsByPath() {
      return buildings.getBuildingsByPath();
    },
    getSidewalksByDirMap() {
      return streets.sidewalksByDirMap();
    },
    getStreetsByDirMap() {
      return streets.streetsByDirMap();
    },
    getBuildingIndex(): BuildingIndex | null {
      return buildings.getBuildingIndex();
    },
    getCells(): Map<number, CellTile> {
      return buildings.getCells();
    },
    getAdPanels() {
      return buildings.getAdPanels();
    },
    getMeshForBuilding(b: Building) {
      return buildings.getMeshForBuilding(b);
    },
    getBuildings() {
      return buildings;
    },
    getTreesComponent() {
      return trees;
    },
    getFirefliesComponent() {
      return fireflies;
    },
    getPathLine() {
      return pathLine;
    },
  };

  // Boot apply — AFTER renderer + registerAdPanelRenderer (the ad-panel race),
  // BEFORE the rig (so bbox is set and the rig's first frame can frame the city).
  await applyManifest(manifest);

  // worldAccessor satisfies CameraRigDeps structurally; cityState is threaded
  // so the rig re-frames reactively when bbox changes.
  const rig = createCameraRig({ canvas, deps: worldAccessor, cityState });
  const camera = rig.camera;
  // Exposed for visual regression tests (tests/visual/setup.ts).
  (window as Window & { __rig?: typeof rig }).__rig = rig;
  const resetView = rig.reset;

  const postFx = createPostFx(renderer, scene, camera);
  postFx.setSize(canvas.clientWidth, canvas.clientHeight);

  const picker = createPicker({ canvas, camera, world: worldAccessor, cityState });

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
    getRootName: () => worldAccessor.getRoot()?.name ?? null,
  });

  function applyTheme(): void {
    scene.background = new THREE.Color(SCENE.value.SKY_COLOR);
    postFx.refresh();
    // Null until the first manifest with media files applies.
    worldAccessor.getAdPanels()?.refresh();
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
    world: worldAccessor,
    applyTheme,
    picker,
    rig,
    resetView,
    /** Focus the camera on the node at `path`: resolve via the picker, dispatch
     *  to the rig. */
    focusByPath(path: string): void {
      rig.focusSelection(picker.targetForPath(path));
    },
  };
}
