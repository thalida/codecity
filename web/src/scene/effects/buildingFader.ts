// scene/effects/buildingFader.ts — per-instance opacity writes for the
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
//   outlineRenderer → ghost/outline opacities          (Task 12)
//   ghostRenderer   → ghost mesh opacity               (Task 13)
//
// The fader writes iFade on each CellTile.detailMesh (vec3 layout).

import * as THREE from 'three';
import { BUILDING_FADE } from '@/config/index.js';
import { FadeDetail, NodeKind } from '@/types';
import type { DirNode, FileNode, PickTarget } from '@/types';
import { parentDirPath } from '@/scene/utils/path.js';
import type { createWorld } from '@/scene/world.js';
import type { createPicker } from '@/scene/system/picker.js';

interface TierResult {
  detail: FadeDetail;
  bodyOpacity: number;
  outlineEnabled: boolean;
  outlineOpacity: number;
}

function _dirTreeDistance(file: FileNode | null, dir: DirNode): number {
  if (!file || !file.path || !dir || dir.path == null) return Infinity;
  let parent = parentDirPath(file.path);
  if (parent == null) parent = '.';
  if (parent === dir.path) return 0;
  const ap = parent === '.' || parent === '' ? [] : parent.split('/');
  const dp = dir.path === '.' || dir.path === '' ? [] : dir.path.split('/');
  let lca = 0;
  while (lca < ap.length && lca < dp.length && ap[lca] === dp[lca]) lca++;
  return ap.length - lca + (dp.length - lca);
}

export function createBuildingFader({
  cityScene,
  picker,
}: {
  cityScene: ReturnType<typeof createWorld>;
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
          const ps = cityScene.getStreetByDir(pp);
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
          const hs = cityScene.getStreetByDir(hp);
          if (hs) dirTarget = hs.dir;
        }
      }
    }
    return dirTarget;
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
    fadeCfg: ReturnType<typeof BUILDING_FADE.get>,
  ): TierResult {
    let detail: FadeDetail;
    let bodyOpacity: number;
    let outlineEnabled: boolean;
    let outlineOpacity: number;

    if (bldgTargetFile && file.path === bldgTargetFile.path) {
      // Selected building: always full body, no per-building outline
      // (the dedicated selectedOutline mesh from outlineRenderer handles it).
      detail = FadeDetail.Full;
      bodyOpacity = 1.0;
      outlineEnabled = false;
      outlineOpacity = 0;
    } else if (dirTarget) {
      const dist = _dirTreeDistance(file, dirTarget);
      if (dist === 0) {
        detail = fadeCfg.DEFAULT_DETAIL;
        bodyOpacity = fadeCfg.DEFAULT_BODY_OPACITY;
        outlineEnabled = fadeCfg.DEFAULT_OUTLINE;
        outlineOpacity = fadeCfg.DEFAULT_OUTLINE_OPACITY;
      } else if (dist === 1) {
        detail = fadeCfg.NEAR_DETAIL;
        bodyOpacity = fadeCfg.NEAR_BODY_OPACITY;
        outlineEnabled = fadeCfg.NEAR_OUTLINE;
        outlineOpacity = fadeCfg.NEAR_OUTLINE_OPACITY;
      } else {
        detail = fadeCfg.FAR_DETAIL;
        bodyOpacity = fadeCfg.FAR_BODY_OPACITY;
        outlineEnabled = fadeCfg.FAR_OUTLINE;
        outlineOpacity = fadeCfg.FAR_OUTLINE_OPACITY;
      }
    } else {
      detail = fadeCfg.DEFAULT_DETAIL;
      bodyOpacity = fadeCfg.DEFAULT_BODY_OPACITY;
      outlineEnabled = fadeCfg.DEFAULT_OUTLINE;
      outlineOpacity = fadeCfg.DEFAULT_OUTLINE_OPACITY;
    }

    if (hoverFile && file.path === hoverFile.path) {
      detail = fadeCfg.DEFAULT_DETAIL;
      bodyOpacity = fadeCfg.DEFAULT_BODY_OPACITY;
      outlineEnabled = false; // hover outline is owned by outlineRenderer
      outlineOpacity = 0;
    }

    return { detail, bodyOpacity, outlineEnabled, outlineOpacity };
  }

  function _sweepAll(): void {
    const sel = picker.selection.get();
    const hov = picker.hover.get();

    const bldgTargetFile =
      sel && sel.kind === NodeKind.File ? sel.file : null;
    const dirTarget = _resolveDirTarget(sel, hov);
    const hoverFile = hov && hov.kind === NodeKind.File ? hov.file : null;

    const fadeCfg = BUILDING_FADE.get();

    // Iterate CellTile.detailMesh instances and write per-slot iFade values.
    const cells = cityScene.getCells();
    for (const cell of cells.values()) {
      const iFadeAttr = cell.detailMesh.geometry.getAttribute('iFade') as THREE.BufferAttribute | undefined;
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
        const opacity        = tier.detail === FadeDetail.Hidden ? 0 : tier.bodyOpacity;
        const silhouette     = tier.detail === FadeDetail.Silhouette ? 1 : 0;
        const outlineOpacity = tier.outlineEnabled ? tier.outlineOpacity : 0;

        iFadeAttr.setXYZ(slot, opacity, silhouette, outlineOpacity);
      }

      iFadeAttr.needsUpdate = true;
    }
  }

  // Subscribe to selection and hover. Either change triggers a full sweep.
  // Unsubscribe handles are kept so dispose() can clean them up.
  const _unsubSel = picker.selection.subscribe(() => _sweepAll());
  const _unsubHov = picker.hover.subscribe(() => _sweepAll());

  // Re-sweep after a manifest rebuild — new blocks have fresh iFade
  // buffers (opacity=1.0, silhouette=0, outlineOpacity=0) and the current selection still applies.
  const _unsubChange = cityScene.onChange(() => _sweepAll());

  // BUILDING_FADE config (tier thresholds, body opacity, detail mode)
  // controls every value _sweepAll reads. Resweep on any change so
  // dragging a slider in the controls pane updates the scene live.
  const _unsubCfg = BUILDING_FADE.subscribe(() => _sweepAll());

  // update() kept as a no-op for API compatibility: main.ts calls
  // fader.update(0) in the animation loop. With the subscription-driven
  // model, all real work is done on change events, not per-frame.
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
