// city/components/buildings/fader.ts — writes each cell's iFade attribute from
// the selection cascade. It owns iFade in Live mode; outline and ghost
// opacities belong to their own renderers. Subscription-driven, so the
// per-frame cost is zero: a sweep runs only when selection or hover changes.

import * as THREE from 'three';
import { effect, untracked } from '@preact/signals';
import { BUILDINGS } from '@/state/settings/fields/buildings';
import type { TimelineStore } from '@/state/stores/timeline';
import { FadeDetail, NodeKind } from '@/types';
import { resolveDirTarget, tierFor } from './fadeTiers';
import { setBuildingsTranslucent } from './material';
import type { CellTile } from './cellTile';
import type { InstancedFacadePanels } from './facadePanels';
import type { createPicker } from '@/city/interaction/picker';
import type { CitySceneState } from '@/city/state';

// Narrow surface, so the fader doesn't take the buildings component's whole
// handle; the street-by-dir lookup comes from sceneState directly.
interface FaderWorld {
  getCells(): Map<number, CellTile>;
  getFacadePanels(): InstancedFacadePanels | null;
}

export function createBuildingFader({
  world,
  sceneState,
  picker,
  timeline,
}: {
  world: FaderWorld;
  sceneState: CitySceneState;
  picker: ReturnType<typeof createPicker>;
  /** This city's history, when something scrubs it. */
  timeline: TimelineStore | null;
}) {
  function _sweepAll(): void {
    // Timeline mode owns iFade per frame (scrub controller); a hover/select sweep
    // here would fight it. Live mode never takes this branch, so it stays identical.
    if (timeline?.mode.peek()) return;
    const sel = picker.selection.value;
    const hov = picker.hover.value;

    const bldgTargetFile = sel && sel.kind === NodeKind.File ? sel.file : null;
    const dirTarget = resolveDirTarget(sel, hov, sceneState.streetsByDirMap.peek());
    const hoverFile = hov && hov.kind === NodeKind.File ? hov.file : null;

    const fadeCfg = BUILDINGS.value;

    // Built here rather than inside applyBuildingFades' per-slot callback,
    // which would re-walk the tree per slot.
    const bodyOpacityByPath = new Map<string, number>();

    // Idle resolves every tier to full opacity, so the common case (nothing
    // selected or hovered) leaves the city in the opaque queue.
    let anyTranslucent = false;

    // Iterate CellTile.detailMesh instances and write per-slot iFade values.
    const cells = world.getCells();
    for (const cell of cells.values()) {
      const iFadeAttr = cell.detailMesh.geometry.getAttribute('iFade') as
        THREE.BufferAttribute | undefined;
      if (!iFadeAttr) continue;

      for (let slot = 0; slot < cell.buildings.length; slot++) {
        const building = cell.buildings[slot];
        if (!building?.file) continue;

        const tier = tierFor(building.file, bldgTargetFile, dirTarget, hoverFile, fadeCfg);

        // Hidden zeroes the body so only the outline composites at face edges,
        // leaving the road visible through it; Silhouette keeps the body.
        const opacity = tier.detail === FadeDetail.Hidden ? 0 : tier.bodyOpacity;
        const silhouette = tier.detail === FadeDetail.Silhouette ? 1 : 0;
        const outlineOpacity = tier.outlineEnabled ? tier.outlineOpacity : 0;

        iFadeAttr.setXYZ(slot, opacity, silhouette, outlineOpacity);
        bodyOpacityByPath.set(building.file.path, opacity);
        if (opacity < 1) anyTranslucent = true;
      }

      iFadeAttr.needsUpdate = true;
    }

    setBuildingsTranslucent(anyTranslucent);

    // A media building's 4 panels take the same tier as its body, so the
    // billboard dims with the wall it sits on.
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

  // A rebuild resets iFade to opaque while the selection still stands.
  // untracked: _sweepAll's own reads would double this up with the effects above.
  const _unsubChange = effect(() => {
    void sceneState.cityRevision.value;
    untracked(_sweepAll);
  });

  // Every value _sweepAll reads comes from BUILDINGS, so dragging a slider in
  // the controls pane has to re-sweep to show up.
  const _unsubCfg = effect(() => {
    void BUILDINGS.value;
    _sweepAll();
  });

  // No-op: the buildings tick() still calls this each frame, but the real work
  // is subscription-driven.
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
