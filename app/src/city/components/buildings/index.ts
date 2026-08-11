// city/components/buildings/index.ts — Buildings COMPONENT (public door).
//
// Self-contained scene component: owns its persistent group (the cell-root
// holder), the shared building material + icon atlas, the per-cell
// InstancedMesh cell scene (built via cellAssembly.ts on rebuild), the building
// path/cell lookups, the instanced facade panels, and the hover/selection
// overlays (fader / outline / ghost). rebuild(layout, dateRanges) colors the
// buildings, assembles the cells, swaps them into the persistent group, and
// rebuilds the lookups. The material reacts to BUILDINGS/SCENE/BLOOM
// via an effect; the fader/outline/ghost are picker-driven and ARMED on the
// first tick() (like streets), once ctx.picker is live.
//
// Buildings are built before the picker/camera/renderer exist. The material
// theme effect reads only settings signals (safe at construction); the
// fader/outline/ghost subscribe to picker.selection/hover, so they are armed on
// the first tick() once ctx.picker is live, not at construction.
//
// Self-tween: the building enter/stay DIFF is computed HERE, inside rebuild(),
// against the prior cells captured before disposal — the tween queue lives here
// (tween.ts) and is fed directly from that internal diff. The boot rebuild does
// NOT animate (it skips the very first diff), so the city paints in place on
// first load and only later edits tween. The tweens resolve meshes through
// getMeshForBuilding() here. The component owns its cells/buildingIndex; world's
// getCells/getBuildingIndex accessors read straight off it.

import * as THREE from 'three';
import { effect, untracked } from '@preact/signals';

import { BUILDINGS, BUILDING_DIMENSIONS } from '@/state/stores/settings/buildings';
import { BLOOM } from '@/state/stores/settings/effects';
import { SCENE } from '@/state/stores/settings/scene';
import { RUINS } from '@/state/stores/settings/ruins';
import { TIMELINE_MODE } from '@/state/stores/timeline';
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
import { getBuildingColor, getCreatedAge, getModifiedAge } from './color';
import { createBuildingFader } from './fader';
import { createOutlineRenderer } from './outline';
import { createGhostRenderer } from './ghost';
import { createBuildingTweens } from './tween';
import { createBuildingScrubApply } from './scrubApply';
import type { BuildingScrubState } from './scrubState';

/** The enter/stay diff rebuild() computes internally (against the prior cells)
 *  and feeds straight to the tween queue. Only entering/staying matter to the
 *  tweens — there is no exit animation in V1, so no exiting bucket. */
interface BuildingDiff {
  entering: { buildings: EnteringBuilding[] };
  staying: { buildings: StayingBuilding[] };
}

/** Public contract for the buildings component. */
export interface Buildings extends SceneComponent {
  /** Color the buildings, assemble the cells, swap them into the group, and
   *  rebuild the lookups. Always rebuilds (the cell root is always rebuilt —
   *  not scenic-gated). Computes its OWN enter/stay diff against the prior
   *  cells and fires the tweens (boot rebuild snaps in without animating). */
  rebuild(layout: CityLayout, dateRanges: DateRanges): Promise<void>;
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
   *  scaleY + iFade per frame while TIMELINE_MODE is on. */
  setScrubController(controller: { update(): void } | null): void;
  /** Window-resize hook — forwards to the outline LineMaterial resolution. */
  onResize(): void;
}

export function createBuildings(ctx: SceneContext): Buildings {
  // Persistent outer group — added to the scene once by createCity. rebuild()
  // swaps the inner cell root in and out of this group.
  const group = new THREE.Group();
  group.name = 'city-buildings';

  // Component-level mutable refs, reassigned each rebuild. The effects /
  // tick target these (NOT stale closure captures) so they hit the live
  // meshes after every rebuild.
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

  // Dispose + remove the prior inner cell root and instanced facade panels.
  // The cell detail meshes SHARE one ShaderMaterial (cellMesh.ts flags them
  // userData.sharedMaterial = true); disposeObject3D's sharedMaterial guard
  // skips disposing it so the new cell root's meshes keep a live material.
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

  // (1) Shared-material theme effect — reacts to BUILDINGS / SCENE / BLOOM /
  // BUILDING_DIMENSIONS / RUINS changes (Save). Reads each store's .value so the
  // effect subscribes to all of them, then re-applies the material uniforms and
  // the ad-panel emission (BLOOM.MEDIA_EMISSION). Safe at construction: reads only
  // settings signals (no picker). If the shared material isn't created yet (first
  // rebuild lazily creates it), refreshBuildingMaterial() no-ops via its
  // `if (!_sharedMaterial) return` guard and _facadePanels is null, and the
  // constructor seeds the identical values.
  const stopMaterialEffect = effect(() => {
    void BUILDINGS.value;
    void SCENE.value;
    void BLOOM.value;
    void BUILDING_DIMENSIONS.value;
    void RUINS.value;
    refreshBuildingMaterial();
    _facadePanels?.refresh();
  });

  // Layout effect — reactive rebuild entry point. Reads cityState.layout (the
  // every-apply signal — per-building dims recompute even on a reuse apply) +
  // manifest (for dateRanges). rebuild() is synchronous here: applyManifest sets
  // the icon atlas BEFORE the layout signal fires, so the cells bake the right
  // roof UVs and buildings paint in the same batch as streets (no flash). The
  // boot rebuild snaps in (_firstBuildDone); the null-guard no-ops construction.
  //
  // rebuild() is wrapped untracked because its synchronous prefix reads
  // BUILDINGS.value (getBuildingColor, cell facade) + SCENE/BLOOM. Without it
  // this effect would subscribe to those stores and rebuild every cell on a
  // Refresh-route material Save — recreating the pickable cell meshes without
  // bumping cityRevision, so the picker would keep raycasting the disposed cells
  // (hover/selection silently breaking). Refresh material changes are applied in
  // place by stopMaterialEffect; the Rebuild-route palette/geometry fields reach
  // here via layout.value, which applyManifest always reassigns.
  const stopRebuild = effect(() => {
    const layout = ctx.cityState.layout.value;
    const manifest = ctx.cityState.manifest.value;
    if (layout && manifest) untracked(() => void rebuild(layout, manifest.dateRanges));
  });

  // (2)(3)(4) Picker-driven hover/selection overlays — fader (body opacity),
  // outline (hover/selected boxes), ghost (hover preview). All three subscribe
  // to picker.selection/hover, so they are ARMED on the first tick() once
  // ctx.picker is live, not at construction (ctx.picker is null there — they'd
  // track NO signal). Mirrors the streets arming pattern. On the first tick both
  // the boot-rebuild cells and ctx.picker are live, so the initial sweeps see
  // populated cells + null selection → default opacities.
  type Fader = ReturnType<typeof createBuildingFader>;
  type Outline = ReturnType<typeof createOutlineRenderer>;
  type Ghost = ReturnType<typeof createGhostRenderer>;
  let _fader: Fader | null = null;
  let _outline: Outline | null = null;
  let _ghost: Ghost | null = null;

  const _arm = armOnFirstTick(ctx, () => {
    // Fader gets a world-facade for the component-local cells + facade panels;
    // it reads the street-by-dir lookup off cityState. Re-sweeps on a city
    // rebuild via cityState.cityRevision.
    _fader = createBuildingFader({
      world: {
        getCells: () => _cells,
        getFacadePanels: () => _facadePanels,
      },
      cityState: ctx.cityState,
      picker: ctx.picker!,
    });
    // Outline + ghost reach the cells / mesh resolver locally. They add their
    // overlay meshes to ctx.scene — they carry explicit renderOrders, so
    // scene-graph parenting is irrelevant to draw order.
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

  // getMeshForBuilding (named so the ghost facade + the door entry share one
  // impl). Resolves a building's live InstancedMesh + slot via its cellId/slotId;
  // the tween queue resolves every tween through it each frame.
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
  // TIMELINE_MODE, it drives scaleY + iFade per frame instead of the tweens.
  let _scrubController: { update(): void } | null = null;

  // _computeBuildingDiff — compares the PRIOR cells (captured before the dispose
  // in rebuild) against the component's freshly-adopted _buildingIndex,
  // producing entering / staying buckets the tween queue consumes. Reads prev
  // transforms via detailMesh.getMatrixAt at each building's slot; classifies
  // entering vs staying by file.path. prevIndex is accepted for symmetry but
  // unused.
  //
  // Liveness: the prev detailMeshes are already disposed by rebuild's
  // _disposeInner before this runs — but disposeObject3D only frees GPU
  // geometry, NOT the JS-side instanceMatrix Float32Array, so getMatrixAt still
  // reads the last-rendered transforms and a rapid edit tweens from where the
  // buildings actually were rather than snapping to layout.
  function _computeBuildingDiff(
    prevCells: Map<number, CellTile>,
    _prevIndex: BuildingIndex | null
  ): BuildingDiff {
    const entering: EnteringBuilding[] = [];
    const staying: StayingBuilding[] = [];

    // file.path → prior transform (scale + position), read from the prior cell's
    // detailMesh at the building's slot to capture wherever the last tween left
    // it (so a rapid edit doesn't snap to layout).
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

  // tick() — arms the picker overlays on the first call, then drives the three
  // per-frame syncs in field-ownership order: fader.update → outline.update →
  // ghost.update. The composer (city/index.ts) runs treeOutlineRenderer/
  // pathLineRenderer AFTER this tick — their writes are disjoint from these and
  // are only consumed at postFx.render.
  function tick(_dt: number, frame: FrameContext): void {
    // Entering/staying tweens run FIRST within the tick. Nothing between that
    // slot and this one reads instance matrices; outline/ghost read them
    // AFTER, within this tick. In Timeline mode the scrub controller owns the
    // matrix + iFade instead, so the tween queue stays dormant.
    if (TIMELINE_MODE.peek() && _scrubController) _scrubController.update();
    else _tweens.update(0);
    _arm.arm();
    _fader?.update(0);
    _outline?.update(0);
    _ghost?.update(0);
    // Distance LOD: hide the transparent facade panels once they're sub-pixel
    // (zoomed far out) so their overdraw doesn't stall the GPU on media-heavy
    // repos. Cheap O(1) visibility toggle off the panel AABB + camera.
    _facadePanels?.updateLOD(frame.camera, ctx.canvas.clientHeight);
  }

  function onResize(): void {
    _outline?.onResize();
  }

  async function rebuild(layout: CityLayout, dateRanges: DateRanges): Promise<void> {
    const buildings = layout?.buildings ?? [];

    // ---- Color the buildings. ----
    for (const b of buildings) {
      // Building.file is always a FileNode (directories become streets,
      // not buildings — see city/layout/layout.ts).
      b.color = getBuildingColor(
        b.file as unknown as Parameters<typeof getBuildingColor>[0],
        dateRanges
      );
      // createdAge is independent of color: it tracks file age (creation
      // date) so grime/weathering can mark old files even if they were
      // recently edited.
      b.createdAge = getCreatedAge(
        b.file as unknown as Parameters<typeof getCreatedAge>[0],
        dateRanges
      );
      b.modifiedAge = getModifiedAge(
        b.file as unknown as Parameters<typeof getModifiedAge>[0],
        dateRanges
      );
    }

    // ---- Derive WorldBounds from the layout bbox. Fall back to building
    // extents if bbox is absent (shouldn't happen for a real manifest, but
    // safe). ----
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
    const cellOut = buildCellsFromLayout(bounds, buildings);

    // Capture the PRIOR cells/index BEFORE disposing them. _disposeInner only
    // frees GPU geometry (not the JS-side instanceMatrix arrays), so these
    // references stay readable for the diff below even post-dispose — but we
    // must grab them now because the swap reassigns _cells/_buildingIndex.
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

    // ---- Self-tween: compute the enter/stay diff (prev cells vs the new
    // _buildingIndex just adopted above) and fire the tweens — UNLESS this is
    // the boot rebuild, which snaps in without animating (createCity
    // subscribes to cityState changes only AFTER the initial build).
    const diff = _computeBuildingDiff(prevCells, prevIndex);
    // Drop any in-flight tweens from a PRIOR rebuild before queueing this one's.
    // Tweens dedup by Building-object identity, but every rebuild produces fresh
    // Building objects — so a stale tween would survive and keep writing its
    // matrix, resolved by cellId/slotId into the NEW cells, into a slot now held
    // by a different building (or a previously scale-zero unused slot). That
    // leaves a phantom building stuck at an old transform (z-fighting). The
    // fresh diff above re-seeds from the current on-screen matrices, so clearing
    // loses no animation continuity.
    _tweens.clear();
    // Same hazard as the tweens: it holds the old manifest's Buildings.
    // reapplyTimelineScene reinstalls one, so only a repo switch leaves it null.
    _scrubController = null;
    if (!_firstBuildDone) {
      _firstBuildDone = true;
    } else if (!TIMELINE_MODE.peek()) {
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
