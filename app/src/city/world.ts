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
//   world.disposeMesh(mesh)           // animator's onComplete calls this
//
// applyManifest sets the cityState signals (manifest/layout/bbox/...) and bumps
// cityState.cityRevision / decorationRevision. The reactive consumers (picker,
// cameraRig, pathLine, buildingFader) react to those signals — there is no
// observer to subscribe to anymore.
//
// Disposal: every mesh added by buildWorld or this module gets removed
// from the persistent scene and disposed. The disposer walks geometry →
// materials → any property whose value is a THREE.Texture, so new mesh
// shapes don't need special-casing. disposeMesh() is idempotent
// (userData.disposed flag) so a double-dispose during a rapid edit can't
// trip a Three.js error.

import * as THREE from 'three';

import { registerShaderChunks } from './utils/color/registerShaderChunks';
import { disposeObject3D } from './utils/disposeObject3D';
import type { CellTile } from './components/buildings/cellTile';
import { BuildingIndex } from './components/buildings/buildingIndex';
import { createBuildings } from './components/buildings';
import type { Buildings } from './components/buildings';
import { findLayoutOverlaps } from './layout/algorithm';
import { createLayoutClient } from './layout/runner';
import { layoutCityWithTrace } from './layout/algorithm';
import { createApplyManifest } from './applyManifest';
import { createCityState, type CityState } from './state/cityState';
import { _formatCollisionReport, _formatStemDiagnostic } from './diagnostics';
import { createGem } from './components/gem';
import type { Gem } from './components/gem';
import type { SceneContext } from './types';
import type { Picker } from './render/picker';
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
import type { Building } from '@/types';

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

  // The cross-boundary manifest-bound state: a per-city signals object
  // (manifest/layout/bbox/latestWorldBounds source signals + rootStreet/
  // gemWorldPos computeds). Created BEFORE the scene components so it can be
  // threaded into each create<X>(ctx, cityState) — the sync scenic components
  // (streets/gem/footprint/island/repoLabel) rebuild themselves reactively off
  // these signals via their own effects (the layout/bounds/anchor effects),
  // rather than being called in order by applyManifest. The accessors below +
  // the pathLine gemWorldPos closure read these signals too; createApplyManifest
  // sets the source signals' .value. The non-accessor mirrors/caches live
  // privately inside the factory.
  const _cityState: CityState = createCityState();

  // The single cast: picker/camera/renderer are populated by renderLoop
  // before the first animate() frame; the gem reads them only in tick().
  const _gem: Gem = createGem(_ctx as unknown as SceneContext, _cityState);
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
  const _island: Island = createIsland(_ctx as unknown as SceneContext, _cityState);
  scene.add(_island.group);

  // Floating repo-name label — created ONCE at scene init, parallel
  // to sky and island. The group is empty (and invisible-effectively)
  // until applyManifest calls setRepoName + setAnchor. Uses nothing
  // from `_ctx`; accepts it only for createX(ctx) composer uniformity.
  const _repoLabel: RepoLabel = createRepoLabel(_ctx as unknown as SceneContext, _cityState, {
    // Live accessor for the gem's inner group. The label's manifest/anchor
    // effect re-reads it on every (non-reuse) apply — after the gem has
    // rebuilt in the same batch — so the beam foot tracks the current gem
    // (mirrors the old post-rebuild `_repoLabel.setGem(_gem.gem)`).
    getGem: () => _gem.gem,
  });
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
  const _streets: Streets = createStreets(_ctx as unknown as SceneContext, _cityState);
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
    cityState: _cityState,
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
  // closures evaluated at call time, post-init. Subscribes to picker at arming
  // (first tick); reacts to cityState.gemWorldPos + cityRevision for rebuilds.
  const _pathLine: PathLine = createPathLine(
    _ctx as unknown as SceneContext,
    {
      // .peek(), not .value: this closure is invoked from inside the renderer's
      // _updatePathLine / _updateHoverPathLine, which run from the selection +
      // hover effects too. A tracking read there would subscribe THOSE effects
      // to gemWorldPos and re-fire them on every rebuild — reactivity they never
      // had. The renderer's dedicated rebuild effect tracks cityState.gemWorldPos
      // directly (it holds cityState), so gem moves still recompute the path.
      getGemWorldPos: () => _cityState.gemWorldPos.peek(),
      getStreetsByDirMap: () => _streets.streetsByDirMap(),
    },
    _cityState
  );
  scene.add(_pathLine.group);

  // One layoutClient instance per world. Owns the off-thread worker
  // (or its sync fallback in test envs). Disposed when the world is
  // disposed.
  const _layoutClient = createLayoutClient();

  // Public idempotent disposal — animator's onComplete calls this when
  // an exit-tween finishes. A second call on the same mesh no-ops.
  function disposeMesh(mesh: THREE.Mesh): void {
    if (!mesh || (mesh.userData && mesh.userData.disposed)) return;
    if (mesh.parent) mesh.parent.remove(mesh);
    disposeObject3D(mesh);
  }

  // The manifest build/rebuild pipeline lives in ./applyManifest
  // (createApplyManifest). It closes over the persistent component refs + the
  // shared _cityState signals object (whose source signals it sets + whose
  // cityRevision/decorationRevision it bumps) plus its own private cache/mirror
  // state. It returns the apply function + the two cache clearers
  // resetCache/invalidateLayoutCache delegate to.
  const {
    applyManifest,
    resetCaches: _resetCaches,
    invalidateLayoutCache: _invalidateLayoutCache,
  } = createApplyManifest({
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
    _layoutClient.dispose();
    _treePlacementClient.dispose();
  }

  function resetCache(): void {
    // The layout/scenic caches now live in createApplyManifest's private state;
    // delegate to its resetCaches().
    _resetCaches();
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
  // own scenic-hash invalidation). The layout cache lives in the factory's
  // private state; delegate.
  function invalidateLayoutCache(): void {
    _invalidateLayoutCache();
  }

  return {
    scene,
    applyManifest,
    dispose,
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
      return _cityState.manifest.value;
    },
    /** The per-city signals object. Exposed so renderLoop can thread it into
     *  the picker + cameraRig (their rebuild reactions track cityRevision /
     *  bbox). Stage 5 rewires these via the composer. */
    getCityState(): CityState {
      return _cityState;
    },
    runCollisionCheck(): void {
      const layout = _cityState.layout.value;
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
      const manifest = _cityState.manifest.value;
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
      return _cityState.bbox.value;
    },
    /** Current world floor bounds (rectangle the plane covers). Null
     *  until the first manifest has been applied. */
    getWorldBounds(): WorldBounds | null {
      return _cityState.latestWorldBounds.value;
    },
    getRoot() {
      const m = _cityState.manifest.value;
      return m && m.tree;
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
      return _cityState.rootStreet.value;
    },
    getGemWorldPos() {
      return _cityState.gemWorldPos.value;
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
