// scene/world.ts — owns the persistent THREE.Scene plus every
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
import { buildIconAtlas } from './components/buildings/atlas';
import { labelFromManifest } from '@/utils/sources';
import type { CellTile } from './components/buildings/cellTile';
import { BuildingIndex } from './components/buildings/pathIndex';
import { createBuildings } from './components/buildings';
import type { Buildings } from './components/buildings';
import { findLayoutOverlaps } from './layout/algorithm';
import type { LayoutOverlap } from './layout/algorithm';
import { createLayoutClient } from './layout/runner';
import type { LayoutComputeOpts } from './layout/runner';
import { layoutCityWithTrace } from './layout/algorithm';
import type { ChildPlacementTrace, StemPlacementTrace } from './layout/algorithm';
import type { WorldRect } from './layout/occupancyIndex';
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
import { getWorldBounds, type WorldBounds } from './utils/floorBounds';
import { createFootprint } from './components/footprint';
import type { Footprint } from './components/footprint';
import { FOOTPRINT } from '@/state/stores/settings/footprint';
import { getDateRanges } from './components/buildings/color';
import { STREETS } from '@/state/stores/settings/streets';
import { GEM, GEM_SIZING } from '@/state/stores/settings/gem';
import { TREES } from '@/state/stores/settings/trees';
import { SCENE } from '@/state/stores/settings/scene';
import { REBUILD_STATUS, RebuildStatus } from '@/state/stores/manifest';
import type {
  Building,
  CityBbox,
  CityLayout,
  WorldDiff,
  DateRanges,
  EnteringBuilding,
  EnteringStreet,
  ExitingEntry,
  Manifest,
  StayingBuilding,
  StayingStreet,
  Street,
} from '@/types';

// Snapshot of the prior manifest state captured at the top of
// applyManifest, used by the diff and the change-listener payload.
interface PrevState {
  streetPickables: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[];
  streetLabels: THREE.Group[];
  asphaltMeshes: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[];
  manifest: Manifest | null;
  layout: CityLayout | null;
  /** Snapshot of cells before they are replaced/disposed. */
  cells: Map<number, CellTile>;
  /** Snapshot of building index before it is replaced. */
  buildingIndex: BuildingIndex | null;
}

// _formatCollisionReport(overlaps, totalRects) -> {level, summary, details}
//
// Pure helper. Partitions overlaps into unexpected vs. t-junction, returns the
// summary line and (for the dirty case) one detail string per unexpected
// overlap. Caller decides what to do with it — runCollisionCheck() routes to
// console.info / console.warn.
function _formatCollisionReport(
  overlaps: LayoutOverlap[],
  totalRects: number
): { level: 'info' | 'warn'; summary: string; details: string[] } {
  const unexpected = overlaps.filter((o) => o.category === 'unexpected');
  const tjctCount = overlaps.filter((o) => o.category === 't-junction').length;
  const summary =
    `[collision] ${unexpected.length} unexpected, ${tjctCount} t-junctions ` +
    `whitelisted (${totalRects} rects)`;
  if (unexpected.length === 0) {
    return { level: 'info', summary, details: [] };
  }
  const fmtRect = (r: { x: number; y: number; w: number; d: number }): string =>
    `[x=${r.x.toFixed(2)} y=${r.y.toFixed(2)} w=${r.w.toFixed(2)} d=${r.d.toFixed(2)}]`;
  const details = unexpected.map(
    (o) =>
      `  ${o.kindA} "${o.labelA}" ${fmtRect(o.rectA)}\n` +
      `    ⟷ ${o.kindB} "${o.labelB}" ${fmtRect(o.rectB)}\n` +
      `    overlap=${o.overlap.w.toFixed(3)}×${o.overlap.d.toFixed(3)} ` +
      `at (${o.overlap.x.toFixed(2)}, ${o.overlap.y.toFixed(2)})`
  );
  return { level: 'warn', summary, details };
}

// _formatStemDiagnostic(trace) -> string[]
//
// Pure helper. Walks a StemPlacementTrace, groups placements by parent road,
// returns one or more lines per parent. Caller routes lines to console.log.
function _formatStemDiagnostic(trace: StemPlacementTrace): string[] {
  if (trace.placements.length === 0) {
    return ['[stem-diag] no placements recorded'];
  }

  // Group by parent path, preserving first-seen order.
  const byParent = new Map<string, ChildPlacementTrace[]>();
  for (const p of trace.placements) {
    let bucket = byParent.get(p.parentPath);
    if (!bucket) {
      bucket = [];
      byParent.set(p.parentPath, bucket);
    }
    bucket.push(p);
  }

  const out: string[] = [];
  for (const [parentPath, children] of byParent) {
    out.push(`[stem-diag] dir "${parentPath}" — ${children.length} children`);
    for (const c of children) {
      // Match display precision: jumps below half a toFixed(2) unit display
      // as +0.00 and would be misleading.
      const jumped = c.chosen.stem - c.baseline > 0.005;
      const tag = c.childKind === 'dir' ? `"${c.childLabel}/"` : `"${c.childLabel}"`;
      const jumpedNote = jumped ? `  ← JUMPED +${(c.chosen.stem - c.baseline).toFixed(2)}` : '';
      out.push(
        `  ─ ${tag} (${c.childKind}) — stem=${c.chosen.stem.toFixed(2)}  ` +
          `(baseline=${c.baseline.toFixed(2)})${jumpedNote}`
      );
      if (jumped && c.chosen.bindingIndex !== null) {
        const binding = c.chosen.forbidden[c.chosen.bindingIndex];
        const obs = binding.obstacle;
        const label = _obstacleLabel(obs);
        out.push(
          `     forced by: ${obs.kind} ${label}  ` +
            `y=[${_yBounds(obs).join(', ')}] x=[${_xBounds(obs).join(', ')}]`
        );
      }
      if (jumped && c.others.length > 0) {
        out.push(`     other variants tried:`);
        const all = [c.chosen, ...c.others].sort(
          (a, b) => a.side - b.side || Number(a.mirror) - Number(b.mirror)
        );
        for (const v of all) {
          const marker = v === c.chosen ? '(chosen)' : '';
          out.push(
            `       side=${v.side} mirror=${v.mirror} → stem=${v.stem.toFixed(2)} ${marker}`.trimEnd()
          );
        }
      }
    }
  }
  return out;
}

function _obstacleLabel(o: WorldRect): string {
  // WorldRect.ref is loosely typed (Building | Street); try common
  // shapes without forcing tight coupling.
  const r = o.ref as {
    file?: { path?: string; name?: string };
    label?: string;
    dir?: { path?: string };
  };
  return (r.file && (r.file.path ?? r.file.name)) ?? r.label ?? (r.dir && r.dir.path) ?? '?';
}

function _yBounds(o: WorldRect): [string, string] {
  return [o.minY.toFixed(2), o.maxY.toFixed(2)];
}

function _xBounds(o: WorldRect): [string, string] {
  return [o.minX.toFixed(2), o.maxX.toFixed(2)];
}

// Internal helpers exposed for tests only. Not part of the public API.
export const __test = {
  _formatCollisionReport,
  _formatStemDiagnostic,
};

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
  // closures (gemWorldPos is a `let` below; closures evaluate at call time,
  // post-init). Subscribes to picker + onChange at arming (first tick).
  const _pathLine: PathLine = createPathLine(_ctx as unknown as SceneContext, {
    getGemWorldPos: () => gemWorldPos,
    getStreetsByDirMap: () => _streets.streetsByDirMap(),
    onChange,
  });
  scene.add(_pathLine.group);

  // Generation counter: each applyManifest invocation increments this and
  // captures its own value. If _currentGeneration has advanced beyond a
  // call's captured value by the time a safe-point check runs, that call
  // was superseded and must bail out (cleaning up any meshes it built).
  let _currentGeneration = 0;

  // One layoutClient instance per world. Owns the off-thread worker
  // (or its sync fallback in test envs). Disposed when the world is
  // disposed.
  const _layoutClient = createLayoutClient();

  // Manifest-bound state. Reassigned on each applyManifest.
  let manifest: Manifest | null = null;
  let layout: CityLayout | null = null;
  let dateRanges: DateRanges | null = null;
  let bbox: THREE.Box3 | null = null;
  let rootStreet: Street | null = null;
  let gemWorldPos: THREE.Vector3 | null = null;
  let latestWorldBounds: WorldBounds | null = null;

  // The flat ground meshes (sidewalks, paths, asphalt) all use single
  // MeshBasicMaterial; renderLoop.ts's color-update path reads
  // `mesh.material.color` directly. Typing them with a single material
  // (rather than the default `Material | Material[]`) keeps that
  // callsite's `.material.color` access working.
  type FlatMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;

  // Reassigned from the _streets component on rebuild. Still read by the
  // PrevState capture + _computeDiff street branch (both vestigial — no
  // consumer reads the resulting street diff — but kept byte-identical).
  let streetPickables: FlatMesh[] = [];
  let streetLabels: THREE.Group[] = [];
  let asphaltMeshes: FlatMesh[] = [];

  // Cell-rendering state mirrors. The _buildings component OWNS the cell
  // scene + lookups; world keeps these two as reassigned mirrors (set from
  // the component after each rebuild) so the PrevState snapshot + _computeDiff
  // building branch still read populated structures under Option B. They are
  // never the source of truth — _buildings is.
  let _cells: Map<number, CellTile> = new Map();
  let _buildingIndex: BuildingIndex | null = null;

  // Layout cache: avoid redundant _layoutClient.compute() when
  // the manifest's tree shape is unchanged (e.g., skeleton → final transition).
  // Keyed by manifest.tree_signature — computed server-side from paths + nesting
  // only (no mtime/size), so it is stable across skeleton/final events for the
  // same scan even though per-file metadata differs between the two phases.
  let _cachedLayoutTreeSig: string | null = null;
  let _cachedLayout: CityLayout | null = null;

  // tree_signature of the manifest the building-roof icon atlas was last built
  // for. The atlas is rebuilt only when this changes (see applyManifest) — the
  // build is expensive, and most re-applies (settings rebuilds) reuse the same
  // manifest.
  let _lastAtlasTreeSig: string | null = null;

  // Scenic state cache: tracks the tree_signature that was used the last time
  // buildWorld ran successfully (in the cell branch). When the layout is
  // reused AND this signature matches the current manifest's tree_signature,
  // the streets/labels/paths/gem meshes are already in the scene and identical
  // to what a fresh buildWorld call would produce — so we skip the call.
  // Cleared by resetCache() when the user switches source (different tree shape).
  let _lastBuildWorldTreeSig: string | null = null;

  // Scenic config hash: a JSON snapshot of all config stores whose values are
  // baked into buildWorld output (street geometry/color, sidewalk color,
  // label typography, gem appearance). Stored alongside _lastBuildWorldTreeSig
  // after every successful buildWorld call. On cache-hit, we also check this
  // hash — if it differs (e.g. user changed SIDEWALK_COLORS.DEFAULT via Settings),
  // we force a full scenic rebuild even though the tree_signature hasn't changed.
  let _lastScenicConfigHash: string | null = null;

  // computeScenicConfigHash collects the current values of every store whose
  // output is baked into buildWorld meshes:
  //   - SCENE  : FOG_* keys baked into building shader uniforms
  //   - STREETS       : ASPHALT_COLOR + SIDEWALK_* baked into street materials,
  //                     LABEL_* baked into label canvas textures + geometry.
  //                     (Path-line keys are live Line2 materials, not baked.)
  //   - GEM_SIZING    : RADIUS_AS_STREET_FRAC / MIN_RADIUS / HOVER_LIFT_FRAC
  //                     baked into gem geometry and position
  //   - GEM_FACE_PALETTE: vertex colors baked into gem polyhedron BufferAttribute
  //   - GEM_APPEARANCE: EDGE_COLOR + BODY_OPACITY baked into gem materials
  //   - GEM_GLOW      : all keys baked into gem sprite materials + scales
  // PATH_LINE / HOVER_PATH_LINE are live Line2 meshes, not built by buildWorld.
  function computeScenicConfigHash(): string {
    return JSON.stringify({
      fog: {
        FOG_ENABLED: SCENE.value.FOG_ENABLED,
        FOG_COLOR: SCENE.value.FOG_COLOR,
        FOG_INTENSITY: SCENE.value.FOG_INTENSITY,
        FOG_HEIGHT_FRAC: SCENE.value.FOG_HEIGHT_FRAC,
      },
      streets: {
        ASPHALT_COLOR: STREETS.value.ASPHALT_COLOR,
        SIDEWALK_DEFAULT: STREETS.value.SIDEWALK_DEFAULT,
        SIDEWALK_HOVER: STREETS.value.SIDEWALK_HOVER,
        SIDEWALK_SELECTED: STREETS.value.SIDEWALK_SELECTED,
        LABEL_FILL: STREETS.value.LABEL_FILL,
        LABEL_STROKE: STREETS.value.LABEL_STROKE,
        LABEL_STROKE_WIDTH_FRAC: STREETS.value.LABEL_STROKE_WIDTH_FRAC,
        LABEL_HEIGHT_FRAC: STREETS.value.LABEL_HEIGHT_FRAC,
      },
      gemSizing: GEM_SIZING.value,
      // GEM shape + appearance + face palette + glow (NOT the per-frame
      // animation keys, which don't affect the built scene).
      gem: {
        SIDES: GEM.value.SIDES,
        EDGE_COLOR: GEM.value.EDGE_COLOR,
        BODY_OPACITY: GEM.value.BODY_OPACITY,
        FACE_1: GEM.value.FACE_1,
        FACE_2: GEM.value.FACE_2,
        FACE_3: GEM.value.FACE_3,
        FACE_4: GEM.value.FACE_4,
        FACE_5: GEM.value.FACE_5,
        FACE_6: GEM.value.FACE_6,
        FACE_7: GEM.value.FACE_7,
        FACE_8: GEM.value.FACE_8,
        GLOW_ENABLED: GEM.value.GLOW_ENABLED,
        GLOW_INNER_SCALE: GEM.value.GLOW_INNER_SCALE,
        GLOW_INNER_OPACITY: GEM.value.GLOW_INNER_OPACITY,
        GLOW_OUTER_SCALE: GEM.value.GLOW_OUTER_SCALE,
        GLOW_OUTER_OPACITY: GEM.value.GLOW_OUTER_OPACITY,
        GLOW_ANIMATE_COLORS: GEM.value.GLOW_ANIMATE_COLORS,
        GLOW_CYCLE_PERIOD_SECONDS: GEM.value.GLOW_CYCLE_PERIOD_SECONDS,
      },
    });
  }

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
    // shared across cell tiles (buildingsCell.ts factory).
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

  function _disposeAllManifestState() {
    // Streets are component-owned now: _streets.rebuild() disposes the prior
    // street/label set (called on the full-rebuild path right after this
    // runs), so world no longer disposes street meshes here. The gem disposes
    // its own inner meshes on rebuild; the outer persistent groups (gem,
    // streets, footprint) are disposed via their component dispose() in
    // world.dispose().
  }

  function _computeRootStreetAndGem() {
    rootStreet = (layout?.streets ?? []).filter((s) => s.isRoot)[0] || null;
    if (!rootStreet) {
      gemWorldPos = null;
      return;
    }
    gemWorldPos = new THREE.Vector3();
    // StreetAxis import is not needed here — use orientation string directly.
    if (rootStreet.orientation === 'x') {
      gemWorldPos.set(rootStreet.x - rootStreet.length / 2 + rootStreet.width / 2, 0, rootStreet.y);
    } else {
      gemWorldPos.set(rootStreet.x, 0, rootStreet.y - rootStreet.length / 2 + rootStreet.width / 2);
    }
  }

  // _computeDiff compares prev cells vs new cells at the per-instance
  // (file.path key) level, producing entering / staying / exiting buckets
  // that the animator uses to write instance matrices.
  //
  // Prev cell transforms are read HERE (before the cell root is disposed)
  // because disposal releases the InstancedMesh attribute buffers. The
  // snapshot is captured in PrevState.cells — the Map reference is stable
  // across the disposal because we replace the module-level `_cells`
  // binding but the snapshot still points at the old Map.
  function _computeDiff(prev: PrevState): WorldDiff {
    const entering: { buildings: EnteringBuilding[]; streets: EnteringStreet[] } = {
      buildings: [],
      streets: [],
    };
    const exiting: { buildings: ExitingEntry[]; streets: ExitingEntry[] } = {
      buildings: [],
      streets: [],
    };
    const staying: { buildings: StayingBuilding[]; streets: StayingStreet[] } = {
      buildings: [],
      streets: [],
    };

    // --- Buildings diff (InstancedMesh semantics) ---
    //
    // Build a map from file.path → prior transform (scale + position).
    // Read from each cell's detailMesh at the building's slotId to capture
    // whatever the animator left it at (so a rapid edit doesn't snap to layout).
    const prevTransforms = new Map<
      string,
      { scaleX: number; scaleY: number; scaleZ: number; posX: number; posY: number; posZ: number }
    >();
    const _readMatrix = new THREE.Matrix4();
    const _pos = new THREE.Vector3();
    const _scale = new THREE.Vector3();
    const _quat = new THREE.Quaternion();

    // Read prior transforms from the old CellTile meshes.
    // NOTE: prev.cells is the snapshot captured before _cells was replaced.
    // The old cell root may already be disposed, but the CellTile.detailMesh
    // references are still valid until GC collects them — we only read, not draw.
    for (const cell of prev.cells.values()) {
      for (let slot = 0; slot < cell.buildings.length; slot++) {
        const b = cell.buildings[slot];
        if (!b?.file?.path) continue;
        if (cell.detailMesh) {
          cell.detailMesh.getMatrixAt(slot, _readMatrix);
          _readMatrix.decompose(_pos, _quat, _scale);
          prevTransforms.set(b.file.path, {
            scaleX: _scale.x,
            scaleY: _scale.y,
            scaleZ: _scale.z,
            posX: _pos.x,
            posY: _pos.y,
            posZ: _pos.z,
          });
        } else {
          prevTransforms.set(b.file.path, {
            scaleX: b.w,
            scaleY: b.h,
            scaleZ: b.d,
            posX: b.x,
            posY: b.h / 2,
            posZ: b.y,
          });
        }
      }
    }

    // Walk the new BuildingIndex to classify entering vs staying.
    if (_buildingIndex) {
      for (const b of _buildingIndex.byPath.values()) {
        if (!b.file?.path) continue;
        const newScaleX = b.w;
        const newScaleY = b.h;
        const newScaleZ = b.d;
        const newPosX = b.x;
        const newPosY = b.h / 2;
        const newPosZ = b.y;
        const instanceId = b.slotId ?? 0;

        const prior = prevTransforms.get(b.file.path);
        if (prior) {
          staying.buildings.push({
            building: b,
            instanceId,
            newScaleX,
            newScaleY,
            newScaleZ,
            newPosX,
            newPosY,
            newPosZ,
            oldScaleX: prior.scaleX,
            oldScaleY: prior.scaleY,
            oldScaleZ: prior.scaleZ,
            oldPosX: prior.posX,
            oldPosY: prior.posY,
            oldPosZ: prior.posZ,
          });
        } else {
          entering.buildings.push({
            building: b,
            instanceId,
            newScaleX,
            newScaleY,
            newScaleZ,
            newPosX,
            newPosY,
            newPosZ,
          });
        }
      }
    }

    // Exiting buildings: paths present in prev but absent from new.
    // V1: no exit animation — they just vanish when cells are rebuilt.
    // We still populate the exiting bucket so subscribers can track counts.
    const newPaths = new Set<string>();
    if (_buildingIndex) {
      for (const path of _buildingIndex.byPath.keys()) newPaths.add(path);
    }
    for (const [path] of prevTransforms) {
      if (!newPaths.has(path)) {
        exiting.buildings.push({});
      }
    }

    // --- Streets diff (still per-mesh) ---
    const prevStreets: Record<string, THREE.Mesh> = {};
    for (const sw of prev.streetPickables ?? []) {
      const dp = sw.userData.street?.dir?.path;
      if (dp != null) prevStreets[dp] = sw;
    }
    for (const nsw of streetPickables) {
      const ndp = nsw.userData.street?.dir?.path;
      if (ndp == null) continue;
      if (Object.hasOwn(prevStreets, ndp)) {
        staying.streets.push({ oldMesh: prevStreets[ndp], newMesh: nsw });
        delete prevStreets[ndp];
      } else {
        entering.streets.push({ mesh: nsw });
      }
    }
    for (const sk in prevStreets) {
      if (Object.hasOwn(prevStreets, sk)) {
        exiting.streets.push({ mesh: prevStreets[sk] });
      }
    }

    return { entering, exiting, staying };
  }

  // Manifest is typed loosely because world.test.ts builds mock
  // manifests with string `type` fields rather than the literal
  // 'directory'/'file'. Real callers (the scanner/IPC path) hand us
  // proper Manifest objects.
  async function applyManifest(
    newManifest: Manifest | { tree: unknown; [k: string]: unknown }
  ): Promise<void> {
    const myGeneration = ++_currentGeneration;
    const newManifestTyped = newManifest as Manifest;

    // Friendly display name: rewrite tree.name to the human label derived from
    // display_root/remote_url BEFORE building, so every downstream consumer
    // (root street label, tree root row, footer, document.title) shows it
    // instead of the cache-dir hash. Cheap + idempotent.
    const _friendlyName = labelFromManifest(newManifestTyped);
    if (newManifestTyped.tree && _friendlyName) {
      newManifestTyped.tree.name = _friendlyName;
    }

    const prev: PrevState = {
      streetPickables,
      streetLabels,
      asphaltMeshes,
      manifest,
      layout,
      cells: _cells,
      buildingIndex: _buildingIndex,
    };

    _emit(beforeChangeCbs, prev);

    // Refresh the building-roof icon atlas when the file structure changed.
    // Building it is expensive (one fetch+draw per unique icon), so gate on the
    // structure-only tree_signature: settings-driven rebuilds re-apply the same
    // manifest (skip), while initial load / a new source / a live-update poll
    // with new or renamed files rebuild it. Done before the cell pass below so
    // the buildings sample the right glyphs.
    const _atlasTreeSig = newManifestTyped.tree_signature ?? '';
    if (_atlasTreeSig !== _lastAtlasTreeSig) {
      try {
        const atlas = await buildIconAtlas(newManifestTyped);
        if (myGeneration !== _currentGeneration) return; // superseded mid-build
        _lastAtlasTreeSig = _atlasTreeSig;
        // Push the atlas into the buildings component's shared material + cell
        // factory BEFORE the cell pass below (rebuild reads it while assembling
        // the cells). The atlas ensure stays in world (Option B): the
        // tree_signature gate + the myGeneration supersede check above are
        // world-owned.
        _buildings.setAtlas(atlas);
      } catch (err) {
        console.warn('[codecity] icon atlas build failed; roofs will render without icons', err);
      }
    }

    // ---- Phase 1: compute the new layout off-thread via layoutClient.
    // A later applyManifest can preempt us by bumping _currentGeneration;
    // layoutClient signals that via a 'superseded' rejection.
    // Use the server-computed tree_signature as the layout-cache key.
    // It is structure-only (paths + nesting, NO mtime/size), so it is
    // stable across skeleton/final events for the same scan.
    const _treeSig = newManifestTyped.tree_signature ?? '';
    const _reuseFrom = _treeSig && _cachedLayoutTreeSig === _treeSig ? _cachedLayout : null;
    const _layoutComputeOpts: LayoutComputeOpts = _reuseFrom ? { reuseLayoutFrom: _reuseFrom } : {};
    let newLayout: CityLayout;
    // Pass the full manifest envelope (not `manifest.tree`) — the worker
    // forwards it to layoutCityV4, which internally unwraps `.tree` via
    // `(manifest as { tree?: DirLike }).tree ?? manifest`. Both shapes
    // produce the same layout, but routing through the envelope keeps
    // the worker message contract typed against `Manifest` rather than
    // a structural `DirLike`. A reject with `Error('superseded')` is
    // expected when a newer applyManifest preempts us — return silently
    // so the newer run owns the swap.
    try {
      newLayout = await _layoutClient.compute(newManifestTyped, _layoutComputeOpts);
    } catch (err) {
      if (err instanceof Error && err.message === 'superseded') return;
      throw err;
    }
    const _layoutReused = _reuseFrom !== null;
    // Cache the layout for the next call (keyed by tree_signature).
    if (_treeSig) {
      _cachedLayoutTreeSig = _treeSig;
      _cachedLayout = newLayout;
    }
    if (myGeneration !== _currentGeneration) return;

    // ---- Phase 2: derive date ranges for the NEW layout. File refs and
    // dimensions are already correct — layoutClient recomputed them via
    // reuseLayout (cheap path) or the worker produced them fresh (full
    // compute). The per-building color/age writes happen inside
    // _buildings.rebuild (which receives these date ranges). Nothing here
    // touches the scene yet.
    const newDateRanges = getDateRanges(
      newManifestTyped.tree as unknown as Parameters<typeof getDateRanges>[0]
    );
    // Per-building color/age writes + the cell assembly moved into
    // _buildings.rebuild(newLayout, newDateRanges) below.
    if (myGeneration !== _currentGeneration) return;

    // ---- Cell rendering path ---------------------------------------------
    // The buildings component owns the SpatialGrid + CellTile scene. It colors
    // the buildings, assembles the cells, swaps them into its persistent group
    // (disposing the prior cell root WITHOUT freeing the shared material), and
    // rebuilds the building-by-path lookup. Always rebuilt (the cell root is
    // the one thing always rebuilt — NOT scenic-gated) to reflect updated
    // per-file metadata (colors, heights). rebuild has no internal await, so
    // it cannot be superseded mid-build; world mirrors _cells/_buildingIndex
    // from it AFTER (and before _computeDiff) for the Option B diff.

    // ---- Atomic swap ----
    //
    // Scenic state reuse: when the layout was reused (same tree_signature,
    // positions/streets/paths unchanged) AND buildWorld was already run
    // for this signature, AND none of the config stores that affect scenic
    // output have changed (same config hash), the streets/labels/paths/gem
    // meshes are already in the scene and would produce identical output —
    // skip the dispose + rebuild. Only the buildings cell root is always
    // rebuilt (fast) to reflect updated per-file metadata (colors, heights).
    const _currentScenicConfigHash = computeScenicConfigHash();
    const _scenicValid =
      _layoutReused &&
      _lastBuildWorldTreeSig !== null &&
      _lastBuildWorldTreeSig === _treeSig &&
      _lastScenicConfigHash === _currentScenicConfigHash &&
      streetPickables.length > 0; // guard: scenic state actually exists in scene

    // The gem is rebuilt EXACTLY on the full-rebuild path — never on scenic
    // reuse (rebuilding then would flash + realloc GPU = behavior change).
    const _didFullRebuild = !_scenicValid;

    // Buildings rebuild on BOTH branches (always) — never gated by _scenicValid.
    // setAtlas already ran above (before this) so the atlas is in the material
    // before the cells read it.
    await _buildings.rebuild(newLayout, newDateRanges);

    if (_scenicValid) {
      // Do NOT call _disposeAllManifestState() — existing streets/labels/
      // paths/gem stay in the scene unmodified. Do NOT call buildWorld.
      manifest = newManifestTyped;
      layout = newLayout;
      dateRanges = newDateRanges;
      // bbox stays from the previous buildWorld call (layout unchanged).
    } else {
      // Full rebuild path: dispose existing scenic state, run buildWorld,
      // and add the new meshes to the scene.
      _disposeAllManifestState();

      manifest = newManifestTyped;
      layout = newLayout;
      dateRanges = newDateRanges;

      // Rebuild the streets component's meshes (sidewalks, asphalt, labels)
      // into its persistent group (already in the scene). The component owns
      // the meshes + the sidewalk/street lookup maps; world reassigns its
      // module-level arrays from the component so PrevState/_computeDiff still
      // read populated arrays (the street diff is vestigial — see comment at
      // the _streets construction site).
      _streets.rebuild(newLayout);
      streetPickables = _streets.pickables();
      streetLabels = _streets.labels();
      asphaltMeshes = _streets.asphalt();

      // bbox over the street meshes only (same geometry set the old
      // _buildWorld local-scene bbox covered) — NOT setFromObject(scene),
      // since the world scene now also holds sky/island/gem/footprint, which
      // would yield the wrong bbox. Empty fallback prevents NaN at boot when
      // the layout has zero meshes (matches the old _buildWorld fallback).
      bbox = new THREE.Box3().setFromObject(_streets.group);
      if (bbox.isEmpty()) {
        bbox.set(new THREE.Vector3(-50, 0, -50), new THREE.Vector3(50, 10, 50));
      }
      // The street bbox covers streets only — NOT buildings (rendered
      // separately via the cell-based instanced renderer). Expand the bbox to
      // include each building's XZ footprint + Y height so downstream
      // consumers (sceneBbox sizing, camera framing in cameraRig) get the
      // FULL visible city.
      for (const b of newLayout.buildings) {
        bbox.expandByPoint(new THREE.Vector3(b.x - b.w / 2, 0, b.y - b.d / 2));
        bbox.expandByPoint(new THREE.Vector3(b.x + b.w / 2, b.h, b.y + b.d / 2));
      }
      // Expand by the city-footprint halo width so the bbox includes the
      // asphalt slab that wraps around the city silhouette (every layout
      // rect is inflated by HALO_WIDTH for the footprint pass). Only
      // expand XZ — Y stays bounded by the actual building heights so
      // cityHeight calc isn't inflated.
      const footprintCfg = FOOTPRINT.value;
      if (footprintCfg.ENABLED && footprintCfg.HALO_WIDTH > 0) {
        const halo = footprintCfg.HALO_WIDTH;
        bbox.min.x -= halo;
        bbox.min.z -= halo;
        bbox.max.x += halo;
        bbox.max.z += halo;
      }

      scene.background = new THREE.Color(SCENE.value.SKY_COLOR);

      // Record that scenic state is now valid for this tree_signature + config.
      _lastBuildWorldTreeSig = _treeSig || null;
      _lastScenicConfigHash = _currentScenicConfigHash;
    }

    // Mirror the buildings component's cells + index into world's module vars
    // for the Option B diff. _buildings is the source of truth; world reads
    // these mirrors in PrevState.cells (next applyManifest) + _computeDiff
    // (below). MUST run AFTER rebuild and BEFORE _computeDiff(prev). The `prev`
    // snapshot captured the OLD _cells at the top of applyManifest — never
    // reassign _cells before that capture.
    _cells = _buildings.getCells();
    _buildingIndex = _buildings.getBuildingIndex();

    _computeRootStreetAndGem();
    // Rebuild the gem's inner mesh only on the full-rebuild path, matching
    // exactly when buildWorld used to build it (scenic reuse leaves the
    // existing gem untouched). rootStreet was just set by the call above.
    if (_didFullRebuild && rootStreet) _gem.rebuild(rootStreet);

    // City is now in the scene. Decoration pass (trees, future mesa
    // bounds, etc.) is deferred to the next animation frame so the
    // city paints + becomes interactive BEFORE the placement scan +
    // GPU upload blocks the main thread. For large repos this gap is
    // the difference between a snappy rebuild and a multi-hundred-ms
    // freeze.
    const treesEnabled = TREES.value.ENABLED;
    // Trees + fireflies are rebuilt every applyManifest (never scenic-gated).
    // clear() the inner meshes BEFORE the first onChange emit below so the
    // picker's pickables refresh sees no tree meshes on that emit —
    // identical to the old dispose-then-emit ordering. clear() is idempotent.
    _trees.clear();
    _fireflies.clear();
    _emit(changeCbs, _computeDiff(prev));

    // Convert the THREE.Box3 (now includes building footprints — expanded
    // above right after the _streets.group bbox assignment) to a placement-style
    // CityBbox.
    const sceneBbox: CityBbox | null = bbox
      ? {
          minX: bbox.min.x,
          maxX: bbox.max.x,
          minY: bbox.min.z, // three.js Z is the second world axis
          maxY: bbox.max.z,
          cx: (bbox.min.x + bbox.max.x) / 2,
          cy: (bbox.min.z + bbox.max.z) / 2,
          width: bbox.max.x - bbox.min.x,
          depth: bbox.max.z - bbox.min.z,
        }
      : null;
    // City's vertical extent — feeds into worldBounds so small-but-tall
    // repos still get an airy floor buffer relative to building height.
    const cityHeight = bbox ? bbox.max.y - bbox.min.y : 0;

    // Floating repo-name label — anchored at the gem position (the
    // floor-level root marker). The label's elevation is governed by
    // REPO_LABEL.HEIGHT_PCT, not by city silhouette: 0 → label flush
    // with the floor; larger → label rises with a visible beam.
    _repoLabel.setRepoName(manifest.tree.name);
    _repoLabel.setAnchor(gemWorldPos ?? new THREE.Vector3());
    // Hand the live gem to the label so its beam foot tracks the
    // gem's hover height + bob animation. _gem.gem is the INNER gem
    // group whose .position.y is mutated each frame by the gem's tick().
    // refresh() is no longer called here — the component's own effect
    // owns REPO_LABEL config reactivity and re-runs on REPO_LABEL Save.
    // setAnchor already calls _applyTransform() which positions the group.
    _repoLabel.setGem(_gem.gem);

    // Floor is sized from the scene's bbox + buffer. Falls back to a
    // small default at the origin when there's no city (empty manifest).
    latestWorldBounds = getWorldBounds(sceneBbox, cityHeight);
    _island.setBounds(latestWorldBounds);

    if (bbox) {
      // Footprint is cheap (one InstancedMesh, no rejection sampling),
      // so we don't need the rAF+setTimeout defer the tree path uses.
      // rebuild() disposes the prior inner mesh and builds a new one
      // into the persistent _footprint.group (already in the scene).
      _footprint.rebuild(newLayout);
    }

    if (treesEnabled && bbox && sceneBbox) {
      // Snapshot what the deferred pass needs so a later applyManifest
      // bumping _currentGeneration doesn't race with this build.
      const generationAtDefer = myGeneration;
      const layoutAtDefer = newLayout;
      const commitCountAtDefer = manifest.commits?.length ?? 0;
      const cityHeightAtDefer = cityHeight;
      const foliageBbox: CityBbox = sceneBbox;

      REBUILD_STATUS.value = RebuildStatus.Decorating;
      // rAF lets the browser START the next frame; setTimeout(0)
      // then yields the task so the browser can COMPLETE the paint
      // before foliage work begins.
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      await new Promise<void>((r) => setTimeout(r, 0));
      if (generationAtDefer !== _currentGeneration) return;

      // Off-thread tree placement via the worker. The supersede protocol
      // rejects this promise with "superseded" if another applyManifest
      // fires while placement is in-flight.
      let treePlacements: import('./components/trees/treePlacement.js').TreePlacement[];
      try {
        treePlacements = await _treePlacementClient.compute(
          layoutAtDefer,
          foliageBbox,
          commitCountAtDefer,
          cityHeightAtDefer
        );
      } catch (err) {
        if (err instanceof Error && err.message === 'superseded') return;
        throw err;
      }
      if (generationAtDefer !== _currentGeneration) return;

      _trees.rebuild(
        treePlacements,
        manifest.commits ?? null,
        manifest.busyness ?? { avg: 1, busy: 1 }
      );
      _fireflies.rebuild(treePlacements, manifest.commits ?? null);

      // Re-notify listeners now that async decoration (trees) is
      // fully attached to the scene. The first onChange fired before this
      // deferred block ran, so world.getTrees() returned null at that
      // point — the picker's _refreshPickables() therefore had no tree
      // meshes to include. This second emit gives the picker (and any
      // other subscriber) a chance to re-refresh with the live tree group.
      // We pass an empty diff because only foliage changed; no building or
      // street geometry was added since the first emit.
      // Defensive guard — always true today: rebuild() above always sets
      // the handle, and the disabled/empty cases bail at the deferred-block
      // gate (treesEnabled && bbox && sceneBbox) before reaching here.
      if (_trees.handle() !== null) {
        _emit(changeCbs, {
          entering: { buildings: [], streets: [] },
          exiting: { buildings: [], streets: [] },
          staying: { buildings: [], streets: [] },
        });
      }

      REBUILD_STATUS.value = RebuildStatus.Idle;
    } else {
      // No deferred decoration pass (trees disabled, or an empty/degenerate
      // bbox), so there's no async foliage work to await — drop straight back
      // to Idle. Without this, a caller that flipped REBUILD_STATUS to
      // Rebuilding (the live-update render effect in useCityScene, or a
      // settings rebuild) would never be cleared and the footer dot would
      // stick yellow. Superseded applies bail via the early returns inside the
      // if-branch above and never reach here, so they can't clobber the status
      // of a newer apply that has already taken over.
      REBUILD_STATUS.value = RebuildStatus.Idle;
    }
  }

  function dispose() {
    _disposeAllManifestState();
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
    _cachedLayoutTreeSig = null;
    _cachedLayout = null;
    _lastBuildWorldTreeSig = null;
    _lastScenicConfigHash = null;
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
    _cachedLayoutTreeSig = null;
    _cachedLayout = null;
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
      return manifest;
    },
    getLayout() {
      return layout;
    },
    runCollisionCheck(): void {
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
      return bbox;
    },
    /** Current world floor bounds (rectangle the plane covers). Null
     *  until the first manifest has been applied. */
    getWorldBounds(): WorldBounds | null {
      return latestWorldBounds;
    },
    getRoot() {
      return manifest && manifest.tree;
    },
    getDateRanges() {
      return dateRanges;
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
      return rootStreet;
    },
    getGemWorldPos() {
      return gemWorldPos;
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
    getAdPanels(): import('./components/buildings/adPanelsInstanced.js').InstancedAdPanels | null {
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
