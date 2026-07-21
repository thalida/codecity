// city/timeline/scrubController.ts — per-frame building driver for Timeline mode.
//
// Reads SCRUB_POS and writes each union building's height (instance matrix
// scaleY, tween.ts field) + presence opacity (iFade.x, fader.ts field) with no
// re-pack. It owns BOTH fields while in mode; the tween queue and fader are
// dormant (index.ts gates them on TIMELINE_MODE).

import * as THREE from 'three';

import { SCRUB_POS } from '@/state/stores/timeline';
import { buildingHeightForLines } from '@/city/layout/dimensions';
import type { HeightContext } from '@/city/layout/dimensions';
import type { Building } from '@/types';
import type { BuildingIndex } from '@/city/components/buildings/buildingIndex';
import { linesAt, presenceAt } from './replay';
import type { PathTimeline } from './replay';

// v1: deleted things fully vanish. A future "ghost ruins" toggle flips this to a
// small floor so removed buildings persist faintly.
export const RUIN_FLOOR = 0;

export interface ScrubControllerDeps {
  getBuildingIndex(): BuildingIndex | null;
  getMeshForBuilding(b: Building): { mesh: THREE.InstancedMesh; slot: number } | null;
  timelines: Map<string, PathTimeline>;
  heightCtx: HeightContext;
}

export function createScrubController(deps: ScrubControllerDeps) {
  // Pair each union building with its replay timeline once; buildings without a
  // timeline (never touched in the window) are left at their baseline.
  const entries: { b: Building; pt: PathTimeline }[] = [];
  const index = deps.getBuildingIndex();
  if (index) {
    for (const b of index.byPath.values()) {
      const path = b.file?.path;
      if (!path) continue;
      const pt = deps.timelines.get(path);
      if (pt) entries.push({ b, pt });
    }
  }

  const _m = new THREE.Matrix4();

  function update(): void {
    const pos = SCRUB_POS.peek();
    const dirtyMeshes = new Set<THREE.InstancedMesh>();
    const dirtyFades = new Set<THREE.BufferAttribute>();

    for (const { b, pt } of entries) {
      const resolved = deps.getMeshForBuilding(b);
      if (!resolved) continue;
      const { mesh, slot } = resolved;

      const lines = linesAt(pt, pos);
      const f = lines > 0 && b.h > 0 ? buildingHeightForLines(b.file, lines, deps.heightCtx) / b.h : 0;
      const sy = b.h * f;
      _m.makeScale(b.w, sy, b.d);
      _m.setPosition(b.x, sy / 2, b.y);
      mesh.setMatrixAt(slot, _m);
      dirtyMeshes.add(mesh);

      const iFade = mesh.geometry.getAttribute('iFade') as THREE.BufferAttribute | undefined;
      if (iFade) {
        const op = presenceAt(pt, pos, RUIN_FLOOR);
        iFade.setXYZ(slot, op, iFade.getY(slot), iFade.getZ(slot));
        dirtyFades.add(iFade);
      }
    }

    for (const mesh of dirtyMeshes) mesh.instanceMatrix.needsUpdate = true;
    for (const iFade of dirtyFades) iFade.needsUpdate = true;
  }

  function dispose(): void {
    entries.length = 0;
  }

  return { update, dispose };
}
