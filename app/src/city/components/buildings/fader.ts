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
import { TIMELINE_MODE } from '@/state/stores/timeline';
import { FadeDetail, NodeKind } from '@/types';
import { resolveDirTarget, tierFor } from './fadeTiers';
import type { CellTile } from './cellTile';
import type { InstancedFacadePanels } from './facadePanels';
import type { createPicker } from '@/city/interaction/picker';
import type { CityState } from '@/city/state';

// Narrow world surface the fader needs (cells + facade panels are component-local).
// The street-by-dir lookup comes from cityState directly. Decouples the fader
// from the buildings component's broader handle.
interface FaderWorld {
  getCells(): Map<number, CellTile>;
  getFacadePanels(): InstancedFacadePanels | null;
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
  function _sweepAll(): void {
    // Timeline mode owns iFade per frame (scrub controller); a hover/select sweep
    // here would fight it. Live mode never takes this branch, so it stays identical.
    if (TIMELINE_MODE.peek()) return;
    const sel = picker.selection.value;
    const hov = picker.hover.value;

    const bldgTargetFile = sel && sel.kind === NodeKind.File ? sel.file : null;
    const dirTarget = resolveDirTarget(sel, hov, cityState.streetsByDirMap.peek());
    const hoverFile = hov && hov.kind === NodeKind.File ? hov.file : null;

    const fadeCfg = BUILDINGS.value;

    // Collected by the cell sweep, drained into the ad-panel sweep below
    // so a media building's facade panel dims by exactly the same factor as
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

        const tier = tierFor(building.file, bldgTargetFile, dirTarget, hoverFile, fadeCfg);

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

    // Mirror the body opacity onto the facade panel mesh: each media
    // building's 4 panel instances pick up the same opacity tier as the
    // building body itself. Skipped silently when no media files exist
    // in this manifest.
    const facadePanels = world.getFacadePanels();
    if (facadePanels) {
      facadePanels.applyBuildingFades((path) => bodyOpacityByPath.get(path) ?? null);
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
