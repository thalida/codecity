// city/world.ts — owns the persistent THREE.Scene plus every
// manifest-bound mesh (buildings, streets, paths, asphalt, root
// gem) and the lookup maps consumers use to reach them by path.
//
// Public contract:
//
//   const world = createWorld(canvas);
//   world.applyManifest(manifest);    // builds OR rebuilds in-place
//
//   world.scene                       // THREE.Scene reference
//   world.getStreetPickables(), …
//   world.getBuildingByPath(p), .getSidewalkByDir(p), …
//
//   world.onBeforeChange(cb)          // before disposal
//   world.onChange(cb)                // after rebuild, with diff
//   world.disposeMesh(mesh)           // animator's onComplete calls this
//
// applyManifest computes the entering / exiting / staying buckets vs the
// previous manifest (matched by file.path / dir.path) and fires onChange
// with them. The diff carries InstancedMesh-level entries which the
// animator consumes.
//
// Disposal: every mesh added by buildWorld or this module gets removed
// from the persistent scene and disposed. The disposer walks geometry →
// materials → any property whose value is a THREE.Texture, so new mesh
// shapes don't need special-casing. disposeMesh() is idempotent
// (userData.disposed flag) so a double-dispose during a rapid edit can't
// trip a Three.js error.

import * as THREE from 'three';

import { registerShaderChunks } from './utils/color/registerShaderChunks';
import type { CellTile } from './components/buildings/cellTile';
import { BuildingIndex } from './components/buildings/buildingIndex';
import { createBuildings } from './components/buildings';
import type { Buildings } from './components/buildings';
import { findLayoutOverlaps } from './layout/algorithm';
import { createLayoutClient } from './layout/runner';
import { layoutCityWithTrace } from './layout/algorithm';
import type { PrevState } from './utils/cityDiff';
import { createApplyManifest, createCityState, type CityState } from './applyManifest';
import { _formatCollisionReport, _formatStemDiagnostic } from './diagnostics';
import { createGem } from './components/gem';
import type { Gem } from './components/gem';
import type { SceneContext } from './types';
import type { Picker } from './runtime/picker';
import { createStreets } from './components/streets';
import type { Streets } from './components/streets';
import { createSky } from './components/sky';
import type { Sky } from './components/sky';
import { createRepoLabel } from './components/repoLabel';
import type { RepoLabel } from './components/repoLabel';
import { createTrees } from './components/trees';
import type { Trees, TreesComponent } from './components/trees';
import { createFireflies } from './components/fireflies';
import type { Fireflies, FirefliesComponent } from './components/fireflies';
import { createPathLine } from './components/pathLine';
import type { PathLine } from './components/pathLine';
import { createTreePlacementClient } from './components/trees/treePlacementClient';
import type { TreePlacementClient } from './components/trees/treePlacementClient';
import { createIsland } from './components/island';
import type { Island } from './components/island';
import type { WorldBounds } from './utils/floorBounds';
import { createFootprint } from './components/footprint';
import type { Footprint } from './components/footprint';
import { SCENE } from '@/state/stores/settings/scene';
import type { Building, WorldDiff } from '@/types';

// `canvas` is unused; kept in the signature so call sites (useCityScene, tests)
// don't have to change. outlineRenderer takes the canvas directly via its
// own factory now, so world no longer needs to forward it — the param
// can be dropped if a downstream pass cleans up the call sites.
export function createWorld(_canvas: HTMLCanvasElement) {
  // Register project GLSL chunks with THREE.ShaderChunk so #include <name>
  // directives in our shaders resolve natively — must run before any
  // ShaderMaterial is constructed.
  registerShaderChunks();

  // Persistent across applyManifest calls.
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SCENE.value.SKY_COLOR);

  // Root gem — a self-contained scene component built ONCE here (parallel
  // to sky/island/repoLabel); rebuild() swaps its inner mesh on full
  // applyManifest rebuilds. The gem reads the picker/camera/renderer only
  // in tick(); at construction (here, before the picker exists) the gem's
  // theme effect reads only GEM/BLOOM signals. renderLoop populates the
  // shared `_ctx` before the first animate() frame, so tick() sees a live
  // picker on frame 1.
  type MutableSceneContext = {
    scene: THREE.Scene;
    picker: Picker | null;
    camera: THREE.PerspectiveCamera | null;
    renderer: THREE.WebGLRenderer | null;
  };
  const _ctx: MutableSceneContext = { scene, picker: null, camera: null, renderer: null };
  // The single cast: picker/camera/renderer are populated by renderLoop
  // before the first animate() frame; the gem reads them only in tick().
  const _gem: Gem = createGem(_ctx as unknown as SceneContext);
  scene.add(_gem.group);

  // Cyberpunk Valley sky — a self-contained scene component built ONCE here,
  // lives at scene root for the lifetime of the world. Not rebuilt per
  // applyManifest (the sky is wallpaper, independent of the manifest tree).
  // Always rendered — the icosphere is never hidden. The sky's settings
  // effect reads only SCENE signals (safe at construction); it uses nothing
  // from `_ctx`, accepting it only for createX(ctx) composer uniformity.
  const _sky: Sky = createSky(_ctx as unknown as SceneContext);
  scene.add(_sky.group);

  // Cyberpunk Valley floating island — a shaped polygonal slab that
  // replaces the old flat world-floor plane. Built ONCE at scene init
  // (it's not layout-dependent — the island is sized to the world
  // bounds, not the city mesh). Sits at renderOrder -500, so it
  // draws AFTER the sky (-1000) but BEFORE the city's own ground
  // tiles (sidewalks at 1, asphalt at 3) — those paint on top.
  // Uses nothing from `_ctx`; accepts it only for createX(ctx) uniformity.
  const _island: Island = createIsland(_ctx as unknown as SceneContext);
  scene.add(_island.group);

  // Floating repo-name label — created ONCE at scene init, parallel
  // to sky and island. The group is empty (and invisible-effectively)
  // until applyManifest calls setRepoName + setAnchor. Uses nothing
  // from `_ctx`; accepts it only for createX(ctx) composer uniformity.
  const _repoLabel: RepoLabel = createRepoLabel(_ctx as unknown as SceneContext);
  scene.add(_repoLabel.group);

  // Tree placement client — owns the off-thread worker (or its sync
  // fallback in test envs). One instance per world; disposed when
  // the world is disposed.
  const _treePlacementClient: TreePlacementClient = createTreePlacementClient();

  // Cyberpunk Valley city footprint — PERSISTENT component; added to scene
  // once at init. rebuild(layout) swaps the inner InstancedMesh on every
  // full-rebuild path; the component's own effect owns FOOTPRINT settings
  // reactivity (COLOR / CORNER_RADIUS / ENABLED). Not rebuilt per applyManifest
  // directly — world calls _footprint.rebuild(newLayout) on the full-rebuild path.
  const _footprint: Footprint = createFootprint(_ctx as unknown as SceneContext);
  scene.add(_footprint.group);

  // Streets — PERSISTENT component; added to scene once at init. rebuild(layout)
  // disposes the prior street set and builds all sidewalk + asphalt slabs +
  // flat road labels on every full-rebuild path. The component owns STREETS
  // settings reactivity (sidewalk/asphalt colors, label height) via its own
  // theme effect, the per-frame label camera-orientation via tick(), and the
  // hover/selection sidewalk tinting via two picker-driven effects armed on
  // its first tick. The street DIFF in this module is vestigial (no consumer
  // reads it) — rebuild() returns void; world keeps the streetPickables/
  // streetLabels/asphaltMeshes module vars and reassigns them from the
  // component so PrevState/_computeDiff still read populated arrays.
  const _streets: Streets = createStreets(_ctx as unknown as SceneContext);
  scene.add(_streets.group);

  // Buildings — PERSISTENT component; added to scene once at init, right after
  // streets (so the transparent building/window/ad-panel draws sort relative
  // to the ground tiles exactly as before). rebuild(layout, dateRanges) colors
  // the buildings, assembles the per-cell InstancedMesh scene, swaps it into
  // the persistent group (disposing the prior cell root WITHOUT freeing the
  // SHARED building material), and rebuilds the building-by-path lookup. The
  // component owns the shared material reactivity (its own effect) + the
  // hover/selection fader/outline/ghost (armed on its first tick).
  //
  // Constructed AFTER _streets so the fader dep `() => _streets.getStreetByDir(p)`
  // is valid. Option B (Task 12): the building DIFF + the animator stay in
  // world — _computeDiff still emits the diff and the animator consumes it,
  // resolving meshes through getMeshForBuilding() which delegates here. World
  // mirrors _cells/_buildingIndex from this component after each rebuild.
  const _buildings: Buildings = createBuildings(_ctx as unknown as SceneContext, {
    getStreetByDir: (p) => _streets.getStreetByDir(p),
    onChange,
  });
  scene.add(_buildings.group);

  // Trees — PERSISTENT component; empty group added once. Inner instanced
  // meshes (one tree per commit, placed commit-driven across the world
  // floor) are swapped in by rebuild() on the deferred decoration pass of
  // every applyManifest; clear() empties at the same point the old code
  // disposed _trees. handle() preserves the null-until-built contract
  // (picker pickables, RightSidebar colorForSha, cameraRig
  // getTreeBoundsBySha all consume it).
  const _trees: TreesComponent = createTrees(_ctx as unknown as SceneContext);
  scene.add(_trees.group);

  // Fireflies — PERSISTENT component, same lifecycle as trees. One orb
  // cluster per tree (commit), driven by GPU shader bob animation.
  const _fireflies: FirefliesComponent = createFireflies(_ctx as unknown as SceneContext);
  scene.add(_fireflies.group);

  // Selection / hover neon path lines — PERSISTENT component. Deps are
  // closures (_cityState.gemWorldPos is reassigned by applyManifest; closures
  // evaluate at call time, post-init). Subscribes to picker + onChange at
  // arming (first tick).
  const _pathLine: PathLine = createPathLine(_ctx as unknown as SceneContext, {
    getGemWorldPos: () => _cityState.gemWorldPos,
    getStreetsByDirMap: () => _streets.streetsByDirMap(),
    onChange,
  });
  scene.add(_pathLine.group);

  // One layoutClient instance per world. Owns the off-thread worker
  // (or its sync fallback in test envs). Disposed when the world is
  // disposed.
  const _layoutClient = createLayoutClient();

  // All mutable manifest-bound state lives in this single bag (manifest,
  // layout, bbox, rootStreet, gemWorldPos, worldBounds, the street mesh
  // arrays, the cell mirrors, the layout/atlas/scenic caches, and the
  // generation counter). createApplyManifest mutates it BY REFERENCE; the
  // accessors below + resetCache/invalidateLayoutCache + the pathLine
  // gemWorldPos closure all read/write through this same object. See the
  // pass-by-reference contract documented in applyManifest.ts.
  const _cityState: CityState = createCityState();

  // Listeners

  const beforeChangeCbs: Array<(prev: PrevState) => void> = [];
  // The change diff is structurally complex; consumers (animator, picker,
  // outlineRenderer, etc.) each look at a different slice. Typed `any`
  // here, but each consumer narrows it locally.

  const changeCbs: Array<(diff: WorldDiff) => void> = [];

  function _emit<T>(arr: Array<(p: T) => void>, payload: T): void {
    // Snapshot to allow listeners to unsubscribe themselves mid-emit
    // without disturbing iteration.
    for (const cb of [...arr]) {
      try {
        cb(payload);
      } catch (e) {
        console.error('[world] listener error', e);
      }
    }
  }

  function onBeforeChange(cb: (prev: PrevState) => void): () => void {
    beforeChangeCbs.push(cb);
    return function unsubscribe() {
      const idx = beforeChangeCbs.indexOf(cb);
      if (idx >= 0) beforeChangeCbs.splice(idx, 1);
    };
  }

  function onChange(cb: (diff: WorldDiff) => void): () => void {
    changeCbs.push(cb);
    return function unsubscribe() {
      const idx = changeCbs.indexOf(cb);
      if (idx >= 0) changeCbs.splice(idx, 1);
    };
  }

  // Generic three.js disposer. Walks geometry → materials → any own
  // property of each material whose value is a THREE.Texture. Idempotent
  // via userData.disposed.
  //
  // Special case: if the object carries `userData.sharedMaterial = true`
  // the material is module-owned (shared across many cells) and must NOT
  // be disposed here — only the geometry is released. This prevents the
  // cell-path atomic swap (which traverses the old cell root with this
  // function) from invalidating the shared ShaderMaterial that the new
  // cell root's meshes already reference.
  function _disposeObject(obj: THREE.Object3D | null): void {
    if (!obj || obj.userData?.disposed) return;
    // Disposable shape: any object that may carry .geometry / .material
    // (Mesh, Line, LineSegments2, Group). Use a structural cast since
    // _disposeObject is intentionally generic across all of them.
    interface DisposableObj {
      geometry?: { dispose?: () => void };
      material?:
        | { dispose?: () => void; [k: string]: unknown }
        | Array<{ dispose?: () => void; [k: string]: unknown }>;
    }
    const d = obj as unknown as DisposableObj;
    if (d.geometry?.dispose) d.geometry.dispose();
    // Skip material disposal for meshes whose material is module-owned and
    // shared across cell tiles (cellMesh.ts factory).
    if (!obj.userData?.sharedMaterial) {
      const mats = Array.isArray(d.material) ? d.material : d.material ? [d.material] : [];
      for (const m of mats) {
        if (!m) continue;
        // Dispose any texture attached to this material.
        for (const key in m) {
          if (!Object.hasOwn(m, key)) continue;
          const v = m[key] as { isTexture?: boolean; dispose?: () => void } | undefined;
          if (v?.isTexture && typeof v.dispose === 'function') v.dispose();
        }
        if (typeof m.dispose === 'function') m.dispose();
      }
    }
    if (obj.userData) obj.userData.disposed = true;
  }

  function _removeAndDispose(obj: THREE.Object3D | null): void {
    if (!obj) return;
    if (obj.parent) obj.parent.remove(obj);
    _disposeObject(obj);
  }

  // Public idempotent disposal — animator's onComplete calls this when
  // an exit-tween finishes. A second call on the same mesh no-ops.
  function disposeMesh(mesh: THREE.Mesh): void {
    if (!mesh || (mesh.userData && mesh.userData.disposed)) return;
    if (mesh.parent) mesh.parent.remove(mesh);
    _disposeObject(mesh);
  }

  // The manifest build/rebuild pipeline lives in ./applyManifest
  // (createApplyManifest). It closes over the persistent component refs +
  // the shared _cityState bag and mutates that bag BY REFERENCE, so the
  // accessors below stay in sync. _computeRootStreetAndGem + the city-diff
  // wrapper moved into the factory with it.
  const applyManifest = createApplyManifest({
    components: {
      gem: _gem,
      sky: _sky,
      island: _island,
      repoLabel: _repoLabel,
      footprint: _footprint,
      streets: _streets,
      buildings: _buildings,
      trees: _trees,
      fireflies: _fireflies,
      pathLine: _pathLine,
    },
    scene,
    layoutClient: _layoutClient,
    treePlacementClient: _treePlacementClient,
    cityState: _cityState,
    emitBeforeChange: (prev) => _emit(beforeChangeCbs, prev),
    emitChange: (diff) => _emit(changeCbs, diff),
  });

  function dispose() {
    _sky.dispose();
    _repoLabel.dispose();
    _island.dispose();
    _gem.dispose();
    _trees.dispose();
    _fireflies.dispose();
    _pathLine.dispose();
    _footprint.dispose();
    _streets.dispose();
    _buildings.dispose();
    beforeChangeCbs.length = 0;
    changeCbs.length = 0;
    _layoutClient.dispose();
    _treePlacementClient.dispose();
  }

  function resetCache(): void {
    _cityState.cachedLayoutTreeSig = null;
    _cityState.cachedLayout = null;
    _cityState.lastBuildWorldTreeSig = null;
    _cityState.lastScenicConfigHash = null;
    // Dispose instanced ad panels so they are rebuilt from scratch on the
    // next applyManifest call (the new source may have a different set of
    // media files and a different layout, so the existing panels are stale).
    // Now owned by the buildings component; disposeAdPanels() preserves the
    // immediate-dispose timing.
    _buildings.disposeAdPanels();
  }

  // Narrow cache-clear used by configCommitReactions before each Save-driven
  // applyManifest. The manifest itself doesn't change on a config-only Save,
  // so without this call applyManifest hits the layout cache and reuseLayout
  // returns identical positions — Save would have no visible effect for
  // layout-affecting configs (building dims, street widths, street layout,
  // gem sizing, label typography). Live-update polls go through a separate
  // path that never triggers scheduleRebuild, so the cache still helps there.
  // Narrower than resetCache(): only nulls the layout cache; leaves scenic
  // state + ad panels alone (those are correctly handled by applyManifest's
  // own scenic-hash invalidation).
  function invalidateLayoutCache(): void {
    _cityState.cachedLayoutTreeSig = null;
    _cityState.cachedLayout = null;
  }

  return {
    scene,
    applyManifest,
    dispose,
    onBeforeChange,
    onChange,
    disposeMesh,
    resetCache,
    invalidateLayoutCache,

    /**
     * Cyberpunk Valley sky component. Exposed so the render loop can call
     * sky.tick(dt, frame) each frame (star twinkle + camera follow). Settings
     * reactivity (SKY_COLOR / stars) is owned by the component's own effect,
     * so applyTheme() no longer touches the sky.
     */
    getSky(): Sky {
      return _sky;
    },

    /**
     * Floating repo-name label reference. Exposed so the render loop
     * can call repoLabel.tick(dt, frameCtx) each frame. The component's
     * own effect handles REPO_LABEL config reactivity (no external refresh()
     * needed).
     */
    getRepoLabel(): RepoLabel {
      return _repoLabel;
    },

    /**
     * Cyberpunk Valley trees inner handle. Rebuilt per applyManifest, so
     * this returns null until the first manifest has been applied (the
     * null-until-built contract consumers guard against).
     */
    getTrees(): Trees | null {
      return _trees.handle();
    },

    /**
     * Cyberpunk Valley fireflies inner handle. Rebuilt per applyManifest,
     * so this returns null until the first manifest has been applied.
     */
    getFireflies(): Fireflies | null {
      return _fireflies.handle();
    },

    getManifest() {
      return _cityState.manifest;
    },
    getLayout() {
      return _cityState.layout;
    },
    runCollisionCheck(): void {
      const layout = _cityState.layout;
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
      const manifest = _cityState.manifest;
      if (!manifest) {
        console.warn('[stem-diag] no manifest — apply one first');
        return;
      }
      const { trace } = layoutCityWithTrace(
        manifest as unknown as Parameters<typeof layoutCityWithTrace>[0]
      );
      const lines = _formatStemDiagnostic(trace);
      for (const line of lines) {
        console.log(line);
      }
    },
    getBbox() {
      return _cityState.bbox;
    },
    /** Current world floor bounds (rectangle the plane covers). Null
     *  until the first manifest has been applied. */
    getWorldBounds(): WorldBounds | null {
      return _cityState.latestWorldBounds;
    },
    getRoot() {
      return _cityState.manifest && _cityState.manifest.tree;
    },

    /**
     * Tallest building height (b.h) across every cell, in world units.
     * 0 if there are no buildings. Used by camera framing code that needs
     * to clear the city silhouette (e.g. cameraRig.focusStreet altitude).
     */
    getMaxBuildingHeight(): number {
      return _buildings.maxHeight();
    },
    /**
     * Tallest building in the city, with its layout position + dimensions.
     * Used by cameraRig to compute the exact start-framing distance
     * needed to fit the building's roof corners at the top edge of the
     * vertical FOV (4 corner projections, no loop over the whole city).
     * `x` and `y` map to world X and Z; `h` is height along world Y.
     */
    getTallestBuilding(): { x: number; y: number; w: number; d: number; h: number } | null {
      return _buildings.tallest();
    },
    /**
     * Per-cell detail InstancedMeshes suitable for raycasting against.
     * Three.js raycasts InstancedMesh natively, returning hits with
     * `.instanceId` set. Used by cameraRig sightline tests.
     */
    getBuildingPickables(): THREE.Object3D[] {
      return _buildings.pickables();
    },
    getStreetPickables() {
      return _streets.pickables();
    },
    getStreetLabels() {
      return _streets.labels();
    },
    getAsphaltMeshes() {
      return _streets.asphalt();
    },
    getRootGem() {
      return _gem.gem;
    },
    getRepoLabelBounds() {
      return _repoLabel.getPanelBounds();
    },
    /** The gem scene component. renderLoop drives its per-frame tick(). */
    getGem(): Gem {
      return _gem;
    },
    /** The streets scene component. renderLoop drives its per-frame tick()
     *  (label camera-orientation + lazy picker-tint arming). */
    getStreets(): Streets {
      return _streets;
    },
    /** Shared SceneContext for components built in world before the
     *  picker/camera/renderer exist. renderLoop populates picker/camera/
     *  renderer immediately after creating them, before the first frame. */
    getSceneCtx(): SceneContext {
      return _ctx as unknown as SceneContext;
    },
    getRootStreet() {
      return _cityState.rootStreet;
    },
    getGemWorldPos() {
      return _cityState.gemWorldPos;
    },
    getTreeBoundsBySha(sha: string) {
      return _trees.handle()?.getTreeBoundsBySha(sha) ?? null;
    },

    getBuildingByPath(p: string) {
      return _buildings.getByPath(p);
    },
    getSidewalkByDir(p: string) {
      return _streets.getSidewalkByDir(p);
    },
    getStreetByDir(p: string) {
      return _streets.getStreetByDir(p);
    },
    // Bulk-map accessors. Treat the returned objects as read-only —
    // their identities are stable within an applyManifest call but
    // get replaced wholesale on the next one. Exposed because some
    // existing callers (e.g. computePathPoints in scene/path.js) take
    // a whole `{ dirPath: street }` map. New consumers should prefer
    // the per-key getters above.
    getBuildingsByPath() {
      return _buildings.getBuildingsByPath();
    },
    getSidewalksByDirMap() {
      return _streets.sidewalksByDirMap();
    },
    getStreetsByDirMap() {
      return _streets.streetsByDirMap();
    },

    // Cell-mode accessors for picker + other consumers. Delegate to the
    // buildings component (the source of truth); world's _cells/_buildingIndex
    // are diff-only mirrors.
    getBuildingIndex(): BuildingIndex | null {
      return _buildings.getBuildingIndex();
    },
    getCells(): Map<number, CellTile> {
      return _buildings.getCells();
    },

    // Read-only accessor for the cell-mode ad-panel mesh manager. Used
    // by buildingFader to mirror selection-cascade body opacity onto
    // the ad-panel instances. Returns null when the current manifest
    // has no media files (no panels were created).
    getAdPanels(): import('./components/buildings/adPanels.js').InstancedAdPanels | null {
      return _buildings.getAdPanels();
    },

    // Unified mesh+slot resolver. Returns the InstancedMesh that owns this
    // building's instance and the slot index within that mesh. Resolves via
    // Building.cellId + Building.slotId. Delegates to the buildings component.
    //
    // Returns null if no live mesh exists for this building (e.g. cellId/
    // slotId are unset, or the cell was disposed).
    getMeshForBuilding(b: Building): { mesh: THREE.InstancedMesh; slot: number } | null {
      return _buildings.getMeshForBuilding(b);
    },

    /** The buildings scene component. renderLoop drives its per-frame tick()
     *  (fader/outline/ghost + lazy picker arming) + onResize(). */
    getBuildings(): Buildings {
      return _buildings;
    },

    /** The trees scene component. renderLoop drives its per-frame tick()
     *  (outline transform snap + rainbow chase + lazy outline arming) +
     *  onResize(). */
    getTreesComponent(): TreesComponent {
      return _trees;
    },

    /** The fireflies scene component. renderLoop drives its per-frame tick()
     *  (bob uTime + orbit-ring chase + lazy boost-effect arming) +
     *  onResize(). */
    getFirefliesComponent(): FirefliesComponent {
      return _fireflies;
    },

    /** The pathLine scene component. renderLoop drives its per-frame tick()
     *  (rainbow chase + lazy renderer arming) + onResize(). */
    getPathLine(): PathLine {
      return _pathLine;
    },
  };
}
