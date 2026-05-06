// scene/effects/buildingFader.ts — per-instance opacity writes for the
// building InstancedMesh. Subscribes to picker.selection and picker.hover;
// on either change, sweeps all blocks and writes the iOpacity
// InstancedBufferAttribute for each instance based on tree-distance from
// the resolved directory target. Marks needsUpdate = true so the shader
// picks up the new alpha next frame.
//
// Per-frame cost: zero. All work happens once per selection/hover change.
//
// Field ownership:
//   buildingFader   → block.detailMesh geometry attribute 'iOpacity'
//   outlineRenderer → ghost/outline opacities          (Task 12)
//   ghostRenderer   → ghost mesh opacity               (Task 13)
//
// NOTE: userData.ghostOp and userData.outlineOp are no longer written here.
// Ownership of those fields transfers to Tasks 12 (outlineRenderer) and
// 13 (ghostRenderer) respectively.

import * as THREE from 'three';
import { BUILDING_FADE } from '@/config/index.js';
import { FadeDetail, NodeKind } from '@/types';
import type { DirNode, FileNode, PickTarget } from '@/types';
import { parentDirPath } from '@/scene/path.js';
import type { createCityScene } from '@/scene/cityScene.js';
import type { createPicker } from '@/scene/picker.js';

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
  cityScene: ReturnType<typeof createCityScene>;
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

  function _sweepAll(): void {
    const sel = picker.selection.get();
    const hov = picker.hover.get();

    const bldgTargetFile =
      sel && sel.kind === NodeKind.File ? sel.file : null;
    const dirTarget = _resolveDirTarget(sel, hov);
    const hoverFile = hov && hov.kind === NodeKind.File ? hov.file : null;

    const fadeCfg = BUILDING_FADE.get();

    for (const block of cityScene.getBlocks()) {
      if (!block.detailMesh) continue;
      const iOpacityAttr = block.detailMesh.geometry.getAttribute(
        'iOpacity'
      ) as THREE.InstancedBufferAttribute | undefined;
      const iSilhouetteAttr = block.detailMesh.geometry.getAttribute(
        'iSilhouette'
      ) as THREE.InstancedBufferAttribute | undefined;
      const iOutlineOpacityAttr = block.detailMesh.geometry.getAttribute(
        'iOutlineOpacity'
      ) as THREE.InstancedBufferAttribute | undefined;
      if (!iOpacityAttr || !iSilhouetteAttr || !iOutlineOpacityAttr) continue;

      for (let i = 0; i < block.buildings.length; i++) {
        const building = block.buildings[i];
        const f: FileNode = building.file;

        // Tier decision — mirrors the old per-frame tier logic, now snap-to-target.
        let bodyOpacity: number;
        let outlineOpacity: number;
        let outlineEnabled: boolean;
        let detail: FadeDetail;

        if (bldgTargetFile && f.path === bldgTargetFile.path) {
          // Selected building: always full body, no per-building outline
          // (the dedicated selectedOutline mesh from outlineRenderer handles it).
          detail = FadeDetail.Full;
          bodyOpacity = 1.0;
          outlineEnabled = false;
          outlineOpacity = 0;
        } else if (dirTarget) {
          const dist = _dirTreeDistance(f, dirTarget);
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
          // No selection / hover — everything renders at default tier.
          detail = fadeCfg.DEFAULT_DETAIL;
          bodyOpacity = fadeCfg.DEFAULT_BODY_OPACITY;
          outlineEnabled = fadeCfg.DEFAULT_OUTLINE;
          outlineOpacity = fadeCfg.DEFAULT_OUTLINE_OPACITY;
        }

        // Hover preview: a hovered file building snaps to DEFAULT tier.
        if (hoverFile && f.path === hoverFile.path) {
          detail = fadeCfg.DEFAULT_DETAIL;
          bodyOpacity = fadeCfg.DEFAULT_BODY_OPACITY;
          outlineEnabled = false; // hover outline is owned by outlineRenderer
          outlineOpacity = 0;
        }

        // Translate detail + bodyOpacity → final alpha written to iOpacity.
        // Full       → body is visible at bodyOpacity, full facade detail.
        // Silhouette → body is visible at bodyOpacity, shader skips per-cell
        //              window/door/slab math and renders solid base color.
        // Hidden     → body opacity is 0; only the per-instance outline
        //              composites at the face edges, leaving the road behind
        //              visible through the empty body.
        const iOpacity = detail === FadeDetail.Hidden ? 0 : bodyOpacity;
        const iSilhouette = detail === FadeDetail.Silhouette ? 1 : 0;
        const iOutlineOpacity = outlineEnabled ? outlineOpacity : 0;

        iOpacityAttr.setX(i, iOpacity);
        iSilhouetteAttr.setX(i, iSilhouette);
        iOutlineOpacityAttr.setX(i, iOutlineOpacity);
      }

      iOpacityAttr.needsUpdate = true;
      iSilhouetteAttr.needsUpdate = true;
      iOutlineOpacityAttr.needsUpdate = true;
    }
  }

  // Subscribe to selection and hover. Either change triggers a full sweep.
  // Unsubscribe handles are kept so dispose() can clean them up.
  const _unsubSel = picker.selection.subscribe(() => _sweepAll());
  const _unsubHov = picker.hover.subscribe(() => _sweepAll());

  // Re-sweep after a manifest rebuild — new blocks have fresh iOpacity
  // buffers (all 1.0) and the current selection still applies.
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
