// scene/cityScene.ts — owns the persistent THREE.Scene plus every
// manifest-bound mesh (buildings, streets, labels, paths, asphalt, root
// gem) and the lookup maps consumers use to reach them by path.
//
// Public contract:
//
//   const cityScene = createCityScene(canvas);
//   cityScene.applyManifest(manifest);    // builds OR rebuilds in-place
//
//   cityScene.scene                       // THREE.Scene reference
//   cityScene.getStreetPickables(), …
//   cityScene.getBuildingByPath(p), .getSidewalkByDir(p), …
//
//   cityScene.onBeforeChange(cb)          // before disposal
//   cityScene.onChange(cb)                // after rebuild, with diff
//   cityScene.disposeMesh(mesh)           // animator's onComplete calls this
//
// applyManifest computes the entering / exiting / staying buckets vs the
// previous manifest (matched by file.path / dir.path) and fires onChange
// with them. The diff carries InstancedMesh-level entries which the
// animator consumes.
//
// Disposal: every mesh added by buildCityScene or this module gets removed
// from the persistent scene and disposed. The disposer walks geometry →
// materials → any property whose value is a THREE.Texture, so new mesh
// shapes don't need special-casing. disposeMesh() is idempotent
// (userData.disposed flag) so a double-dispose during a rapid edit can't
// trip a Three.js error.

import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

import { getSharedBuildingUniforms } from './instanced/buildings.js';
import { disposeLabelMaterials } from './instanced/labels.js';
import { buildCellsFromLayout } from './cellAssembly.js';
import type { CellTile } from './cellTile.js';
import { BuildingIndex } from './buildingIndex.js';
import type { SpatialGrid } from './spatialGrid.js';
import { findLayoutOverlaps } from './layout.js';
import type { LayoutOverlap } from './layout.js';
import { createLayoutClient } from './layoutClient.js';
import type { LayoutComputeOpts } from './layoutClient.js';
import { layoutCityV4WithTrace } from './layoutV4.js';
import type {
  ChildPlacementTrace,
  StemPlacementTrace,
} from './layoutV4.js';
import type { WorldRect } from './worldOccupancy.js';
import { buildCityScene } from './engine.js';
import { createSky } from './sky/sky.js';
import type { Sky } from './sky/sky.js';
import { createParks } from './parks/parks.js';
import type { Parks } from './parks/parks.js';
import { createParksPlacementClient } from './parks/parksPlacementClient.js';
import type { ParksPlacementClient } from './parks/parksPlacementClient.js';
import type { ParkPlacement } from './parks/parksPlacement.js';
import { createValleyFloor } from './parks/valleyFloor.js';
import type { ValleyFloor } from './parks/valleyFloor.js';
import { getWorldBounds } from './parks/worldBounds.js';
import { createCityFootprint } from './cityFootprint/footprint.js';
import type { CityFootprint } from './cityFootprint/footprint.js';
import { getBuildingColor, getCreatedAge, getModifiedAge, getDateRanges } from './colors.js';
import { parentDirPath } from './path.js';
import {
  ASPHALT,
  GEM_APPEARANCE,
  GEM_FACE_PALETTE,
  GEM_GLOW,
  GEM_SIZING,
  LABEL_TYPOGRAPHY,
  PARKS,
  SCENE_COLORS,
  SIDEWALK_COLORS,
} from '@/config/index.js';
import { REBUILD_STATUS } from '../liveStatus.js';
import type {
  Building,
  CityBbox,
  CityLayout,
  CitySceneDiff,
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
  pathMeshes: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[];
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
  -0.5, -0.5, -0.5,  0.5, -0.5, -0.5,
   0.5, -0.5, -0.5,  0.5, -0.5,  0.5,
   0.5, -0.5,  0.5, -0.5, -0.5,  0.5,
  -0.5, -0.5,  0.5, -0.5, -0.5, -0.5,
  // Top face (y = 0.5) — 4 edges around the roof.
  -0.5,  0.5, -0.5,  0.5,  0.5, -0.5,
   0.5,  0.5, -0.5,  0.5,  0.5,  0.5,
   0.5,  0.5,  0.5, -0.5,  0.5,  0.5,
  -0.5,  0.5,  0.5, -0.5,  0.5, -0.5,
  // Vertical edges — 4 edges connecting corresponding base + roof corners.
  -0.5, -0.5, -0.5, -0.5,  0.5, -0.5,
   0.5, -0.5, -0.5,  0.5,  0.5, -0.5,
   0.5, -0.5,  0.5,  0.5,  0.5,  0.5,
  -0.5, -0.5,  0.5, -0.5,  0.5,  0.5,
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
      const jumpedNote = jumped
        ? `  ← JUMPED +${(c.chosen.stem - c.baseline).toFixed(2)}`
        : '';
      out.push(
        `  ─ ${tag} (${c.childKind}) — stem=${c.chosen.stem.toFixed(2)}  ` +
          `(baseline=${c.baseline.toFixed(2)})${jumpedNote}`,
      );
      if (jumped && c.chosen.bindingIndex !== null) {
        const binding = c.chosen.forbidden[c.chosen.bindingIndex];
        const obs = binding.obstacle;
        const label = _obstacleLabel(obs);
        out.push(
          `     forced by: ${obs.kind} ${label}  ` +
            `y=[${_yBounds(obs).join(', ')}] x=[${_xBounds(obs).join(', ')}]`,
        );
      }
      if (jumped && c.others.length > 0) {
        out.push(`     other variants tried:`);
        const all = [c.chosen, ...c.others].sort(
          (a, b) => a.side - b.side || Number(a.mirror) - Number(b.mirror),
        );
        for (const v of all) {
          const marker = v === c.chosen ? '(chosen)' : '';
          out.push(
            `       side=${v.side} mirror=${v.mirror} → stem=${v.stem.toFixed(2)} ${marker}`.trimEnd(),
          );
        }
      }
    }
  }
  return out;
}

function _obstacleLabel(o: WorldRect): string {
  // WorldRect.ref is loosely typed (Building | Street | BuildingPath); try
  // common shapes without forcing tight coupling.
  const r = o.ref as { file?: { path?: string; name?: string }; label?: string; dir?: { path?: string } };
  return (
    (r.file && (r.file.path ?? r.file.name)) ??
    r.label ??
    (r.dir && r.dir.path) ??
    '?'
  );
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

// `canvas` is unused; kept in the signature so call sites (main.ts, tests)
// don't have to change. outlineRenderer takes the canvas directly via its
// own factory now, so cityScene no longer needs to forward it — the param
// can be dropped if a downstream pass cleans up the call sites.
export function createCityScene(_canvas: HTMLCanvasElement) {
  // Persistent across applyManifest calls.
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SCENE_COLORS.get().GROUND);

  // Cyberpunk Valley sky — built ONCE here, lives at scene root for
  // the lifetime of the cityScene. Not rebuilt per applyManifest
  // (the sky is wallpaper, independent of the manifest tree). When
  // SKY.ENABLED is false the mesh.visible flag is cleared
  // by sky.refresh() and scene.background's GROUND color shows
  // through as the fallback.
  const _sky: Sky = createSky();
  scene.add(_sky.mesh);

  // Cyberpunk Valley valley floor — a large flat plane world-anchored
  // at the gem, painting the entire visible ground with a forest
  // tint. Built ONCE at scene init (it's not layout-dependent — the
  // plane is bigger than any city). Sits at renderOrder -500, so it
  // draws AFTER the sky (-1000) but BEFORE the city's own ground
  // tiles (sidewalks at 1, asphalt at 3) — those paint on top.
  const _valleyFloor: ValleyFloor = createValleyFloor(null);
  scene.add(_valleyFloor.mesh);

  // Cyberpunk Valley parks — REBUILT per applyManifest from the new
  // layout's buildings/streets/paths (the placement algorithm fills
  // the gaps between them and rings the city's outer boundary).
  // Held at cityScene scope so applyTheme() can call .refresh()
  // through getParks() and the rebuild branches can dispose the prior
  // instance before swapping in the new one.
  let _parks: Parks | null = null;

  // Parks placement client — owns the off-thread worker (or its sync
  // fallback in test envs). One instance per cityScene; disposed when
  // the cityScene is disposed. Mirrors the _layoutClient pattern.
  const _parksPlacementClient: ParksPlacementClient = createParksPlacementClient();

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

  // One layoutClient instance per cityScene. Owns the off-thread worker
  // (or its sync fallback in test envs). Disposed when the cityScene is
  // disposed.
  const _layoutClient = createLayoutClient();

  // Manifest-bound state. Reassigned on each applyManifest.
  let manifest: Manifest | null = null;
  let layout: CityLayout | null = null;
  let dateRanges: DateRanges | null = null;
  let bbox: THREE.Box3 | null = null;
  let rootStreet: Street | null = null;
  let gemWorldPos: THREE.Vector3 | null = null;

  // The flat ground meshes (sidewalks, paths, asphalt) all use single
  // MeshBasicMaterial; main.ts's color-update path reads
  // `mesh.material.color` directly. Typing them with a single material
  // (rather than the default `Material | Material[]`) keeps that
  // callsite's `.material.color` access working.
  type FlatMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;

  let streetPickables: FlatMesh[] = [];
  let streetLabels: THREE.Group[] = [];
  let pathMeshes: FlatMesh[] = [];
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
  let buildingsByPath: Record<string, { mesh: THREE.Mesh; building: Building; instanceId: number }> = {};
  let pathMeshesByDirPath: Record<string, FlatMesh[]> = {};

  // Cell-rendering state — owns the InstancedMesh-per-cell scene root.
  let _cellRoot: THREE.Group | null = null;
  let _cells: Map<number, CellTile> = new Map();
  let _buildingIndex: BuildingIndex | null = null;
  let _grid: SpatialGrid | null = null;
  // Instanced ad panels (DataArrayTexture-backed). One instance per
  // applyManifest call; disposed on full rebuild or resetCache.
  let _instancedAdPanels: import('./instanced/adPanelsInstanced.js').InstancedAdPanels | null = null;

  // Layout cache: avoid redundant _layoutClient.compute() when
  // the manifest's tree shape is unchanged (e.g., skeleton → final transition).
  // Keyed by manifest.tree_signature — computed server-side from paths + nesting
  // only (no mtime/size), so it is stable across skeleton/final events for the
  // same scan even though per-file metadata differs between the two phases.
  let _cachedLayoutTreeSig: string | null = null;
  let _cachedLayout: CityLayout | null = null;

  // Scenic state cache: tracks the tree_signature that was used the last time
  // buildCityScene ran successfully (in the cell branch). When the layout is
  // reused AND this signature matches the current manifest's tree_signature,
  // the streets/labels/paths/gem meshes are already in the scene and identical
  // to what a fresh buildCityScene call would produce — so we skip the call.
  // Cleared by resetCache() when the user switches source (different tree shape).
  let _lastBuildCitySceneTreeSig: string | null = null;

  // Scenic config hash: a JSON snapshot of all config stores whose values are
  // baked into buildCityScene output (street geometry/color, sidewalk color,
  // label typography, gem appearance). Stored alongside _lastBuildCitySceneTreeSig
  // after every successful buildCityScene call. On cache-hit, we also check this
  // hash — if it differs (e.g. user changed SIDEWALK_COLORS.DEFAULT via Settings),
  // we force a full scenic rebuild even though the tree_signature hasn't changed.
  let _lastScenicConfigHash: string | null = null;

  // computeScenicConfigHash collects the current values of every store whose
  // output is baked into buildCityScene meshes:
  //   - SCENE_COLORS  : scene background (GROUND); baked into scene.background
  //   - ASPHALT       : COLOR + WIDTH_FRAC baked into asphalt geometry/material
  //   - SIDEWALK_COLORS: DEFAULT baked into sidewalk + path-connector materials
  //   - LABEL_TYPOGRAPHY: all keys baked into label canvas textures + geometry
  //   - GEM_SIZING    : RADIUS_AS_STREET_FRAC / MIN_RADIUS / HOVER_LIFT_FRAC
  //                     baked into gem geometry and position
  //   - GEM_FACE_PALETTE: vertex colors baked into gem octahedron BufferAttribute
  //   - GEM_APPEARANCE: EDGE_COLOR + BODY_OPACITY baked into gem materials
  //   - GEM_GLOW      : all keys baked into gem sprite materials + scales
  // PATH_LINE / HOVER_PATH_LINE are live Line2 meshes, not built by buildCityScene.
  function computeScenicConfigHash(): string {
    return JSON.stringify({
      sceneColors: SCENE_COLORS.get(),
      asphalt: ASPHALT.get(),
      sidewalkColors: SIDEWALK_COLORS.get(),
      labelTypography: LABEL_TYPOGRAPHY.get(),
      gemSizing: GEM_SIZING.get(),
      gemFacePalette: GEM_FACE_PALETTE.get(),
      gemAppearance: GEM_APPEARANCE.get(),
      gemGlow: GEM_GLOW.get(),
    });
  }

  // Listeners

  const beforeChangeCbs: Array<(prev: PrevState) => void> = [];
  // The change diff is structurally complex; consumers (animator, picker,
  // outlineRenderer, etc.) each look at a different slice. Typed `any`
  // here, but each consumer narrows it locally.

  const changeCbs: Array<(diff: CitySceneDiff) => void> = [];

  function _emit<T>(arr: Array<(p: T) => void>, payload: T): void {
    // Snapshot to allow listeners to unsubscribe themselves mid-emit
    // without disturbing iteration.
    for (const cb of [...arr]) {
      try {
        cb(payload);
      } catch (e) {
        console.error('[cityScene] listener error', e);
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

  function onChange(cb: (diff: CitySceneDiff) => void): () => void {
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
    for (const m of pathMeshes) _removeAndDispose(m);
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

    pathMeshesByDirPath = {};
    for (const pm of pathMeshes) {
      const pmFile = pm.userData.file;
      const pmDir = pmFile?.path != null ? parentDirPath(pmFile.path) : null;
      if (pmDir == null) continue;
      if (!pathMeshesByDirPath[pmDir]) pathMeshesByDirPath[pmDir] = [];
      pathMeshesByDirPath[pmDir].push(pm);
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
  function _computeDiff(prev: PrevState): CitySceneDiff {
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

  // Manifest is typed loosely because cityScene.test.ts builds mock
  // manifests with string `type` fields rather than the literal
  // 'directory'/'file'. Real callers (the scanner/IPC path) hand us
  // proper Manifest objects.
  async function applyManifest(
    newManifest: Manifest | { tree: unknown; [k: string]: unknown },
  ): Promise<void> {
    const myGeneration = ++_currentGeneration;

    const prev: PrevState = {
      streetPickables,
      streetLabels,
      pathMeshes,
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
    const _reuseFrom =
      _treeSig && _cachedLayoutTreeSig === _treeSig ? _cachedLayout : null;
    const _layoutComputeOpts: LayoutComputeOpts = _reuseFrom
      ? { reuseLayoutFrom: _reuseFrom }
      : {};
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
      newManifestTyped.tree as unknown as Parameters<typeof getDateRanges>[0],
    );
    const newBuildings = newLayout?.buildings ?? [];

    for (const b of newBuildings) {
      // Building.file is always a FileNode (directories become streets,
      // not buildings — see layoutV4.ts).
      b.color = getBuildingColor(
        b.file as unknown as Parameters<typeof getBuildingColor>[0],
        newDateRanges,
      );
      // createdAge is independent of color: it tracks file age (creation
      // date) so grime/weathering can mark old files even if they were
      // recently edited.
      b.createdAge = getCreatedAge(
        b.file as unknown as Parameters<typeof getCreatedAge>[0],
        newDateRanges,
      );
      b.modifiedAge = getModifiedAge(
        b.file as unknown as Parameters<typeof getModifiedAge>[0],
        newDateRanges,
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
          let minX = 0, maxX = 0, minZ = 0, maxZ = 0;
          for (const b of newBuildings) {
            if (b.x - b.w / 2 < minX) minX = b.x - b.w / 2;
            if (b.x + b.w / 2 > maxX) maxX = b.x + b.w / 2;
            if (b.y - b.d / 2 < minZ) minZ = b.y - b.d / 2;
            if (b.y + b.d / 2 > maxZ) maxZ = b.y + b.d / 2;
          }
          return { minX, maxX, minZ, maxZ };
        })();

    // Build the cell scene (buildings only — streets/labels/paths/gem
    // are produced by buildCityScene below).
    const cellOut = buildCellsFromLayout(bounds, newBuildings, getSharedBuildingUniforms());

    if (myGeneration !== _currentGeneration) {
      // Superseded while we were building — clean up and bail.
      cellOut.sceneRoot.traverse(_disposeObject);
      return;
    }

    // ---- Atomic swap ----
    //
    // Scenic state reuse: when the layout was reused (same tree_signature,
    // positions/streets/paths unchanged) AND buildCityScene was already run
    // for this signature, AND none of the config stores that affect scenic
    // output have changed (same config hash), the streets/labels/paths/gem
    // meshes are already in the scene and would produce identical output —
    // skip the dispose + rebuild. Only the cell root is always rebuilt
    // (fast) to reflect updated per-file metadata (colors, heights).
    const _currentScenicConfigHash = computeScenicConfigHash();
    const _scenicValid =
      _layoutReused &&
      _lastBuildCitySceneTreeSig !== null &&
      _lastBuildCitySceneTreeSig === _treeSig &&
      _lastScenicConfigHash === _currentScenicConfigHash &&
      streetPickables.length > 0; // guard: scenic state actually exists in scene

    if (_scenicValid) {
      // Do NOT call _disposeAllManifestState() — existing streets/labels/
      // paths/gem stay in the scene unmodified. Do NOT call buildCityScene.

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
      // bbox stays from the previous buildCityScene call (layout unchanged).

      _cellRoot = cellOut.sceneRoot;
      _cells = cellOut.cells;
      _buildingIndex = cellOut.index;
      _grid = cellOut.grid;
      _instancedAdPanels = cellOut.adPanels;

      // Add the new cell root (instanced building InstancedMeshes + ad panels).
      scene.add(_cellRoot);
    } else {
      // Full rebuild path: dispose existing scenic state, run buildCityScene,
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
      _grid = cellOut.grid;
      _instancedAdPanels = cellOut.adPanels;

      // Also build the streets/paths/gem sub-scene from buildCityScene so
      // sidewalks, asphalt, and the root gem still appear. The cell path
      // replaces buildings; non-building scene elements are still needed.
      //
      // skipBuildings: true — omits per-building path-connector meshes
      // (one mesh per layout.paths entry, ~N_buildings total). For a large
      // repo those meshes dominate cellBuilt.scene.children and cause a
      // multi-second stall in the scene.add() loop below.
      // Cell mode has no per-building interactivity that needs connectors.
      const cellBuilt = buildCityScene(newLayout, { skipBuildings: true });
      bbox = cellBuilt.bbox;

      streetPickables = cellBuilt.streetPickables || [];
      streetLabels = cellBuilt.streetLabels || [];
      pathMeshes = cellBuilt.pathMeshes || [];
      asphaltMeshes = cellBuilt.asphaltMeshes || [];
      rootGem = cellBuilt.rootGem || null;
      rootGemBody = cellBuilt.rootGemBody || null;
      rootGemEdges = cellBuilt.rootGemEdges || null;

      for (const child of [...cellBuilt.scene.children]) scene.add(child);
      scene.background = new THREE.Color(SCENE_COLORS.get().GROUND);

      // Remove per-building meshes that buildCityScene emits — the cell
      // path replaces them with InstancedMesh cells. Keep streetLabels:
      // they serve as our labels on the cell path too.
      for (const bm of cellBuilt.buildingMeshes || []) {
        if (bm.parent) bm.parent.remove(bm);
        _disposeObject(bm);
      }

      // Add the cell root (instanced building InstancedMeshes, one group per cell).
      scene.add(_cellRoot);

      // Record that scenic state is now valid for this tree_signature + config.
      _lastBuildCitySceneTreeSig = _treeSig || null;
      _lastScenicConfigHash = _currentScenicConfigHash;
    }

    _buildLookups();
    _computeRootStreetAndGem();

    // City is now in the scene. Decoration pass (parks, future mesa
    // bounds, etc.) is deferred to the next animation frame so the
    // city paints + becomes interactive BEFORE the placement scan +
    // GPU upload blocks the main thread. For large repos this gap is
    // the difference between a snappy rebuild and a multi-hundred-ms
    // freeze.
    const parksEnabled = PARKS.get().ENABLED;
    if (_parks) {
      _parks.dispose();
      _parks = null;
    }
    if (_cityFootprint) {
      _cityFootprint.dispose();
      _cityFootprint = null;
    }

    _emit(changeCbs, _computeDiff(prev));

    // Convert the THREE.Box3 of the rendered scene to a placement-style
    // CityBbox. This captures the actual on-screen extent (all buildings +
    // streets + paths) — which is what the valley floor and tree scatter
    // need to size against. The layout module's `layout.bbox` is a 2D
    // pre-render placement bbox that can lag behind the final rendered
    // geometry on big repos, so we use this one as the single source of
    // truth for "how big is the city."
    const sceneBbox: CityBbox | null = bbox ? {
      minX: bbox.min.x,
      maxX: bbox.max.x,
      minY: bbox.min.z, // three.js Z is the second world axis
      maxY: bbox.max.z,
      cx: (bbox.min.x + bbox.max.x) / 2,
      cy: (bbox.min.z + bbox.max.z) / 2,
      width: bbox.max.x - bbox.min.x,
      depth: bbox.max.z - bbox.min.z,
    } : null;

    // Floor is sized from the scene's bbox + buffer. Falls back to a
    // small default at the origin when there's no city (empty manifest).
    _valleyFloor.setBounds(getWorldBounds(sceneBbox));

    if (bbox) {
      // Footprint is cheap (one InstancedMesh, no rejection sampling),
      // so we don't need the rAF+setTimeout defer the parks path uses.
      _cityFootprint = createCityFootprint(newLayout);
      scene.add(_cityFootprint.group);
    }

    if (parksEnabled && bbox && sceneBbox) {
      // Snapshot what the deferred pass needs so a later applyManifest
      // bumping _currentGeneration doesn't race with this build.
      const generationAtDefer = myGeneration;
      const layoutAtDefer = newLayout;
      const commitCountAtDefer = manifest.commits?.length ?? 0;
      const parksBbox: CityBbox = sceneBbox;

      REBUILD_STATUS.set('decorating');
      // rAF lets the browser START the next frame; setTimeout(0)
      // then yields the task so the browser can COMPLETE the paint
      // before parks work begins. The combination is the most
      // reliable way to ensure the city is on-screen before we touch
      // the main thread again.
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      await new Promise<void>((r) => setTimeout(r, 0));
      if (generationAtDefer !== _currentGeneration) return;

      // Off-thread placement via the worker. The supersede protocol
      // rejects this promise with "superseded" if another applyManifest
      // fires while placement is in-flight — silently abort that branch
      // so we don't add a stale parks group to the scene.
      let placements: ParkPlacement[];
      try {
        placements = await _parksPlacementClient.compute(layoutAtDefer, parksBbox, commitCountAtDefer);
      } catch (err) {
        if (err instanceof Error && err.message === 'superseded') return;
        throw err;
      }
      if (generationAtDefer !== _currentGeneration) return;

      _parks = createParks(placements);
      scene.add(_parks.group);
    }
  }

  function dispose() {
    _disposeAllManifestState();
    _sky.dispose();
    _valleyFloor.dispose();
    if (_parks) {
      _parks.dispose();
      _parks = null;
    }
    if (_cityFootprint) {
      _cityFootprint.dispose();
      _cityFootprint = null;
    }
    beforeChangeCbs.length = 0;
    changeCbs.length = 0;
    _layoutClient.dispose();
    _parksPlacementClient.dispose();
  }

  function resetCache(): void {
    _cachedLayoutTreeSig = null;
    _cachedLayout = null;
    _lastBuildCitySceneTreeSig = null;
    _lastScenicConfigHash = null;
    // Dispose instanced ad panels so they are rebuilt from scratch on the
    // next applyManifest call (the new source may have a different set of
    // media files and a different layout, so the existing panels are stale).
    if (_instancedAdPanels) {
      _instancedAdPanels.dispose();
      _instancedAdPanels = null;
    }
  }

  return {
    scene,
    applyManifest,
    dispose,
    onBeforeChange,
    onChange,
    disposeMesh,
    resetCache,

    /**
     * Cyberpunk Valley sky reference. Exposed so main.ts's applyTheme()
     * can call sky.refresh() on hot-reload and the render loop can call
     * sky.tick(dtSeconds) each frame.
     */
    getSky(): Sky {
      return _sky;
    },

    /**
     * Cyberpunk Valley valley-floor reference. The floor is
     * world-anchored at the gem; this is exposed for applyTheme()
     * (hot-reload refresh) and any future external access.
     */
    getValleyFloor(): ValleyFloor {
      return _valleyFloor;
    },

    /**
     * Cyberpunk Valley parks reference. Rebuilt per applyManifest, so
     * this returns null until the first manifest has been applied.
     * main.ts's applyTheme() guards with `?.refresh()` to handle the
     * pre-manifest case.
     */
    getParks(): Parks | null {
      return _parks;
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
        // eslint-disable-next-line no-console
        console.warn('[collision] no layout — apply a manifest first');
        return;
      }
      const overlaps = findLayoutOverlaps(layout);
      const totalRects =
        layout.streets.length + layout.buildings.length + layout.paths.length;
      const report = _formatCollisionReport(overlaps, totalRects);
      if (report.level === 'info') {
        // eslint-disable-next-line no-console
        console.info(report.summary);
      } else {
        // eslint-disable-next-line no-console
        console.warn(report.summary);
        for (const line of report.details) {
          // eslint-disable-next-line no-console
          console.warn(line);
        }
      }
    },
    runStemPlacementDiagnostic(): void {
      if (!manifest) {
        // eslint-disable-next-line no-console
        console.warn('[stem-diag] no manifest — apply one first');
        return;
      }
      const { trace } = layoutCityV4WithTrace(
        manifest as unknown as Parameters<typeof layoutCityV4WithTrace>[0],
      );
      const lines = _formatStemDiagnostic(trace);
      for (const line of lines) {
        // eslint-disable-next-line no-console
        console.log(line);
      }
    },
    getBbox() {
      return bbox;
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
     * Per-cell InstancedMeshes (detail + impostor) suitable for raycasting
     * against. Three.js raycasts InstancedMesh natively, returning hits
     * with `.instanceId` set; hidden cells (LOD-gated) are skipped by the
     * default visibility check. Used by cameraRig sightline tests.
     *
     * Both detail and impostor meshes are included so a far-away cell on
     * the impostor tier still occludes the sightline when it's actually
     * visible on screen.
     */
    getBuildingPickables(): THREE.Object3D[] {
      const out: THREE.Object3D[] = [];
      for (const cell of _cells.values()) {
        out.push(cell.detailMesh, cell.impostorMesh);
      }
      return out;
    },
    getStreetPickables() {
      return streetPickables;
    },
    getStreetLabels() {
      return streetLabels;
    },
    getPathMeshes() {
      return pathMeshes;
    },
    getAsphaltMeshes() {
      return asphaltMeshes;
    },
    getRootGem() {
      return rootGem;
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
    getPathConnectorsByDir(p: string) {
      return pathMeshesByDirPath[p] || [];
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
    getPathConnectorsMap() {
      return pathMeshesByDirPath;
    },

    // Cell-mode accessors for picker + other consumers.
    getBuildingIndex(): BuildingIndex | null {
      return _buildingIndex;
    },
    getCells(): Map<number, CellTile> {
      return _cells;
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
