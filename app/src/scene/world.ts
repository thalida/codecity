// scene/world.ts — owns the persistent THREE.Scene plus every
// manifest-bound mesh (buildings, streets, labels, paths, asphalt, root
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
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

import { registerShaderChunks } from './utils/color/registerShaderChunks';
import { getSharedBuildingUniforms } from './components/buildings/buildings';
import { disposeLabelMaterials } from './components/labels/labels';
import { buildCellsFromLayout } from './layout/cellAssembly';
import type { CellTile } from './layout/cellTile';
import { BuildingIndex } from './components/buildings/buildingIndex';
import { findLayoutOverlaps } from './layout/layout';
import type { LayoutOverlap } from './layout/layout';
import { createLayoutClient } from './layout/layoutClient';
import type { LayoutComputeOpts } from './layout/layoutClient';
import { layoutCityWithTrace } from './layout/layout';
import type { ChildPlacementTrace, StemPlacementTrace } from './layout/layout';
import type { WorldRect } from './layout/worldOccupancy';
import { createRootGem } from './components/gem/gem';
import { createStreetMesh } from './components/streets/streets';
import { createStreetLabels } from './components/streets/streetLabels';
import { createSky } from './components/sky/sky';
import type { Sky } from './components/sky/sky';
import { createRepoLabel } from './components/repoLabel/repoLabel';
import type { RepoLabel } from './components/repoLabel/repoLabel';
import { createTrees } from './components/trees/trees';
import type { Trees } from './components/trees/trees';
import { createFireflies } from './components/fireflies/fireflies';
import type { Fireflies } from './components/fireflies/fireflies';
import { createTreePlacementClient } from './components/trees/treePlacementClient';
import type { TreePlacementClient } from './components/trees/treePlacementClient';
import { createIsland } from './components/island/islandMesh';
import type { Island } from './components/island/islandMesh';
import { getWorldBounds, type WorldBounds } from './layout/worldBounds';
import { createCityFootprint } from './components/footprint/footprint';
import type { CityFootprint } from './components/footprint/footprint';
import { FOOTPRINT } from '@/state/stores/settings/footprint';
import {
  getBuildingColor,
  getCreatedAge,
  getModifiedAge,
  getDateRanges,
} from './components/buildings/buildingColor';
import {
  STREETS,
  GEM,
  GEM_SIZING,
  TREES,
  SCENE,
} from '@/state/stores/settings/index';
import { REBUILD_STATUS } from '@/state/stores/manifest';
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
  rootGem: THREE.Group | null;
  manifest: Manifest | null;
  layout: CityLayout | null;
  /** Snapshot of cells before they are replaced/disposed. */
  cells: Map<number, CellTile>;
  /** Snapshot of building index before it is replaced. */
  buildingIndex: BuildingIndex | null;
}

// 12 edges of a unit cube as flat [x,y,z, x,y,z, ...] segment endpoints.
// Used by Line2 outlines (rendered as triangle strips so linewidth is
// settable in pixels — regular WebGL lines are locked to 1px). Exported
// so the hover/selected outline meshes in main.js (and later in
// outlineRenderer.js) share this geometry definition.
export const UNIT_BOX_EDGE_POSITIONS = [
  // Bottom face (y = -0.5) — 4 edges around the base.
  -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5, -0.5,
  0.5, -0.5, -0.5, 0.5, -0.5, -0.5, -0.5,
  // Top face (y = 0.5) — 4 edges around the roof.
  -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
  -0.5, 0.5, 0.5, -0.5, 0.5, -0.5,
  // Vertical edges — 4 edges connecting corresponding base + roof corners.
  -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5,
  -0.5, -0.5, 0.5, -0.5, 0.5, 0.5,
];

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

// _buildWorld(layout) — one-shot scene builder.
//
// Composes the streets / street labels / root gem component factories
// into a fresh THREE.Scene and returns the lookup tables createWorld
// needs to wire interaction + post-processing.
// Per-cell instanced building/label/adPanel meshes are NOT built here —
// scene/layout/cellAssembly.ts handles those once the layout is in hand.
function _buildWorld(layout: CityLayout) {
  // All visual values (street colors, sidewalk default, label fill/stroke,
  // gem edge color, etc.) come from the named exports of @/config.
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SCENE.value.SKY_COLOR);

  // Streets + their labels
  const streets = layout.streets || [];
  type FlatMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  const streetPickables: FlatMesh[] = [];
  const asphaltMeshes: FlatMesh[] = [];
  const streetLabels: THREE.Group[] = [];
  let rootGem: THREE.Group | null = null;
  let rootGemBody: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | null = null;
  let rootGemEdges: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial> | null = null;
  for (const street of streets) {
    const sg = createStreetMesh(street, 0);
    scene.add(sg);
    streetPickables.push(sg.userData.sidewalk as FlatMesh);
    if (sg.userData.asphalt) asphaltMeshes.push(sg.userData.asphalt as FlatMesh);

    const labels = createStreetLabels(street);
    for (const label of labels) {
      scene.add(label);
      streetLabels.push(label);
    }

    // Root-of-repo landmark at the street's origin end. The gem group
    // wraps two children: [0] body (the colored octahedron) and [1]
    // edges (the dark separator lines). Both are exposed so the Settings
    // UI can hot-update color + opacity.
    if (street.isRoot) {
      const gemGroup = createRootGem(street);
      scene.add(gemGroup);
      rootGem = (gemGroup.userData.gem as THREE.Group) || null;
      if (rootGem) {
        rootGemBody =
          (rootGem.userData.body as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>) ||
          null;
        rootGemEdges =
          (rootGem.userData.edges as THREE.LineSegments<
            THREE.BufferGeometry,
            THREE.LineBasicMaterial
          >) || null;
      }
    }
  }

  // Bounding box of the whole city (in scene coords). Caller uses it
  // to frame the camera. Empty fallback prevents NaN at boot when the
  // layout has zero meshes.
  const bbox = new THREE.Box3().setFromObject(scene);
  if (bbox.isEmpty()) {
    bbox.set(new THREE.Vector3(-50, 0, -50), new THREE.Vector3(50, 10, 50));
  }

  // buildingMeshes is empty — per-building meshes live in cell
  // InstancedMeshes, not on this scene. Returned for shape compatibility
  // with world's disposal loop.
  const buildingMeshes: THREE.Mesh[] = [];

  return {
    scene,
    buildingMeshes,
    streetPickables,
    streetLabels,
    asphaltMeshes,
    rootGem,
    rootGemBody,
    rootGemEdges,
    bbox,
  };
}

// `canvas` is unused; kept in the signature so call sites (main.ts, tests)
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

  // Cyberpunk Valley sky — built ONCE here, lives at scene root for
  // the lifetime of the world. Not rebuilt per applyManifest
  // (the sky is wallpaper, independent of the manifest tree). Always
  // rendered — the icosphere is never hidden.
  const _sky: Sky = createSky();
  scene.add(_sky.mesh);

  // Floating repo-name label — created ONCE at scene init, parallel
  // to sky and island. The group is empty (and invisible-effectively)
  // until applyManifest calls setRepoName + setAnchor.
  const _repoLabel: RepoLabel = createRepoLabel();
  scene.add(_repoLabel.group);

  // Cyberpunk Valley floating island — a shaped polygonal slab that
  // replaces the old flat world-floor plane. Built ONCE at scene init
  // (it's not layout-dependent — the island is sized to the world
  // bounds, not the city mesh). Sits at renderOrder -500, so it
  // draws AFTER the sky (-1000) but BEFORE the city's own ground
  // tiles (sidewalks at 1, asphalt at 3) — those paint on top.
  const _island: Island = createIsland(null);
  scene.add(_island.group);

  // Cyberpunk Valley trees — REBUILT per applyManifest. One tree per
  // commit, placed commit-driven across the world floor.
  let _trees: Trees | null = null;

  // Cyberpunk Valley fireflies — REBUILT per applyManifest. One orb
  // cluster per tree (commit), driven by GPU shader bob animation.
  let _fireflies: Fireflies | null = null;

  // Tree placement client — owns the off-thread worker (or its sync
  // fallback in test envs). One instance per world; disposed when
  // the world is disposed.
  const _treePlacementClient: TreePlacementClient = createTreePlacementClient();

  // Cyberpunk Valley city footprint — REBUILT per applyManifest.
  // One InstancedMesh of inflated layout rects that composes into a
  // contoured asphalt slab. Cheap to build (no rejection sampling),
  // so it is created synchronously inside applyManifest. Held here
  // so applyTheme() can call .refresh() through getCityFootprint().
  let _cityFootprint: CityFootprint | null = null;

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
  // MeshBasicMaterial; main.ts's color-update path reads
  // `mesh.material.color` directly. Typing them with a single material
  // (rather than the default `Material | Material[]`) keeps that
  // callsite's `.material.color` access working.
  type FlatMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;

  let streetPickables: FlatMesh[] = [];
  let streetLabels: THREE.Group[] = [];
  let asphaltMeshes: FlatMesh[] = [];
  let rootGem: THREE.Group | null = null;
  // rootGem children expose `.material.{color,opacity}` directly to the
  // applyTheme code in main.ts; type with single-material variants so
  // those member accesses remain checked rather than `Material |
  // Material[]`-shaped.
  let rootGemBody: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | null = null;
  let rootGemEdges: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial> | null = null;

  // Outline / ghost stubs — kept so outlineRenderer's
  // getBuildingOutlines() / getBuildingGhosts() calls iterate an empty
  // list and no-op (the cell path renders outlines through a different
  // mechanism).
  const buildingOutlines: LineSegments2[] = [];
  const buildingOutlineMats: LineMaterial[] = [];
  const buildingGhosts: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[] = [];

  let sidewalksByDirPath: Record<string, FlatMesh> = {};
  let streetsByDirPath: Record<string, Street> = {};
  let buildingsByPath: Record<
    string,
    { mesh: THREE.Mesh; building: Building; instanceId: number }
  > = {};

  // Cell-rendering state — owns the InstancedMesh-per-cell scene root.
  let _cellRoot: THREE.Group | null = null;
  let _cells: Map<number, CellTile> = new Map();
  let _buildingIndex: BuildingIndex | null = null;
  // Instanced ad panels (DataArrayTexture-backed). One instance per
  // applyManifest call; disposed on full rebuild or resetCache.
  let _instancedAdPanels:
    | import('./components/adPanels/adPanelsInstanced.js').InstancedAdPanels
    | null = null;

  // Layout cache: avoid redundant _layoutClient.compute() when
  // the manifest's tree shape is unchanged (e.g., skeleton → final transition).
  // Keyed by manifest.tree_signature — computed server-side from paths + nesting
  // only (no mtime/size), so it is stable across skeleton/final events for the
  // same scan even though per-file metadata differs between the two phases.
  let _cachedLayoutTreeSig: string | null = null;
  let _cachedLayout: CityLayout | null = null;

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
        FACE_1: GEM.value.FACE_1, FACE_2: GEM.value.FACE_2, FACE_3: GEM.value.FACE_3,
        FACE_4: GEM.value.FACE_4, FACE_5: GEM.value.FACE_5, FACE_6: GEM.value.FACE_6,
        FACE_7: GEM.value.FACE_7, FACE_8: GEM.value.FACE_8,
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
    // shared across cell tiles (buildingsCell.ts / labelsCell.ts factories).
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
    const paired = (mesh.userData && mesh.userData.paired) || null;
    if (paired) {
      if (paired.outline) _removeAndDispose(paired.outline);
      if (paired.ghost) _removeAndDispose(paired.ghost);
    }
    _disposeObject(mesh);
  }

  function _disposeAllManifestState() {
    // Cached label materials (keyed by atlas textures) are released so the
    // next applyManifest builds a fresh set.
    disposeLabelMaterials();

    for (const m of streetPickables) _removeAndDispose(m);
    for (const m of streetLabels) _removeAndDispose(m);
    for (const m of asphaltMeshes) _removeAndDispose(m);
    if (rootGem) {
      if (rootGem.parent) rootGem.parent.remove(rootGem);
      rootGem.traverse(_disposeObject);
    }
  }

  function _buildLookups() {
    sidewalksByDirPath = {};
    streetsByDirPath = {};
    for (const sw of streetPickables) {
      const swStreet = sw.userData.street;
      const swDir = swStreet?.dir;
      if (swDir?.path != null) {
        sidewalksByDirPath[swDir.path] = sw;
        streetsByDirPath[swDir.path] = swStreet;
      }
    }

    // buildingsByPath stores the cell's InstancedMesh + slotId so the
    // picker and other consumers can target the right per-instance attribute
    // slot. Walks _cells (the cell-mode building store) directly.
    buildingsByPath = {};
    for (const cell of _cells.values()) {
      if (!cell.detailMesh) continue;
      for (let i = 0; i < cell.buildings.length; i++) {
        const b = cell.buildings[i];
        if (b?.file?.path != null) {
          buildingsByPath[b.file.path] = {
            mesh: cell.detailMesh as unknown as THREE.Mesh,
            building: b,
            instanceId: i,
          };
        }
      }
    }
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

    const prev: PrevState = {
      streetPickables,
      streetLabels,
      asphaltMeshes,
      rootGem,
      manifest,
      layout,
      cells: _cells,
      buildingIndex: _buildingIndex,
    };

    _emit(beforeChangeCbs, prev);

    // ---- Phase 1: compute the new layout off-thread via layoutClient.
    // A later applyManifest can preempt us by bumping _currentGeneration;
    // layoutClient signals that via a 'superseded' rejection.
    const newManifestTyped = newManifest as Manifest;
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

    // ---- Phase 2: derive date ranges + color buildings on the NEW layout's
    // building list. File refs and dimensions are already correct — layoutClient
    // recomputed them via reuseLayout (cheap path) or the worker produced them
    // fresh (full compute). dateRanges and the color loops don't touch the scene yet.
    const newDateRanges = getDateRanges(
      newManifestTyped.tree as unknown as Parameters<typeof getDateRanges>[0]
    );
    const newBuildings = newLayout?.buildings ?? [];

    for (const b of newBuildings) {
      // Building.file is always a FileNode (directories become streets,
      // not buildings — see layoutV4.ts).
      b.color = getBuildingColor(
        b.file as unknown as Parameters<typeof getBuildingColor>[0],
        newDateRanges
      );
      // createdAge is independent of color: it tracks file age (creation
      // date) so grime/weathering can mark old files even if they were
      // recently edited.
      b.createdAge = getCreatedAge(
        b.file as unknown as Parameters<typeof getCreatedAge>[0],
        newDateRanges
      );
      b.modifiedAge = getModifiedAge(
        b.file as unknown as Parameters<typeof getModifiedAge>[0],
        newDateRanges
      );
    }
    if (myGeneration !== _currentGeneration) return;

    // ---- Cell rendering path ---------------------------------------------
    // Build a SpatialGrid + CellTile scene. The atomic swap disposes the
    // previous cell root and builds a fresh one. The layout is already
    // correct (file refs + dimensions recomputed by layoutClient.reuseLayout
    // on cache-hit, or freshly computed by the worker on cache-miss), so
    // this single path handles all cases.

    // Derive WorldBounds from the layout bbox. Fall back to building extents
    // if bbox is absent (shouldn't happen for a real manifest, but safe).
    const lb = newLayout.bbox;
    const bounds = lb
      ? { minX: lb.minX, maxX: lb.maxX, minZ: lb.minY, maxZ: lb.maxY }
      : (() => {
          let minX = 0,
            maxX = 0,
            minZ = 0,
            maxZ = 0;
          for (const b of newBuildings) {
            if (b.x - b.w / 2 < minX) minX = b.x - b.w / 2;
            if (b.x + b.w / 2 > maxX) maxX = b.x + b.w / 2;
            if (b.y - b.d / 2 < minZ) minZ = b.y - b.d / 2;
            if (b.y + b.d / 2 > maxZ) maxZ = b.y + b.d / 2;
          }
          return { minX, maxX, minZ, maxZ };
        })();

    // Build the cell scene (buildings only — streets/labels/paths/gem
    // are produced by buildWorld below).
    const cellOut = buildCellsFromLayout(bounds, newBuildings, getSharedBuildingUniforms());

    if (myGeneration !== _currentGeneration) {
      // Superseded while we were building — clean up and bail.
      cellOut.sceneRoot.traverse(_disposeObject);
      return;
    }

    // ---- Atomic swap ----
    //
    // Scenic state reuse: when the layout was reused (same tree_signature,
    // positions/streets/paths unchanged) AND buildWorld was already run
    // for this signature, AND none of the config stores that affect scenic
    // output have changed (same config hash), the streets/labels/paths/gem
    // meshes are already in the scene and would produce identical output —
    // skip the dispose + rebuild. Only the cell root is always rebuilt
    // (fast) to reflect updated per-file metadata (colors, heights).
    const _currentScenicConfigHash = computeScenicConfigHash();
    const _scenicValid =
      _layoutReused &&
      _lastBuildWorldTreeSig !== null &&
      _lastBuildWorldTreeSig === _treeSig &&
      _lastScenicConfigHash === _currentScenicConfigHash &&
      streetPickables.length > 0; // guard: scenic state actually exists in scene

    if (_scenicValid) {
      // Do NOT call _disposeAllManifestState() — existing streets/labels/
      // paths/gem stay in the scene unmodified. Do NOT call buildWorld.

      // Dispose old cell root before the new one is swapped in.
      if (_cellRoot) {
        _cellRoot.traverse(_disposeObject);
        if (_cellRoot.parent) _cellRoot.parent.remove(_cellRoot);
      }
      // Dispose old instanced ad panels (layout reused → new ad panels from cellOut).
      if (_instancedAdPanels) {
        _instancedAdPanels.dispose();
        _instancedAdPanels = null;
      }

      manifest = newManifestTyped;
      layout = newLayout;
      dateRanges = newDateRanges;
      // bbox stays from the previous buildWorld call (layout unchanged).

      _cellRoot = cellOut.sceneRoot;
      _cells = cellOut.cells;
      _buildingIndex = cellOut.index;
      _instancedAdPanels = cellOut.adPanels;

      // Add the new cell root (instanced building InstancedMeshes + ad panels).
      scene.add(_cellRoot);
    } else {
      // Full rebuild path: dispose existing scenic state, run buildWorld,
      // and add the new meshes to the scene.
      _disposeAllManifestState();

      // Dispose old cell root if present.
      if (_cellRoot) {
        _cellRoot.traverse(_disposeObject);
        if (_cellRoot.parent) _cellRoot.parent.remove(_cellRoot);
      }
      // Dispose old instanced ad panels before swapping in new ones.
      if (_instancedAdPanels) {
        _instancedAdPanels.dispose();
        _instancedAdPanels = null;
      }

      manifest = newManifestTyped;
      layout = newLayout;
      dateRanges = newDateRanges;

      _cellRoot = cellOut.sceneRoot;
      _cells = cellOut.cells;
      _buildingIndex = cellOut.index;
      _instancedAdPanels = cellOut.adPanels;

      // Also build the streets/gem sub-scene from buildWorld so
      // sidewalks, asphalt, and the root gem still appear. The cell path
      // replaces buildings; non-building scene elements are still needed.
      const cellBuilt = _buildWorld(newLayout);
      bbox = cellBuilt.bbox;
      // The bbox returned by buildWorld covers streets/gem only — NOT
      // buildings (rendered separately via the cell-based instanced
      // renderer). Expand the bbox to include each building's XZ footprint
      // + Y height so downstream consumers (sceneBbox sizing, camera
      // framing in cameraRig) get the FULL visible city.
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

      streetPickables = cellBuilt.streetPickables || [];
      streetLabels = cellBuilt.streetLabels || [];
      asphaltMeshes = cellBuilt.asphaltMeshes || [];
      rootGem = cellBuilt.rootGem || null;
      rootGemBody = cellBuilt.rootGemBody || null;
      rootGemEdges = cellBuilt.rootGemEdges || null;

      for (const child of [...cellBuilt.scene.children]) scene.add(child);
      scene.background = new THREE.Color(SCENE.value.SKY_COLOR);

      // Remove per-building meshes that buildWorld emits — the cell
      // path replaces them with InstancedMesh cells. Keep streetLabels:
      // they serve as our labels on the cell path too.
      for (const bm of cellBuilt.buildingMeshes || []) {
        if (bm.parent) bm.parent.remove(bm);
        _disposeObject(bm);
      }

      // Add the cell root (instanced building InstancedMeshes, one group per cell).
      scene.add(_cellRoot);

      // Record that scenic state is now valid for this tree_signature + config.
      _lastBuildWorldTreeSig = _treeSig || null;
      _lastScenicConfigHash = _currentScenicConfigHash;
    }

    _buildLookups();
    _computeRootStreetAndGem();

    // City is now in the scene. Decoration pass (trees, future mesa
    // bounds, etc.) is deferred to the next animation frame so the
    // city paints + becomes interactive BEFORE the placement scan +
    // GPU upload blocks the main thread. For large repos this gap is
    // the difference between a snappy rebuild and a multi-hundred-ms
    // freeze.
    const treesEnabled = TREES.value.ENABLED;
    if (_trees) {
      _trees.dispose();
      _trees = null;
    }
    if (_fireflies) {
      scene.remove(_fireflies.group);
      _fireflies.dispose();
      _fireflies = null;
    }
    if (_cityFootprint) {
      _cityFootprint.dispose();
      _cityFootprint = null;
    }

    _emit(changeCbs, _computeDiff(prev));

    // Convert the THREE.Box3 (now includes building footprints — expanded
    // above right after cellBuilt.bbox assignment) to a placement-style
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
    // gem's hover height + bob animation. rootGem is the gem GROUP
    // whose .position.y is mutated each frame by the renderLoop.
    _repoLabel.setGem(rootGem);
    _repoLabel.refresh();

    // Floor is sized from the scene's bbox + buffer. Falls back to a
    // small default at the origin when there's no city (empty manifest).
    latestWorldBounds = getWorldBounds(sceneBbox, cityHeight);
    _island.setBounds(latestWorldBounds);

    if (bbox) {
      // Footprint is cheap (one InstancedMesh, no rejection sampling),
      // so we don't need the rAF+setTimeout defer the tree path uses.
      _cityFootprint = createCityFootprint(newLayout);
      scene.add(_cityFootprint.group);
    }

    if (treesEnabled && bbox && sceneBbox) {
      // Snapshot what the deferred pass needs so a later applyManifest
      // bumping _currentGeneration doesn't race with this build.
      const generationAtDefer = myGeneration;
      const layoutAtDefer = newLayout;
      const commitCountAtDefer = manifest.commits?.length ?? 0;
      const cityHeightAtDefer = cityHeight;
      const foliageBbox: CityBbox = sceneBbox;

      REBUILD_STATUS.value = 'decorating';
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

      _trees = createTrees(treePlacements, manifest.commits ?? null, manifest.busyness ?? { avg: 1, busy: 1 });
      scene.add(_trees.group);
      _fireflies = createFireflies(treePlacements, manifest.commits ?? null);
      scene.add(_fireflies.group);

      // Re-notify listeners now that async decoration (trees) is
      // fully attached to the scene. The first onChange fired before this
      // deferred block ran, so world.getTrees() returned null at that
      // point — the picker's _refreshPickables() therefore had no tree
      // meshes to include. This second emit gives the picker (and any
      // other subscriber) a chance to re-refresh with the live tree group.
      // We pass an empty diff because only foliage changed; no building or
      // street geometry was added since the first emit.
      // Only fire when trees were actually placed — if trees are null
      // (disabled, zero commits, etc.) the first emit already captured
      // the complete state and a second one is wasteful.
      if (_trees !== null) {
        _emit(changeCbs, {
          entering: { buildings: [], streets: [] },
          exiting: { buildings: [], streets: [] },
          staying: { buildings: [], streets: [] },
        });
      }

      REBUILD_STATUS.value = 'idle';
    }
  }

  function dispose() {
    _disposeAllManifestState();
    _sky.dispose();
    _repoLabel.dispose();
    _island.dispose();
    if (_trees) {
      _trees.dispose();
      _trees = null;
    }
    if (_fireflies) {
      scene.remove(_fireflies.group);
      _fireflies.dispose();
      _fireflies = null;
    }
    if (_cityFootprint) {
      _cityFootprint.dispose();
      _cityFootprint = null;
    }
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
    if (_instancedAdPanels) {
      _instancedAdPanels.dispose();
      _instancedAdPanels = null;
    }
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
     * Cyberpunk Valley sky reference. Exposed so main.ts's applyTheme()
     * can call sky.refresh() on Save (via applyTheme()) and the render loop can call
     * sky.tick(dtSeconds) each frame.
     */
    getSky(): Sky {
      return _sky;
    },

    /**
     * Floating repo-name label reference. Exposed so main.ts's
     * applyTheme() can call repoLabel.refresh() on Save and the
     * render loop can call repoLabel.tick(dtSeconds, camera) each frame.
     */
    getRepoLabel(): RepoLabel {
      return _repoLabel;
    },

    /**
     * Cyberpunk Valley floating island reference. The island is
     * world-anchored at the gem; this is exposed for applyTheme()
     * (applyTheme() on Save) and any future external access.
     */
    getIsland(): Island {
      return _island;
    },

    /**
     * Cyberpunk Valley trees reference. Rebuilt per applyManifest, so
     * this returns null until the first manifest has been applied.
     * main.ts's applyTheme() guards with `?.refresh()` to handle the
     * pre-manifest case.
     */
    getTrees(): Trees | null {
      return _trees;
    },

    /**
     * Cyberpunk Valley fireflies reference. Rebuilt per applyManifest,
     * so this returns null until the first manifest has been applied.
     * The render loop calls setTime() each frame to drive the bob shader.
     */
    getFireflies(): Fireflies | null {
      return _fireflies;
    },

    /**
     * Cyberpunk Valley city footprint reference. Rebuilt per
     * applyManifest; null until the first manifest has been applied.
     * main.ts's applyTheme() guards with `?.refresh()`.
     */
    getCityFootprint(): CityFootprint | null {
      return _cityFootprint;
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
      let maxH = 0;
      for (const cell of _cells.values()) {
        for (const b of cell.buildings) {
          if (b && b.h > maxH) maxH = b.h;
        }
      }
      return maxH;
    },
    /**
     * Tallest building in the city, with its layout position + dimensions.
     * Used by cameraRig to compute the exact start-framing distance
     * needed to fit the building's roof corners at the top edge of the
     * vertical FOV (4 corner projections, no loop over the whole city).
     * `x` and `y` map to world X and Z; `h` is height along world Y.
     */
    getTallestBuilding(): { x: number; y: number; w: number; d: number; h: number } | null {
      let tallest: Building | null = null;
      for (const cell of _cells.values()) {
        for (const b of cell.buildings) {
          if (b && (!tallest || b.h > tallest.h)) tallest = b;
        }
      }
      if (!tallest) return null;
      return { x: tallest.x, y: tallest.y, w: tallest.w, d: tallest.d, h: tallest.h };
    },
    /**
     * Per-cell detail InstancedMeshes suitable for raycasting against.
     * Three.js raycasts InstancedMesh natively, returning hits with
     * `.instanceId` set. Used by cameraRig sightline tests.
     */
    getBuildingPickables(): THREE.Object3D[] {
      const out: THREE.Object3D[] = [];
      for (const cell of _cells.values()) {
        out.push(cell.detailMesh);
      }
      return out;
    },
    getStreetPickables() {
      return streetPickables;
    },
    getStreetLabels() {
      return streetLabels;
    },
    getAsphaltMeshes() {
      return asphaltMeshes;
    },
    getRootGem() {
      return rootGem;
    },
    getRepoLabelBounds() {
      return _repoLabel.getPanelBounds();
    },
    getRootGemBody() {
      return rootGemBody;
    },
    getRootGemEdges() {
      return rootGemEdges;
    },
    getRootStreet() {
      return rootStreet;
    },
    getGemWorldPos() {
      return gemWorldPos;
    },
    getTreeBoundsBySha(sha: string) {
      return _trees?.getTreeBoundsBySha(sha) ?? null;
    },

    // Outline/ghost arrays — empty stubs returned so existing callers
    // (outlineRenderer.refreshMaterials, outlineRenderer.onResize) iterate
    // zero elements and no-op gracefully (cell-path outlines run via a
    // separate mechanism).
    getBuildingOutlines(): LineSegments2[] {
      return buildingOutlines;
    },
    getBuildingOutlineMats(): LineMaterial[] {
      return buildingOutlineMats;
    },
    getBuildingGhosts(): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[] {
      return buildingGhosts;
    },

    getBuildingByPath(p: string) {
      return buildingsByPath[p] || null;
    },
    getSidewalkByDir(p: string) {
      return sidewalksByDirPath[p] || null;
    },
    getStreetByDir(p: string) {
      return streetsByDirPath[p] || null;
    },
    // Bulk-map accessors. Treat the returned objects as read-only —
    // their identities are stable within an applyManifest call but
    // get replaced wholesale on the next one. Exposed because some
    // existing callers (e.g. computePathPoints in scene/path.js) take
    // a whole `{ dirPath: street }` map. New consumers should prefer
    // the per-key getters above.
    getBuildingsByPath() {
      return buildingsByPath;
    },
    getSidewalksByDirMap() {
      return sidewalksByDirPath;
    },
    getStreetsByDirMap() {
      return streetsByDirPath;
    },

    // Cell-mode accessors for picker + other consumers.
    getBuildingIndex(): BuildingIndex | null {
      return _buildingIndex;
    },
    getCells(): Map<number, CellTile> {
      return _cells;
    },

    // Read-only accessor for the cell-mode ad-panel mesh manager. Used
    // by buildingFader to mirror selection-cascade body opacity onto
    // the ad-panel instances. Returns null when the current manifest
    // has no media files (no panels were created).
    getAdPanels(): import('./components/adPanels/adPanelsInstanced.js').InstancedAdPanels | null {
      return _instancedAdPanels;
    },

    // Unified mesh+slot resolver. Returns the InstancedMesh that owns this
    // building's instance and the slot index within that mesh. Resolves via
    // Building.cellId + Building.slotId.
    //
    // Returns null if no live mesh exists for this building (e.g. cellId/
    // slotId are unset, or the cell was disposed).
    getMeshForBuilding(b: Building): { mesh: THREE.InstancedMesh; slot: number } | null {
      if (_cells.size > 0 && b.cellId != null && b.slotId != null) {
        const cell = _cells.get(b.cellId);
        if (cell?.detailMesh) return { mesh: cell.detailMesh, slot: b.slotId };
      }
      return null;
    },
  };
}
