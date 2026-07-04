// city/components/buildings/fader.ts — per-instance opacity writes for the
// building InstancedMesh. Subscribes to picker.selection and picker.hover;
// on either change, sweeps all cells and writes the iFade
// InstancedBufferAttribute for each instance based on tree-distance from
// the resolved directory target. Marks needsUpdate = true so the shader
// picks up the new alpha next frame.
//
// Per-frame cost: zero. All work happens once per selection/hover change.
//
// Field ownership:
//   buildingFader   → cell.detailMesh geometry attribute 'iFade'
//   outlineRenderer → ghost/outline opacities
//   ghostRenderer   → ghost mesh opacity
//
// The fader writes iFade on each CellTile.detailMesh (vec3 layout).

import * as THREE from 'three';
import { effect, untracked } from '@preact/signals';
import { BUILDINGS } from '@/state/stores/settings/buildings';
import type { BuildingsConfig } from '@/state/stores/settings/buildings';
import { FadeDetail, NodeKind } from '@/types';
import type { DirNode, FileNode, PickTarget } from '@/types';
import { parentDirPath } from '@/city/utils/path';
import { ROOT_PATH } from '@/constants/manifest';
import type { CellTile } from './cellTile';
import type { InstancedAdPanels } from './adPanels';
import type { createPicker } from '@/city/interaction/picker';
import type { CityState } from '@/city/state';

// Narrow world surface the fader needs (cells + ad panels are component-local).
// The street-by-dir lookup comes from cityState directly. Decouples the fader
// from the buildings component's broader handle.
interface FaderWorld {
  getCells(): Map<number, CellTile>;
  getAdPanels(): InstancedAdPanels | null;
}

interface TierResult {
  detail: FadeDetail;
  bodyOpacity: number;
  outlineEnabled: boolean;
  outlineOpacity: number;
}

// Tier level for a building relative to the directory target, measured
// as the symmetric directory-tree distance: hops up to the lowest common
// ancestor plus hops back down. distance 0 = same dir (L1); 1 = one hop
// in either direction (L2); 2 = two hops (L3); 3+ = far (L4). Going up
// matters the same as going down so a file in `src/lib/` and a file in
// `src/foo/bar/` are equally "near" a selection in `src/foo/`.
function _tierLevelFor(file: FileNode | null, dir: DirNode): 1 | 2 | 3 | 4 {
  if (!file?.path || !dir || dir.path == null) return 4;
  let parent = parentDirPath(file.path);
  if (parent == null) parent = ROOT_PATH;
  const ap = parent === ROOT_PATH ? [] : parent.split('/');
  const dp = dir.path === ROOT_PATH ? [] : dir.path.split('/');
  let lca = 0;
  while (lca < ap.length && lca < dp.length && ap[lca] === dp[lca]) lca++;
  const distance = ap.length - lca + (dp.length - lca);
  if (distance === 0) return 1;
  if (distance === 1) return 2;
  if (distance === 2) return 3;
  return 4;
}

export function createBuildingFader({
  world,
  cityState,
  picker,
}: {
  world: FaderWorld;
  cityState: CityState;
  picker: ReturnType<typeof createPicker>;
}) {
  function _resolveDirTarget(sel: PickTarget | null, hov: PickTarget | null): DirNode | null {
    let dirTarget: DirNode | null = null;
    if (sel) {
      if (sel.kind === NodeKind.Directory) {
        dirTarget = sel.dir;
      } else if (sel.kind === NodeKind.File) {
        const pp = parentDirPath(sel.file.path);
        if (pp != null) {
          const ps = cityState.streetsByDirMap.peek()[pp];
          if (ps) dirTarget = ps.dir;
        }
      }
    }
    if (hov) {
      if (hov.kind === NodeKind.Directory && hov.street?.dir) {
        dirTarget = hov.street.dir;
      } else if (hov.kind === NodeKind.File && hov.file) {
        const hp = parentDirPath(hov.file.path);
        if (hp != null) {
          const hs = cityState.streetsByDirMap.peek()[hp];
          if (hs) dirTarget = hs.dir;
        }
      }
    }
    return dirTarget;
  }

  // Read one tier's four config values by key prefix. The BUILDINGS
  // store is flat (DEFAULT_*, LEVEL1_*…LEVEL4_*); dir-tree level N maps to
  // the LEVEL{N} prefix, every other tier to DEFAULT.
  function _tierFromPrefix(
    fadeCfg: BuildingsConfig,
    prefix: 'DEFAULT' | 'LEVEL1' | 'LEVEL2' | 'LEVEL3' | 'LEVEL4'
  ): TierResult {
    return {
      detail: fadeCfg[`${prefix}_DETAIL`],
      bodyOpacity: fadeCfg[`${prefix}_BODY_OPACITY`],
      outlineEnabled: fadeCfg[`${prefix}_OUTLINE`],
      outlineOpacity: fadeCfg[`${prefix}_OUTLINE_OPACITY`],
    };
  }

  // Shared tier decision used by both building-instance writes and
  // billboard-group writes. Pulled into its own function so the two
  // code paths produce IDENTICAL tier results — a media file's
  // billboard fades to the same opacity that a non-media sibling's
  // building instance would.
  function _tierFor(
    file: FileNode,
    bldgTargetFile: FileNode | null,
    dirTarget: DirNode | null,
    hoverFile: FileNode | null,
    fadeCfg: BuildingsConfig
  ): TierResult {
    // Hover wins — its tier values overwrite any selection/dir-tree result
    // unconditionally, so check first and skip the more expensive
    // dirTreeDistance walk when the cursor is already on this building.
    // The hover outline is owned by outlineRenderer, so force it off here.
    if (hoverFile && file.path === hoverFile.path) {
      return { ..._tierFromPrefix(fadeCfg, 'DEFAULT'), outlineEnabled: false, outlineOpacity: 0 };
    }

    if (bldgTargetFile && file.path === bldgTargetFile.path) {
      return _tierFromPrefix(fadeCfg, 'DEFAULT');
    }

    if (dirTarget) {
      const lvl = _tierLevelFor(file, dirTarget);
      return _tierFromPrefix(fadeCfg, `LEVEL${lvl}`);
    }

    return _tierFromPrefix(fadeCfg, 'DEFAULT');
  }

  function _sweepAll(): void {
    const sel = picker.selection.value;
    const hov = picker.hover.value;

    const bldgTargetFile = sel && sel.kind === NodeKind.File ? sel.file : null;
    const dirTarget = _resolveDirTarget(sel, hov);
    const hoverFile = hov && hov.kind === NodeKind.File ? hov.file : null;

    const fadeCfg = BUILDINGS.value;

    // Collected by the cell sweep, drained into the ad-panel sweep below
    // so a media building's ad panel dims by exactly the same factor as
    // its building body when the selection cascade demotes it to a
    // lower tier. Built once per sweep rather than recomputed inside
    // applyBuildingFades' per-slot callback to avoid an O(N²) tree-walk.
    const bodyOpacityByPath = new Map<string, number>();

    // Iterate CellTile.detailMesh instances and write per-slot iFade values.
    const cells = world.getCells();
    for (const cell of cells.values()) {
      const iFadeAttr = cell.detailMesh.geometry.getAttribute('iFade') as
        | THREE.BufferAttribute
        | undefined;
      if (!iFadeAttr) continue;

      for (let slot = 0; slot < cell.buildings.length; slot++) {
        const building = cell.buildings[slot];
        if (!building?.file) continue;

        const tier = _tierFor(building.file, bldgTargetFile, dirTarget, hoverFile, fadeCfg);

        // Translate detail + bodyOpacity → final values written to iFade.
        // Full       → body visible at bodyOpacity, full facade detail.
        // Silhouette → body visible at bodyOpacity, shader skips per-cell
        //              window/door/slab math and renders solid base color.
        // Hidden     → body opacity 0; only the per-instance outline
        //              composites at face edges, leaving the road visible
        //              through the empty body.
        const opacity = tier.detail === FadeDetail.Hidden ? 0 : tier.bodyOpacity;
        const silhouette = tier.detail === FadeDetail.Silhouette ? 1 : 0;
        const outlineOpacity = tier.outlineEnabled ? tier.outlineOpacity : 0;

        iFadeAttr.setXYZ(slot, opacity, silhouette, outlineOpacity);
        bodyOpacityByPath.set(building.file.path, opacity);
      }

      iFadeAttr.needsUpdate = true;
    }

    // Mirror the body opacity onto the ad panel mesh: each media
    // building's 4 panel instances pick up the same opacity tier as the
    // building body itself. Skipped silently when no media files exist
    // in this manifest.
    const adPanels = world.getAdPanels();
    if (adPanels) {
      adPanels.applyBuildingFades((path) => bodyOpacityByPath.get(path) ?? null);
    }
  }

  // Selection / hover / config changes all trigger a full sweep. Separate
  // effects per signal keep tracking narrow.
  const _unsubSel = effect(() => {
    void picker.selection.value;
    _sweepAll();
  });
  const _unsubHov = effect(() => {
    void picker.hover.value;
    _sweepAll();
  });

  // Re-sweep after a manifest rebuild — new cells start with fresh iFade
  // buffers (opacity=1.0, silhouette=0, outlineOpacity=0) and the current
  // selection still applies. Tracks cityRevision only; _sweepAll reads
  // picker.selection/hover + BUILDINGS, so it runs untracked to keep this
  // effect from doubling up with the selection/hover/config effects above.
  const _unsubChange = effect(() => {
    void cityState.cityRevision.value;
    untracked(_sweepAll);
  });

  // BUILDINGS config (tier thresholds, body opacity, detail mode)
  // controls every value _sweepAll reads. Resweep on any change so dragging
  // a slider in the controls pane updates the scene live.
  const _unsubCfg = effect(() => {
    void BUILDINGS.value;
    _sweepAll();
  });

  // update() kept as a no-op for API compatibility: the buildings tick()
  // calls fader.update(0) each frame. With the subscription-driven model,
  // all real work is done on change events, not per-frame.
  function update(_dtMs: number): void {
    // intentional no-op — fading is now event-driven via subscriptions above.
  }

  function dispose(): void {
    _unsubSel();
    _unsubHov();
    _unsubChange();
    _unsubCfg();
  }

  return { update, dispose };
}
