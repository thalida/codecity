// city/components/buildings/index.ts — Buildings COMPONENT (public door).
//
// Self-contained scene component: owns its persistent group (the cell-root
// holder), the shared building material + icon atlas, the per-cell
// InstancedMesh cell scene (built via cellAssembly.ts on rebuild), the building
// path/cell lookups, the instanced ad panels, and the hover/selection
// overlays (fader / outline / ghost). rebuild(layout, dateRanges) colors the
// buildings, assembles the cells, swaps them into the persistent group, and
// rebuilds the lookups. The material reacts to BUILDINGS/FACADE/SCENE/BLOOM
// via an effect; the fader/outline/ghost are picker-driven and ARMED on the
// first tick() (like streets), once ctx.picker is live.
//
// Construction-time bridge (Strategy A): buildings are built inside world.ts
// BEFORE the picker/camera/renderer exist. The component captures the
// SceneContext at construction. The material theme effect reads only settings
// signals, so it's safe at construction. The fader/outline/ghost subscribe to
// picker.selection/hover, so they are NOT created at construction — they are
// armed on the first tick(), once renderLoop has populated ctx.picker.
//
// Option B (Task 12, amended by Task 13): the building DIFF stays in world;
// the animator no longer exists as a module — its tween queue lives here
// (tween.ts) behind animateFrom(diff)/tick(). world keeps computing the diff
// via _computeDiff and renderLoop feeds it to animateFrom via world.onChange;
// the tweens resolve meshes through getMeshForBuilding() here. World mirrors
// _cells/_buildingIndex from this component after rebuild so its _computeDiff
// / PrevState still read populated structures.

import * as THREE from 'three';
import { effect } from '@preact/signals';

import { BUILDINGS, BUILDING_DIMENSIONS } from '@/state/stores/settings/buildings';
import { FACADE } from '@/state/stores/settings/facade';
import { BLOOM } from '@/state/stores/settings/effects';
import { SCENE } from '@/state/stores/settings/scene';
import type {
  Building,
  CityLayout,
  DateRanges,
  EnteringBuilding,
  ExitingEntry,
  Street,
  StayingBuilding,
} from '@/types';

import type { FrameContext, SceneComponent, SceneContext } from '../../types';
import { armOnFirstTick } from '../armOnFirstTick';
import type { WorldBounds } from './spatialGrid';
import type { CellTile } from './cellTile';
import { BuildingIndex } from './buildingIndex';
import { buildCellsFromLayout } from './cellAssembly';
import type { InstancedAdPanels } from './adPanels';
import { getSharedBuildingUniforms, setIconAtlas, refreshBuildingMaterial } from './material';
import { setCellIconAtlas } from './cellMesh';
import { disposeObject3D } from '@/city/utils/disposeObject3D';
import type { IconAtlas } from './atlas';
import { getBuildingColor, getCreatedAge, getModifiedAge } from './color';
import { createBuildingFader } from './fader';
import { createOutlineRenderer } from './outline';
import { createGhostRenderer } from './ghost';
import { createBuildingTweens } from './tween';

/** Building-only slice of WorldDiff. Accepted by animateFrom() so a full
 *  WorldDiff (from world.onChange) flows in structurally without pulling
 *  the street buckets. */
export interface BuildingDiff {
  entering: { buildings: EnteringBuilding[] };
  staying: { buildings: StayingBuilding[] };
  exiting: { buildings: ExitingEntry[] };
}

/** Construction-time deps sourced from world (the streets lookup + onChange
 *  for the fader; world has _streets + onChange in scope when it builds this
 *  component). Keeps SceneContext untouched. */
export interface BuildingsDeps {
  getStreetByDir(path: string): Street | null;
  onChange(cb: () => void): () => void;
}

/** Public contract for the buildings component. */
export interface Buildings extends SceneComponent {
  /** Color the buildings, assemble the cells, swap them into the group, and
   *  rebuild the lookups. Always rebuilds (the cell root is always rebuilt —
   *  not scenic-gated). World computes its own diff via _computeDiff. */
  rebuild(layout: CityLayout, dateRanges: DateRanges): Promise<void>;
  /** Push the roof-icon atlas into the shared material + cell factory. Must
   *  run BEFORE rebuild() (the atlas is read while building the cells). */
  setAtlas(atlas: IconAtlas | null): void;
  /** Dispose the current instanced ad panels immediately (world.resetCache
   *  uses this to drop stale panels on a source switch). The next rebuild()
   *  rebuilds them from the fresh layout. */
  disposeAdPanels(): void;
  /** Building lookup by file path → { mesh, building, instanceId }. */
  getByPath(p: string): { mesh: THREE.Mesh; building: Building; instanceId: number } | null;
  /** Full building-by-path map (consumed wholesale by some callers). */
  getBuildingsByPath(): Record<
    string,
    { mesh: THREE.Mesh; building: Building; instanceId: number }
  >;
  /** Per-cell detail InstancedMeshes suitable for raycasting against. */
  pickables(): THREE.Object3D[];
  /** Tallest building (layout pos + dims), or null when empty. */
  tallest(): { x: number; y: number; w: number; d: number; h: number } | null;
  /** Tallest building height (b.h), or 0 when empty. */
  maxHeight(): number;
  /** Cell map (consumed by picker / fader / outline / diff mirror). */
  getCells(): Map<number, CellTile>;
  /** Building index, or null pre-rebuild. */
  getBuildingIndex(): BuildingIndex | null;
  /** Resolve a building's live InstancedMesh + slot. Null if no live mesh. */
  getMeshForBuilding(b: Building): { mesh: THREE.InstancedMesh; slot: number } | null;
  /** Instanced ad-panel manager, or null when there are no media files. */
  getAdPanels(): InstancedAdPanels | null;
  /** Window-resize hook — forwards to the outline LineMaterial resolution. */
  onResize(): void;
  /** Start enter/stay tweens from a building diff (the dissolved animator).
   *  Driven per-frame by tick(); each tween re-resolves its mesh via
   *  getMeshForBuilding() so it survives rebuilds (null → dropped).
   *  Accepts a WorldDiff structurally (BuildingDiff is its buildings slice). */
  animateFrom(diff: BuildingDiff): void;
}

export function createBuildings(ctx: SceneContext, deps: BuildingsDeps): Buildings {
  // Persistent outer group — added to the scene once by world.ts. rebuild()
  // swaps the inner cell root in and out of this group.
  const group = new THREE.Group();
  group.name = 'city-buildings';

  // Component-level mutable refs, reassigned each rebuild. The effects /
  // tick target these (NOT stale closure captures) so they hit the live
  // meshes after every rebuild.
  let _innerCellRoot: THREE.Group | null = null;
  let _cells: Map<number, CellTile> = new Map();
  let _buildingIndex: BuildingIndex | null = null;
  let _adPanels: InstancedAdPanels | null = null;
  let _buildingsByPath: Record<
    string,
    { mesh: THREE.Mesh; building: Building; instanceId: number }
  > = {};

  // Dispose + remove the prior inner cell root and instanced ad panels.
  // The cell detail meshes SHARE one ShaderMaterial (cellMesh.ts flags them
  // userData.sharedMaterial = true); disposeObject3D's sharedMaterial guard
  // skips disposing it so the new cell root's meshes keep a live material.
  function _disposeInner(): void {
    if (_innerCellRoot) {
      _innerCellRoot.traverse(disposeObject3D);
      if (_innerCellRoot.parent) _innerCellRoot.parent.remove(_innerCellRoot);
      _innerCellRoot = null;
    }
    if (_adPanels) {
      _adPanels.dispose();
      _adPanels = null;
    }
  }

  function setAtlas(atlas: IconAtlas | null): void {
    setIconAtlas(atlas);
    setCellIconAtlas(atlas);
  }

  function disposeAdPanels(): void {
    if (_adPanels) {
      _adPanels.dispose();
      _adPanels = null;
    }
  }

  // (1) Shared-material theme effect — reacts to BUILDINGS / FACADE / SCENE /
  // BLOOM / BUILDING_DIMENSIONS changes (Save). Replaces the
  // refreshBuildingMaterial() call that renderLoop.applyTheme() used to make.
  // Reads each store's .value so the effect subscribes to all of them, then
  // runs the verbatim refreshBuildingMaterial() body (which re-applies the
  // uniforms). Safe at construction: reads only settings signals (no picker).
  // If the shared material isn't created yet (first rebuild lazily creates it),
  // refreshBuildingMaterial() no-ops via its `if (!_sharedMaterial) return`
  // guard — the constructor seeds the identical values, so a missed first run
  // is behavior-identical to the old construct-then-Save flow.
  const stopMaterialEffect = effect(() => {
    void BUILDINGS.value;
    void FACADE.value;
    void SCENE.value;
    void BLOOM.value;
    void BUILDING_DIMENSIONS.value;
    refreshBuildingMaterial();
  });

  // (2)(3)(4) Picker-driven hover/selection overlays — fader (body opacity),
  // outline (hover/selected boxes), ghost (hover preview). All three subscribe
  // to picker.selection/hover at construction, so they are NOT created at
  // component construction (ctx.picker is null there — they'd track NO signal
  // and never re-fire). They are ARMED on the first tick(), once renderLoop
  // has populated ctx.picker. Mirrors the streets arming pattern.
  //
  // On the first tick both cells (built by the boot rebuild, which runs before
  // the first animate frame) and ctx.picker are live, so the construction-time
  // sweeps see populated cells + null selection → default opacities, identical
  // to the old renderLoop construct-after-applyManifest flow.
  type Fader = ReturnType<typeof createBuildingFader>;
  type Outline = ReturnType<typeof createOutlineRenderer>;
  type Ghost = ReturnType<typeof createGhostRenderer>;
  let _fader: Fader | null = null;
  let _outline: Outline | null = null;
  let _ghost: Ghost | null = null;

  const _arm = armOnFirstTick(
    ctx,
    () => {
      // Fader gets a world-facade: cells + ad panels are component-local;
      // getStreetByDir + onChange are threaded from world via deps.
      _fader = createBuildingFader({
        world: {
          getCells: () => _cells,
          getStreetByDir: deps.getStreetByDir,
          getAdPanels: () => _adPanels,
          onChange: deps.onChange,
        },
        picker: ctx.picker!,
      });
      // Outline + ghost reach the cells / mesh resolver locally. They add their
      // overlay meshes to ctx.scene (verbatim — they carry explicit
      // renderOrders, so scene-graph parenting is irrelevant to draw order).
      _outline = createOutlineRenderer({
        canvas: ctx.renderer!.domElement,
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
    },
    { needsRenderer: true }
  );

  // getMeshForBuilding (named so the ghost facade + the door entry share one
  // impl). VERBATIM from world.ts (~1463): the _cells.size>0 && cellId!=null
  // && slotId!=null guard + cell.detailMesh lookup. The animator resolves every
  // tween through it (via world.getMeshForBuilding → this) every frame.
  function getMeshForBuilding(b: Building): { mesh: THREE.InstancedMesh; slot: number } | null {
    if (_cells.size > 0 && b.cellId != null && b.slotId != null) {
      const cell = _cells.get(b.cellId);
      if (cell?.detailMesh) return { mesh: cell.detailMesh, slot: b.slotId };
    }
    return null;
  }

  // Enter/stay tween queue — the dissolved system/animator. No picker dep, so
  // (unlike fader/outline/ghost) it is created at construction, not armed.
  const _tweens = createBuildingTweens({ getMeshForBuilding });

  function animateFrom(diff: BuildingDiff): void {
    _tweens.onDiff(diff);
  }

  // tick() — arms the picker overlays on the first call, then drives the three
  // per-frame syncs in the SAME order renderLoop did: fader.update →
  // outline.update → ghost.update (field-ownership order; see the old
  // renderLoop animate() comments). treeOutlineRenderer/pathLineRenderer stay
  // in renderLoop and now run AFTER this tick (proven behavior-neutral — their
  // writes are disjoint from these and are only consumed at postFx.render).
  function tick(_dt: number, _frame: FrameContext): void {
    // Entering/staying tweens run FIRST within the tick — this was
    // animator.update(0) in renderLoop's animate(), pre-Task-13. Nothing
    // between that slot and this one reads instance matrices; outline/ghost
    // read them AFTER, within this tick — behavior-identical ordering.
    _tweens.update(0);
    _arm.arm();
    _fader?.update(0);
    _outline?.update(0);
    _ghost?.update(0);
  }

  function onResize(): void {
    _outline?.onResize();
  }

  async function rebuild(layout: CityLayout, dateRanges: DateRanges): Promise<void> {
    const buildings = layout?.buildings ?? [];

    // ---- Color the buildings (moved verbatim from world.applyManifest). ----
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
    // safe). (Moved verbatim from world.applyManifest.) ----
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
    const cellOut = buildCellsFromLayout(bounds, buildings, getSharedBuildingUniforms());

    // ---- Atomic swap: dispose the prior inner cell root + ad panels, then
    // adopt the fresh ones into the persistent group. ----
    _disposeInner();

    _innerCellRoot = cellOut.sceneRoot;
    _cells = cellOut.cells;
    _buildingIndex = cellOut.index;
    _adPanels = cellOut.adPanels;

    group.add(_innerCellRoot);

    // ---- Rebuild the building-by-path lookup from the new cells. (Moved
    // verbatim from world._buildLookups.) ----
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
  }

  function dispose(): void {
    _disposeInner();
    _tweens.clear();
    stopMaterialEffect();
    _arm.dispose();
    _buildingsByPath = {};
    _cells = new Map();
    _buildingIndex = null;
  }

  return {
    group,
    rebuild,
    setAtlas,
    disposeAdPanels,
    tick,
    onResize,
    animateFrom,
    dispose,
    getByPath: (p) => _buildingsByPath[p] || null,
    getBuildingsByPath: () => _buildingsByPath,
    pickables: () => {
      const out: THREE.Object3D[] = [];
      for (const cell of _cells.values()) {
        out.push(cell.detailMesh);
      }
      return out;
    },
    tallest: () => {
      let tallest: Building | null = null;
      for (const cell of _cells.values()) {
        for (const b of cell.buildings) {
          if (b && (!tallest || b.h > tallest.h)) tallest = b;
        }
      }
      if (!tallest) return null;
      return { x: tallest.x, y: tallest.y, w: tallest.w, d: tallest.d, h: tallest.h };
    },
    maxHeight: () => {
      let maxH = 0;
      for (const cell of _cells.values()) {
        for (const b of cell.buildings) {
          if (b && b.h > maxH) maxH = b.h;
        }
      }
      return maxH;
    },
    getCells: () => _cells,
    getBuildingIndex: () => _buildingIndex,
    getAdPanels: () => _adPanels,
    getMeshForBuilding,
  };
}
