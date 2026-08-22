// city/components/buildings/index.ts — the buildings component: its group, the
// shared material and icon atlas, the per-cell instanced meshes, the lookups,
// and the hover/selection overlays. Buildings exist before the picker does, so
// anything picker-driven is armed on the first tick() rather than constructed.

import * as THREE from 'three';
import { effect, untracked } from '@preact/signals';

import { BUILDINGS, BUILDING_DIMENSIONS } from '@/state/settings/fields/buildings';
import { BLOOM } from '@/state/settings/fields/effects';
import { SCENE } from '@/state/settings/fields/scene';
import { RUINS } from '@/state/settings/fields/ruins';
import type { Building, CityLayout, DateRanges, EnteringBuilding, StayingBuilding } from '@/types';

import type { FrameContext, SceneComponent, SceneContext } from '../../types';
import { armOnFirstTick } from '../../utils/armOnFirstTick';
import type { WorldBounds } from './spatialGrid';
import type { CellTile } from './cellTile';
import { BuildingIndex } from './buildingIndex';
import { buildCellsFromLayout } from './cellAssembly';
import type { InstancedFacadePanels } from './facadePanels';
import { refreshBuildingMaterial } from './material';
import { disposeObject3D } from '@/city/utils/disposeObject3D';
import { sourceOf } from '@/utils/manifest';
import { getBuildingColor, getCreatedAge, getModifiedAge } from './color';
import { createBuildingFader } from './fader';
import { createOutlineRenderer } from './outline';
import { createGhostRenderer } from './ghost';
import { createBuildingTweens } from './tween';
import { createBuildingScrubApply } from './scrubApply';
import type { BuildingScrubState } from './scrubState';
import { parseDateMs } from '@/utils/dates';

/** The diff rebuild() computes against the prior cells and feeds to the tween
 *  queue. No exiting bucket: nothing animates on the way out. */
interface BuildingDiff {
  entering: { buildings: EnteringBuilding[] };
  staying: { buildings: StayingBuilding[] };
}

/** Public contract for the buildings component. */
export interface Buildings extends SceneComponent {
  // Required here, optional on SceneComponent: this one always has a tick, and
  // a caller holding this type shouldn't have to prove it.
  tick(dt: number, ctx: FrameContext): void;
  /** Colour, assemble, swap in, relookup. Diffs against the prior cells to fire
   *  the tweens; the boot rebuild snaps in rather than animating. */
  rebuild(layout: CityLayout, dateRanges: DateRanges, scannedAt?: string | null): Promise<void>;
  /** Resolves when the meshes for the layout in effect exist. A later rebuild
   *  supersedes rather than extends it: the caller re-asks on the next city. */
  whenSettled(): Promise<void>;
  /** Dispose the current instanced facade panels immediately; the next rebuild()
   *  recreates them from the fresh layout. */
  disposeFacadePanels(): void;
  /** Building lookup by file path → { mesh, building, instanceId }. */
  getBuildingByPath(p: string): { mesh: THREE.Mesh; building: Building; instanceId: number } | null;
  /** Cell map (consumed by picker / fader / outline / diff mirror). */
  getCells(): Map<number, CellTile>;
  /** Building index, or null pre-rebuild. */
  getBuildingIndex(): BuildingIndex | null;
  /** Instanced facade panels, or null pre-rebuild / while disposed. */
  getFacadePanels(): InstancedFacadePanels | null;
  /** Resolve a building's live InstancedMesh + slot. Null if no live mesh. */
  getMeshForBuilding(b: Building): { mesh: THREE.InstancedMesh; slot: number } | null;
  /** Paint one frame of Timeline scrub: shape, fade, kind, weathering and the
   *  ad panels. The scrub pass decides the states; this owns the writes. */
  applyScrub(states: ReadonlyMap<string, BuildingScrubState>): void;
  /** Install (or clear with null) the Timeline scrub controller, which drives
   *  scaleY + iFade per frame while a scrub is on. */
  setScrubController(controller: { update(): void } | null): void;
  /** Window-resize hook — forwards to the outline LineMaterial resolution. */
  onResize(): void;
}

export function createBuildings(ctx: SceneContext): Buildings {
  // This city's history, or null when nothing scrubs it.
  const timeline = ctx.timeline?.store ?? null;
  // Persistent outer group — added to the scene once by createCity. rebuild()
  // swaps the inner cell root in and out of this group.
  const group = new THREE.Group();
  group.name = 'city-buildings';

  // Reassigned each rebuild, and read through by the effects and tick, so
  // neither ends up holding a closure over meshes that have been swapped out.
  let _innerCellRoot: THREE.Group | null = null;
  let _cells: Map<number, CellTile> = new Map();
  let _buildingIndex: BuildingIndex | null = null;
  let _facadePanels: InstancedFacadePanels | null = null;
  // Boot-skip: the very first rebuild must NOT animate (the boot city snaps in).
  // Flipped true on the first rebuild; every rebuild after animates.
  let _firstBuildDone = false;
  let _buildingsByPath: Record<
    string,
    { mesh: THREE.Mesh; building: Building; instanceId: number }
  > = {};

  // The detail meshes share one material, flagged so disposeObject3D leaves it
  // alone: disposing it here would leave the next cell root without one.
  function _disposeInner(): void {
    if (_innerCellRoot) {
      _innerCellRoot.traverse(disposeObject3D);
      if (_innerCellRoot.parent) _innerCellRoot.parent.remove(_innerCellRoot);
      _innerCellRoot = null;
    }
    if (_facadePanels) {
      _facadePanels.dispose();
      _facadePanels = null;
    }
  }

  function disposeFacadePanels(): void {
    if (_facadePanels) {
      _facadePanels.dispose();
      _facadePanels = null;
    }
  }

  // Material theme. Reads each store's .value to subscribe to all of them; safe
  // at construction, since none of it is the picker, and it no-ops pre-rebuild.
  const stopMaterialEffect = effect(() => {
    void BUILDINGS.value;
    void SCENE.value;
    void BLOOM.value;
    void BUILDING_DIMENSIONS.value;
    void RUINS.value;
    refreshBuildingMaterial();
    _facadePanels?.refresh();
  });

  // untracked, or this also subscribes to the material stores: a Refresh Save
  // would recreate pickable meshes and leave the picker raycasting dead ones.

  // The most recent rebuild, for a caller that must wait for the meshes.
  let _rebuilding: Promise<void> = Promise.resolve();

  const stopRebuild = effect(() => {
    const layout = ctx.cityState.layout.value;
    const manifest = ctx.cityState.manifest.value;
    if (layout && manifest)
      untracked(() => {
        // Held, not just fired: nothing downstream can know the meshes exist
        // without it (see whenSettled).
        _rebuilding = rebuild(layout, manifest.dateRanges, manifest.scanned_at);
        void _rebuilding;
      });
  });

  // All three subscribe to picker.selection/hover, so they arm on the first
  // tick: at construction ctx.picker is null and they'd track nothing.
  type Fader = ReturnType<typeof createBuildingFader>;
  type Outline = ReturnType<typeof createOutlineRenderer>;
  type Ghost = ReturnType<typeof createGhostRenderer>;
  let _fader: Fader | null = null;
  let _outline: Outline | null = null;
  let _ghost: Ghost | null = null;

  const _arm = armOnFirstTick(ctx, () => {
    // A world-facade over the component-local cells, re-swept on cityRevision.
    _fader = createBuildingFader({
      world: {
        getCells: () => _cells,
        getFacadePanels: () => _facadePanels,
      },
      cityState: ctx.cityState,
      picker: ctx.picker!,
      timeline,
    });
    // Their overlays go straight on the scene: explicit renderOrders, so where
    // they sit in the graph doesn't decide draw order.
    _outline = createOutlineRenderer({
      canvas: ctx.canvas,
      scene: ctx.scene,
      world: { getCells: () => _cells },
      picker: ctx.picker!,
    });
    _ghost = createGhostRenderer({
      scene: ctx.scene,
      world: { getMeshForBuilding: (b) => getMeshForBuilding(b) },
      picker: ctx.picker!,
    });
    return [
      () => {
        _fader?.dispose();
        _fader = null;
      },
      () => {
        _outline?.dispose();
        _outline = null;
      },
      () => {
        _ghost?.dispose();
        _ghost = null;
      },
    ];
  });

  // A building's live mesh + slot, which is how the tween queue reaches one
  // every frame without holding a reference across a rebuild.
  function getMeshForBuilding(b: Building): { mesh: THREE.InstancedMesh; slot: number } | null {
    if (_cells.size > 0 && b.cellId != null && b.slotId != null) {
      const cell = _cells.get(b.cellId);
      if (cell?.detailMesh) return { mesh: cell.detailMesh, slot: b.slotId };
    }
    return null;
  }

  // Enter/stay tween queue. No picker dep, so (unlike fader/outline/ghost) it is
  // created at construction, not armed.
  const _tweens = createBuildingTweens({ getMeshForBuilding });

  // Resolves meshes through the same accessors the tweens use, so a rebuild
  // swaps both onto the fresh cells at once.
  const applyScrub = createBuildingScrubApply({
    getBuildingIndex: () => _buildingIndex,
    getMeshForBuilding,
    getFacadePanels: () => _facadePanels,
  });

  // Timeline scrub controller (installed by the timeline lifecycle). While
  // a scrub, it drives scaleY + iFade per frame instead of the tweens.
  let _scrubController: { update(): void } | null = null;

  // The prior meshes are disposed by now, but that frees GPU geometry only: the
  // matrices still read, so a rapid edit tweens from where things were.
  function _computeBuildingDiff(
    prevCells: Map<number, CellTile>,
    _prevIndex: BuildingIndex | null
  ): BuildingDiff {
    const entering: EnteringBuilding[] = [];
    const staying: StayingBuilding[] = [];

    // Where the last tween left each building, not where layout says it goes.
    const prevTransforms = new Map<
      string,
      { scaleX: number; scaleY: number; scaleZ: number; posX: number; posY: number; posZ: number }
    >();
    const _readMatrix = new THREE.Matrix4();
    const _pos = new THREE.Vector3();
    const _scale = new THREE.Vector3();
    const _quat = new THREE.Quaternion();

    for (const cell of prevCells.values()) {
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
          staying.push({
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
          entering.push({
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

    return { entering: { buildings: entering }, staying: { buildings: staying } };
  }

  // Arms the overlays on the first call, then runs them in field-ownership
  // order: fader, outline, ghost.
  function tick(_dt: number, frame: FrameContext): void {
    // First in the tick: outline and ghost read these matrices further down. In
    // Timeline the scrub controller owns them instead and this stays dormant.
    if (timeline?.mode.peek() && _scrubController) _scrubController.update();
    else _tweens.update(0);
    _arm.arm();
    _fader?.update(0);
    _outline?.update(0);
    _ghost?.update(0);
    // Sub-pixel panels still cost their overdraw, which stalls the GPU on a
    // media-heavy repo. One AABB test hides the lot.
    _facadePanels?.updateLOD(frame.camera, ctx.canvas.clientHeight);
  }

  function onResize(): void {
    _outline?.onResize();
  }

  async function rebuild(
    layout: CityLayout,
    dateRanges: DateRanges,
    scannedAt?: string | null
  ): Promise<void> {
    const buildings = layout?.buildings ?? [];
    // Colour and weathering measure against the scan, not a live clock, so a
    // rebuild is deterministic and the goldens hold.
    const nowMs = parseDateMs(scannedAt ?? '') || Date.now();

    // ---- Color the buildings. ----
    for (const b of buildings) {
      // Building.file is always a FileNode (directories become streets,
      // not buildings — see city/layout/layout.ts).
      b.color = getBuildingColor(
        b.file as unknown as Parameters<typeof getBuildingColor>[0],
        nowMs
      );
      // Independent of colour: creation age, so grime can mark an old file
      // that was edited yesterday.
      b.createdAge = getCreatedAge(
        b.file as unknown as Parameters<typeof getCreatedAge>[0],
        dateRanges
      );
      b.modifiedAge = getModifiedAge(
        b.file as unknown as Parameters<typeof getModifiedAge>[0],
        nowMs
      );
    }

    // Building extents are the fallback for a manifest with no bbox.
    const lb = layout.bbox;
    const bounds: WorldBounds = lb
      ? { minX: lb.minX, maxX: lb.maxX, minZ: lb.minY, maxZ: lb.maxY }
      : (() => {
          let minX = 0,
            maxX = 0,
            minZ = 0,
            maxZ = 0;
          for (const b of buildings) {
            if (b.x - b.w / 2 < minX) minX = b.x - b.w / 2;
            if (b.x + b.w / 2 > maxX) maxX = b.x + b.w / 2;
            if (b.y - b.d / 2 < minZ) minZ = b.y - b.d / 2;
            if (b.y + b.d / 2 > maxZ) maxZ = b.y + b.d / 2;
          }
          return { minX, maxX, minZ, maxZ };
        })();

    // ---- Assemble the cell scene (buildings only). ----
    // THIS city's source, not the app's: the landing's backdrop is another repo.
    const cellOut = buildCellsFromLayout(
      bounds,
      buildings,
      sourceOf(ctx.cityState.manifest.peek()),
      timeline
    );

    // Grabbed before the swap reassigns them: the arrays stay readable through
    // disposal, but these bindings don't.
    const prevCells = _cells;
    const prevIndex = _buildingIndex;

    // ---- Atomic swap: dispose the prior inner cell root + facade panels, then
    // adopt the fresh ones into the persistent group. ----
    _disposeInner();

    _innerCellRoot = cellOut.sceneRoot;
    _cells = cellOut.cells;
    _buildingIndex = cellOut.index;
    _facadePanels = cellOut.facadePanels;

    group.add(_innerCellRoot);

    // ---- Rebuild the building-by-path lookup from the new cells. ----
    _buildingsByPath = {};
    for (const cell of _cells.values()) {
      if (!cell.detailMesh) continue;
      for (let i = 0; i < cell.buildings.length; i++) {
        const b = cell.buildings[i];
        if (b?.file?.path != null) {
          _buildingsByPath[b.file.path] = {
            mesh: cell.detailMesh as unknown as THREE.Mesh,
            building: b,
            instanceId: i,
          };
        }
      }
    }

    // The boot rebuild snaps in: nothing should animate into place on load.
    const diff = _computeBuildingDiff(prevCells, prevIndex);
    // Tweens dedup by Building identity and every rebuild makes fresh ones, so
    // a survivor would write its old matrix into whatever now holds that slot.
    _tweens.clear();
    // Same hazard as the tweens: it holds the old manifest's Buildings.
    // reapplyTimelineScene reinstalls one, so only a repo switch leaves it null.
    _scrubController = null;
    if (!_firstBuildDone) {
      _firstBuildDone = true;
    } else if (!timeline?.mode.peek()) {
      // Timeline mode packs the union once; the scrub controller owns the
      // matrix from here, so don't animate a per-commit diff against it.
      _tweens.onDiff(diff);
    }
  }

  function dispose(): void {
    _disposeInner();
    _tweens.clear();
    stopMaterialEffect();
    stopRebuild();
    _arm.dispose();
    _buildingsByPath = {};
    _cells = new Map();
    _buildingIndex = null;
  }

  return {
    group,
    rebuild,
    whenSettled: () => _rebuilding,
    disposeFacadePanels,
    tick,
    onResize,
    dispose,
    getBuildingByPath: (p) => _buildingsByPath[p] || null,
    getCells: () => _cells,
    getBuildingIndex: () => _buildingIndex,
    getFacadePanels: () => _facadePanels,
    getMeshForBuilding,
    applyScrub,
    setScrubController: (c) => {
      _scrubController = c;
    },
  };
}
