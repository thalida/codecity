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
//   cityScene.getBlocks()                 // per-block InstancedMesh array (Task 8+)
//   cityScene.getBlockByDirPath(p)        // SceneBlock | null
//   cityScene.getBuildingByInstance(b, i) // Building at instanceId i in block b
//   cityScene.getBuildings()              // DEPRECATED: flat list (for transition period)
//   cityScene.getStreetPickables(), …
//   cityScene.getBuildingByPath(p), .getSidewalkByDir(p), …
//
//   cityScene.onBeforeChange(cb)          // before disposal
//   cityScene.onChange(cb)                // after rebuild, with diff
//   cityScene.disposeMesh(mesh)           // animator's onComplete calls this
//
// applyManifest computes the entering / exiting / staying buckets vs the
// previous manifest (matched by file.path / dir.path) and fires onChange
// with them. The diff in Task 8 carries InstancedMesh-level entries;
// the animator (Task 9) will be rewritten to use them.
//
// Disposal: every mesh added by buildCityScene or this module gets removed
// from the persistent scene and disposed. The disposer walks geometry →
// materials → any property whose value is a THREE.Texture, so new mesh
// shapes don't need special-casing. disposeMesh() is idempotent
// (userData.disposed flag) so a double-dispose during a rapid edit can't
// trip a Three.js error.

import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
// TODO(Task 11): re-import LineSegmentsGeometry when per-block outline meshes are built.
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

export type { SceneBlock } from './blocks.js';

import { groupBuildingsByDirectory } from './blocks.js';
import { createBuildingsInstancedMesh } from './instanced/buildings.js';
import { createBillboard, disposeBillboard, isMediaFile } from './billboards.js';
import {
  buildLabelAtlas,
  truncateLabelToFit,
  createLabelsInstancedMesh,
  disposeLabelMaterials,
} from './instanced/labels.js';
import { findLayoutOverlaps } from './layout.js';
import type { LayoutOverlap } from './layout.js';
import { createLayoutClient } from './layoutClient.js';
import { layoutCityV4WithTrace } from './layoutV4.js';
import type {
  ChildPlacementTrace,
  StemPlacementTrace,
} from './layoutV4.js';
import type { WorldRect } from './worldOccupancy.js';
import { buildCityScene } from './engine.js';
import { getBuildingColor, getDateRanges } from './colors.js';
import { parentDirPath } from './path.js';
import { BUILDING_PALETTE, LABEL_TYPOGRAPHY, SCENE_COLORS } from '@/config/index.js';
// TODO(Task 11/12): re-import RENDER_ORDERS when per-block outlines/ghosts are built.
import { NodeKind } from '@/types';
import type {
  Building,
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
import type { SceneBlock } from './blocks.js';

// Snapshot of the prior manifest state captured at the top of
// applyManifest, used by the diff and the change-listener payload.
interface PrevState {
  buildings: THREE.Object3D[];
  blocks: SceneBlock[];
  streetPickables: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[];
  streetLabels: THREE.Group[];
  pathMeshes: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[];
  asphaltMeshes: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[];
  rootGem: THREE.Group | null;
  manifest: Manifest | null;
  layout: CityLayout | null;
}

// 12 edges of a unit cube as flat [x,y,z, x,y,z, ...] segment endpoints.
// Used by Line2 outlines (rendered as triangle strips so linewidth is
// settable in pixels — regular WebGL lines are locked to 1px). Exported
// so the hover/selected outline meshes in main.js (and later in
// outlineRenderer.js) share this geometry definition.
export const UNIT_BOX_EDGE_POSITIONS = [
  -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5, -0.5,
  0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
  0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5, -0.5, -0.5, -0.5, -0.5, 0.5,
  -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5,
  0.5,
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

// canvas is unused directly by cityScene after Task 8 removed
// _buildOutlinesAndGhosts (which used it for LineMaterial.resolution).
// Kept in the signature so call sites (main.ts, tests) need no change.
// TODO(Task 12): outlineRenderer's own createOutlineRenderer({ canvas })
// takes it directly; cityScene no longer needs to forward it.
export function createCityScene(_canvas: HTMLCanvasElement) {
  // Persistent across applyManifest calls.
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SCENE_COLORS.get().GROUND);

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

  // Task 8: per-block InstancedMesh tracking replaces per-building mesh
  // tracking. buildingMeshes is kept as an empty array stub so consumers
  // that haven't been rewritten yet (buildingFader, outlineRenderer —
  // Tasks 11-12) don't crash; they will iterate an empty list.
  let blocks: SceneBlock[] = [];
  let blocksByDirPath: Record<string, SceneBlock> = {};
  // Task 15: shared atlas CanvasTextures (one per atlas page; multiple
  // pages when a project has too many unique labels for a single texture).
  let _atlasTextures: THREE.CanvasTexture[] = [];
  // buildingMeshes stub — kept for the diff machinery during transition.
  // TODO(Task 9): remove once the diff is rewritten for InstancedMesh.
  let buildingMeshes: THREE.Object3D[] = [];

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

  // TODO(Task 11): per-building outline arrays replaced by per-block instanced
  // outlines. Keep stubs returning empty arrays so outlineRenderer's
  // getBuildingOutlines() / getBuildingGhosts() calls don't crash.
  const buildingOutlines: LineSegments2[] = [];
  const buildingOutlineMats: LineMaterial[] = [];
  const buildingGhosts: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[] = [];

  let sidewalksByDirPath: Record<string, FlatMesh> = {};
  let streetsByDirPath: Record<string, Street> = {};
  let buildingsByPath: Record<string, { mesh: THREE.Mesh; building: Building; block: SceneBlock; instanceId: number }> = {};
  let pathMeshesByDirPath: Record<string, FlatMesh[]> = {};

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
    if (obj.userData) obj.userData.disposed = true;
  }

  function _removeAndDispose(obj: THREE.Object3D | null): void {
    if (!obj) return;
    if (obj.parent) obj.parent.remove(obj);
    _disposeObject(obj);
  }

  // Public idempotent disposal — animator's onComplete calls this when
  // an exit-tween finishes. A second call on the same mesh no-ops.
  // TODO(Task 9): adapt for InstancedMesh once animator is rewritten.
  function disposeMesh(mesh: THREE.Mesh): void {
    if (!mesh || (mesh.userData && mesh.userData.disposed)) return;
    if (mesh.parent) mesh.parent.remove(mesh);
    // TODO(Task 11/12): per-building paired outline/ghost disposed here.
    // After Task 11, outline/ghost disposal is per-block, not per-mesh.
    const paired = (mesh.userData && mesh.userData.paired) || null;
    if (paired) {
      if (paired.outline) _removeAndDispose(paired.outline);
      if (paired.ghost) _removeAndDispose(paired.ghost);
    }
    _disposeObject(mesh);
  }

  function _disposeAllManifestState() {
    // Dispose per-block InstancedMeshes (buildings + labels) and placeholder cuboids.
    for (const block of blocks) {
      if (block.detailMesh) {
        _removeAndDispose(block.detailMesh);
        block.detailMesh = undefined;
      }
      if (block.labelsMesh) {
        _removeAndDispose(block.labelsMesh);
        block.labelsMesh = undefined;
      }
      if (block.placeholderMesh) {
        _removeAndDispose(block.placeholderMesh);
        block.placeholderMesh = undefined;
      }
      if (block.billboards) {
        for (const bm of block.billboards) {
          if (bm.parent) bm.parent.remove(bm);
          disposeBillboard(bm);
        }
        block.billboards = undefined;
      }
    }
    // Dispose all atlas page textures + their cached label materials.
    for (const tex of _atlasTextures) tex.dispose();
    _atlasTextures = [];
    disposeLabelMaterials();
    blocks = [];
    blocksByDirPath = {};
    buildingMeshes = [];

    for (const m of streetPickables) _removeAndDispose(m);
    for (const m of streetLabels) _removeAndDispose(m);
    for (const m of pathMeshes) _removeAndDispose(m);
    for (const m of asphaltMeshes) _removeAndDispose(m);
    // TODO(Task 11/12): dispose buildingOutlines and buildingGhosts once
    // per-block instanced versions are created.
    if (rootGem) {
      if (rootGem.parent) rootGem.parent.remove(rootGem);
      rootGem.traverse(_disposeObject);
    }
  }

  // TODO(Task 11/12): _buildOutlinesAndGhosts is commented out. The per-building
  // outline + ghost meshes are replaced by per-block InstancedMesh outlines
  // and ghosts in Tasks 11-12. Leaving the stub arrays above as empty []
  // so outlineRenderer's loops over getBuildingOutlines() / getBuildingGhosts()
  // iterate zero elements and no-op gracefully.
  //
  // function _buildOutlinesAndGhosts() { ... }  // removed in Task 8

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

    // Task 10: buildingsByPath stores block + instanceId so the picker and
    // other consumers can target the right per-instance attribute slot.
    buildingsByPath = {};
    for (const block of blocks) {
      for (let i = 0; i < block.buildings.length; i++) {
        const b = block.buildings[i];
        if (b.file?.path != null && block.detailMesh) {
          buildingsByPath[b.file.path] = {
            mesh: block.detailMesh as unknown as THREE.Mesh,
            building: b,
            block,
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

  // Task 9: _computeDiff compares prev blocks vs new blocks at the
  // per-instance (file.path key) level, producing entering / staying /
  // exiting buckets that the animator uses to write instance matrices.
  //
  // Prev block transforms are read HERE (before _disposeAllManifestState
  // is called) because disposal zeroes block.detailMesh. The snapshot is
  // captured in PrevState.blocks — the array reference is stable across
  // the disposal because we replace the module-level `blocks` binding
  // but the snapshot still points at the old array.
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
    // Build a map from file.path → prior transform (scale + position)
    // from the PREVIOUS blocks. We read the instance matrix directly from
    // detailMesh to capture whatever the animator left it at (so a
    // rapid edit doesn't snap to the layout position).
    const prevTransforms = new Map<
      string,
      { scaleX: number; scaleY: number; scaleZ: number; posX: number; posY: number; posZ: number }
    >();
    const _readMatrix = new THREE.Matrix4();
    const _pos = new THREE.Vector3();
    const _scale = new THREE.Vector3();
    const _quat = new THREE.Quaternion();
    for (const pb of prev.blocks) {
      for (let i = 0; i < pb.buildings.length; i++) {
        const b = pb.buildings[i];
        if (!b.file?.path) continue;
        if (pb.detailMesh) {
          pb.detailMesh.getMatrixAt(i, _readMatrix);
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
          // No mesh (block was empty / not yet built): record layout values
          // so staying buildings get a sensible from-transform.
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

    // Walk new blocks and classify each instance as entering or staying.
    for (const nb of blocks) {
      for (let i = 0; i < nb.buildings.length; i++) {
        const b = nb.buildings[i];
        const newScaleX = b.w;
        const newScaleY = b.h;
        const newScaleZ = b.d;
        const newPosX = b.x;
        const newPosY = b.h / 2;
        const newPosZ = b.y;

        const prior = b.file?.path ? prevTransforms.get(b.file.path) : undefined;
        if (prior) {
          staying.buildings.push({
            block: nb,
            instanceId: i,
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
            block: nb,
            instanceId: i,
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
    // V1: no exit animation — they just vanish when blocks are rebuilt.
    // We still populate the exiting bucket so subscribers can track counts.
    const newPaths = new Set<string>();
    for (const nb of blocks) {
      for (const b of nb.buildings) {
        if (b.file?.path) newPaths.add(b.file.path);
      }
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
      buildings: buildingMeshes,
      blocks,
      streetPickables,
      streetLabels,
      pathMeshes,
      asphaltMeshes,
      rootGem,
      manifest,
      layout,
    };

    _emit(beforeChangeCbs, prev);

    // ---- Phase 1: compute the new layout off-thread via layoutClient.
    // A later applyManifest can preempt us by bumping _currentGeneration;
    // layoutClient signals that via a 'superseded' rejection.
    const newManifestTyped = newManifest as Manifest;
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
      newLayout = await _layoutClient.compute(newManifestTyped);
    } catch (err) {
      if (err instanceof Error && err.message === 'superseded') return;
      throw err;
    }
    if (myGeneration !== _currentGeneration) return;

    // ---- Phase 2: derive date ranges + color buildings on the NEW layout's
    // building list. dateRanges and the color loop don't touch the scene yet.
    const newDateRanges = getDateRanges(
      newManifestTyped.tree as unknown as Parameters<typeof getDateRanges>[0],
    );
    const dirColor = BUILDING_PALETTE.get().DIRECTORY_COLOR;
    const newBuildings = newLayout?.buildings ?? [];
    for (const b of newBuildings) {
      b.color =
        b.file?.type === NodeKind.File
          ? getBuildingColor(
              b.file as unknown as Parameters<typeof getBuildingColor>[0],
              newDateRanges,
            )
          : dirColor;
    }
    if (myGeneration !== _currentGeneration) return;

    // ---- Phase 3: build all new meshes detached from the live scene.
    // `built` is a sub-scene from buildCityScene with its own children
    // (streets, labels, paths, gem). We do NOT add its children to the
    // live scene yet — that happens in Phase 4's atomic swap.
    const built = buildCityScene(newLayout);
    const newBlocks = groupBuildingsByDirectory(
      newLayout.buildings,
      newLayout.streets,
    );

    // Task 15: build shared label atlas from all unique street label texts.
    // Each street.label is first truncated to fit its own road; the atlas
    // dedups across blocks that resolve to the same truncated form. We
    // mutate `street.label` in place so the atlas lookup later in the
    // pipeline finds the same key it was stored under.
    const labelCfg = LABEL_TYPOGRAPHY.get();
    const measureCtx = document.createElement('canvas').getContext('2d');
    if (measureCtx) {
      measureCtx.font = `${labelCfg.FONT_WEIGHT} ${labelCfg.FONT_SIZE_PX}px ${labelCfg.FONT_FAMILY}`;
      for (const b of newBlocks) {
        const street = b.primaryStreet;
        if (!street || !street.label) continue;
        street.label = truncateLabelToFit(street.label, street, labelCfg, measureCtx);
      }
    }
    const uniqueTexts = Array.from(
      new Set(
        newBlocks
          .map((b) => b.primaryStreet?.label)
          .filter((t): t is string => Boolean(t)),
      ),
    );
    const atlas = buildLabelAtlas(uniqueTexts, labelCfg);
    const newAtlasTextures = atlas.pages.map(
      (c) => new THREE.CanvasTexture(c),
    );

    // Diagnostic: dump (dir.path → primaryStreet.label) pairs and the atlas
    // rect each block resolves to. Toggle with window.__labelDebug = true
    // and reload the manifest. Surfaces label-to-street mismapping.
    if (typeof window !== 'undefined' && (window as unknown as { __labelDebug?: boolean }).__labelDebug) {
      const dump = newBlocks.map((b) => {
        const text = b.primaryStreet?.label ?? '';
        const rect = atlas.rectByText.get(text);
        return {
          dirPath: b.dir?.path ?? '<no-dir>',
          dirName: b.dir?.name ?? '<no-name>',
          label: text,
          rectPage: rect?.page ?? null,
          rectU: rect?.u ?? null,
          rectV: rect?.v ?? null,
        };
      });
      // eslint-disable-next-line no-console
      console.table(dump);
      (window as unknown as { __labelDebugDump?: unknown }).__labelDebugDump = dump;
    }

    // Per-block detail + label meshes — created here but added to the
    // scene only in Phase 4 below.
    for (const block of newBlocks) {
      // Placeholders disabled: they caused hover ambiguity (one block's
      // placeholder cuboid intercepting rays meant for another block's
      // buildings) and visual confusion (cuboid vs real building). Three's
      // built-in frustum culling per InstancedMesh handles the perf
      // benefit at far zoom that placeholders were supposed to provide.
      //
      // Building mesh is only built when the block has direct files;
      // container-only directories (e.g. `.superpowers/brainstorm` whose
      // children are all subdirs) have 0 buildings and skip that path.
      // The street label is built unconditionally — every street should
      // be named on the road, including container-only ones.
      if (block.buildings.length > 0) {
        block.detailMesh = createBuildingsInstancedMesh(block);
      }
      // Image / video files get a separate billboard plane instead of
      // a building cuboid. They still own a (zero-scale) slot in the
      // detailMesh so per-instance indices line up with block.buildings.
      const billboards: THREE.Group[] = [];
      for (const b of block.buildings) {
        if (b.file && isMediaFile(b.file)) {
          billboards.push(createBillboard(b));
        }
      }
      if (billboards.length > 0) block.billboards = billboards;
      // Task 15: per-block label InstancedMesh. Built regardless of
      // direct-file count.
      const labelsMesh = createLabelsInstancedMesh(block, atlas, newAtlasTextures);
      if (labelsMesh) {
        block.labelsMesh = labelsMesh;
      }
    }

    if (myGeneration !== _currentGeneration) {
      // A newer applyManifest started while we were building. Dispose the
      // new meshes we just built (they'd leak otherwise) and bail.
      // disposeLabelMaterials clears the module-level _labelMaterials map
      // keyed by atlas textures we're about to release.
      for (const block of newBlocks) {
        if (block.detailMesh) _disposeObject(block.detailMesh);
        if (block.labelsMesh) _disposeObject(block.labelsMesh);
        if (block.billboards) {
          for (const bm of block.billboards) disposeBillboard(bm);
        }
      }
      disposeLabelMaterials();
      for (const tex of newAtlasTextures) tex.dispose();
      built.scene.traverse(_disposeObject);
      return;
    }

    // ---- Phase 4: atomic swap. Up to this point, the previous scene is
    // still on screen. Now we dispose the previous state and attach every
    // new mesh in a single uninterrupted block.
    _disposeAllManifestState();
    _atlasTextures = newAtlasTextures;

    manifest = newManifestTyped;
    layout = newLayout;
    dateRanges = newDateRanges;
    bbox = built.bbox;

    streetPickables = built.streetPickables || [];
    streetLabels = built.streetLabels || [];
    pathMeshes = built.pathMeshes || [];
    asphaltMeshes = built.asphaltMeshes || [];
    rootGem = built.rootGem || null;
    rootGemBody = built.rootGemBody || null;
    rootGemEdges = built.rootGemEdges || null;

    // Migrate built scene's non-building children into the persistent scene.
    for (const child of [...built.scene.children]) scene.add(child);
    // buildCityScene also set its own scene.background; mirror onto ours.
    scene.background = new THREE.Color(SCENE_COLORS.get().GROUND);

    // buildCityScene still builds per-building meshes internally; we don't
    // use them. Remove + dispose to match prior behavior.
    for (const bm of built.buildingMeshes || []) {
      if (bm.parent) bm.parent.remove(bm);
      _disposeObject(bm);
    }
    // Task 15: Remove old per-Group label meshes from buildCityScene —
    // replaced by per-block label InstancedMeshes.
    for (const lg of built.streetLabels || []) {
      if (lg.parent) lg.parent.remove(lg);
      lg.traverse(_disposeObject);
    }

    for (const block of newBlocks) {
      if (block.detailMesh) scene.add(block.detailMesh);
      if (block.labelsMesh) scene.add(block.labelsMesh);
      if (block.billboards) {
        for (const bm of block.billboards) scene.add(bm);
      }
    }
    blocks = newBlocks;
    blocksByDirPath = {};
    for (const block of blocks) {
      if (block.dir?.path != null) blocksByDirPath[block.dir.path] = block;
    }

    // TODO(Task 11/12): _buildOutlinesAndGhosts() removed — per-block
    // instanced outlines/ghosts will be built in Tasks 11-12.
    _buildLookups();
    _computeRootStreetAndGem();

    _emit(changeCbs, _computeDiff(prev));
  }

  function dispose() {
    _disposeAllManifestState();
    beforeChangeCbs.length = 0;
    changeCbs.length = 0;
    _layoutClient.dispose();
  }

  return {
    scene,
    applyManifest,
    dispose,
    onBeforeChange,
    onChange,
    disposeMesh,

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

    // Task 8: new block-level accessors.
    getBlocks(): SceneBlock[] {
      return blocks;
    },
    getBlockByDirPath(path: string): SceneBlock | null {
      return blocksByDirPath[path] || null;
    },
    getBuildingByInstance(block: SceneBlock, instanceId: number): Building | null {
      return block.buildings[instanceId] || null;
    },

    // getBuildings() now returns the InstancedMesh objects (one per block).
    // TODO(Task 10): picker will use getBlocks() + instanceId instead.
    // TODO(Task 11): buildingFader will iterate blocks, not individual meshes.
    getBuildings(): THREE.Object3D[] {
      return buildingMeshes; // empty stub — see NOTE above
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

    // TODO(Task 11/12): per-building outline/ghost arrays replaced by
    // per-block instanced meshes. Returning empty arrays so existing callers
    // (outlineRenderer.refreshMaterials, outlineRenderer.onResize) iterate
    // zero elements and no-op gracefully until Task 11-12 rewrite them.
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
  };
}
